"""
Gamification / mini-game XP (challenge runs, streaks, lives). Future XP sources use ``XPEvent.Source``.
"""

from __future__ import annotations

import math
import secrets
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal
from typing import Any

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, F, Max, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from .gamification_game import replay_daily_challenge, validate_finish_timing
from .models import (
    DailyChallengeAttempt,
    GamificationProfile,
    Order,
    PartnerProfile,
    ReferralPointTransaction,
    ReferralShopOwnedItem,
    XPEvent,
)

# Sanity cap for submitted game scores (anti-abuse).
MAX_CHALLENGE_SCORE = 100_000

LEADERBOARD_TOP_N = 50

REFERRAL_LEADERBOARD_TOP_N = 50

CHALLENGE_LIFE_RECOVERY_INTERVAL = timedelta(hours=4)

# --- XP tiers by score (daily challenge base XP) ---
# score < 500 -> 2; 500..999 -> 4; 1000..1999 -> 7; score >= 2000 -> 10
DAILY_CHALLENGE_XP_TIERS: tuple[dict[str, Any], ...] = (
    {"min_score": 0, "max_score_exclusive": 500, "base_xp": 2},
    {"min_score": 500, "max_score_exclusive": 1000, "base_xp": 4},
    {"min_score": 1000, "max_score_exclusive": 2000, "base_xp": 7},
    {"min_score": 2000, "max_score_exclusive": None, "base_xp": 10},
)

# Streak day thresholds -> multiplier (highest matching tier wins).
STREAK_MULTIPLIER_TIERS: tuple[tuple[int, Decimal], ...] = (
    (30, Decimal("2.0")),
    (14, Decimal("1.7")),
    (7, Decimal("1.5")),
    (5, Decimal("1.3")),
    (3, Decimal("1.2")),
    (2, Decimal("1.1")),
    (1, Decimal("1.0")),
)

# Level curve: XP required to *reach* level L (L >= 1). Level 1 starts at 0 XP.
# Cumulative XP to reach level L is 150 * L * (L - 1); step k→k+1 is 300*k.


def local_today() -> date:
    """Calendar day for challenge boundaries (timezone-aware). Patch in tests."""
    return timezone.localdate()


def _leaderboard_display_name(user) -> str:
    """Public-ish label for daily leaderboard (no raw email)."""
    if user is None:
        return "Игрок"
    fio = (getattr(user, "fio", "") or "").strip()
    if fio:
        return fio if len(fio) <= 48 else fio[:45] + "…"
    username = (getattr(user, "username", "") or "").strip()
    if username:
        return username if len(username) <= 48 else username[:45] + "…"
    pid = (getattr(user, "public_id", "") or "").strip()
    if pid:
        return f"Игрок {pid}"
    return "Игрок"


def build_daily_challenge_leaderboard(limit: int = LEADERBOARD_TOP_N) -> dict[str, Any]:
    """
    Best completed challenge score per user for the current local calendar day, top ``limit``.
    """
    today = local_today()
    lim = max(1, min(int(limit), LEADERBOARD_TOP_N))
    ranked = (
        DailyChallengeAttempt.objects.filter(
            status=DailyChallengeAttempt.Status.COMPLETED,
            challenge_date=today,
        )
        .values("user_id")
        .annotate(best_score=Max("score"))
        .order_by("-best_score")[:lim]
    )
    rows_raw = list(ranked)
    User = get_user_model()
    users = User.objects.in_bulk([r["user_id"] for r in rows_raw])
    rows: list[dict[str, Any]] = []
    for rank, r in enumerate(rows_raw, start=1):
        uid = r["user_id"]
        u = users.get(uid)
        rows.append(
            {
                "rank": rank,
                "user_id": uid,
                "name": _leaderboard_display_name(u),
                "score": int(r["best_score"]),
            }
        )
    return {
        "challenge_date": today.isoformat(),
        "limit": lim,
        "rows": rows,
    }


def get_or_create_gamification_profile(user) -> GamificationProfile:
    profile, _ = GamificationProfile.objects.get_or_create(user=user)
    return profile


def xp_threshold_for_level(level: int) -> int:
    """Minimum total XP to be at least ``level`` (level is 1-indexed)."""
    if level <= 1:
        return 0
    return 150 * (level - 1) * level


def calculate_level(xp_total: int) -> int:
    """Current level from total XP (levels start at 1)."""
    if xp_total < 0:
        xp_total = 0
    level = 1
    while xp_threshold_for_level(level + 1) <= xp_total:
        level += 1
    return level


def get_level_progress(xp_total: int) -> dict[str, int]:
    """XP within current level and gap to the next level."""
    if xp_total < 0:
        xp_total = 0
    level = calculate_level(xp_total)
    floor_xp = xp_threshold_for_level(level)
    ceiling_xp = xp_threshold_for_level(level + 1)
    xp_into_level = xp_total - floor_xp
    xp_span = ceiling_xp - floor_xp
    xp_remaining_for_next = max(0, ceiling_xp - xp_total)
    return {
        "level": level,
        "xp_into_level": xp_into_level,
        "xp_for_current_level_span": xp_span,
        "xp_remaining_for_next_level": xp_remaining_for_next,
    }


def get_streak_multiplier(streak_days: int) -> Decimal:
    if streak_days < 1:
        streak_days = 1
    for min_days, mult in STREAK_MULTIPLIER_TIERS:
        if streak_days >= min_days:
            return mult
    return Decimal("1.0")


def calculate_daily_challenge_base_xp(score: int) -> int:
    if score < 500:
        return 2
    if score < 1000:
        return 4
    if score < 2000:
        return 7
    return 10


def _validate_challenge_score(score: Any) -> int:
    if isinstance(score, bool) or not isinstance(score, int):
        raise ValidationError("invalid_score", code="invalid_score")
    if score < 0 or score > MAX_CHALLENGE_SCORE:
        raise ValidationError("invalid_score", code="invalid_score")
    return score


def _validate_optional_client_score(score: Any) -> int | None:
    if score is None:
        return None
    return _validate_challenge_score(score)


def _apply_streak_on_activity(profile: GamificationProfile, activity_date: date) -> None:
    """
    Update streak for an activity on ``activity_date`` (idempotent same calendar day).

    If exactly one calendar day was missed since ``last_activity_date`` and the user has a streak
    shield, the streak continues and one shield is consumed.
    """
    if profile.last_activity_date == activity_date:
        return
    if profile.last_activity_date is None:
        profile.streak_days = 1
    else:
        gap_days = (activity_date - profile.last_activity_date).days
        if gap_days == 1:
            profile.streak_days += 1
        elif gap_days == 2 and profile.streak_shields_available > 0:
            profile.streak_days += 1
            profile.streak_shields_available -= 1
        else:
            profile.streak_days = 1
    profile.last_activity_date = activity_date


