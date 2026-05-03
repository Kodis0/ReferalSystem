"""Отправка писем пользователям через django.core.mail (backend задаётся в settings)."""

from __future__ import annotations

from django.conf import settings
from django.core.mail import send_mail


def send_password_reset_code_email(to_email: str, code: str) -> None:
    subject = "Код восстановления Lumo Referral"
    body = (
        f"Ваш код восстановления: {code}\n"
        "Код действует 15 минут.\n"
        "Если вы не запрашивали восстановление, просто проигнорируйте письмо.\n"
    )
    send_mail(
        subject,
        body,
        settings.DEFAULT_FROM_EMAIL,
        [to_email],
        fail_silently=False,
    )
