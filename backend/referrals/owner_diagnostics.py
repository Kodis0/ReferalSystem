"""
Site owner diagnostics — integration health, recent lead rows, window aggregates.

Kept separate from ``services.py`` to avoid growing the public-ingest surface.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from django.utils import timezone

from .models import ReferralLeadEvent, Site
from .public_ingest_audit import build_ingest_quality_window
from .services import (
    mask_email_for_partner_dashboard,
    page_path_for_partner_dashboard,
    site_allowed_origins_list,
)


def _truthy_config_flag(cfg: dict[str, Any], key: str) -> bool:
    v = cfg.get(key)
    if v is True:
        return True
    s = str(v or "").strip().lower()
    return s in ("1", "true", "yes", "on")


def widget_runtime_flags_from_config(cfg: dict[str, Any]) -> dict[str, Any]:
    """Runtime flags and selector fields surfaced to the owner (mirrors embed semantics)."""
    cfg = cfg if isinstance(cfg, dict) else {}
    out: dict[str, Any] = {
        "observe_success": _truthy_config_flag(cfg, "observe_success"),
        "report_observed_outcome": _truthy_config_flag(cfg, "report_observed_outcome"),
        "amount_selector": "",
        "product_name_selector": "",
        "currency": "",
    }
    for key in ("amount_selector", "product_name_selector"):
        raw = cfg.get(key)
        if isinstance(raw, str) and raw.strip():
            out[key] = raw.strip()
    cur = cfg.get("currency")
    if isinstance(cur, str) and cur.strip():
        out["currency"] = cur.strip()[:16]
    return out


def mask_phone_for_owner_preview(raw: str) -> Optional[str]:
    """Short non-reversible phone hint for owner UI (last 4 digits)."""
    digits = "".join(c for c in (raw or "") if c.isdigit())
    if len(digits) < 4:
        return None
    return f"***{digits[-4:]}"


SUBMISSION_STAGE_UI = {
    ReferralLeadEvent.SubmissionStage.SUBMIT_ATTEMPT: {
        "label": "Попытка отправки (submit_attempt)",
        "badge": "stage_submit_attempt",
    },
}

CLIENT_OUTCOME_UI = {
    "": {
        "label": "Не сообщено",
        "badge": "outcome_unset",
    },
    ReferralLeadEvent.ClientObservedOutcome.SUCCESS_OBSERVED: {
        "label": "Успех наблюдён (клиент)",
        "badge": "outcome_success",
    },
    ReferralLeadEvent.ClientObservedOutcome.FAILURE_OBSERVED: {
        "label": "Сбой наблюдён (клиент)",
        "badge": "outcome_failure",
    },
    ReferralLeadEvent.ClientObservedOutcome.NOT_OBSERVED: {
        "label": "Итог не подтверждён (not_observed)",
        "badge": "outcome_not_observed",
    },
}


def _outcome_ui(code: str) -> dict[str, str]:
    return CLIENT_OUTCOME_UI.get(
        (code or "").strip(),
        {"label": (code or "—")[:64], "badge": "outcome_unknown"},
    )


def _stage_ui(code: str) -> dict[str, str]:
    return SUBMISSION_STAGE_UI.get(
        (code or "").strip(),
        {"label": (code or "—")[:64], "badge": "stage_unknown"},
    )


@dataclass(frozen=True)
class WindowStats:
    submit_attempt_count: int
    success_observed_count: int
    failure_observed_count: int
    not_observed_count: int
    outcome_unset_count: int


def _window_stats_for_site(site: Site, *, since) -> WindowStats:
    qs = ReferralLeadEvent.objects.filter(site=site, created_at__gte=since)
    return WindowStats(
        submit_attempt_count=qs.count(),
        success_observed_count=qs.filter(
            client_observed_outcome=ReferralLeadEvent.ClientObservedOutcome.SUCCESS_OBSERVED
        ).count(),
        failure_observed_count=qs.filter(
            client_observed_outcome=ReferralLeadEvent.ClientObservedOutcome.FAILURE_OBSERVED
        ).count(),
        not_observed_count=qs.filter(
            client_observed_outcome=ReferralLeadEvent.ClientObservedOutcome.NOT_OBSERVED
        ).count(),
        outcome_unset_count=qs.filter(client_observed_outcome="").count(),
    )


def build_integration_warnings(
    site: Site,
    *,
    cfg: dict[str, Any],
    stats_24h: WindowStats,
    stats_7d: WindowStats,
) -> list[str]:
    codes: list[str] = []
    origins = site_allowed_origins_list(site)
    if not origins:
        codes.append("no_allowed_origins")
    if not site.widget_enabled:
        codes.append("widget_disabled")
    if not (site.publishable_key or "").strip():
        codes.append("publishable_key_missing")

    flags = widget_runtime_flags_from_config(cfg)
    if not flags["observe_success"]:
        codes.append("observe_success_off")
    if not flags["report_observed_outcome"]:
        codes.append("report_observed_outcome_off")

    if site.widget_enabled and origins:
        if stats_7d.submit_attempt_count == 0:
            codes.append("no_leads_last_7_days")

    # Heuristic: many inconclusive outcomes with volume — likely selector / thank-you page issues.
    if stats_7d.submit_attempt_count >= 5:
        ratio = stats_7d.not_observed_count / max(1, stats_7d.submit_attempt_count)
        if ratio >= 0.6 and stats_7d.not_observed_count >= 3:
            codes.append("high_not_observed_ratio_7d")

    if stats_24h.submit_attempt_count >= 3 and stats_24h.outcome_unset_count == stats_24h.submit_attempt_count:
        if flags["report_observed_outcome"]:
            codes.append("no_outcome_reported_last_24h")

    return codes


def resolve_integration_status(
    site: Site,
    *,
    warnings: list[str],
) -> str:
    if not site.widget_enabled:
        return "disabled"
    if not site_allowed_origins_list(site):
        return "incomplete"
    if not (site.publishable_key or "").strip():
        return "incomplete"
    critical = {
        "no_allowed_origins",
        "publishable_key_missing",
        "widget_disabled",
    }
    if any(w in critical for w in warnings):
        return "needs_attention"
    # Strong signals only — observe_success/report defaults stay as integration_warnings text,
    # without forcing "needs_attention" for every new site.
    strong_signals = {
        "high_not_observed_ratio_7d",
        "no_outcome_reported_last_24h",
    }
    if any(w in strong_signals for w in warnings):
        return "needs_attention"
    return "healthy"


def build_embed_readiness(site: Site) -> dict[str, bool]:
    return {
        "origins_configured": bool(site_allowed_origins_list(site)),
        "widget_enabled": bool(site.widget_enabled),
        "publishable_key_present": bool((site.publishable_key or "").strip()),
        "public_id_present": bool(site.public_id),
    }


def list_recent_site_leads_for_owner(site: Site, *, limit: int = 50) -> list[ReferralLeadEvent]:
    return list(
        ReferralLeadEvent.objects.filter(site=site)
        .order_by("-created_at")[: max(1, min(limit, 100))]
    )


def serialize_owner_lead_row(ev: ReferralLeadEvent) -> dict[str, Any]:
    stage = _stage_ui(ev.submission_stage)
    oc = _outcome_ui(ev.client_observed_outcome)
    return {
        "id": ev.id,
        "created_at": ev.created_at.isoformat(),
        "page_path": page_path_for_partner_dashboard(ev.page_url),
        "page_key": (ev.page_key or "")[:512],
        "form_id": ev.form_id,
        "ref_code": ev.ref_code,
        "submission_stage": ev.submission_stage,
        "submission_stage_label": stage["label"],
        "submission_stage_badge": stage["badge"],
        "client_observed_outcome": ev.client_observed_outcome or "",
        "client_outcome_label": oc["label"],
        "client_outcome_badge": oc["badge"],
        "client_outcome_reason": (ev.client_outcome_reason or "")[:255],
        "customer_email_masked": mask_email_for_partner_dashboard(ev.customer_email),
        "customer_phone_masked": mask_phone_for_owner_preview(ev.customer_phone),
        "amount": str(ev.amount) if ev.amount is not None else None,
        "currency": ev.currency or "",
        "product_name": (ev.product_name or "")[:512],
        "note": "Каноническая строка лида; дублирующие попытки учитываются в ingest_quality.",
    }


def build_site_owner_diagnostics_payload(*, site: Site, recent_limit: int = 50) -> dict[str, Any]:
    now = timezone.now()
    since_24h = now - timezone.timedelta(hours=24)
    since_7d = now - timezone.timedelta(days=7)

    cfg = site.config_json if isinstance(site.config_json, dict) else {}
    flags = widget_runtime_flags_from_config(cfg)

    w24 = _window_stats_for_site(site, since=since_24h)
    w7 = _window_stats_for_site(site, since=since_7d)

    warnings = build_integration_warnings(site, cfg=cfg, stats_24h=w24, stats_7d=w7)
    integration_status = resolve_integration_status(site, warnings=warnings)

    recent = list_recent_site_leads_for_owner(site, limit=recent_limit)
    has_recent = ReferralLeadEvent.objects.filter(site=site).exists()

    ingest_24h = build_ingest_quality_window(site=site, since=since_24h)
    ingest_7d = build_ingest_quality_window(site=site, since=since_7d)

    def _win(ws: WindowStats) -> dict[str, Any]:
        return {
            "submit_attempt_count": ws.submit_attempt_count,
            "success_observed_count": ws.success_observed_count,
            "failure_observed_count": ws.failure_observed_count,
            "not_observed_count": ws.not_observed_count,
            "outcome_unset_count": ws.outcome_unset_count,
        }

    return {
        "site_public_id": str(site.public_id),
        "integration_status": integration_status,
        "integration_warnings": warnings,
        "embed_readiness": build_embed_readiness(site),
        "widget_runtime": flags,
        "platform_preset": site.platform_preset,
        "widget_enabled": site.widget_enabled,
        "allowed_origins": site_allowed_origins_list(site),
        "windows": {
            "24h": _win(w24),
            "7d": _win(w7),
        },
        "has_recent_leads": has_recent,
        "recent_leads_count": len(recent),
        "ingest_quality": {
            "source": "public_lead_ingest_audit",
            "24h": ingest_24h,
            "7d": ingest_7d,
        },
        "recent_leads": [serialize_owner_lead_row(ev) for ev in recent],
    }