def is_fast_life_regen_active(profile: GamificationProfile, now) -> bool:
    u = profile.fast_life_regen_until
    return u is not None and u > now


def _effective_life_recovery_interval(profile: GamificationProfile, now) -> timedelta:
    base = CHALLENGE_LIFE_RECOVERY_INTERVAL
    if is_fast_life_regen_active(profile, now):
        return base / 2
    return base


def refresh_challenge_lives(profile: GamificationProfile, now) -> None:
    """
    Apply elapsed recovery intervals; ensure a timer exists when below max lives.
    """
    interval = _effective_life_recovery_interval(profile, now)
    while profile.lives_current < profile.lives_max:
        if profile.next_life_at is None:
            break
        if now < profile.next_life_at:
            break
        profile.lives_current += 1
        profile.last_life_refill_at = now
        if profile.lives_current >= profile.lives_max:
            profile.next_life_at = None
            break
        profile.next_life_at = profile.next_life_at + interval

    if profile.lives_current >= profile.lives_max:
        profile.next_life_at = None
    elif profile.next_life_at is None:
        profile.next_life_at = now + interval


def get_life_recovery_seconds(profile: GamificationProfile, now) -> int | None:
    if profile.lives_current >= profile.lives_max:
        return None
    if profile.next_life_at is None:
        return None
    delta = (profile.next_life_at - now).total_seconds()
    return max(0, int(math.ceil(delta)))


def can_start_challenge_run(profile: GamificationProfile, now) -> bool:
    refresh_challenge_lives(profile, now)
    return profile.lives_current > 0


def consume_challenge_life(profile: GamificationProfile, now) -> None:
    interval = _effective_life_recovery_interval(profile, now)
    profile.lives_current -= 1
    if profile.lives_current < profile.lives_max and profile.next_life_at is None:
        profile.next_life_at = now + interval


def _challenge_xp_idempotency_key(attempt_public_id: uuid.UUID) -> str:
    return f"daily_challenge:{attempt_public_id}"


def _award_decimal_to_int(base: int, multiplier: Decimal) -> int:
    v = (Decimal(base) * multiplier).quantize(Decimal("1"), rounding=ROUND_FLOOR)
    return max(0, int(v))


def _active_attempt_dict(attempt: DailyChallengeAttempt | None) -> dict[str, Any] | None:
    if attempt is None or attempt.status != DailyChallengeAttempt.Status.STARTED:
        return None
    return {
        "attempt_public_id": str(attempt.public_id),
        "rng_seed": attempt.rng_seed,
    }


def build_gamification_summary(user) -> dict[str, Any]:
    profile = get_or_create_gamification_profile(user)
    now = timezone.now()
    refresh_challenge_lives(profile, now)
    profile.save(
        update_fields=[
            "lives_current",
            "lives_max",
            "next_life_at",
            "last_life_refill_at",
            "updated_at",
        ]
    )

    xp_total = profile.xp_total
    level = calculate_level(xp_total)
    progress = get_level_progress(xp_total)
    streak_mult = get_streak_multiplier(profile.streak_days)
    recovery_seconds = get_life_recovery_seconds(profile, now)
    next_iso = profile.next_life_at.isoformat() if profile.next_life_at else None
    fast_regen_iso = profile.fast_life_regen_until.isoformat() if profile.fast_life_regen_until else None
    eff_hours = 2 if is_fast_life_regen_active(profile, now) else 4
    active_frame = (getattr(profile, "active_minigame_frame", None) or "").strip()

    active = (
        DailyChallengeAttempt.objects.filter(user=user, status=DailyChallengeAttempt.Status.STARTED)
        .order_by("-started_at")
        .first()
    )

    referral_sales_rub = _referral_sales_rub_all_time(user)
    league_id = calculate_referral_league_id(
        referral_sales_rub,
        level,
        int(profile.streak_days),
    )

    return {
        "referral_sales_rub": referral_sales_rub,
        "profile": {
            "xp_total": xp_total,
            "level": level,
            "level_progress": progress,
            "streak_days": profile.streak_days,
            "streak_multiplier": str(streak_mult),
            "best_challenge_score": profile.best_challenge_score,
            "league_id": league_id,
            "streak_shields_available": int(profile.streak_shields_available),
            "streak_shields_max": int(profile.streak_shields_max),
            "fast_life_regen_until": fast_regen_iso,
            "active_minigame_frame": active_frame,
        },
        "points": {
            "balance": int(profile.points_balance),
            "lifetime_earned": int(profile.points_lifetime_earned),
            "lifetime_spent": int(profile.points_lifetime_spent),
        },
        "lives": {
            "current": profile.lives_current,
            "max": profile.lives_max,
            "next_life_at": next_iso,
            "recovery_seconds": recovery_seconds,
            "recovery_interval_hours": eff_hours,
        },
        "active_attempt": _active_attempt_dict(active),
        "daily_challenge_xp_tiers": list(DAILY_CHALLENGE_XP_TIERS),
        "streak_multiplier_tiers": [
            {"min_streak_days": md, "multiplier": str(m)} for md, m in STREAK_MULTIPLIER_TIERS
        ],
    }


def start_daily_challenge(user) -> DailyChallengeAttempt:
    """Spend one life and create a new started attempt (RNG seed server-side)."""
    today = local_today()
    now = timezone.now()
    with transaction.atomic():
        profile, _ = GamificationProfile.objects.select_for_update().get_or_create(user=user)
        refresh_challenge_lives(profile, now)
        if profile.lives_current == 0:
            profile.save(
                update_fields=[
                    "lives_current",
                    "lives_max",
                    "next_life_at",
                    "last_life_refill_at",
                    "updated_at",
                ]
            )
            raise ValidationError("no_lives", code="no_lives")

        consume_challenge_life(profile, now)

        DailyChallengeAttempt.objects.filter(user=user, status=DailyChallengeAttempt.Status.STARTED).delete()

        attempt = DailyChallengeAttempt.objects.create(
            user=user,
            challenge_date=today,
            status=DailyChallengeAttempt.Status.STARTED,
            started_at=now,
            rng_seed=secrets.randbelow(2**31),
        )

        profile.save(
            update_fields=[
                "lives_current",
                "lives_max",
                "next_life_at",
                "last_life_refill_at",
                "updated_at",
            ]
        )
        return attempt


@dataclass
class DailyChallengeFinishOutcome:
    summary: dict[str, Any]
    reward: dict[str, Any]
    already_completed: bool


