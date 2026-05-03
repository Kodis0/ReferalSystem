"""Кастомные бэкенды отправки почты (обход блокировки SMTP на VPS через HTTPS API)."""

from __future__ import annotations

import logging
import uuid
from email.utils import parseaddr

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend
from django.core.mail.message import EmailMessage

logger = logging.getLogger(__name__)


class BrevoApiEmailBackendError(Exception):
    """Ошибка ответа Brevo Transactional Email API."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        response_body: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


class RuSenderApiEmailBackendError(Exception):
    """Ошибка ответа RuSender External Mails API."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        response_body: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


def _parse_sender(from_email: str) -> dict[str, str]:
    """Разбор `Display Name <email@domain>` для поля sender API."""
    name, addr = parseaddr(from_email)
    addr = (addr or "").strip()
    if not addr:
        raise ValueError(f"Invalid from_email (no address): {from_email!r}")
    name = (name or "").strip()
    return {"email": addr, "name": name}


def _recipient_email(raw: str) -> str:
    _, addr = parseaddr(raw)
    out = (addr or raw or "").strip()
    if not out:
        raise ValueError(f"Invalid recipient: {raw!r}")
    return out


class BrevoApiEmailBackend(BaseEmailBackend):
    """
    Отправка через Brevo HTTPS API (без SMTP).
    Контракт для приложения — прежний: django.core.mail.send_mail / EmailMessage.
    """

    def send_messages(self, email_messages: list) -> int:
        if not email_messages:
            return 0
        api_key = getattr(settings, "BREVO_API_KEY", "") or ""
        if not api_key.strip():
            err = "BREVO_API_KEY is empty; set it in environment for BrevoApiEmailBackend."
            if self.fail_silently:
                logger.warning(err)
                return 0
            raise BrevoApiEmailBackendError(err, status_code=None, response_body=None)

        num_sent = 0
        for message in email_messages:
            if not isinstance(message, EmailMessage):
                continue
            if not message.to and not message.cc and not message.bcc:
                continue
            try:
                if self._send_one(message, api_key.strip()):
                    num_sent += 1
            except Exception:
                if not self.fail_silently:
                    raise
        return num_sent

    def _send_one(self, message: EmailMessage, api_key: str) -> bool:
        url = getattr(settings, "BREVO_API_URL", "https://api.brevo.com/v3/smtp/email").strip()
        timeout = getattr(settings, "EMAIL_TIMEOUT", 10)

        from_email = message.from_email or settings.DEFAULT_FROM_EMAIL
        sender = _parse_sender(from_email)

        html_content = None
        for alt_content, mimetype in getattr(message, "alternatives", None) or []:
            if mimetype and str(mimetype).lower() == "text/html":
                html_content = alt_content
                break

        payload: dict = {
            "sender": sender,
            "subject": message.subject or "",
            "textContent": message.body if message.body is not None else "",
        }
        if html_content:
            payload["htmlContent"] = html_content

        to_addrs = list(message.to or [])
        if not to_addrs:
            to_addrs = list(message.cc or message.bcc or [])
        if not to_addrs:
            return False
        payload["to"] = [{"email": _recipient_email(t)} for t in to_addrs]

        if message.to and message.cc:
            payload["cc"] = [{"email": _recipient_email(t)} for t in message.cc]
        if message.to and message.bcc:
            payload["bcc"] = [{"email": _recipient_email(t)} for t in message.bcc]

        headers = {
            "api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        response = requests.post(url, json=payload, headers=headers, timeout=timeout)

        if 200 <= response.status_code < 300:
            return True

        snippet = (response.text or "")[:800]
        msg = f"Brevo API error HTTP {response.status_code}: {snippet}"
        exc = BrevoApiEmailBackendError(
            msg,
            status_code=response.status_code,
            response_body=response.text,
        )
        if self.fail_silently:
            logger.warning(msg)
            return False
        raise exc


def _html_alternative(message: EmailMessage) -> str | None:
    for alt_content, mimetype in getattr(message, "alternatives", None) or []:
        if mimetype and str(mimetype).lower() == "text/html":
            return alt_content
    return None


class RuSenderApiEmailBackend(BaseEmailBackend):
    """
    Отправка через RuSender HTTPS API (`POST /v1/external-mails/send`).
    Один запрос на одного получателя в `to`.
    """

    def send_messages(self, email_messages: list) -> int:
        if not email_messages:
            return 0
        api_key = getattr(settings, "RUSENDER_API_KEY", "") or ""
        if not api_key.strip():
            err = "RUSENDER_API_KEY is empty; set it in environment for RuSenderApiEmailBackend."
            if self.fail_silently:
                logger.warning(err)
                return 0
            raise RuSenderApiEmailBackendError(err, status_code=None, response_body=None)

        num_sent = 0
        for message in email_messages:
            if not isinstance(message, EmailMessage):
                continue
            recipients = list(message.to or [])
            if not recipients:
                recipients = list(message.cc or message.bcc or [])
            if not recipients:
                continue

            from_email = message.from_email or settings.DEFAULT_FROM_EMAIL
            sender = _parse_sender(from_email)
            html_content = _html_alternative(message)
            text_body = message.body if message.body is not None else ""

            for rcpt_raw in recipients:
                try:
                    if self._send_one_recipient(
                        sender=sender,
                        subject=message.subject or "",
                        text_body=text_body,
                        html_content=html_content,
                        rcpt_raw=rcpt_raw,
                        api_key=api_key.strip(),
                    ):
                        num_sent += 1
                except RuSenderApiEmailBackendError:
                    if not self.fail_silently:
                        raise
                except Exception:
                    if not self.fail_silently:
                        raise
        return num_sent

    def _send_one_recipient(
        self,
        *,
        sender: dict[str, str],
        subject: str,
        text_body: str,
        html_content: str | None,
        rcpt_raw: str,
        api_key: str,
    ) -> bool:
        url = getattr(
            settings,
            "RUSENDER_API_URL",
            "https://api.beta.rusender.ru/api/v1/external-mails/send",
        ).strip()
        timeout = getattr(settings, "EMAIL_TIMEOUT", 10)

        to_mail = _parse_sender(rcpt_raw)

        mail_obj: dict = {
            "to": to_mail,
            "from": sender,
            "subject": subject,
            "text": text_body,
        }
        if html_content:
            mail_obj["html"] = html_content

        payload = {
            "mail": mail_obj,
            "idempotencyKey": str(uuid.uuid4()),
        }

        headers = {
            "X-Api-Key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        response = requests.post(url, json=payload, headers=headers, timeout=timeout)

        if 200 <= response.status_code < 300:
            return True

        snippet = (response.text or "")[:800]
        msg = f"RuSender API error HTTP {response.status_code}: {snippet}"
        exc = RuSenderApiEmailBackendError(
            msg,
            status_code=response.status_code,
            response_body=response.text,
        )
        if self.fail_silently:
            logger.warning(msg)
            return False
        raise exc
