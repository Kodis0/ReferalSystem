"""Normalization of Site.config_json capture_config (no DB writes)."""
from __future__ import annotations

from typing import Any, Mapping

from .models import Site

SITE_CAPTURE_CONFIG_KEY = "capture_config"
SITE_CAPTURE_CONFIG_VERSION = 1
SITE_CAPTURE_REQUIRED_FIELDS = ("ref", "page_url", "form_id")
SITE_CAPTURE_OPTIONAL_FIELDS = ("name", "email", "phone", "amount", "currency", "product_name")
SITE_CAPTURE_RECOMMENDED_FIELDS = ("name", "email", "phone")


def sanitize_site_capture_config(raw: Any) -> dict[str, Any]:
    allowed = set(SITE_CAPTURE_OPTIONAL_FIELDS)
    values = raw if isinstance(raw, Mapping) else {}
    enabled_raw = values.get("enabled_optional_fields")
    enabled_items = enabled_raw if isinstance(enabled_raw, list) else []
    enabled_seen: set[str] = set()
    enabled: list[str] = []
    for item in enabled_items:
        key = str(item or "").strip()
        if key in allowed and key not in enabled_seen:
            enabled_seen.add(key)
            enabled.append(key)
    return {
        "version": SITE_CAPTURE_CONFIG_VERSION,
        "enabled_optional_fields": enabled,
    }


def site_capture_config_dict(site: Site) -> dict[str, Any]:
    cfg = site.config_json if isinstance(site.config_json, Mapping) else {}
    has_capture_config = SITE_CAPTURE_CONFIG_KEY in cfg
    raw = cfg.get(SITE_CAPTURE_CONFIG_KEY)
    normalized = sanitize_site_capture_config(raw)
    if not has_capture_config:
        normalized["enabled_optional_fields"] = list(SITE_CAPTURE_OPTIONAL_FIELDS)
    return {
        **normalized,
        "required_fields": list(SITE_CAPTURE_REQUIRED_FIELDS),
        "recommended_fields": list(SITE_CAPTURE_RECOMMENDED_FIELDS),
    }