def finish_daily_challenge(
    user,
    *,
    attempt_public_id: Any,
    moves: Any,
    client_score: Any | None = None,
) -> DailyChallengeFinishOutcome:
    """
    Replay ``moves`` with the seeded attempt; grant XP from server-side score only.
    """
    today = local_today()

    try:
        aid = uuid.UUID(str(attempt_public_id))
    except (ValueError, TypeError):
        raise ValidationError("invalid_attempt_id", code="invalid_attempt_id") from None

    client_opt = _validate_optional_client_score(client_score)

    with transaction.atomic():
        attempt = (
            DailyChallengeAttempt.objects.select_for_update()
            .filter(public_id=aid, user=user)
            .first()
        )

        if attempt is None:
            raise ValidationError(
                "daily_challenge_not_started",
                code="daily_challenge_not_started",
            )

        if attempt.status == DailyChallengeAttempt.Status.COMPLETED:
            profile = get_or_create_gamification_profile(user)
            summary = build_gamification_summary(user)
            reward = {
                "score": attempt.score,
                "client_score": client_opt
                if client_opt is not None
                else (attempt.client_reported_score or 0),
                "base_xp": attempt.base_xp,
                "multiplier": str(attempt.multiplier),
                "awarded_xp": attempt.awarded_xp,
                "xp_total": profile.xp_total,
                "level": calculate_level(profile.xp_total),
            }
            if client_opt is not None and client_opt != attempt.score:
                reward["score_mismatch_warning"] = True
            return DailyChallengeFinishOutcome(
                summary=summary,
                reward=reward,
                already_completed=True,
            )

        seed = int(attempt.rng_seed)
        attempt_pk = attempt.pk

    server_score, replay_err = replay_daily_challenge(seed, moves)
    timing_err = (
        validate_finish_timing(moves, server_score) if server_score is not None else None
    )

    fail_code = replay_err or timing_err
    if fail_code or server_score is None:
        DailyChallengeAttempt.objects.filter(pk=attempt_pk).update(
            validation_error=fail_code or "replay_failed",
            move_log=moves if isinstance(moves, list) else [],
            client_reported_score=client_opt,
            updated_at=timezone.now(),
        )
        raise ValidationError(fail_code or "replay_failed", code=(fail_code or "replay_failed"))

    server_score = min(server_score, MAX_CHALLENGE_SCORE)

    with transaction.atomic():
        attempt = DailyChallengeAttempt.objects.select_for_update().get(pk=attempt_pk)
        GamificationProfile.objects.get_or_create(user=user)
        profile = GamificationProfile.objects.select_for_update().get(user=user)

        if attempt.status != DailyChallengeAttempt.Status.STARTED:
            if attempt.status == DailyChallengeAttempt.Status.COMPLETED:
                summary = build_gamification_summary(user)
                reward = {
                    "score": attempt.score,
                    "client_score": client_opt
                    if client_opt is not None
                    else (attempt.client_reported_score or 0),
                    "base_xp": attempt.base_xp,
                    "multiplier": str(attempt.multiplier),
                    "awarded_xp": attempt.awarded_xp,
                    "xp_total": profile.xp_total,
                    "level": calculate_level(profile.xp_total),
                }
                if client_opt is not None and client_opt != attempt.score:
                    reward["score_mismatch_warning"] = True
                return DailyChallengeFinishOutcome(
                    summary=summary,
                    reward=reward,
                    already_completed=True,
                )
            raise ValidationError(
                "daily_challenge_not_started",
                code="daily_challenge_not_started",
            )

        base_xp = calculate_daily_challenge_base_xp(server_score)

        if profile.last_streak_increment_date != today:
            _apply_streak_on_activity(profile, today)
            profile.last_streak_increment_date = today

        mult = get_streak_multiplier(profile.streak_days)
        awarded = _award_decimal_to_int(base_xp, mult)
        idem = _challenge_xp_idempotency_key(attempt.public_id)

        XPEvent.objects.create(
            user=user,
            source=XPEvent.Source.DAILY_CHALLENGE,
            amount=awarded,
            base_amount=base_xp,
            multiplier=mult,
            idempotency_key=idem,
            metadata_json={
                "challenge_date": today.isoformat(),
                "score": server_score,
                "attempt_public_id": str(attempt.public_id),
            },
        )

        profile.xp_total += awarded
        if server_score > profile.best_challenge_score:
            profile.best_challenge_score = server_score
        profile.save(
            update_fields=[
                "streak_days",
                "last_activity_date",
                "last_streak_increment_date",
                "streak_shields_available",
                "xp_total",
                "best_challenge_score",
                "updated_at",
            ]
        )

        now = timezone.now()
        attempt.score = server_score
        attempt.base_xp = base_xp
        attempt.multiplier = mult
        attempt.awarded_xp = awarded
        attempt.status = DailyChallengeAttempt.Status.COMPLETED
        attempt.completed_at = now
        attempt.validation_error = ""
        attempt.move_log = moves if isinstance(moves, list) else []
        attempt.client_reported_score = client_opt
        attempt.save(
            update_fields=[
                "score",
                "base_xp",
                "multiplier",
                "awarded_xp",
                "status",
                "completed_at",
                "validation_error",
                "move_log",
                "client_reported_score",
                "updated_at",
            ]
        )

        summary = build_gamification_summary(user)
        reward = {
            "score": server_score,
            "client_score": client_opt if client_opt is not None else 0,
            "base_xp": base_xp,
            "multiplier": str(mult),
            "awarded_xp": awarded,
            "xp_total": summary["profile"]["xp_total"],
            "level": summary["profile"]["level"],
        }
        if client_opt is not None and client_opt != server_score:
            reward["score_mismatch_warning"] = True
        return DailyChallengeFinishOutcome(
            summary=summary,
            reward=reward,
            already_completed=False,
        )


# Referral league: sales (RUB) + shared level + streak days — all gates must pass for a tier.
REFERRAL_LEAGUE_TIERS_DESC: tuple[tuple[str, int, int, int], ...] = (
    ("ultra", 15_000_000, 30, 60),
    ("diamond", 5_000_000, 25, 45),
    ("platinum", 1_500_000, 20, 30),
    ("gold", 500_000, 10, 14),
    ("silver", 75_000, 5, 7),
    ("bronze", 15_000, 2, 3),
)


def calculate_referral_league_id(sales_rub: int, level: int, streak_days: int) -> str:
    """Highest league whose sales, level, and streak gates all pass."""
    s = max(0, int(sales_rub))
    lv = max(1, int(level))
    st = max(0, int(streak_days))
    for league_id, sales_min, level_min, streak_min in REFERRAL_LEAGUE_TIERS_DESC:
        if s >= sales_min and lv >= level_min and st >= streak_min:
            return league_id
    return "start"


