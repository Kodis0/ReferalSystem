"""Логика цифрового кода восстановления пароля (rate limit, hash, confirm)."""

from __future__ import annotations

import logging
import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from .email_service import send_password_reset_code_email
from .models import PasswordResetCode

logger = logging.getLogger(__name__)

User = get_user_model()

CODE_TTL = timedelta(minutes=15)
COOLDOWN_SECONDS = 60
MAX_CODES_PER_EMAIL_PER_HOUR = 5
MAX_VERIFY_ATTEMPTS = 5


def normalize_email(email: str) -> str:
    return email.strip().lower()


def generate_six_digit_code() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def hash_code(code: str) -> str:
    return make_password(code)


def codes_match(plain: str, code_hash: str) -> bool:
    return check_password(plain, code_hash)


def get_client_ip(request) -> str | None:
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip() or None
    ip = request.META.get("REMOTE_ADDR")
    return ip or None


def can_issue_code_for_email(normalized_email: str) -> bool:
    """Cooldown 60s и не более 5 записей за час на email."""
    now = timezone.now()
    last = (
        PasswordResetCode.objects.filter(email__iexact=normalized_email)
        .order_by("-created_at")
        .first()
    )
    if last is not None and (now - last.created_at).total_seconds() < COOLDOWN_SECONDS:
        return False
    hour_ago = now - timedelta(hours=1)
    count = PasswordResetCode.objects.filter(
        email__iexact=normalized_email,
        created_at__gte=hour_ago,
    ).count()
    return count < MAX_CODES_PER_EMAIL_PER_HOUR


def issue_code_for_user(user, normalized_email: str, request) -> bool:
    """
    Создаёт код и отправляет письмо. Возвращает False, если сработал rate limit
    (вызывающий код всё равно отвечает generic success).
    """
    if not can_issue_code_for_email(normalized_email):
        return False
    plain = generate_six_digit_code()
    ua = (request.META.get("HTTP_USER_AGENT") or "")[:2048]
    ip = get_client_ip(request)
    prc = PasswordResetCode.objects.create(
        user=user,
        email=normalized_email,
        code_hash=hash_code(plain),
        expires_at=timezone.now() + CODE_TTL,
        request_ip=ip,
        user_agent=ua,
    )
    try:
        send_password_reset_code_email(user.email, plain)
    except Exception:
        prc.delete()
        raise
    return True


def get_latest_active_code(user):
    now = timezone.now()
    return (
        PasswordResetCode.objects.filter(
            user=user,
            used_at__isnull=True,
            expires_at__gt=now,
        )
        .order_by("-created_at")
        .first()
    )


def confirm_password_reset_with_code(
    *,
    normalized_email: str,
    code_plain: str,
    new_password: str,
    new_password_confirm: str,
):
    """
    Возвращает (response_dict, http_status).
    """
    if new_password != new_password_confirm:
        return (
            {
                "detail": "Пароли не совпадают.",
                "code": "password_mismatch",
            },
            400,
        )

    user = User.objects.filter(email__iexact=normalized_email).first()
    if user is None or not user.is_active:
        return (
            {
                "detail": "Неверный код восстановления или email.",
                "code": "password_reset_confirm_failed",
            },
            400,
        )

    prc = get_latest_active_code(user)
    if prc is None:
        return (
            {
                "detail": "Код восстановления недействителен или истёк.",
                "code": "password_reset_code_invalid",
            },
            400,
        )

    if prc.attempts >= MAX_VERIFY_ATTEMPTS:
        return (
            {
                "detail": "Превышено число попыток ввода кода.",
                "code": "password_reset_max_attempts",
            },
            400,
        )

    stripped_code = (code_plain or "").strip()
    if not codes_match(stripped_code, prc.code_hash):
        prc.attempts += 1
        prc.save(update_fields=["attempts"])
        return (
            {
                "detail": "Неверный код восстановления.",
                "code": "password_reset_code_invalid",
            },
            400,
        )

    try:
        validate_password(new_password, user)
    except ValidationError as exc:
        msgs = exc.messages
        detail = msgs[0] if msgs else "Пароль не прошёл проверку."
        return (
            {
                "detail": detail,
                "code": "password_validation_failed",
            },
            400,
        )

    with transaction.atomic():
        user.set_password(new_password)
        user.save(update_fields=["password"])
        now = timezone.now()
        PasswordResetCode.objects.filter(user=user, used_at__isnull=True).update(used_at=now)

    return ({"detail": "Пароль успешно изменён."}, 200)
