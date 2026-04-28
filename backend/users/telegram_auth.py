"""Telegram Login (oauth.telegram.org callback): проверка подписи hash (core.telegram.org/widgets/login)."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import secrets
import time
from typing import Any, Mapping

TELEGRAM_OAUTH_AUTH_URL = "https://oauth.telegram.org/auth"
MAX_AUTH_AGE_SEC = 86400


def parse_bot_id(bot_token: str) -> str | None:
    if not bot_token or ":" not in bot_token:
        return None
    left = bot_token.split(":", 1)[0].strip()
    return left if left.isdigit() else None


def verify_telegram_login(auth_data: Mapping[str, str], bot_token: str) -> bool:
    """
    Проверка query-параметров редиректа Telegram (поля — строки, как в request.GET).
    """
    rh = (auth_data.get("hash") or "").strip()
    if not rh:
        return False
    try:
        auth_date = int(auth_data.get("auth_date") or "0")
    except (TypeError, ValueError):
        return False
    if auth_date <= 0 or (int(time.time()) - auth_date) > MAX_AUTH_AGE_SEC:
        return False

    lines: list[str] = []
    for key in sorted(k for k in auth_data if k != "hash"):
        val = auth_data.get(key)
        if val is None:
            continue
        lines.append(f"{key}={val}")
    data_check_string = "\n".join(lines)

    secret_key = hashlib.sha256(bot_token.encode()).digest()
    digest = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return secrets.compare_digest(digest, rh)


def decode_telegram_widget_tg_auth_result(b64: str) -> dict[str, Any]:
    """
    Декодирует значение hash-параметра tgAuthResult (base64 JSON из Telegram Login Widget).
    """
    s = (b64 or "").strip()
    if not s:
        raise ValueError("empty_payload")
    pad = (-len(s)) % 4
    if pad:
        s += "=" * pad
    try:
        raw = base64.urlsafe_b64decode(s)
    except (binascii.Error, ValueError):
        raw = base64.standard_b64decode(s)
    try:
        data = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ValueError("invalid_json") from e
    if not isinstance(data, dict):
        raise ValueError("not_object")
    return data


def telegram_widget_auth_to_verify_dict(obj: dict[str, Any]) -> dict[str, str]:
    """Те же строковые поля, что у GET-callback (для verify_telegram_login)."""
    out: dict[str, str] = {}
    for k, v in obj.items():
        if v is None:
            continue
        out[k] = str(v)
    return out