# MVP referral shop catalog (no DB model).
REFERRAL_SHOP_LIVES_MAX_CAP = 10

REFERRAL_SHOP_LIVES_MAX_UPGRADE_COSTS: dict[int, int] = {
    5: 25_000,
    6: 75_000,
    7: 200_000,
    8: 500_000,
    9: 1_000_000,
}

REFERRAL_SHOP_STREAK_SHIELDS_MAX_CAP = 7

REFERRAL_SHOP_STREAK_SHIELDS_MAX_UPGRADE_COSTS: dict[int, int] = {
    3: 50_000,
    4: 150_000,
    5: 400_000,
    6: 900_000,
}

# Cosmetic mini-game frame codes (shop catalog + select validation).
REFERRAL_SHOP_COSMETIC_FRAME_CODES: frozenset[str] = frozenset(
    {"frame_garland", "frame_neon_line", "frame_pixel_arcade", "frame_pacman_chase"}
)


def _lives_max_upgrade_cost_for_current(lives_max: int) -> int | None:
    return REFERRAL_SHOP_LIVES_MAX_UPGRADE_COSTS.get(int(lives_max))


def _streak_shields_max_upgrade_cost_for_current(streak_shields_max: int) -> int | None:
    return REFERRAL_SHOP_STREAK_SHIELDS_MAX_UPGRADE_COSTS.get(int(streak_shields_max))


REFERRAL_SHOP_REWARDS: dict[str, dict[str, Any]] = {
    "extra_life": {
        "title": "+1 жизнь",
        "description": "Восстанавливает одну жизнь, но не выше максимума.",
        "cost_points": 300,
        "effect": "extra_life",
    },
    "full_lives_refill": {
        "title": "Полное восстановление жизней",
        "description": "Восстанавливает все жизни до максимума.",
        "cost_points": 1000,
        "effect": "full_lives_refill",
    },
    "streak_shield_1_day": {
        "title": "Защита серии на 1 день",
        "description": "Один раз защищает серию, если пропустить день.",
        "cost_points": 1500,
        "effect": "streak_shield",
    },
    "increase_lives_max": {
        "title": "Расширить запас жизней",
        "description": "Увеличивает максимум жизней на 1.",
        "effect": "increase_lives_max",
    },
    "increase_streak_shields_max": {
        "title": "Расширить запас защит",
        "description": "Увеличивает максимум защит серии на 1.",
        "effect": "increase_streak_shields_max",
    },
    "fast_life_regen_24h": {
        "title": "Ускоренное восстановление",
        "description": "Жизни восстанавливаются в 2 раза быстрее в течение 24 часов.",
        "cost_points": 15_000,
        "effect": "fast_life_regen",
    },
    "frame_garland": {
        "title": "Гирлянда",
        "description": "Классическое оформление поля мини-игры с гирляндой вокруг доски.",
        "cost_points": 0,
        "effect": "cosmetic_frame",
        "permanent": True,
        "default_owned": True,
    },
    "frame_neon_line": {
        "title": "Neon Line",
        "description": "Минималистичная неоновая рамка для мини-игры.",
        "cost_points": 10_000,
        "effect": "cosmetic_frame",
        "permanent": True,
    },
    "frame_pixel_arcade": {
        "title": "Змейка",
        "description": "Классическая пиксельная рамка со змейкой, которая ползёт по периметру поля.",
        "cost_points": 30_000,
        "effect": "cosmetic_frame",
        "permanent": True,
    },
    "frame_pacman_chase": {
        "title": "Pac-Man Chase",
        "description": "Аркадная рамка: Пакман гонится за призраком по периметру поля.",
        "cost_points": 30_000,
        "effect": "cosmetic_frame",
        "permanent": True,
    },
}


def _referral_shop_profile_block(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "lives_current": int(summary["lives"]["current"]),
        "lives_max": int(summary["lives"]["max"]),
        "streak_days": int(summary["profile"]["streak_days"]),
        "streak_shields_available": int(summary["profile"]["streak_shields_available"]),
        "streak_shields_max": int(summary["profile"]["streak_shields_max"]),
        "next_life_at": summary["lives"].get("next_life_at"),
        "fast_life_regen_until": summary["profile"].get("fast_life_regen_until"),
        "active_minigame_frame": summary["profile"].get("active_minigame_frame") or "",
    }


def _referral_shop_item_can_redeem(
    balance: int, profile: GamificationProfile, meta: dict[str, Any]
) -> tuple[bool, str | None]:
    cost = int(meta["cost_points"])
    effect = meta["effect"]
    if balance < cost:
        return False, "not_enough_points"
    if effect == "extra_life":
        if profile.lives_current >= profile.lives_max:
            return False, "lives_full"
    elif effect == "full_lives_refill":
        if profile.lives_current >= profile.lives_max:
            return False, "lives_full"
    elif effect == "streak_shield":
        if profile.streak_shields_available >= int(profile.streak_shields_max):
            return False, "streak_shields_limit"
    elif effect == "fast_life_regen":
        pass
    elif effect == "cosmetic_frame":
        pass
    else:
        return False, "unknown_reward"
    return True, None


