"""Настройки Relying Party и origins для WebAuthn (Passkey)."""

from __future__ import annotations

from urllib.parse import urlparse

from django.conf import settings


def webauthn_rp_id() -> str:
    explicit = (getattr(settings, "WEBAUTHN_RP_ID", None) or "").strip()
    if explicit:
        return explicit
    fe = getattr(settings, "FRONTEND_URL", "http://localhost:3000")
    host = urlparse(fe).hostname or "localhost"
    return host


def webauthn_rp_name() -> str:
    name = (getattr(settings, "WEBAUTHN_RP_NAME", None) or "").strip()
    return name or "LumoRef"


def webauthn_expected_origins() -> list[str]:
    raw = (getattr(settings, "WEBAUTHN_EXPECTED_ORIGINS", None) or "").strip()
    if raw:
        return [x.strip() for x in raw.split(",") if x.strip()]
    fe = (getattr(settings, "FRONTEND_URL", "http://localhost:3000") or "").strip().rstrip("/")
    out: list[str] = []
    if fe:
        out.append(fe)
    if getattr(settings, "DEBUG", False):
        for local in ("http://localhost:3000", "http://127.0.0.1:3000"):
            if local not in out:
                out.append(local)
    return out if out else ["http://localhost:3000"]


def request_origin_header(request) -> str | None:
    v = (request.headers.get("Origin") or "").strip()
    return v or None


def user_handle_bytes(user_id: int) -> bytes:
    """Стабильный user handle для WebAuthn (до 64 байт)."""
    return user_id.to_bytes(8, byteorder="big")
