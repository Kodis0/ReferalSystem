"""Partner-facing formatting helpers for dashboard payloads (no DB, no I/O)."""
from __future__ import annotations

from typing import Optional
from urllib.parse import urlparse


def mask_email_for_partner_dashboard(raw: str) -> Optional[str]:
    """
    Return a heavily redacted email for partner-facing surfaces (not reversible).
    If the value does not look like a normal email, returns None (do not echo arbitrary PII).
    """
    s = (raw or "").strip()
    if not s or "@" not in s:
        return None
    local, _, domain = s.partition("@")
    local = local.strip()
    domain = domain.strip()
    if not local or not domain:
        return None
    domain_lower = domain.lower()
    if len(local) == 1:
        masked_local = "*"
    else:
        masked_local = f"{local[0]}***"
    return f"{masked_local}@{domain_lower}"


def page_path_for_partner_dashboard(page_url: str, *, max_len: int = 96) -> str:
    """
    Page reference for partners: path only (no query string), never the full raw URL in the UI payload.
    """
    s = (page_url or "").strip()
    if not s:
        return ""
    try:
        parsed = urlparse(s)
        if parsed.scheme or parsed.netloc:
            path = parsed.path or "/"
        else:
            path = s.split("?", 1)[0].split("#", 1)[0]
    except Exception:
        path = s.split("?", 1)[0].split("#", 1)[0]
    path = path.strip() or "/"
    if len(path) > max_len:
        return f"{path[: max_len - 1]}…"
    return path