def build_referral_shop_payload(user) -> dict[str, Any]:
    summary = build_gamification_summary(user)
    profile = GamificationProfile.objects.get(user=user)
    balance = int(summary["points"]["balance"])
    owned_codes = set(
        ReferralShopOwnedItem.objects.filter(user=user).values_list("item_code", flat=True)
    )
    items: list[dict[str, Any]] = []
    for code, meta in REFERRAL_SHOP_REWARDS.items():
        effect = meta["effect"]
        if effect == "increase_lives_max":
            lm = int(profile.lives_max)
            if lm >= REFERRAL_SHOP_LIVES_MAX_CAP:
                items.append(
                    {
                        "code": code,
                        "title": meta["title"],
                        "description": meta["description"],
                        "cost_points": 0,
                        "can_redeem": False,
                        "disabled_reason": "max_lives_limit",
                        "current_value": lm,
                    }
                )
                continue
            cost_opt = _lives_max_upgrade_cost_for_current(lm)
            if cost_opt is None:
                items.append(
                    {
                        "code": code,
                        "title": meta["title"],
                        "description": meta["description"],
                        "cost_points": 0,
                        "can_redeem": False,
                        "disabled_reason": "max_lives_limit",
                        "current_value": lm,
                    }
                )
                continue
            can, reason = True, None
            if balance < cost_opt:
                can, reason = False, "not_enough_points"
            items.append(
                {
                    "code": code,
                    "title": meta["title"],
                    "description": meta["description"],
                    "cost_points": cost_opt,
                    "can_redeem": can,
                    "disabled_reason": reason,
                    "current_value": lm,
                    "next_value": lm + 1,
                }
            )
            continue
        if effect == "increase_streak_shields_max":
            sm = int(profile.streak_shields_max)
            if sm >= REFERRAL_SHOP_STREAK_SHIELDS_MAX_CAP:
                items.append(
                    {
                        "code": code,
                        "title": meta["title"],
                        "description": meta["description"],
                        "cost_points": 0,
                        "can_redeem": False,
                        "disabled_reason": "streak_shields_max_limit",
                        "current_value": sm,
                    }
                )
                continue
            cost_opt = _streak_shields_max_upgrade_cost_for_current(sm)
            if cost_opt is None:
                items.append(
                    {
                        "code": code,
                        "title": meta["title"],
                        "description": meta["description"],
                        "cost_points": 0,
                        "can_redeem": False,
                        "disabled_reason": "streak_shields_max_limit",
                        "current_value": sm,
                    }
                )
                continue
            can, reason = True, None
            if balance < cost_opt:
                can, reason = False, "not_enough_points"
            items.append(
                {
                    "code": code,
                    "title": meta["title"],
                    "description": meta["description"],
                    "cost_points": cost_opt,
                    "can_redeem": can,
                    "disabled_reason": reason,
                    "current_value": sm,
                    "next_value": sm + 1,
                }
            )
            continue

        if effect == "cosmetic_frame":
            cost = int(meta["cost_points"])
            if meta.get("default_owned"):
                active_cur = (profile.active_minigame_frame or "").strip()
                active = active_cur == "" or active_cur == code
                items.append(
                    {
                        "code": code,
                        "title": meta["title"],
                        "description": meta["description"],
                        "cost_points": cost,
                        "effect": effect,
                        "item_type": "cosmetic_frame",
                        "permanent": bool(meta.get("permanent", True)),
                        "default_owned": True,
                        "owned": True,
                        "active": active,
                        "can_redeem": False,
                        "disabled_reason": None,
                    }
                )
                continue

            owned = code in owned_codes
            active = (profile.active_minigame_frame or "") == code
            if owned:
                items.append(
                    {
                        "code": code,
                        "title": meta["title"],
                        "description": meta["description"],
                        "cost_points": cost,
                        "effect": effect,
                        "item_type": "cosmetic_frame",
                        "permanent": bool(meta.get("permanent", True)),
                        "owned": True,
                        "active": active,
                        "can_redeem": False,
                        "disabled_reason": None,
                    }
                )
            else:
                can_buy = balance >= cost
                items.append(
                    {
                        "code": code,
                        "title": meta["title"],
                        "description": meta["description"],
                        "cost_points": cost,
                        "effect": effect,
                        "item_type": "cosmetic_frame",
                        "permanent": bool(meta.get("permanent", True)),
                        "owned": False,
                        "active": False,
                        "can_redeem": can_buy,
                        "disabled_reason": None if can_buy else "not_enough_points",
                    }
                )
            continue

        if effect == "fast_life_regen":
            fu = profile.fast_life_regen_until
            now_shop = timezone.now()
            is_act = fu is not None and fu > now_shop
            can, reason = _referral_shop_item_can_redeem(balance, profile, meta)
            items.append(
                {
                    "code": code,
                    "title": meta["title"],
                    "description": meta["description"],
                    "cost_points": int(meta["cost_points"]),
                    "can_redeem": can,
                    "disabled_reason": reason,
                    "active_until": fu.isoformat() if fu else None,
                    "is_active": is_act,
                }
            )
            continue

        can, reason = _referral_shop_item_can_redeem(balance, profile, meta)
        items.append(
            {
                "code": code,
                "title": meta["title"],
                "description": meta["description"],
                "cost_points": int(meta["cost_points"]),
                "can_redeem": can,
                "disabled_reason": reason,
            }
        )
    return {
        "points": summary["points"],
        "profile": _referral_shop_profile_block(summary),
        "items": items,
    }


