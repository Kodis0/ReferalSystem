"""
Persistent technical audit rows for public POST /public/v1/events/leads (one row per handled request).

Separate from ReferralLeadEvent: canonical leads stay unchanged; this plane is for operational metrics.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Mapping, Optional

from django.db.models import Count
from django.utils import timezone

from .public_ingest_contract import (
    CODE_CREATED,
    CODE_DUPLICATE_SUPPRESSED,
    CODE_RATE_LIMITED,
    RESULT_OUTCOME_UNCHANGED,
    RESULT_OUTCOME_UPDATED,
)

if TYPE_CHECKING:
    from django.http import HttpRequest

    from .models import PublicLeadIngestAudit, ReferralLeadEvent, Site

logger = logging.getLogger(__name__)

# Success / accepted HTTP paths for lead_submitted + lead_client_outcome
_SUCCESS_CODES = frozenset(
    {
        CODE_CREATED,
        CODE_DUPLICATE_SUPPRESSED,
        RESULT_OUTCOME_UPDATED,
        RESULT_OUTCOME_UNCHANGED,
    }
)


def _client_ip(request: HttpRequest) -> str:
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return (xff.split(",")[0]).strip() or ""
    return (request.META.get("REMOTE_ADDR") or "").strip()


def _origin_prefix(request: HttpRequest) -> tuple[bool, str]:
    o = (request.headers.get("Origin") or "").strip()
    return (bool(o), o[:256])


def record_public_lead_ingest_audit(
    *,
    site: Optional[Site],
    request: HttpRequest,
    event_name: str,
    public_code: str,
    http_status: int,
    internal_reason: str = "",
    lead_event: Optional[ReferralLeadEvent] = None,
    throttle_scope: str = "",
    form_id: str = "",
    page_key: str = "",
    submission_stage_snapshot: str = "",
    client_observed_outcome_snapshot: str = "",
    has_email: bool = False,
    has_phone: bool = False,
) -> None:
    """
    Best-effort insert; never raises to callers (ingest response must not fail on audit DB issues).
    """
    try:
        from .models import PublicLeadIngestAudit

        origin_present, origin_prefix = _origin_prefix(request)
        ip = _client_ip(request)
        PublicLeadIngestAudit.objects.create(
            site=site,
            event_name=(event_name or "")[:32],
            public_code=(public_code or "")[:64],
            internal_reason=(internal_reason or "")[:64],
            http_status=int(http_status),
            lead_event=lead_event,
            throttle_scope=(throttle_scope or "")[:16],
            form_id=(form_id or "")[:255],
            page_key=(page_key or "")[:512],
            submission_stage_snapshot=(submission_stage_snapshot or "")[:32],
            client_observed_outcome_snapshot=(client_observed_outcome_snapshot or "")[:32],
            origin_present=origin_present,
            origin_header_prefix=origin_prefix,
            client_ip=ip or None,
            has_email=bool(has_email),
            has_phone=bool(has_phone),
        )
    except Exception:
        logger.exception("public_ingest_audit: failed to persist audit row")


def build_ingest_quality_window(*, site: Site, since) -> dict[str, Any]:
    """Aggregates for owner diagnostics from PublicLeadIngestAudit."""
    from .models import PublicLeadIngestAudit

    qs = PublicLeadIngestAudit.objects.filter(site=site, created_at__gte=since)
    total = qs.count()
    by_code: dict[str, int] = {}
    for row in qs.values("public_code").annotate(c=Count("id")):
        code = row["public_code"] or ""
        by_code[code] = row["c"]

    def _c(code: str) -> int:
        return by_code.get(code, 0)

    created = _c(CODE_CREATED)
    dup = _c(CODE_DUPLICATE_SUPPRESSED)
    ou = _c(RESULT_OUTCOME_UPDATED)
    ouu = _c(RESULT_OUTCOME_UNCHANGED)
    rl = _c(CODE_RATE_LIMITED)

    success_rows = qs.filter(public_code__in=_SUCCESS_CODES).count()
    rl_rows = qs.filter(public_code=CODE_RATE_LIMITED).count()
    rejected = max(0, total - success_rows - rl_rows)
    lead_ingest_den = created + dup
    dup_ratio = (dup / lead_ingest_den) if lead_ingest_den else None

    return {
        "total_requests": total,
        "by_code": by_code,
        "created_count": created,
        "duplicate_suppressed_count": dup,
        "outcome_updated_count": ou,
        "outcome_unchanged_count": ouu,
        "rate_limited_count": rl_rows,
        "rejected_count": rejected,
        "success_count": success_rows,
        "duplicate_ratio_lead_submitted": dup_ratio,
        "success_ratio": (success_rows / total) if total else None,
    }
