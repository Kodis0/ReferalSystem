"""Platform-wide service availability for LK support UI (optional env overrides)."""

from __future__ import annotations

import json
from typing import Any

from django.conf import settings
from django.utils import timezone

# Same logical services as `frontend/src/pages/lk/support/supportConstants.js` (`value` field).
DEFAULT_SERVICE_IDS: tuple[str, ...] = ("lumo-owner", "lumo-widget", "lumo-referral")


def _parse_overrides(raw: str) -> dict[str, dict[str, Any]]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if isinstance(data, dict):
        out: dict[str, dict[str, Any]] = {}
        for key, val in data.items():
            sid = str(key).strip()
            if not sid or sid not in DEFAULT_SERVICE_IDS:
                continue
            if isinstance(val, dict):
                out[sid] = val
        return out
    if isinstance(data, list):
        out = {}
        for item in data:
            if not isinstance(item, dict):
                continue
            sid = str(item.get("id") or "").strip()
            if not sid or sid not in DEFAULT_SERVICE_IDS:
                continue
            out[sid] = item
        return out
    return {}


def build_platform_service_status_payload() -> dict[str, Any]:
    raw = getattr(settings, "PLATFORM_SERVICE_STATUS_OVERRIDES_JSON", "") or ""
    overrides = _parse_overrides(str(raw).strip())

    services = []
    for sid in DEFAULT_SERVICE_IDS:
        ov = overrides.get(sid, {})
        ok = True
        if isinstance(ov, dict) and "ok" in ov:
            ok = bool(ov.get("ok"))
        message = ""
        if isinstance(ov, dict):
            message = str(ov.get("message") or "").strip()
        services.append({"id": sid, "ok": ok, "message": message})

    return {"services": services, "fetched_at": timezone.now().isoformat()}