def redeem_referral_shop_reward(
    user,
    reward_code: str,
    client_request_id: str | None = None,
) -> dict[str, Any]:
    """
    Spend referral shop points for a catalog reward. Idempotent when ``client_request_id`` is set.
    """
    reward_code = (reward_code or "").strip()
    meta = REFERRAL_SHOP_REWARDS.get(reward_code)
    if meta is None:
        raise ValidationError("unknown_reward", code="unknown_reward")

    effect = meta["effect"]
    now = timezone.now()

    if effect == "cosmetic_frame" and meta.get("default_owned"):
        raise ValidationError("not_purchasable", code="not_purchasable")

    with transaction.atomic():
        profile, _ = GamificationProfile.objects.select_for_update().get_or_create(user=user)
        refresh_challenge_lives(profile, now)

        if effect == "increase_lives_max":
            lm = int(profile.lives_max)
            if lm >= REFERRAL_SHOP_LIVES_MAX_CAP:
                raise ValidationError("max_lives_limit", code="max_lives_limit")
            cost_opt = _lives_max_upgrade_cost_for_current(lm)
            if cost_opt is None:
                raise ValidationError("max_lives_limit", code="max_lives_limit")
            cost = cost_opt
        elif effect == "increase_streak_shields_max":
            sm = int(profile.streak_shields_max)
            if sm >= REFERRAL_SHOP_STREAK_SHIELDS_MAX_CAP:
                raise ValidationError("streak_shields_max_limit", code="streak_shields_max_limit")
            cost_opt = _streak_shields_max_upgrade_cost_for_current(sm)
            if cost_opt is None:
                raise ValidationError("streak_shields_max_limit", code="streak_shields_max_limit")
            cost = cost_opt
        else:
            cost = int(meta["cost_points"])

        idem_key: str | None = None
        if client_request_id is not None:
            cid = str(client_request_id).strip()
            if not cid:
                raise ValidationError("invalid_client_request_id", code="invalid_client_request_id")
            idem_key = f"reward_spend:{user.pk}:{cid}"
            existing = (
                ReferralPointTransaction.objects.select_for_update()
                .filter(idempotency_key=idem_key)
                .first()
            )
            if existing is not None:
                profile.refresh_from_db()
                summary = build_gamification_summary(user)
                return {
                    "ok": True,
                    "reward_code": str(existing.metadata.get("reward_code") or reward_code),
                    "spent_points": abs(int(existing.amount)),
                    "points": summary["points"],
                    "profile": _referral_shop_profile_block(summary),
                }

        if effect == "cosmetic_frame":
            if ReferralShopOwnedItem.objects.filter(user=user, item_code=reward_code).exists():
                raise ValidationError("already_owned", code="already_owned")

        if int(profile.points_balance) < cost:
            raise ValidationError("not_enough_points", code="not_enough_points")

        if effect == "extra_life":
            if profile.lives_current >= profile.lives_max:
                raise ValidationError("lives_full", code="lives_full")
            profile.lives_current += 1
            md: dict[str, Any] = {
                "reward_code": reward_code,
                "reward_title": meta["title"],
                "effect": effect,
                "cost_points": cost,
            }
        elif effect == "full_lives_refill":
            if profile.lives_current >= profile.lives_max:
                raise ValidationError("lives_full", code="lives_full")
            profile.lives_current = profile.lives_max
            profile.next_life_at = None
            profile.last_life_refill_at = now
            md = {
                "reward_code": reward_code,
                "reward_title": meta["title"],
                "effect": effect,
                "cost_points": cost,
            }
        elif effect == "streak_shield":
            if profile.streak_shields_available >= int(profile.streak_shields_max):
                raise ValidationError("streak_shields_limit", code="streak_shields_limit")
            profile.streak_shields_available += 1
            md = {
                "reward_code": reward_code,
                "reward_title": meta["title"],
                "effect": effect,
                "cost_points": cost,
            }
        elif effect == "increase_lives_max":
            old_lm = int(profile.lives_max)
            new_lm = old_lm + 1
            profile.lives_max = new_lm
            profile.lives_current = min(int(profile.lives_current) + 1, new_lm)
            md = {
                "reward_code": reward_code,
                "old_lives_max": old_lm,
                "new_lives_max": new_lm,
                "cost_points": cost,
            }
        elif effect == "increase_streak_shields_max":
            old_sm = int(profile.streak_shields_max)
            new_sm = old_sm + 1
            profile.streak_shields_max = new_sm
            profile.streak_shields_available = min(int(profile.streak_shields_available) + 1, new_sm)
            md = {
                "reward_code": reward_code,
                "old_streak_shields_max": old_sm,
                "new_streak_shields_max": new_sm,
                "cost_points": cost,
            }
        elif effect == "fast_life_regen":
            max_until = now + timedelta(days=7)
            old_until = profile.fast_life_regen_until
            if old_until and old_until > now:
                new_uncapped = old_until + timedelta(hours=24)
            else:
                new_uncapped = now + timedelta(hours=24)
            new_until = min(new_uncapped, max_until)
            if old_until and old_until > now and new_until <= old_until:
                raise ValidationError("fast_life_regen_limit", code="fast_life_regen_limit")
            profile.fast_life_regen_until = new_until
            refresh_challenge_lives(profile, now)
            md = {
                "reward_code": reward_code,
                "old_fast_life_regen_until": old_until.isoformat() if old_until else None,
                "new_fast_life_regen_until": new_until.isoformat(),
                "duration_hours": 24,
                "cost_points": cost,
            }
        elif effect == "cosmetic_frame":
            ReferralShopOwnedItem.objects.create(
                user=user,
                item_code=reward_code,
                item_type="frame",
                metadata={},
            )
            profile.active_minigame_frame = reward_code
            md = {
                "reward_code": reward_code,
                "item_type": "frame",
                "reward_title": meta["title"],
                "cost_points": cost,
            }
        else:
            raise ValidationError("unknown_reward", code="unknown_reward")

        new_balance = int(profile.points_balance) - cost
        if new_balance < 0:
            raise ValidationError("not_enough_points", code="not_enough_points")

        profile.points_balance = new_balance
        profile.points_lifetime_spent += cost

        try:
            with transaction.atomic():
                ReferralPointTransaction.objects.create(
                    user=user,
                    transaction_type=ReferralPointTransaction.Type.REWARD_SPEND,
                    amount=-cost,
                    idempotency_key=idem_key,
                    balance_after=new_balance,
                    metadata=md,
                )
        except IntegrityError as exc:
            if idem_key and ReferralPointTransaction.objects.filter(idempotency_key=idem_key).exists():
                profile.refresh_from_db()
                summary = build_gamification_summary(user)
                existing = ReferralPointTransaction.objects.get(idempotency_key=idem_key)
                return {
                    "ok": True,
                    "reward_code": str(existing.metadata.get("reward_code") or reward_code),
                    "spent_points": abs(int(existing.amount)),
                    "points": summary["points"],
                    "profile": _referral_shop_profile_block(summary),
                }
            raise exc

        uf = {"points_balance", "points_lifetime_spent", "updated_at"}
        if effect == "extra_life":
            uf |= {"lives_current"}
        elif effect == "full_lives_refill":
            uf |= {"lives_current", "next_life_at", "last_life_refill_at"}
        elif effect == "streak_shield":
            uf |= {"streak_shields_available"}
        elif effect == "increase_lives_max":
            uf |= {"lives_current", "lives_max"}
        elif effect == "increase_streak_shields_max":
            uf |= {"streak_shields_available", "streak_shields_max"}
        elif effect == "fast_life_regen":
            uf |= {
                "fast_life_regen_until",
                "lives_current",
                "next_life_at",
                "last_life_refill_at",
            }
        elif effect == "cosmetic_frame":
            uf |= {"active_minigame_frame"}
        profile.save(update_fields=sorted(uf))

    summary = build_gamification_summary(user)
    return {
        "ok": True,
        "reward_code": reward_code,
        "spent_points": cost,
        "points": summary["points"],
        "profile": _referral_shop_profile_block(summary),
    }


def select_active_minigame_frame(user, frame_code: str) -> dict[str, Any]:
    """Set ``GamificationProfile.active_minigame_frame`` if the user owns the frame."""
    frame_code = (frame_code or "").strip()
    if frame_code not in REFERRAL_SHOP_COSMETIC_FRAME_CODES:
        raise ValidationError("unknown_frame", code="unknown_frame")
    meta = REFERRAL_SHOP_REWARDS.get(frame_code)
    if meta is None:
        raise ValidationError("unknown_frame", code="unknown_frame")
    with transaction.atomic():
        profile, _ = GamificationProfile.objects.select_for_update().get_or_create(user=user)
        if meta.get("effect") == "cosmetic_frame" and meta.get("default_owned"):
            profile.active_minigame_frame = ""
            profile.save(update_fields=["active_minigame_frame", "updated_at"])
        else:
            if not ReferralShopOwnedItem.objects.filter(user=user, item_code=frame_code).exists():
                raise ValidationError("frame_not_owned", code="frame_not_owned")
            profile.active_minigame_frame = frame_code
            profile.save(update_fields=["active_minigame_frame", "updated_at"])
    summary = build_gamification_summary(user)
    return {
        "ok": True,
        "frame_code": frame_code,
        "points": summary["points"],
        "profile": _referral_shop_profile_block(summary),
    }


