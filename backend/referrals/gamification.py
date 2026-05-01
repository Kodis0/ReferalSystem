"""
Gamification / mini-game XP (challenge runs, streaks, lives). Future XP sources use ``XPEvent.Source``.
"""

from __future__ import annotations

import math
import secrets
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_FLOOR, Decimal
from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from .gamification_game import replay_daily_challenge, validate_finish_timing
from .models import DailyChallengeAttempt, GamificationProfile, XPEvent

# Sanity cap for submitted game scores (anti-abuse).
MAX_CHALLENGE_SCORE = 100_000

CHALLENGE_LIFE_RECOVERY_INTERVAL = timedelta(hours=4)

# --- XP tiers by score (daily challenge base XP) ---
# score < 500 -> 10; 500..999 -> 20; 1000..1999 -> 35; score >= 2000 -> 50
DAILY_CHALLENGE_XP_TIERS: tuple[dict[str, Any], ...] = (
    {"min_score": 0, "max_score_exclusive": 500, "base_xp": 10},
    {"min_score": 500, "max_score_exclusive": 1000, "base_xp": 20},
    {"min_score": 1000, "max_score_exclusive": 2000, "base_xp": 35},
    {"min_score": 2000, "max_score_exclusive": None, "base_xp": 50},
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
# XP to go from level k to k+1 is 100*k; cumulative XP to reach level L is 50 * L * (L - 1).


def local_today() -> date:
    """Calendar day for challenge boundaries (timezone-aware). Patch in tests."""
    return timezone.localdate()


def get_or_create_gamification_profile(user) -> GamificationProfile:
    profile, _ = GamificationProfile.objects.get_or_create(user=user)
    return profile


def xp_threshold_for_level(level: int) -> int:
    """Minimum total XP to be at least ``level`` (level is 1-indexed)."""
    if level <= 1:
        return 0
    return 50 * (level - 1) * level


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
        return 10
    if score < 1000:
        return 20
    if score < 2000:
        return 35
    return 50


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
    """
    if profile.last_activity_date == activity_date:
        return
    if profile.last_activity_date is None:
        profile.streak_days = 1
    else:
        yesterday = activity_date - timedelta(days=1)
        if profile.last_activity_date == yesterday:
            profile.streak_days += 1
        else:
            profile.streak_days = 1
    profile.last_activity_date = activity_date


def refresh_challenge_lives(profile: GamificationProfile, now) -> None:
    """
    Apply elapsed recovery intervals; ensure a timer exists when below max lives.
    """
    interval = CHALLENGE_LIFE_RECOVERY_INTERVAL
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
    interval = CHALLENGE_LIFE_RECOVERY_INTERVAL
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

    active = (
        DailyChallengeAttempt.objects.filter(user=user, status=DailyChallengeAttempt.Status.STARTED)
        .order_by("-started_at")
        .first()
    )

    return {
        "profile": {
            "xp_total": xp_total,
            "level": level,
            "level_progress": progress,
            "streak_days": profile.streak_days,
            "streak_multiplier": str(streak_mult),
            "best_challenge_score": profile.best_challenge_score,
        },
        "lives": {
            "current": profile.lives_current,
            "max": profile.lives_max,
            "next_life_at": next_iso,
            "recovery_seconds": recovery_seconds,
            "recovery_interval_hours": 4,
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
