"""
Achievements (START + LINKS + LEADS + EARNINGS + GAME + ACTIVITY): metrics, unlock rows, XP via ``XPEvent`` idempotency.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import ROUND_DOWN, Decimal
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import F, Max, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from .achievements_definitions import ALL_ACHIEVEMENTS, get_achievement_definition
from .gamification import build_gamification_leaderboard
from .gamification_game import replay_daily_challenge_line_metrics
from .models import (
    Commission,
    DailyChallengeAttempt,
    GamificationProfile,
    Order,
    PartnerProfile,
    ReferralVisit,
    SiteMembership,
    UserAchievement,
    XPEvent,
)


def _programs_joined_count(user) -> int:
    return SiteMembership.objects.filter(user=user).count()


def _has_referral_link(user) -> bool:
    """
    True if the user has a partner profile (persistent ``ref_code`` → dashboard / share link).
    """
    return PartnerProfile.objects.filter(user_id=user.pk).exists()


def _is_profile_complete(user) -> bool:
    """
    MVP: non-empty ФИО and phone. TODO: align with product rules if a dedicated completeness flag appears.
    """
    fio = (getattr(user, "fio", None) or "").strip()
    phone = (getattr(user, "phone", None) or "").strip()
    return bool(fio and phone)


def _total_referral_clicks(user) -> int:
    """
    Count ``ReferralVisit`` rows for this user's partner profile (clicks on their ref links).
    """
    partner = PartnerProfile.objects.filter(user_id=user.pk).first()
    if partner is None:
        return 0
    return ReferralVisit.objects.filter(partner_id=partner.pk).count()


def _confirmed_paid_orders_qs(partner: PartnerProfile | None):
    """Paid ``Order`` rows attributed to the partner (same bar as referral leaderboard / payouts)."""
    if partner is None:
        return Order.objects.none()
    return Order.objects.filter(partner_id=partner.pk, status=Order.Status.PAID)


def total_confirmed_leads(partner: PartnerProfile | None) -> int:
    """Count of paid orders for the partner (business \"confirmed lead\" in this codebase)."""
    return _confirmed_paid_orders_qs(partner).count()


def confirmed_leads_last_7_days(partner: PartnerProfile | None, *, now) -> int:
    """Paid orders whose effective time (``paid_at`` or ``created_at``) is within the last 7 days from ``now``."""
    if partner is None:
        return 0
    since = now - timedelta(days=7)
    return (
        _confirmed_paid_orders_qs(partner)
        .annotate(eff_ts=Coalesce(F("paid_at"), F("created_at")))
        .filter(eff_ts__gte=since)
        .count()
    )


def confirmed_leads_programs_count(partner: PartnerProfile | None, partner_user) -> int:
    """
    Distinct ``Site`` ids where the partner user has a non-empty ``SiteMembership.ref_code``
    that matches at least one paid ``Order.ref_code``.

    ``Order`` has no ``Site`` FK (see ``member_referrer_money_totals``); this uses the existing
    per-program ref snapshot on ``SiteMembership`` when webhooks echo that ref on orders.
    """
    if partner is None:
        return 0
    ref_to_site: dict[str, int] = {}
    for site_id, ref in SiteMembership.objects.filter(user_id=partner_user.pk).exclude(
        ref_code=""
    ).values_list("site_id", "ref_code"):
        rc = (ref or "").strip()
        if rc:
            ref_to_site[rc] = int(site_id)
    if not ref_to_site:
        return 0
    seen: set[int] = set()
    for ref in (
        _confirmed_paid_orders_qs(partner)
        .exclude(ref_code="")
        .values_list("ref_code", flat=True)
        .distinct()
    ):
        rc = (ref or "").strip()
        sid = ref_to_site.get(rc)
        if sid is not None:
            seen.add(sid)
    return len(seen)


def _commissions_on_paid_orders_qs(partner: PartnerProfile | None):
    """
    Commission rows whose related order is PAID (realized referral sale).

    Excludes accruals attached to unpaid/cancelled orders so stray ``PENDING`` rows
    on non-paid orders do not count toward earnings achievements.
    """
    if partner is None:
        return Commission.objects.none()
    return Commission.objects.filter(partner_id=partner.pk, order__status=Order.Status.PAID)


def total_commissions_count(partner: PartnerProfile | None) -> int:
    """Number of commission accruals attributed to paid orders for this partner."""
    return _commissions_on_paid_orders_qs(partner).count()


def total_earned_amount(partner: PartnerProfile | None) -> int:
    """Sum of ``commission_amount`` (whole currency units, floored) for commissions on paid orders."""
    agg = _commissions_on_paid_orders_qs(partner).aggregate(t=Sum("commission_amount"))
    total = agg["t"] or Decimal("0")
    return int(total.to_integral_value(rounding=ROUND_DOWN))


def withdrawals_count(_partner: PartnerProfile | None) -> int:
    """
    Count of withdrawal / payout requests for the partner.

    TODO: wire to a withdrawal-request model when it exists (none under ``referrals`` today).
    """
    return 0


def _local_date_from_dt(dt) -> date | None:
    if dt is None:
        return None
    return timezone.localtime(dt).date()


def _collect_activity_dates(user) -> set[date]:
    """Union of local calendar days with qualifying user actions (see ``activity_metrics``)."""
    dates: set[date] = set()

    for dt in (
        DailyChallengeAttempt.objects.filter(
            user_id=user.pk,
            status=DailyChallengeAttempt.Status.COMPLETED,
        )
        .exclude(completed_at=None)
        .values_list("completed_at", flat=True)
    ):
        ld = _local_date_from_dt(dt)
        if ld:
            dates.add(ld)

    for dt in SiteMembership.objects.filter(user_id=user.pk).values_list("created_at", flat=True):
        ld = _local_date_from_dt(dt)
        if ld:
            dates.add(ld)

    partner = PartnerProfile.objects.filter(user_id=user.pk).first()
    if partner is not None:
        for dt in ReferralVisit.objects.filter(partner_id=partner.pk).values_list(
            "created_at", flat=True
        ):
            ld = _local_date_from_dt(dt)
            if ld:
                dates.add(ld)

        for eff in (
            Order.objects.filter(partner_id=partner.pk, status=Order.Status.PAID)
            .annotate(eff_ts=Coalesce(F("paid_at"), F("created_at")))
            .values_list("eff_ts", flat=True)
        ):
            ld = _local_date_from_dt(eff)
            if ld:
                dates.add(ld)

    for dt in (
        XPEvent.objects.filter(user_id=user.pk)
        .exclude(source=XPEvent.Source.ACHIEVEMENT)
        .values_list("created_at", flat=True)
    ):
        ld = _local_date_from_dt(dt)
        if ld:
            dates.add(ld)

    return dates


def _calendar_streak_days(active_dates: set[date]) -> int:
    """Length of consecutive calendar days ending at the user's latest active day."""
    if not active_dates:
        return 0
    d = max(active_dates)
    streak = 0
    while d in active_dates:
        streak += 1
        d -= timedelta(days=1)
    return streak


def _returned_after_break(active_dates: set[date], today: date, *, min_calendar_gap_days: int = 8) -> int:
    """
    1 if ``today`` is active and the prior active day is at least ``min_calendar_gap_days``
    earlier (>= 7 inactive calendar days between them).
    """
    if today not in active_dates:
        return 0
    earlier = [x for x in active_dates if x < today]
    if not earlier:
        return 0
    prev = max(earlier)
    if (today - prev).days >= min_calendar_gap_days:
        return 1
    return 0


def rating_metrics(user, *, now=None) -> dict[str, int]:
    """
    Referral sales leaderboard ranks (same rules as ``/referrals/gamification/leaderboard/``).

    ``overall_rank`` / ``weekly_rank`` are 0 when the user has no ``PartnerProfile`` row or no rank.
    """
    now = now if now is not None else timezone.now()
    overall = build_gamification_leaderboard(user, "all", now=now)
    weekly = build_gamification_leaderboard(user, "week", now=now)
    rk_o = overall["current_user"].get("rank")
    rk_w = weekly["current_user"].get("rank")
    overall_rank = int(rk_o) if rk_o is not None else 0
    weekly_rank = int(rk_w) if rk_w is not None else 0
    is_in_ranking = 1 if rk_o is not None else 0
    return {
        "overall_rank": overall_rank,
        "weekly_rank": weekly_rank,
        "is_in_ranking": is_in_ranking,
    }


def activity_metrics(user, *, today: date | None = None) -> dict[str, int]:
    """
    ``current_activity_streak_days``: consecutive calendar days ending at last activity.

    ``total_active_days``: distinct days with any qualifying action.

    ``returned_after_7_days``: activity on ``today`` after >= 7-day gap since previous activity.

    Qualifying actions: completed daily challenge, site membership created, referral visits,
    paid orders as partner, and non-achievement ``XPEvent`` rows.
    """
    active_dates = _collect_activity_dates(user)
    today_d = timezone.localdate(timezone.now()) if today is None else today
    return {
        "current_activity_streak_days": _calendar_streak_days(active_dates),
        "total_active_days": len(active_dates),
        "returned_after_7_days": _returned_after_break(active_dates, today_d),
    }


def mini_game_metrics(user) -> dict[str, int]:
    """
    Daily challenge (Block Blast) stats from completed ``DailyChallengeAttempt`` rows.

    ``max_combo`` is **not** persisted separately today; it mirrors
    ``max_lines_cleared_single_move`` until a dedicated combo chain exists in stored results.

    ``best_score`` uses ``GamificationProfile.best_challenge_score`` and completed attempts' scores.
    """
    qs = DailyChallengeAttempt.objects.filter(
        user_id=user.pk, status=DailyChallengeAttempt.Status.COMPLETED
    )
    games_played_count = qs.count()
    total_lines_cleared = 0
    max_lines_cleared_single_move = 0
    for att in qs.iterator(chunk_size=100):
        moves = att.move_log if isinstance(att.move_log, list) else []
        sc, tl, mx = replay_daily_challenge_line_metrics(int(att.rng_seed), moves)
        if sc is None:
            continue
        total_lines_cleared += tl
        if mx > max_lines_cleared_single_move:
            max_lines_cleared_single_move = mx

    profile = GamificationProfile.objects.filter(user_id=user.pk).first()
    prof_best = int(profile.best_challenge_score) if profile else 0
    agg_best_i = int(qs.aggregate(m=Max("score"))["m"] or 0)
    best_score = max(prof_best, agg_best_i)

    max_combo = max_lines_cleared_single_move

    return {
        "games_played_count": games_played_count,
        "total_lines_cleared": total_lines_cleared,
        "max_lines_cleared_single_move": max_lines_cleared_single_move,
        "max_combo": max_combo,
        "best_score": best_score,
    }


def _raw_current_for_code(
    user,
    code: str,
    *,
    programs: int,
    clicks: int,
    leads_total: int,
    leads_programs: int,
    leads_last_7: int,
    earnings_commissions: int,
    earnings_rub: int,
    withdrawals: int,
    game_games: int,
    game_total_lines: int,
    game_max_lines_move: int,
    game_max_combo: int,
    game_best_score: int,
    activity_streak: int,
    activity_total_days: int,
    activity_returned: int,
    rating_overall_rank: int,
    rating_weekly_rank: int,
    rating_in_ranking: int,
) -> int:
    if code == "FIRST_PROGRAM_JOINED":
        return programs
    if code == "FIRST_REFERRAL_LINK":
        return 1 if _has_referral_link(user) else 0
    if code == "PROFILE_COMPLETED":
        return 1 if _is_profile_complete(user) else 0
    if code == "THREE_PROGRAMS_JOINED":
        return programs
    if code in (
        "FIRST_CLICK",
        "CLICKS_10",
        "CLICKS_50",
        "CLICKS_100",
        "CLICKS_250",
    ):
        return int(clicks)
    if code == "FIRST_CONFIRMED_LEAD":
        return int(leads_total)
    if code in ("CONFIRMED_LEADS_3", "CONFIRMED_LEADS_5", "CONFIRMED_LEADS_10"):
        return int(leads_total)
    if code == "LEADS_IN_3_PROGRAMS":
        return int(leads_programs)
    if code == "HOT_WEEK":
        return int(leads_last_7)
    if code == "FIRST_COMMISSION":
        return int(earnings_commissions)
    if code in ("EARNED_1000", "EARNED_5000", "EARNED_10000"):
        return int(earnings_rub)
    if code == "FIRST_WITHDRAWAL":
        return int(withdrawals)
    if code == "FIRST_GAME":
        return int(game_games)
    if code == "FIRST_LINE_CLEAR":
        return int(game_total_lines)
    if code == "DOUBLE_LINE_CLEAR":
        return int(game_max_lines_move)
    if code == "COMBO_X3":
        return int(game_max_combo)
    if code in ("SCORE_500", "SCORE_1500", "SCORE_3000"):
        return int(game_best_score)
    if code in ("STREAK_3_DAYS", "STREAK_7_DAYS", "STREAK_14_DAYS"):
        return int(activity_streak)
    if code == "ACTIVE_DAYS_10":
        return int(activity_total_days)
    if code == "RETURN_AFTER_7_DAYS":
        return int(activity_returned)
    if code == "ENTERED_RANKING":
        return int(rating_in_ranking)
    if code in ("TOP_100", "TOP_50"):
        return int(rating_overall_rank)
    if code in ("TOP_10_WEEK", "TOP_3_WEEK", "FIRST_PLACE_WEEK"):
        return int(rating_weekly_rank)
    return 0


RATING_MAX_RANK_CODES: dict[str, int] = {
    "TOP_100": 100,
    "TOP_50": 50,
    "TOP_10_WEEK": 10,
    "TOP_3_WEEK": 3,
}


def _rating_unlock_eligible(code: str, current: int, target: int) -> bool:
    """Unlock rule for rating achievements (rank thresholds use inclusive upper bound on rank)."""
    thr = RATING_MAX_RANK_CODES.get(code)
    if thr is not None:
        rank = int(current)
        return rank > 0 and rank <= thr
    if code == "FIRST_PLACE_WEEK":
        return int(current) == 1 and target == 1
    return int(current) >= int(target)


def _rating_progress_current_display(code: str, rm: dict[str, int]) -> int:
    if code == "ENTERED_RANKING":
        return int(rm["is_in_ranking"])
    if code in ("TOP_100", "TOP_50"):
        return int(rm["overall_rank"])
    return int(rm["weekly_rank"])


def _achievement_xp_idempotency_key(user_id: int, code: str) -> str:
    return f"achievement:{user_id}:{code}"


def _award_achievement_xp(user, code: str, amount: int) -> int:
    """
    Grant XP once per (user, achievement) using ``XPEvent`` unique ``idempotency_key``.
    Returns XP actually counted toward ``GamificationProfile`` (0 if already awarded).

    Duplicate ``XPEvent`` inserts (parallel unlock/sync) surface as ``IntegrityError`` on the
    unique ``idempotency_key``; nested ``atomic`` limits rollback to a savepoint so the caller
    transaction stays valid. Other ``IntegrityError`` causes are re-raised.
    """
    if amount <= 0:
        return 0
    idem = _achievement_xp_idempotency_key(user.pk, code)
    with transaction.atomic():
        profile, _ = GamificationProfile.objects.select_for_update().get_or_create(user=user)
        try:
            with transaction.atomic():
                XPEvent.objects.create(
                    user=user,
                    source=XPEvent.Source.ACHIEVEMENT,
                    amount=amount,
                    base_amount=amount,
                    multiplier=Decimal("1.0000"),
                    idempotency_key=idem,
                    metadata_json={"achievement_code": code},
                )
        except IntegrityError as exc:
            if XPEvent.objects.filter(idempotency_key=idem).exists():
                return 0
            raise exc
        profile.xp_total += amount
        profile.save(update_fields=["xp_total", "updated_at"])
        return amount


def unlock_achievement(user, code: str, current: int, target: int) -> UserAchievement | None:
    """
    If progress meets the definition, create ``UserAchievement`` (if missing) and award XP once.

    Rating ``TOP_*`` codes pass **rank** as ``current`` and unlock when rank is within the threshold;
    see ``RATING_MAX_RANK_CODES`` / ``_rating_unlock_eligible``.
    """
    defn = get_achievement_definition(code)
    if defn is None or defn.target != target:
        return None
    if not _rating_unlock_eligible(code, current, target):
        return None

    with transaction.atomic():
        existing = (
            UserAchievement.objects.select_for_update()
            .filter(user_id=user.pk, code=code)
            .first()
        )
        if existing:
            return existing

        xp_amount = defn.xp_reward
        awarded = _award_achievement_xp(user, code, xp_amount)
        pc = min(int(current), int(target))
        if code in RATING_MAX_RANK_CODES or code == "FIRST_PLACE_WEEK":
            pc = int(current)
        return UserAchievement.objects.create(
            user=user,
            code=code,
            xp_awarded=awarded,
            progress_current=pc,
            progress_target=int(target),
            metadata={},
        )


def sync_user_achievements(user) -> None:
    """Evaluate START + LINKS + LEADS + EARNINGS + GAME + ACTIVITY + RATING achievements."""
    programs = _programs_joined_count(user)
    clicks = _total_referral_clicks(user)
    partner = PartnerProfile.objects.filter(user_id=user.pk).first()
    now = timezone.now()
    leads_total = total_confirmed_leads(partner)
    leads_programs = confirmed_leads_programs_count(partner, user)
    leads_last_7 = confirmed_leads_last_7_days(partner, now=now)
    earnings_commissions = total_commissions_count(partner)
    earnings_rub = total_earned_amount(partner)
    withdrawals = withdrawals_count(partner)
    gm = mini_game_metrics(user)
    am = activity_metrics(user)
    rm = rating_metrics(user, now=now)
    for defn in ALL_ACHIEVEMENTS:
        raw = _raw_current_for_code(
            user,
            defn.code,
            programs=programs,
            clicks=clicks,
            leads_total=leads_total,
            leads_programs=leads_programs,
            leads_last_7=leads_last_7,
            earnings_commissions=earnings_commissions,
            earnings_rub=earnings_rub,
            withdrawals=withdrawals,
            game_games=gm["games_played_count"],
            game_total_lines=gm["total_lines_cleared"],
            game_max_lines_move=gm["max_lines_cleared_single_move"],
            game_max_combo=gm["max_combo"],
            game_best_score=gm["best_score"],
            activity_streak=am["current_activity_streak_days"],
            activity_total_days=am["total_active_days"],
            activity_returned=am["returned_after_7_days"],
            rating_overall_rank=rm["overall_rank"],
            rating_weekly_rank=rm["weekly_rank"],
            rating_in_ranking=rm["is_in_ranking"],
        )
        unlock_achievement(user, defn.code, raw, defn.target)


def get_user_achievement_progress(user) -> dict[str, Any]:
    """
    Build API payload (``items`` + ``summary``). Call ``sync_user_achievements`` first for live unlocks.
    """
    programs = _programs_joined_count(user)
    clicks = _total_referral_clicks(user)
    partner = PartnerProfile.objects.filter(user_id=user.pk).first()
    now = timezone.now()
    leads_total = total_confirmed_leads(partner)
    leads_programs = confirmed_leads_programs_count(partner, user)
    leads_last_7 = confirmed_leads_last_7_days(partner, now=now)
    earnings_commissions = total_commissions_count(partner)
    earnings_rub = total_earned_amount(partner)
    withdrawals = withdrawals_count(partner)
    gm = mini_game_metrics(user)
    am = activity_metrics(user)
    rm = rating_metrics(user, now=now)
    ua_by_code = {ua.code: ua for ua in UserAchievement.objects.filter(user=user)}
    items: list[dict[str, Any]] = []
    xp_from_achievements = 0
    unlocked_n = 0

    for defn in ALL_ACHIEVEMENTS:
        raw = _raw_current_for_code(
            user,
            defn.code,
            programs=programs,
            clicks=clicks,
            leads_total=leads_total,
            leads_programs=leads_programs,
            leads_last_7=leads_last_7,
            earnings_commissions=earnings_commissions,
            earnings_rub=earnings_rub,
            withdrawals=withdrawals,
            game_games=gm["games_played_count"],
            game_total_lines=gm["total_lines_cleared"],
            game_max_lines_move=gm["max_lines_cleared_single_move"],
            game_max_combo=gm["max_combo"],
            game_best_score=gm["best_score"],
            activity_streak=am["current_activity_streak_days"],
            activity_total_days=am["total_active_days"],
            activity_returned=am["returned_after_7_days"],
            rating_overall_rank=rm["overall_rank"],
            rating_weekly_rank=rm["weekly_rank"],
            rating_in_ranking=rm["is_in_ranking"],
        )
        ua = ua_by_code.get(defn.code)
        unlocked = ua is not None
        if unlocked:
            unlocked_n += 1
            xp_from_achievements += int(ua.xp_awarded or 0)
            if defn.category == "rating":
                if defn.code == "ENTERED_RANKING":
                    current_out = 1
                else:
                    current_out = _rating_progress_current_display(defn.code, rm)
            else:
                current_out = defn.target
            unlocked_at = ua.unlocked_at.isoformat() if ua.unlocked_at else None
        else:
            unlocked_at = None
            if defn.category == "rating":
                current_out = _rating_progress_current_display(defn.code, rm)
            else:
                current_out = min(int(raw), int(defn.target))

        items.append(
            {
                "code": defn.code,
                "title": defn.title,
                "description": defn.description,
                "category": defn.category,
                "xp_reward": defn.xp_reward,
                "target": defn.target,
                "current": current_out,
                "unlocked": unlocked,
                "unlocked_at": unlocked_at,
                "rarity": defn.rarity,
            }
        )

    return {
        "items": items,
        "summary": {
            "total": len(ALL_ACHIEVEMENTS),
            "unlocked": unlocked_n,
            "xp_from_achievements": xp_from_achievements,
        },
    }