# Referral shop points multiplier by league (same tier names as ``calculate_referral_league_id``).
REFERRAL_LEAGUE_POINT_MULTIPLIERS: dict[str, Decimal] = {
    "start": Decimal("1"),
    "bronze": Decimal("1.25"),
    "silver": Decimal("1.5"),
    "gold": Decimal("2"),
    "platinum": Decimal("2.5"),
    "diamond": Decimal("3"),
    "ultra": Decimal("4"),
}


def grant_purchase_xp_for_paid_referral_order(order: Order) -> int:
    """
    Idempotent XP into ``GamificationProfile.xp_total`` for a paid referral sale (same eligibility
    idea as commission: active partner, not self-referral, RUB-or-empty currency).
    """
    if order.status != Order.Status.PAID:
        return 0
    if not order.partner_id:
        return 0
    if order.amount is None or order.amount <= 0:
        return 0

    currency = (order.currency or "").strip()
    if currency and currency != "RUB":
        return 0

    partner = order.partner
    if partner.status != PartnerProfile.Status.ACTIVE:
        return 0

    from referrals.services import would_be_self_referral

    buyer = order.customer_user if order.customer_user_id else None
    if would_be_self_referral(
        partner,
        customer_user=buyer,
        customer_email=order.customer_email or "",
    ):
        return 0

    amount_rub = int(Decimal(order.amount).quantize(Decimal("1"), rounding=ROUND_FLOOR))
    xp_amt = amount_rub // 100
    if xp_amt <= 0:
        return 0

    partner_user = partner.user
    idem = f"purchase_confirmed:{order.pk}"

    with transaction.atomic():
        profile, _ = GamificationProfile.objects.select_for_update().get_or_create(user=partner_user)
        try:
            with transaction.atomic():
                XPEvent.objects.create(
                    user=partner_user,
                    source=XPEvent.Source.PURCHASE_CONFIRMED,
                    amount=xp_amt,
                    base_amount=xp_amt,
                    multiplier=Decimal("1.0000"),
                    idempotency_key=idem,
                    metadata_json={"order_id": order.pk},
                )
        except IntegrityError as exc:
            if XPEvent.objects.filter(idempotency_key=idem).exists():
                return 0
            raise exc
        profile.xp_total += xp_amt
        profile.save(update_fields=["xp_total", "updated_at"])
        return xp_amt


def grant_purchase_points_for_paid_referral_order(order: Order) -> int:
    """
    Idempotent referral shop points for a paid referral sale.

    League multiplier uses partner state *before* XP from this order: all-time paid sales
    excluding this order, current ``xp_total``, and current streak — via ``calculate_referral_league_id``.
    """
    if order.status != Order.Status.PAID:
        return 0
    if not order.partner_id:
        return 0
    if order.amount is None or order.amount <= 0:
        return 0

    currency = (order.currency or "").strip()
    if currency and currency != "RUB":
        return 0

    partner = order.partner
    if partner.status != PartnerProfile.Status.ACTIVE:
        return 0

    from referrals.services import would_be_self_referral

    buyer = order.customer_user if order.customer_user_id else None
    if would_be_self_referral(
        partner,
        customer_user=buyer,
        customer_email=order.customer_email or "",
    ):
        return 0

    amount_rub = int(Decimal(order.amount).quantize(Decimal("1"), rounding=ROUND_FLOOR))
    base_points = amount_rub // 100
    if base_points <= 0:
        return 0

    partner_user = partner.user
    idem = f"referral_points:purchase_confirmed:{order.pk}"

    with transaction.atomic():
        profile, _ = GamificationProfile.objects.select_for_update().get_or_create(user=partner_user)

        sales_rub = _referral_sales_rub_partner_all_time_excluding_order(order.partner_id, order.pk)
        level = calculate_level(profile.xp_total)
        league_id = calculate_referral_league_id(sales_rub, level, int(profile.streak_days))
        mult = REFERRAL_LEAGUE_POINT_MULTIPLIERS.get(league_id, Decimal("1"))
        points_amt = _award_decimal_to_int(base_points, mult)
        if points_amt <= 0:
            return 0

        try:
            with transaction.atomic():
                ReferralPointTransaction.objects.create(
                    user=partner_user,
                    transaction_type=ReferralPointTransaction.Type.PURCHASE_CONFIRMED,
                    amount=points_amt,
                    idempotency_key=idem,
                    balance_after=int(profile.points_balance) + points_amt,
                    metadata={
                        "order_id": order.pk,
                        "league_id": league_id,
                        "base_points": base_points,
                        "multiplier": str(mult),
                    },
                )
        except IntegrityError as exc:
            if ReferralPointTransaction.objects.filter(idempotency_key=idem).exists():
                return 0
            raise exc

        profile.points_balance += points_amt
        profile.points_lifetime_earned += points_amt
        profile.save(
            update_fields=["points_balance", "points_lifetime_earned", "updated_at"],
        )
        return points_amt


def _looks_like_email(value: str) -> bool:
    return "@" in value


def _referral_leaderboard_display_name(user) -> str:
    """Public leaderboard label: ФИО / username / public_id / fallback — never raw email."""
    if user is None:
        return "Участник"
    fio = (getattr(user, "fio", "") or "").strip()
    if fio:
        return fio if len(fio) <= 48 else fio[:45] + "…"
    username = (getattr(user, "username", "") or "").strip()
    if username and not _looks_like_email(username):
        return username if len(username) <= 48 else username[:45] + "…"
    pid = (getattr(user, "public_id", "") or "").strip()
    if pid:
        return f"Участник {pid}"
    return f"Участник #{user.pk}"


def _referral_leaderboard_period_start(period: str, now) -> Any:
    if period == "all":
        return None
    if period == "week":
        return now - timedelta(days=7)
    if period == "month":
        local = timezone.localtime(now)
        return local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    raise ValueError(period)


