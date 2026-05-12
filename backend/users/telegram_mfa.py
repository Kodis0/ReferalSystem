"""Telegram MFA: генерация/хэширование кода и доставка через Bot API.

Раздельно от ``admin_views`` чтобы:
* удобно мокать ``users.telegram_mfa.send_admin_mfa_code`` в тестах;
* не выходить в сеть из тестов;
* держать «канал доставки» как тонкий, заменимый модуль (TOTP/WebAuthn — отдельные шаги).
"""

import json
import logging
import secrets
from typing import Optional
import urllib.parse
import urllib.request

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password

logger = logging.getLogger(__name__)

CODE_LENGTH = 6
CODE_TTL_SECONDS = 300
MAX_ATTEMPTS = 5
RATE_LIMIT_WINDOW_SECONDS = 60

BIND_TOKEN_TTL_SECONDS = 600  # 10 minutes
BIND_TOKEN_LENGTH = 32  # urlsafe characters

APPROVAL_TTL_SECONDS = 300
APPROVAL_RATE_LIMIT_WINDOW_SECONDS = 60
# 24 байт ≈ 32 символа urlsafe; вместе с префиксом ``admin_mfa:<action>:<cid>:`` укладываемся
# в 64-байтовый лимит Telegram на callback_data.
APPROVAL_CALLBACK_NONCE_BYTES = 24


class TelegramMfaError(Exception):
    """Доставка/конфигурация Telegram MFA провалилась.

    ``code`` — стабильный машиночитаемый идентификатор (для frontend),
    ``detail`` — пользовательское сообщение.
    """

    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _bot_token() -> Optional[str]:
    token = getattr(settings, "TELEGRAM_BOT_TOKEN", "") or ""
    return token or None


def _bot_username() -> Optional[str]:
    name = getattr(settings, "TELEGRAM_BOT_USERNAME", "") or ""
    return name.lstrip("@") or None


def _webhook_secret() -> Optional[str]:
    secret = getattr(settings, "TELEGRAM_WEBHOOK_SECRET", "") or ""
    return secret or None


def generate_bind_token() -> str:
    return secrets.token_urlsafe(BIND_TOKEN_LENGTH)


def hash_bind_token(token: str) -> str:
    return make_password(token)


def verify_bind_token(raw: str, hashed: str) -> bool:
    return check_password(raw, hashed)


def build_bot_link(token: str) -> Optional[str]:
    name = _bot_username()
    if not name:
        return None
    return f"https://t.me/{name}?start={token}"


