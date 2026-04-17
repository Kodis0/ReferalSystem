"""
Structured logging for public lead ingest — no raw PII, flags only where useful.
"""
from __future__ import annotations

import logging
from typing import Any, Mapping, Optional

from django.conf import settings

from .models import Site

logger = logging.getLogger("referrals.public_ingest")

# Test-only observability (no-op in production unless tests enable it)
_ingest_counters: dict[str, int] = {}


def reset_ingest_counters_for_tests() -> None:
    _ingest_counters.clear()


def bump_ingest_counter(key: str) -> None:
    if not getattr(settings, "LEAD_INGEST_EXPOSE_COUNTERS", False):
        return
    _ingest_counters[key] = _ingest_counters.get(key, 0) + 1


def get_ingest_counters_snapshot() -> dict[str, int]:
    return dict(_ingest_counters)


def _client_ip(request) -> str:
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return (xff.split(",")[0]).strip() or ""
    return (request.META.get("REMOTE_ADDR") or "").strip()


def log_public_lead_gate_rejection(
    *,
    request,
    internal_reason: str,
    public_code: str,
    site: Optional[Site] = None,
) -> None:
    origin = (request.headers.get("Origin") or "").strip()
    bump_ingest_counter(f"gate:{public_code}")
    logger.warning(
        "public_ingest gate_reject internal_reason=%s public_code=%s "
        "site_public_id=%s site_id=%s origin=%s client_ip=%s",
        internal_reason,
        public_code,
        str(site.public_id) if site else "",
        site.pk if site else "",
        origin[:200] if origin else "",
        _client_ip(request),
    )


def log_public_lead_rate_limited(
    *,
    request,
    site: Site,
    scope: str,
) -> None:
    bump_ingest_counter("outcome:rate_limited")
    logger.warning(
        "public_ingest rate_limited scope=%s site_public_id=%s site_id=%s "
        "origin=%s client_ip=%s",
        scope,
        str(site.public_id),
        site.pk,
        (request.headers.get("Origin") or "")[:200],
        _client_ip(request),
    )


def log_public_lead_validation_error(
    *,
    request,
    site: Site,
    code: str,
) -> None:
    bump_ingest_counter(f"validation:{code}")
    logger.info(
        "public_ingest validation_reject code=%s site_public_id=%s site_id=%s origin=%s",
        code,
        str(site.public_id),
        site.pk,
        (request.headers.get("Origin") or "")[:200],
    )


def log_public_lead_ingest_success(
    *,
    request,
    site: Site,
    result: str,
    lead_event_id: int,
    normalized: Mapping[str, Any],
    page_key: str = "",
) -> None:
    bump_ingest_counter(f"outcome:{result}")
    has_email = bool((normalized.get("customer_email") or "").strip())
    has_phone = bool((normalized.get("customer_phone") or "").strip())
    form_id = (normalized.get("form_id") or "")[:64]
    pk = (page_key or "")[:128]
    dbg = bool(getattr(settings, "LEAD_INGEST_DEBUG_LOGGING", False))
    logger.info(
        "public_ingest ok result=%s lead_event_id=%s site_public_id=%s site_id=%s "
        "has_email=%s has_phone=%s form_id=%r page_key=%r origin=%s client_ip=%s",
        result,
        lead_event_id,
        str(site.public_id),
        site.pk,
        has_email,
        has_phone,
        form_id,
        pk,
        (request.headers.get("Origin") or "")[:200],
        _client_ip(request),
    )
    if dbg:
        logger.debug(
            "public_ingest debug keys=%s",
            sorted(str(k) for k in normalized.keys())[:40],
        )


def log_public_lead_outcome_report(
    *,
    request,
    site: Site,
    result: str,
    lead_event_id: int,
    outcome_code: str,
) -> None:
    bump_ingest_counter(f"outcome_report:{result}")
    logger.info(
        "public_ingest outcome_report result=%s lead_event_id=%s site_public_id=%s "
        "site_id=%s outcome_code=%s origin=%s client_ip=%s",
        result,
        lead_event_id,
        str(site.public_id),
        site.pk,
        (outcome_code or "")[:32],
        (request.headers.get("Origin") or "")[:200],
        _client_ip(request),
    )
