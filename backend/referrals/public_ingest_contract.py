"""
Structured responses and reason codes for public lead ingest (/public/v1/events/leads).

External JSON uses stable `code` values for tests and support; sensitive distinctions
(e.g. widget disabled vs unknown site) may share the same public response — see services.
"""
from __future__ import annotations

from typing import Any, Mapping, Optional

# --- Stable external codes (client / support / tests) ---
CODE_CREATED = "created"
CODE_DUPLICATE_SUPPRESSED = "duplicate_suppressed"
CODE_RATE_LIMITED = "rate_limited"
CODE_INVALID_PAYLOAD = "invalid_payload"
CODE_INVALID_EVENT = "invalid_event"
CODE_SITE_NOT_FOUND = "site_not_found"
CODE_INVALID_ORIGIN = "invalid_origin"
CODE_ORIGIN_REQUIRED = "origin_required"
CODE_ALLOWED_ORIGINS_REQUIRED = "allowed_origins_required"
CODE_PUBLISHABLE_KEY_REQUIRED = "publishable_key_required"
CODE_INVALID_KEY = "invalid_key"
CODE_VALIDATION_ERROR = "validation_error"
CODE_LEAD_EVENT_NOT_FOUND = "lead_event_not_found"
CODE_INVALID_CLIENT_OUTCOME = "invalid_client_outcome"

RESULT_OUTCOME_UPDATED = "outcome_updated"
RESULT_OUTCOME_UNCHANGED = "outcome_unchanged"

# Internal-only (logs / support), never sent as public `code` when masking applies
INTERNAL_WIDGET_DISABLED = "widget_disabled"
INTERNAL_SITE_NOT_FOUND = "site_not_found"


def public_ingest_success_body(
    *,
    result: str,
    lead_event_id: int,
    event_name: str = "lead_submitted",
) -> dict[str, Any]:
    return {
        "status": "ok",
        "result": result,
        "code": result,
        "event": event_name,
        "lead_event_id": lead_event_id,
    }


def public_ingest_client_outcome_success_body(
    *,
    result: str,
    lead_event_id: int,
) -> dict[str, Any]:
    """Structured OK for ``event: lead_client_outcome`` follow-ups."""
    return {
        "status": "ok",
        "result": result,
        "code": result,
        "event": "lead_client_outcome",
        "lead_event_id": lead_event_id,
    }


def public_ingest_error_body(
    *,
    code: str,
    message: str,
    details: Optional[Mapping[str, Any]] = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "status": "error",
        "code": code,
        "message": message,
        # Backward compatibility for older clients/tests expecting `detail`
        "detail": code,
    }
    if details:
        body["details"] = dict(details)
    return body