def send_telegram_text(chat_id: str, text: str) -> None:
    """Best-effort plain-text Telegram message. Same delivery rules as send_admin_mfa_code."""
    bot = _bot_token()
    if not bot:
        if getattr(settings, "DEBUG", False):
            logger.warning("TELEGRAM_BOT_TOKEN not set; would send to %s: %s", chat_id, text)
            return
        raise TelegramMfaError("TELEGRAM_MFA_NOT_CONFIGURED", "Telegram MFA не настроен на сервере")
    url = f"https://api.telegram.org/bot{bot}/sendMessage"
    payload = urllib.parse.urlencode({"chat_id": str(chat_id), "text": text}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status >= 400:
                raise TelegramMfaError("TELEGRAM_MFA_DELIVERY_FAILED", "Не удалось отправить сообщение")
    except TelegramMfaError:
        raise
    except Exception as exc:
        logger.exception("Telegram sendMessage failed: %s", exc)
        raise TelegramMfaError("TELEGRAM_MFA_DELIVERY_FAILED", "Не удалось отправить сообщение")


def generate_code() -> str:
    return f"{secrets.randbelow(10 ** CODE_LENGTH):0{CODE_LENGTH}d}"


def hash_code(code: str) -> str:
    return make_password(code)


def verify_code(raw: str, hashed: str) -> bool:
    return check_password(raw, hashed)


def generate_callback_nonce() -> str:
    return secrets.token_urlsafe(APPROVAL_CALLBACK_NONCE_BYTES)


def hash_callback_nonce(nonce: str) -> str:
    return make_password(nonce)


def verify_callback_nonce(raw: str, hashed: str) -> bool:
    if not hashed:
        return False
    return check_password(raw, hashed)


def _short_ua(user_agent: str, limit: int = 80) -> str:
    ua = (user_agent or "").strip()
    if len(ua) <= limit:
        return ua
    return ua[: max(limit - 1, 1)] + "…"


def send_admin_mfa_approval(
    chat_id: str,
    challenge_id: int,
    callback_nonce: str,
    *,
    account_email: str,
    ip: Optional[str],
    user_agent_short: str,
    ttl_seconds: int,
) -> Optional[str]:
    """Отправляет approve/deny inline-кнопки в Telegram.

    Возвращает ``message_id`` (строкой), либо ``None`` если в DEBUG нет ``TELEGRAM_BOT_TOKEN``.
    В prod без токена/при ошибке доставки — ``TelegramMfaError``.
    """
    text_lines = [
        "Вход в админку Lumoref",
        f"Аккаунт: {account_email or '—'}",
        f"IP: {ip or '—'}",
        f"Устройство: {user_agent_short or '—'}",
        f"Действителен: {ttl_seconds}с",
    ]
    text = "\n".join(text_lines)

    approve_cb = f"admin_mfa:approve:{int(challenge_id)}:{callback_nonce}"
    deny_cb = f"admin_mfa:deny:{int(challenge_id)}:{callback_nonce}"
    # Telegram allows up to 64 bytes; защитимся от длинного nonce.
    if len(approve_cb.encode("utf-8")) > 64 or len(deny_cb.encode("utf-8")) > 64:
        max_nonce = max(0, 64 - len(f"admin_mfa:approve:{int(challenge_id)}:".encode("utf-8")))
        callback_nonce = callback_nonce[:max_nonce]
        approve_cb = f"admin_mfa:approve:{int(challenge_id)}:{callback_nonce}"
        deny_cb = f"admin_mfa:deny:{int(challenge_id)}:{callback_nonce}"

    reply_markup = {
        "inline_keyboard": [
            [
                {"text": "✅ Подтвердить", "callback_data": approve_cb},
                {"text": "❌ Отклонить", "callback_data": deny_cb},
            ]
        ]
    }

    bot = _bot_token()
    if not bot:
        if getattr(settings, "DEBUG", False):
            logger.warning(
                "TELEGRAM_BOT_TOKEN not set; would send approval to %s: cid=%s",
                chat_id,
                challenge_id,
            )
            return None
        raise TelegramMfaError(
            "TELEGRAM_MFA_NOT_CONFIGURED", "Telegram MFA не настроен на сервере",
        )

    url = f"https://api.telegram.org/bot{bot}/sendMessage"
    payload = urllib.parse.urlencode(
        {
            "chat_id": str(chat_id),
            "text": text,
            "reply_markup": json.dumps(reply_markup),
        }
    ).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status >= 400:
                raise TelegramMfaError(
                    "TELEGRAM_MFA_DELIVERY_FAILED",
                    "Не удалось отправить сообщение в Telegram",
                )
            try:
                body = json.loads(resp.read().decode("utf-8"))
                mid = (body or {}).get("result", {}).get("message_id")
                return str(mid) if mid is not None else None
            except Exception:
                return None
    except TelegramMfaError:
        raise
    except Exception as exc:
        logger.exception("Telegram sendMessage (approval) failed: %s", exc)
        raise TelegramMfaError(
            "TELEGRAM_MFA_DELIVERY_FAILED",
            "Не удалось отправить сообщение в Telegram",
        )


def answer_callback_query(callback_query_id: str, text: str = "") -> None:
    """Best-effort answerCallbackQuery; в DEBUG без токена — no-op."""
    bot = _bot_token()
    if not bot:
        if getattr(settings, "DEBUG", False):
            logger.warning(
                "TELEGRAM_BOT_TOKEN not set; would answerCallbackQuery(%s)=%r",
                callback_query_id,
                text,
            )
            return
        return
    url = f"https://api.telegram.org/bot{bot}/answerCallbackQuery"
    data = {"callback_query_id": str(callback_query_id)}
    if text:
        data["text"] = text[:200]
    payload = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
    except Exception as exc:
        logger.warning("Telegram answerCallbackQuery failed: %s", exc)


def edit_message_text(chat_id: str, message_id, text: str) -> None:
    """Best-effort editMessageText. Снимает кнопки (reply_markup пустой)."""
    if message_id in (None, ""):
        return
    bot = _bot_token()
    if not bot:
        if getattr(settings, "DEBUG", False):
            logger.warning(
                "TELEGRAM_BOT_TOKEN not set; would edit %s/%s -> %r",
                chat_id,
                message_id,
                text,
            )
            return
        return
    url = f"https://api.telegram.org/bot{bot}/editMessageText"
    payload = urllib.parse.urlencode(
        {
            "chat_id": str(chat_id),
            "message_id": str(message_id),
            "text": text,
        }
    ).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
    except Exception as exc:
        logger.warning("Telegram editMessageText failed: %s", exc)


def send_admin_mfa_code(chat_id: str, code: str) -> None:
    """Отправляет код админа в Telegram.

    В DEBUG без ``TELEGRAM_BOT_TOKEN`` логирует код (тестам не нужен патч до этого уровня —
    они мокают саму функцию). В production без токена/при сетевой ошибке — ``TelegramMfaError``.
    """
    token = _bot_token()
    if not token:
        if getattr(settings, "DEBUG", False):
            logger.warning(
                "TELEGRAM_BOT_TOKEN not set; admin MFA code (DEBUG only): %s -> %s",
                chat_id,
                code,
            )
            return
        raise TelegramMfaError(
            "TELEGRAM_MFA_NOT_CONFIGURED",
            "Telegram MFA не настроен на сервере",
        )

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = urllib.parse.urlencode(
        {
            "chat_id": str(chat_id),
            "text": f"Код подтверждения админа: {code}\nДействителен 5 минут.",
        }
    ).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status >= 400:
                raise TelegramMfaError(
                    "TELEGRAM_MFA_DELIVERY_FAILED",
                    "Не удалось отправить код в Telegram",
                )
    except TelegramMfaError:
        raise
    except Exception as exc:
        logger.exception("Telegram sendMessage failed: %s", exc)
        raise TelegramMfaError(
            "TELEGRAM_MFA_DELIVERY_FAILED",
            "Не удалось отправить код в Telegram",
        )
