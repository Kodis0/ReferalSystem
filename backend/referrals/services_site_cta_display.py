"""Human-readable site label for CTA / post-join UX (reads Site.config_json and allowed_origins)."""
from __future__ import annotations

from urllib.parse import urlparse

from .models import Site

_CTA_SITE_LABEL_CONFIG_KEYS = (
    "display_name",
    "site_title",
    "title",
    "brand_name",
)


def _sanitize_cta_site_display_label(raw: str) -> str:
    if not raw or not isinstance(raw, str):
        return ""
    s = raw.strip()
    if not s:
        return ""
    s = "".join(ch for ch in s if ch == "\t" or ord(ch) >= 32)
    s = " ".join(s.split())
    return s[:120]


def site_cta_display_label(site: Site) -> str:
    """
    Human-readable line for CTA / post-join UX (no new DB field).

    Prefer optional string keys in ``config_json``, else the hostname of the first parsable
    ``allowed_origins`` URL (owner already sets origins for the embed).
    """
    cfg = site.config_json if isinstance(site.config_json, dict) else {}
    for key in _CTA_SITE_LABEL_CONFIG_KEYS:
        val = cfg.get(key)
        if isinstance(val, str):
            label = _sanitize_cta_site_display_label(val)
            if label:
                return label
    origins = site.allowed_origins or []
    if not isinstance(origins, list):
        return ""
    for origin in origins:
        if not isinstance(origin, str):
            continue
        o = origin.strip()
        if not o:
            continue
        if "://" not in o:
            o = f"https://{o}"
        try:
            host = (urlparse(o).hostname or "").strip().lower()
        except ValueError:
            continue
        if not host:
            continue
        if host.startswith("www."):
            host = host[4:]
        if host:
            return host[:120]
    return ""
