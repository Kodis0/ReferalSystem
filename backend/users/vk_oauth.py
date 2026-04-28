"""VK ID OAuth 2.1 (PKCE): authorize на id.vk.com, обмен кода на id.vk.com/oauth2/auth."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
from typing import Any

import requests

logger = logging.getLogger(__name__)

VK_ID_AUTHORIZE_URL = "https://id.vk.com/authorize"
VK_ID_TOKEN_URL = "https://id.vk.com/oauth2/auth"
VK_ID_USER_INFO_URL = "https://id.vk.com/oauth2/user_info"


def generate_pkce_pair() -> tuple[str, str]:
    """Возвращает (code_verifier, code_challenge) для S256."""
    verifier = secrets.token_urlsafe(32)
    challenge = pkce_challenge_s256(verifier)
    return verifier, challenge


def pkce_challenge_s256(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def parse_vk_id_callback_query(request) -> dict[str, Any]:
    """
    Параметры редиректа VK ID: обычно code, state, device_id в query;
    либо данные в `payload` (строка JSON или base64url JSON).
    """
    get = request.GET
    err = get.get("error")
    if err:
        return {"error": err, "code": None, "state": None, "device_id": None}

    payload_raw = get.get("payload")
    if payload_raw:
        try:
            raw = payload_raw.strip()
            if raw.startswith("{"):
                data = json.loads(raw)
            else:
                pad = (-len(raw)) % 4
                decoded = base64.urlsafe_b64decode(raw + ("=" * pad)).decode("utf-8")
                data = json.loads(decoded)
            if isinstance(data, dict):
                did = data.get("device_id")
                return {
                    "error": None,
                    "code": data.get("code"),
                    "state": data.get("state"),
                    "device_id": str(did) if did is not None and did != "" else None,
                }
        except (json.JSONDecodeError, ValueError, UnicodeDecodeError) as ex:
            logger.warning("VK ID payload parse failed: %s", ex)

    did_flat = get.get("device_id")
    return {
        "error": None,
        "code": get.get("code"),
        "state": get.get("state"),
        "device_id": str(did_flat) if did_flat not in (None, "") else None,
    }


def _email_from_mapping(data: dict[str, Any]) -> str | None:
    if not isinstance(data, dict):
        return None
    for key in ("email",):
        v = data.get(key)
        if isinstance(v, str) and "@" in v:
            return v.strip()
    user = data.get("user")
    if isinstance(user, dict):
        e = user.get("email")
        if isinstance(e, str) and "@" in e:
            return e.strip()
    return None


def _find_email_deep(obj: Any) -> str | None:
    """Обход вложенных dict/list на случай смены схемы ответа VK ID."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "email" and isinstance(v, str) and "@" in v:
                return v.strip()
            found = _find_email_deep(v)
            if found:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = _find_email_deep(item)
            if found:
                return found
    return None


def fetch_vk_id_user_email(*, access_token: str, client_id: str) -> str | None:
    """
    Документация VK ID: POST user_info, form-urlencoded, client_id + access_token.
    Только GET + Bearer часто не отдают email, даже при scope=email.
    """
    resp = requests.post(
        VK_ID_USER_INFO_URL,
        data={"client_id": str(client_id), "access_token": access_token},
        timeout=25,
    )
    resp.raise_for_status()
    payload = resp.json()
    if not isinstance(payload, dict):
        return None
    return _email_from_mapping(payload) or _find_email_deep(payload)


def exchange_vk_oauth_code(
    *,
    code: str,
    app_id: str,
    client_secret: str,
    redirect_uri: str,
    code_verifier: str,
    device_id: str,
    state: str | None,
) -> dict[str, Any]:
    """
    Обмен authorization code на токены (VK ID, PKCE).
    Защищённый ключ опционален, если приложение настроено только на PKCE.
    """
    data: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": code_verifier,
        "client_id": app_id,
        "device_id": device_id,
        "redirect_uri": redirect_uri,
    }
    if state:
        data["state"] = state
    secret = (client_secret or "").strip()
    if secret:
        data["client_secret"] = secret

    resp = requests.post(VK_ID_TOKEN_URL, data=data, timeout=25)
    resp.raise_for_status()
    out = resp.json()
    if not isinstance(out, dict):
        raise ValueError("vk_token_not_json")
    if out.get("error"):
        logger.warning(
            "VK ID token endpoint error: %s",
            out.get("error_description", out.get("error")),
        )
        raise ValueError("vk_token_error")
    return out


def email_from_vk_id_token_response(token_payload: dict[str, Any]) -> str | None:
    """Email из ответа /oauth2/auth, если VK отдал его сразу."""
    return _email_from_mapping(token_payload)