def _rub_from_decimal(amount: Decimal | None) -> int:
    if amount is None:
        return 0
    return int(Decimal(amount).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _referral_paid_orders_qs(since: Any):
    """Paid orders attributed to a partner, RUB-or-empty currency, optional lower bound on payment time."""
    qs = Order.objects.filter(status=Order.Status.PAID, partner_id__isnull=False).filter(
        Q(currency="") | Q(currency="RUB")
    )
    qs = qs.annotate(eff_ts=Coalesce(F("paid_at"), F("created_at")))
    if since is not None:
        qs = qs.filter(eff_ts__gte=since)
    return qs


def _referral_sales_rub_all_time(user) -> int:
    """
    Total paid referral sales for ``user``'s partner, same aggregation as ``build_gamification_leaderboard``
    with ``period=\"all\"`` (no lower bound on ``eff_ts``).
    """
    pp = PartnerProfile.objects.filter(user_id=user.pk).first()
    if pp is None:
        return 0
    agg = _referral_paid_orders_qs(None).filter(partner_id=pp.id).aggregate(s=Sum("amount"))
    return _rub_from_decimal(agg["s"])


def _referral_sales_rub_partner_all_time_excluding_order(partner_id: int, exclude_order_id: int | None) -> int:
    """Paid referral RUB sales for partner, optionally excluding one order (for pre-order league)."""
    qs = _referral_paid_orders_qs(None).filter(partner_id=partner_id)
    if exclude_order_id is not None:
        qs = qs.exclude(pk=exclude_order_id)
    agg = qs.aggregate(s=Sum("amount"))
    return _rub_from_decimal(agg["s"])


def build_gamification_leaderboard(request_user, period: str, *, now=None) -> dict[str, Any]:
    """
    Referral sales leaderboard for the mini-game rating page.

    Ranking uses sum of confirmed paid ``Order.amount`` in RUB (or blank currency) per ``PartnerProfile``,
    within the selected period. Tie-breakers: paid order count, then ``GamificationProfile.xp_total``.
    """
    if period not in ("week", "month", "all"):
        raise ValueError("invalid_period")

    now = now if now is not None else timezone.now()
    since = _referral_leaderboard_period_start(period, now)

    paid_in_period = _referral_paid_orders_qs(since)
    leaderboard_empty = not paid_in_period.exists()

    agg_rows = (
        paid_in_period.values("partner_id")
        .annotate(sales_sum=Sum("amount"), orders_cnt=Count("id"))
        .order_by()
    )
    partner_totals: dict[int, dict[str, Any]] = {
        int(r["partner_id"]): {
            "sales_amount": _rub_from_decimal(r["sales_sum"]),
            "paid_orders_count": int(r["orders_cnt"] or 0),
        }
        for r in agg_rows
    }

    profiles = list(PartnerProfile.objects.select_related("user").order_by("user_id"))
    partner_ids = [p.id for p in profiles]
    all_time_rows = (
        _referral_paid_orders_qs(None)
        .filter(partner_id__in=partner_ids)
        .values("partner_id")
        .annotate(sales_sum=Sum("amount"))
    )
    all_time_sales_by_partner: dict[int, int] = {
        int(r["partner_id"]): _rub_from_decimal(r["sales_sum"]) for r in all_time_rows
    }

    user_ids = [p.user_id for p in profiles]
    gam_map = {gp.user_id: gp for gp in GamificationProfile.objects.filter(user_id__in=user_ids)}

    rows_raw: list[dict[str, Any]] = []
    for p in profiles:
        u = p.user
        totals = partner_totals.get(p.id, {"sales_amount": 0, "paid_orders_count": 0})
        gp = gam_map.get(u.id)
        xp_total = int(gp.xp_total) if gp else 0
        streak_days = int(gp.streak_days) if gp else 0
        rows_raw.append(
            {
                "user_id": u.id,
                "user": u,
                "sales_amount": int(totals["sales_amount"]),
                "paid_orders_count": int(totals["paid_orders_count"]),
                "xp_total": xp_total,
                "streak_days": streak_days,
                "sales_all_time_rub": all_time_sales_by_partner.get(p.id, 0),
            }
        )

    rows_raw.sort(
        key=lambda r: (-r["sales_amount"], -r["paid_orders_count"], -r["xp_total"], r["user_id"])
    )

    ranked: list[dict[str, Any]] = []
    for idx, r in enumerate(rows_raw, start=1):
        rr = dict(r)
        rr["rank"] = idx
        ranked.append(rr)

    top_limit = max(1, min(int(REFERRAL_LEADERBOARD_TOP_N), 500))

    def entry_dict(r: dict[str, Any], *, is_current_user: bool) -> dict[str, Any]:
        u = r["user"]
        sales_rub = int(r["sales_amount"])
        sales_all_rub = int(r["sales_all_time_rub"])
        lvl = calculate_level(int(r["xp_total"]))
        return {
            "rank": int(r["rank"]),
            "user_id": int(u.id),
            "display_name": _referral_leaderboard_display_name(u),
            "is_current_user": bool(is_current_user),
            "league": calculate_referral_league_id(sales_all_rub, lvl, int(r["streak_days"])),
            "sales_amount": sales_rub,
            "paid_orders_count": int(r["paid_orders_count"]),
            "xp_total": int(r["xp_total"]),
            "streak_days": int(r["streak_days"]),
        }

    entries_out: list[dict[str, Any]] = []
    if not leaderboard_empty:
        for r in ranked[:top_limit]:
            entries_out.append(entry_dict(r, is_current_user=r["user"].id == request_user.id))

    request_row = next((r for r in ranked if r["user"].id == request_user.id), None)
    gp_self = GamificationProfile.objects.filter(user=request_user).first()
    pp_self = PartnerProfile.objects.filter(user=request_user).first()

    if request_row is None:
        xp_self = int(gp_self.xp_total) if gp_self else 0
        streak_self = int(gp_self.streak_days) if gp_self else 0
        sales_all_self = (
            all_time_sales_by_partner.get(pp_self.id, 0) if pp_self is not None else 0
        )
        current_user = {
            "rank": None,
            "sales_amount": 0,
            "paid_orders_count": 0,
            "xp_total": xp_self,
            "streak_days": streak_self,
            "league": calculate_referral_league_id(
                sales_all_self,
                calculate_level(xp_self),
                streak_self,
            ),
            "gap_to_top_5": 0,
        }
    else:
        ur = request_row
        sales_u = int(ur["sales_amount"])
        sales_all_u = int(ur["sales_all_time_rub"])
        rank_u = int(ur["rank"])
        fifth_sales = 0
        if ranked:
            fi = min(4, len(ranked) - 1)
            fifth_sales = int(ranked[fi]["sales_amount"])
        gap = max(0, fifth_sales - sales_u) if rank_u > 5 else 0
        current_user = {
            "rank": rank_u,
            "sales_amount": sales_u,
            "paid_orders_count": int(ur["paid_orders_count"]),
            "xp_total": int(ur["xp_total"]),
            "streak_days": int(ur["streak_days"]),
            "league": calculate_referral_league_id(
                sales_all_u,
                calculate_level(int(ur["xp_total"])),
                int(ur["streak_days"]),
            ),
            "gap_to_top_5": int(gap),
        }

    return {
        "period": period,
        "leaderboard_empty": leaderboard_empty,
        "entries": entries_out,
        "current_user": current_user,
    }
