"""
Referral domain services — explicit entry points (no Django signals).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import string
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping, NamedTuple, Optional, Tuple
from urllib.parse import urlparse

from django.apps import apps
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F, Q, Sum
from django.utils import timezone

from .models import (
    Commission,
    CustomerAttribution,
    Order,
    PartnerProfile,
    Project,
    ReferralLeadEvent,
    ReferralVisit,
    Site,
    SiteMembership,
)
from .services_owner_site_shell import (
    SITE_DISPLAY_NAME_CONFIG_KEY,
    SITE_SHELL_AVATAR_CONFIG_KEY,
    owner_project_metadata_from_site,
    site_owner_display_name,
    site_shell_avatar_data_url,
)
from .services_site_capture_config import (
    SITE_CAPTURE_CONFIG_KEY,
    SITE_CAPTURE_CONFIG_VERSION,
    SITE_CAPTURE_OPTIONAL_FIELDS,
    SITE_CAPTURE_RECOMMENDED_FIELDS,
    SITE_CAPTURE_REQUIRED_FIELDS,
    sanitize_site_capture_config,
    site_capture_config_dict,
)
from .services_site_cta_display import site_cta_display_label
from .services_partner_dashboard_formatting import (
    mask_email_for_partner_dashboard,
    page_path_for_partner_dashboard,
)

logger = logging.getLogger(__name__)

# Unambiguous ref alphabet (no O/0/I/1 confusion).
_REF_ALPHABET = string.ascii_uppercase.replace("O", "").replace("I", "") + "23456789"

_PROJECT_AVATAR_PALETTES = (
    ("#0F172A", "#1D4ED8", "#1E3A8A", "#1D4ED8"),
    ("#172554", "#1D4ED8", "#1E40AF", "#2563EB"),
    ("#1E1B4B", "#1E40AF", "#1E3A8A", "#3B82F6"),
    ("#082F49", "#1D4ED8", "#0F3D91", "#2563EB"),
)
DEFAULT_OWNER_PROJECT_NAME = "Общий проект"
_PUBLIC_WIDGET_PRIVATE_CONFIG_KEYS = frozenset(
    {
        "display_name",
        "description",
        "avatar_data_url",
        SITE_SHELL_AVATAR_CONFIG_KEY,
        SITE_DISPLAY_NAME_CONFIG_KEY,
        SITE_CAPTURE_CONFIG_KEY,
    }
)


def _ttl_delta():
    days = int(getattr(settings, "REFERRAL_ATTRIBUTION_TTL_DAYS", 30))
    return timezone.timedelta(days=days)


def _default_commission_percent() -> Decimal:
    raw = getattr(settings, "REFERRAL_DEFAULT_COMMISSION_PERCENT", "10.00")
    return Decimal(str(raw))


def _timing_safe_str_eq(expected: str, got: str) -> bool:
    """Constant-time compare for webhook secrets (length mismatch => False, no exception)."""
    a = (expected or "").encode("utf-8")
    b = (got or "").encode("utf-8")
    if len(a) != len(b) or not a:
        return False
    return hmac.compare_digest(a, b)


def order_webhook_auth_failure(request) -> Optional[Tuple[int, dict]]:
    """
    Enforce shared secret for POST /users/api/orders/ when ORDER_WEBHOOK_SHARED_SECRET is set.

    Accepts the secret in ``X-Order-Webhook-Secret`` or ``Authorization: Bearer <secret>``.

    Returns:
        None if the request may proceed.
        (http_status, body_dict) if the request must be rejected.
    """
    secret = (getattr(settings, "ORDER_WEBHOOK_SHARED_SECRET", None) or "").strip()
    if not secret:
        if settings.DEBUG:
            return None
        return (
            503,
            {
                "status": "error",
                "message": "webhook_secret_not_configured",
            },
        )

    header_secret = (request.headers.get("X-Order-Webhook-Secret") or "").strip()
    auth = (request.headers.get("Authorization") or "").strip()
    bearer = ""
    if auth.lower().startswith("bearer "):
        bearer = auth[7:].strip()

    provided = header_secret or bearer
    if not provided:
        return (401, {"status": "error", "message": "unauthorized"})

    if not _timing_safe_str_eq(secret, provided):
        return (401, {"status": "error", "message": "unauthorized"})

    return None


def generate_ref_code(length: int = 10) -> str:
    """Return a unique ref_code for PartnerProfile."""
    PartnerProfileModel = apps.get_model("referrals", "PartnerProfile")
    for _ in range(80):
        code = "".join(secrets.choice(_REF_ALPHABET) for _ in range(length))
        if not PartnerProfileModel.objects.filter(ref_code__iexact=code).exists():
            return code
    raise RuntimeError("Could not allocate a unique ref_code")


def generate_project_avatar_data_url() -> str:
    """Generate a blue geometric SVG avatar for a newly created owner project."""
    seed = secrets.token_hex(12)
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    bg_start, bg_end, shape_a, shape_b = _PROJECT_AVATAR_PALETTES[
        digest[0] % len(_PROJECT_AVATAR_PALETTES)
    ]
    accent = "#FFFFFF"

    orb_1_x = 16 + digest[1] % 20
    orb_1_y = 16 + digest[2] % 20
    orb_1_r = 12 + digest[3] % 8
    orb_2_x = 40 + digest[4] % 18
    orb_2_y = 38 + digest[5] % 18
    orb_2_r = 11 + digest[6] % 9

    diamond_cx = 24 + digest[7] % 24
    diamond_cy = 24 + digest[8] % 24
    diamond_r = 10 + digest[9] % 9

    rect_x = 10 + digest[10] % 18
    rect_y = 30 + digest[11] % 16
    rect_w = 28 + digest[12] % 18
    rect_h = 12 + digest[13] % 10
    rect_rot = -24 + digest[14] % 49

    triangle_x1 = 8 + digest[15] % 18
    triangle_y1 = 40 + digest[16] % 16
    triangle_x2 = 28 + digest[17] % 18
    triangle_y2 = 12 + digest[18] % 18
    triangle_x3 = 50 + digest[19] % 14
    triangle_y3 = 44 + digest[20] % 16

    highlight_x = 34 + digest[21] % 18
    highlight_y = 8 + digest[22] % 16
    highlight_r = 8 + digest[23] % 7

    svg = f"""
<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="bg-{seed}" x1="10" y1="6" x2="62" y2="66" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="{bg_start}"/>
      <stop offset="1" stop-color="{bg_end}"/>
    </linearGradient>
    <clipPath id="clip-{seed}">
      <circle cx="36" cy="36" r="36"/>
    </clipPath>
  </defs>
  <g clip-path="url(#clip-{seed})">
    <circle cx="36" cy="36" r="36" fill="url(#bg-{seed})"/>
    <circle cx="{orb_1_x}" cy="{orb_1_y}" r="{orb_1_r}" fill="{shape_a}" opacity="0.85"/>
    <circle cx="{orb_2_x}" cy="{orb_2_y}" r="{orb_2_r}" fill="{shape_b}" opacity="0.72"/>
    <rect x="{rect_x}" y="{rect_y}" width="{rect_w}" height="{rect_h}" rx="{max(6, rect_h // 2)}"
      fill="{accent}" opacity="0.18" transform="rotate({rect_rot} 36 36)"/>
    <path d="M{diamond_cx} {diamond_cy - diamond_r} L{diamond_cx + diamond_r} {diamond_cy} L{diamond_cx} {diamond_cy + diamond_r} L{diamond_cx - diamond_r} {diamond_cy} Z"
      fill="{accent}" opacity="0.28"/>
    <path d="M{triangle_x1} {triangle_y1} L{triangle_x2} {triangle_y2} L{triangle_x3} {triangle_y3} Z"
      fill="{shape_b}" opacity="0.34"/>
    <circle cx="{highlight_x}" cy="{highlight_y}" r="{highlight_r}" fill="{accent}" opacity="0.12"/>
  </g>
</svg>
""".strip()
    encoded_svg = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded_svg}"


def ensure_project_avatar_data_url(value: Any) -> str:
    raw = value.strip() if isinstance(value, str) else ""
    return raw or generate_project_avatar_data_url()


def persist_project_avatar_if_empty(project: Project) -> str:
    """Return stored avatar URL; if empty, assign a generated SVG and persist (legacy default projects)."""
    raw = project.avatar_data_url.strip() if isinstance(project.avatar_data_url, str) else ""
    if raw:
        return raw
    next_url = ensure_project_avatar_data_url("")
    Project.objects.filter(pk=project.pk).update(avatar_data_url=next_url)
    project.avatar_data_url = next_url
    return next_url


def ensure_default_owner_project(user) -> Tuple[Project, bool]:
    project, created = Project.objects.get_or_create(
        owner=user,
        is_default=True,
        defaults={
            "name": DEFAULT_OWNER_PROJECT_NAME,
            "avatar_data_url": generate_project_avatar_data_url(),
        },
    )
    return project, created


def get_active_partner_by_ref_code(ref_code: str) -> Optional[PartnerProfile]:
    if not ref_code or not str(ref_code).strip():
        return None
    code = str(ref_code).strip()
    return (
        PartnerProfile.objects.filter(
            ref_code__iexact=code,
            status=PartnerProfile.Status.ACTIVE,
        )
        .select_related("user")
        .first()
    )


def ensure_partner_profile(user) -> Tuple[PartnerProfile, bool]:
    """Create partner profile for user if missing; idempotent. Returns (profile, created)."""
    profile, created = PartnerProfile.objects.get_or_create(
        user=user,
        defaults={
            "ref_code": generate_ref_code(),
            "commission_percent": _default_commission_percent(),
            "status": PartnerProfile.Status.ACTIVE,
        },
    )
    return profile, created


def capture_referral_attribution(
    *,
    request,
    ref_code: str,
    landing_url: str = "",
    utm_source: str = "",
    utm_medium: str = "",
    utm_campaign: str = "",
) -> Tuple[bool, str]:
    """
    Validate ref, log ReferralVisit, append CustomerAttribution (last-click).
    Ensures Django session exists for anonymous continuity.
    Returns (success, message).
    """
    partner = get_active_partner_by_ref_code(ref_code)
    if not partner:
        return False, "invalid_or_inactive_ref"

    if not request.session.session_key:
        request.session.create()

    session_key = request.session.session_key or ""
    now = timezone.now()
    expires = now + _ttl_delta()

    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        ip = (xff.split(",")[0]).strip()
    else:
        ip = request.META.get("REMOTE_ADDR") or None

    user = request.user if request.user.is_authenticated else None

    with transaction.atomic():
        visit = ReferralVisit.objects.create(
            partner=partner,
            ref_code=partner.ref_code,
            session_key=session_key,
            landing_url=landing_url[:2000] if landing_url else "",
            utm_source=utm_source[:255],
            utm_medium=utm_medium[:255],
            utm_campaign=utm_campaign[:255],
            ip_address=ip,
            user_agent=(request.META.get("HTTP_USER_AGENT") or "")[:2000],
        )
        CustomerAttribution.objects.create(
            partner=partner,
            ref_code=partner.ref_code,
            customer_user=user,
            session_key=session_key,
            source_visit=visit,
            attributed_at=now,
            expires_at=expires,
        )

    return True, "ok"


def referral_capture_origin_allowed(request) -> bool:
    """
    CSRF is disabled for this POST; require browser Origin (when sent) to match CORS allowlist.
    Missing Origin is allowed (same-site navigations, tests, non-browser clients).
    """
    origin = (request.headers.get("Origin") or "").strip()
    if not origin:
        return True
    allowed = list(getattr(settings, "CORS_ALLOWED_ORIGINS", ()) or ())
    fe = (getattr(settings, "FRONTEND_URL", "") or "").strip().rstrip("/")
    if fe:
        allowed = list(allowed) + [fe]
    origin_cmp = origin.rstrip("/")
    for entry in allowed:
        e = (entry or "").strip().rstrip("/")
        if e and origin_cmp == e:
            return True
    return False


def link_session_attributions_to_user(
    *,
    session_key: Optional[str],
    user,
    at_time=None,
) -> int:
    """
    Bind anonymous session-scoped attributions to the authenticated user after
    login/register/JWT obtain so last-click resolution survives session key rotation.

    Only updates rows that are still valid, session-matched, and not yet tied to a user.
    Does not change partner/ref/timestamps — deterministic last-click order unchanged.
    """
    if not session_key:
        return 0
    if user is None or not getattr(user, "is_authenticated", False):
        return 0
    at_time = at_time or timezone.now()
    return CustomerAttribution.objects.filter(
        session_key=session_key,
        customer_user_id__isnull=True,
        expires_at__gt=at_time,
    ).update(customer_user=user)


def create_project_for_site(site: Site) -> Project:
    if site.project_id:
        if getattr(site, "project", None) is not None:
            return site.project
        return Project.objects.get(pk=site.project_id)

    project_meta = owner_project_metadata_from_site(site)
    project_meta["avatar_data_url"] = ensure_project_avatar_data_url(
        project_meta.get("avatar_data_url")
    )
    project = Project.objects.create(owner=site.owner, **project_meta)
    Site.objects.filter(pk=site.pk).update(project=project)
    site.project = project
    return project


def get_site_by_public_id(public_id) -> Optional[Site]:
    if not public_id:
        return None
    return Site.objects.select_related("project").filter(public_id=public_id).first()


def site_allows_cta_signup_membership(site: Site) -> bool:
    """
    Visitor signup with ``site_public_id`` may create SiteMembership only in these states.

    Semantics: ``verified`` means embed readiness was satisfied and the owner ran verify
    (config/ops milestone), not a third-party browser or Tilda attestation.
    """
    return site.status in (Site.Status.VERIFIED, Site.Status.ACTIVE)


def resolve_valid_attribution(
    *,
    session_key: Optional[str] = None,
    user=None,
    at_time=None,
) -> Optional[CustomerAttribution]:
    """Latest attribution that is still valid (last-click among non-expired)."""
    at_time = at_time or timezone.now()
    q = CustomerAttribution.objects.filter(expires_at__gt=at_time).select_related(
        "partner", "partner__user"
    )

    candidates = q.none()
    if session_key:
        candidates = candidates | q.filter(session_key=session_key)
    if user is not None and getattr(user, "is_authenticated", False):
        candidates = candidates | q.filter(customer_user_id=user.pk)

    # Tie-break on pk so ordering is stable when attributed_at matches.
    return candidates.order_by("-attributed_at", "-pk").first()


def _cta_membership_partner_ref_snapshot(
    *,
    user,
    session_key: Optional[str],
    ref_code: str,
) -> Tuple[Optional[PartnerProfile], str]:
    """Partner + canonical ref_code for SiteMembership snapshot (signup / CTA join)."""
    partner = None
    ref_snap = ""
    if ref_code:
        explicit_partner = get_active_partner_by_ref_code(ref_code)
        if explicit_partner and not would_be_self_referral(
            explicit_partner,
            customer_user=user,
            customer_email=getattr(user, "email", "") or "",
        ):
            partner = explicit_partner
            ref_snap = explicit_partner.ref_code

    if partner is None:
        attr = resolve_valid_attribution(session_key=session_key, user=user)
        if attr and not would_be_self_referral(
            attr.partner,
            customer_user=user,
            customer_email=getattr(user, "email", "") or "",
        ):
            partner = attr.partner
            ref_snap = attr.ref_code

    return partner, ref_snap


def create_site_membership_from_signup(
    *,
    site_public_id,
    user,
    session_key: Optional[str] = None,
    ref_code: str = "",
) -> Tuple[SiteMembership, bool]:
    if user is None or not getattr(user, "is_authenticated", False):
        raise ValueError("authenticated_user_required")

    site = get_site_by_public_id(site_public_id)
    if site is None:
        raise ValueError("invalid_site_public_id")
    if not site_allows_cta_signup_membership(site):
        raise ValueError("site_not_joinable")

    partner, ref_snap = _cta_membership_partner_ref_snapshot(
        user=user, session_key=session_key, ref_code=ref_code
    )

    membership, created = SiteMembership.objects.update_or_create(
        site=site,
        user=user,
        defaults={
            "partner": partner,
            "ref_code": ref_snap,
            "joined_via": SiteMembership.JoinedVia.CTA_SIGNUP,
        },
    )
    return membership, created


def join_site_membership_cta_logged_in(
    *,
    site_public_id,
    user,
    session_key: Optional[str] = None,
    ref_code: str = "",
) -> Tuple[SiteMembership, str]:
    """
    Idempotent CTA join for an already-authenticated user.

    Returns (membership, outcome) where outcome is ``joined`` or ``already_joined``.
    Does not overwrite partner/ref on an existing row (duplicate POSTs are no-ops).
    """
    if user is None or not getattr(user, "is_authenticated", False):
        raise ValueError("authenticated_user_required")

    site = get_site_by_public_id(site_public_id)
    if site is None:
        raise ValueError("invalid_site_public_id")
    if not site_allows_cta_signup_membership(site):
        raise ValueError("site_not_joinable")

    existing = (
        SiteMembership.objects.filter(site=site, user=user).select_related("site").first()
    )
    if existing is not None:
        return existing, "already_joined"

    partner, ref_snap = _cta_membership_partner_ref_snapshot(
        user=user, session_key=session_key, ref_code=ref_code
    )
    try:
        with transaction.atomic():
            membership = SiteMembership.objects.create(
                site=site,
                user=user,
                partner=partner,
                ref_code=ref_snap,
                joined_via=SiteMembership.JoinedVia.CTA_SIGNUP,
            )
    except IntegrityError:
        existing2 = SiteMembership.objects.filter(site=site, user=user).first()
        if existing2 is not None:
            return existing2, "already_joined"
        raise
    return membership, "joined"


def would_be_self_referral(
    partner: PartnerProfile,
    *,
    customer_user=None,
    customer_email: str = "",
) -> bool:
    """True if the buyer identity matches the partner (no commission / no attach)."""
    if customer_user is not None and getattr(customer_user, "is_authenticated", False):
        if customer_user.pk == partner.user_id:
            return True
    email = (customer_email or "").strip().lower()
    if email and email == (partner.user.email or "").strip().lower():
        return True
    return False


def attach_attribution_to_order(
    order: Order,
    *,
    session_key: Optional[str] = None,
    customer_user=None,
    ref_code_from_payload: Optional[str] = None,
) -> None:
    """
    Snapshot partner + ref_code on the order.
    Precedence: explicit ref in payload (if valid active partner), else latest valid attribution.
    Never attaches when attribution is expired (resolver enforces) or buyer is the partner.
    """
    partner = None
    ref_snap = ""

    email_for_self = (order.customer_email or "").strip()
    user_for_self = customer_user
    if user_for_self is None and order.customer_user_id:
        user_for_self = order.customer_user

    if ref_code_from_payload:
        p = get_active_partner_by_ref_code(ref_code_from_payload)
        if p and not would_be_self_referral(
            p, customer_user=user_for_self, customer_email=email_for_self
        ):
            partner = p
            ref_snap = p.ref_code

    if partner is None:
        attr = resolve_valid_attribution(session_key=session_key, user=customer_user)
        if attr and not would_be_self_referral(
            attr.partner, customer_user=user_for_self, customer_email=email_for_self
        ):
            partner = attr.partner
            ref_snap = attr.ref_code

    Order.objects.filter(pk=order.pk).update(partner_id=partner.pk if partner else None, ref_code=ref_snap)


def _is_self_referral(order: Order, partner: PartnerProfile) -> bool:
    user = order.customer_user if order.customer_user_id else None
    return would_be_self_referral(
        partner, customer_user=user, customer_email=order.customer_email or ""
    )


def create_commission_for_paid_order(order: Order) -> Optional[Commission]:
    """
    Idempotent: at most one Commission per order (enforced by OneToOne).
    Only when order is PAID, has partner, amount > 0, not self-referral.
    """
    if order.status != Order.Status.PAID:
        return None
    if not order.partner_id:
        return None
    if order.amount <= 0:
        return None

    partner = order.partner
    if partner.status != PartnerProfile.Status.ACTIVE:
        return None

    if _is_self_referral(order, partner):
        return None

    commission: Optional[Commission] = None
    with transaction.atomic():
        locked = (
            Order.objects.select_for_update()
            .select_related("partner", "partner__user", "customer_user")
            .get(pk=order.pk)
        )
        if locked.status != Order.Status.PAID:
            return None
        if not locked.partner_id:
            return None

        existing = Commission.objects.filter(order_id=locked.pk).first()
        if existing:
            return existing

        pct = locked.partner.commission_percent
        base = locked.amount
        amount = (base * pct / Decimal("100")).quantize(Decimal("0.01"))

        try:
            commission = Commission.objects.create(
                partner=locked.partner,
                order=locked,
                base_amount=base,
                commission_percent=pct,
                commission_amount=amount,
                status=Commission.Status.PENDING,
            )
        except IntegrityError:
            return Commission.objects.filter(order_id=locked.pk).first()

        PartnerProfile.objects.filter(pk=locked.partner_id).update(
            balance_available=F("balance_available") + amount,
            balance_total=F("balance_total") + amount,
        )

    return commission


def _coerce_webhook_scalar(v: Any) -> str:
    """Reduce nested DRF / form values to a string for fingerprinting and field extraction."""
    if v is None:
        return ""
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float, Decimal)):
        return str(v)
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        if not v:
            return ""
        return _coerce_webhook_scalar(v[0])
    if isinstance(v, dict):
        return ""
    return str(v)


def flatten_request_data(data: Any) -> dict:
    """Normalize DRF request.data (dict or QueryDict) to a plain dict of string scalars."""
    if hasattr(data, "dict"):
        raw = data.dict()
    elif isinstance(data, dict):
        raw = data
    else:
        return {}
    out: dict = {}
    for k, v in raw.items():
        out[str(k)] = _coerce_webhook_scalar(v)
    return out


def payload_fingerprint(data: Mapping[str, Any]) -> str:
    canonical = json.dumps(data, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _first_str(data: Mapping[str, Any], keys: Tuple[str, ...]) -> str:
    for k in keys:
        for variant in (k, k.lower(), k.upper()):
            if variant not in data:
                continue
            val = data[variant]
            if val in (None, ""):
                continue
            if isinstance(val, (list, dict)):
                continue
            s = str(val).strip()
            if s:
                return s
    return ""


def _first_decimal(data: Mapping[str, Any], keys: Tuple[str, ...]) -> Decimal:
    raw = _first_str(data, keys)
    if not raw:
        return Decimal("0.00")
    try:
        normalized = raw.replace(",", ".").replace(" ", "")
        return Decimal(normalized).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("0.00")


# Status-like field: clear unpaid tokens take precedence over generic "payment" flags.
_TILDA_UNPAID_STATUS = frozenset(
    {
        "pending",
        "unpaid",
        "awaiting",
        "awaiting_payment",
        "awaitingpayment",
        "not_paid",
        "notpaid",
        "failed",
        "failure",
        "cancelled",
        "canceled",
        "void",
        "refunded",
        "rejected",
        "declined",
        "denied",
        "error",
        "incomplete",
        "abandoned",
        "chargeback",
        "disputed",
        "authorized",
        "uncaptured",
        "requires_capture",
    }
)
_TILDA_PAID_STATUS = frozenset(
    {
        "paid",
        "success",
        "successful",
        "completed",
        "complete",
        "1",
        "y",
        "yes",
        "true",
        "ok",
    }
)
_TILDA_PAID_LOOSE_FLAG = frozenset(
    {
        "1",
        "y",
        "yes",
        "true",
        "paid",
        "success",
        "ok",
        "completed",
    }
)


def _normalize_token(s: str) -> str:
    return "".join(ch for ch in s.lower().strip() if ch not in " _-")


def _interpret_tilda_is_paid(*, status_text: str, loose_flag_text: str) -> bool:
    raw = (status_text or "").strip()
    st_norm = _normalize_token(raw)
    if st_norm:
        if st_norm in _TILDA_UNPAID_STATUS or any(
            st_norm.startswith(u) for u in ("pending", "awaiting", "cancel", "fail")
        ):
            return False
        if raw.lower() in _TILDA_PAID_STATUS or st_norm in _TILDA_PAID_STATUS:
            return True
    flag = (loose_flag_text or "").strip().lower()
    if flag in _TILDA_PAID_LOOSE_FLAG:
        return True
    return False


def _tilda_extracted_blocks_mvp_assumed_paid(extracted: Mapping[str, Any]) -> bool:
    """
    True when primary payment-status text explicitly indicates not paid.
    Used so MVP "assume paid from amount" never overrides e.g. paymentstatus=pending.
    """
    paid_raw = str(extracted.get("payment_status_raw") or "").strip()
    if not paid_raw:
        return False
    st_norm = _normalize_token(paid_raw)
    if not st_norm:
        return False
    if st_norm in _TILDA_UNPAID_STATUS or any(
        st_norm.startswith(u) for u in ("pending", "awaiting", "cancel", "fail")
    ):
        return True
    return False


def effective_tilda_is_paid_for_upsert(extracted: Mapping[str, Any]) -> bool:
    """
    Paid flag for persistence and commission: real Tilda interpretation first, then optional
    MVP fallback (amount > 0, no explicit unpaid primary status). Tilda-only entrypoint.
    """
    if bool(extracted.get("is_paid")):
        return True
    if not getattr(settings, "REFERRAL_MVP_ASSUME_PAID_IF_AMOUNT_PRESENT", False):
        return False
    amt = extracted.get("amount")
    if amt is None or amt <= 0:
        return False
    if _tilda_extracted_blocks_mvp_assumed_paid(extracted):
        return False
    return True


def _primary_payment_status_unrecognized(raw_status: str) -> bool:
    """
    True when paymentstatus-like text is non-empty but not mapped to a known
    paid/unpaid token (mirrors the primary branch of _interpret_tilda_is_paid).
    """
    raw = (raw_status or "").strip()
    if not raw:
        return False
    st_norm = _normalize_token(raw)
    if not st_norm:
        return False
    if st_norm in _TILDA_UNPAID_STATUS or any(
        st_norm.startswith(u) for u in ("pending", "awaiting", "cancel", "fail")
    ):
        return False
    if raw.lower() in _TILDA_PAID_STATUS or st_norm in _TILDA_PAID_STATUS:
        return False
    return True


def _loose_payment_flag_unrecognized(flag_text: str) -> bool:
    f = (flag_text or "").strip()
    if not f:
        return False
    return f.lower() not in _TILDA_PAID_LOOSE_FLAG


def _log_tilda_webhook_ingestion(
    *,
    flat: dict,
    extracted: Mapping[str, Any],
    dedupe_key: str,
) -> None:
    """
    Ingestion diagnostics without logging raw body, emails, amounts, or ref codes.

    - WARNING: no external id (unstable dedupe on fingerprint).
    - WARNING: non-empty payment status text that did not match known paid/unpaid
      patterns and the order is still treated as unpaid (see _interpret_tilda_is_paid).
    - INFO (only if ORDER_WEBHOOK_DEBUG_LOGGING): missing payment fields / odd loose flag.
    """
    ext = (extracted.get("external_id") or "").strip()
    is_paid = bool(extracted.get("is_paid"))
    paid_raw = str(extracted.get("payment_status_raw") or "")
    payment_flag = str(extracted.get("payment_flag_raw") or "")
    keys_preview = sorted(flat.keys())
    if len(keys_preview) > 48:
        keys_preview = keys_preview[:48] + ["…"]
    dedupe_prefix = (dedupe_key or "")[:48]

    if not ext:
        logger.warning(
            "order_webhook: missing_external_id_for_dedupe dedupe_key_prefix=%r payload_keys=%s",
            dedupe_prefix,
            keys_preview,
        )

    if not is_paid and _primary_payment_status_unrecognized(paid_raw):
        logger.warning(
            "order_webhook: unrecognized_payment_status status_preview=%r "
            "dedupe_key_prefix=%r is_paid=%s",
            (paid_raw or "")[:80],
            dedupe_prefix,
            is_paid,
        )

    dbg = bool(getattr(settings, "ORDER_WEBHOOK_DEBUG_LOGGING", False))
    if dbg:
        has_primary = bool(
            _first_str(
                flat,
                (
                    "paymentstatus",
                    "PaymentStatus",
                    "paid",
                    "Paid",
                    "is_paid",
                    "st",
                ),
            )
        )
        has_loose = bool(_first_str(flat, ("payment", "Payment", "payed", "Payed")))
        if not has_primary and not has_loose:
            logger.info(
                "order_webhook: no_payment_status_fields payload_keys=%s dedupe_key_prefix=%r",
                keys_preview,
                dedupe_prefix,
            )
        if (
            not is_paid
            and not (paid_raw or "").strip()
            and _loose_payment_flag_unrecognized(payment_flag)
        ):
            logger.info(
                "order_webhook: unrecognized_payment_flag flag_preview=%r dedupe_key_prefix=%r",
                (payment_flag or "")[:40],
                dedupe_prefix,
            )


def extract_tilda_order_fields(data: Mapping[str, Any]) -> dict:
    """
    Map a flat Tilda (or similar) POST webhook into normalized order fields.

    Tilda sends ``application/x-www-form-urlencoded`` or JSON as flat key/value pairs.
    Use a **hidden field** on the form (or payment success redirect) so the same keys
    reach this endpoint as in the storefront URL (e.g. hidden input ``name="ref"``
    with default from URL ``ref``), in addition to standard payment fields.

    **Required**
        None for HTTP 200 processing: an empty payload still raises in
        ``upsert_order_from_tilda_payload``. Any non-empty flat dict is accepted.

    **Strongly recommended (dedupe / stable upserts)**
        At least one external transaction or order id. ``_first_str`` walks this tuple
        in order; any case variant of each name is accepted (e.g. ``tranid`` / ``TranId``):

        ``tranid``, ``TranId``, ``transaction_id``, ``TransactionId``, ``transact``,
        ``orderid``, ``OrderId``, ``invoiceid``, ``InvoiceId``, ``paymentid``, ``PaymentId``.

        Dedupe key: ``tilda:<external_id>`` when any of the above is present; otherwise
        ``fp:<sha256(canonical_json(flat))>`` (same keys/values in any key order yield the
        same fingerprint; changing any value or key produces a new order row).

    **Optional**
        - **Buyer email** — ``email``, ``Email``, ``E-mail``, ``mail``, ``EMail``,
          ``form_email``, ``Email_`` (attribution fallback when matching a user).
        - **Amount** — ``sum``, ``Sum``, ``amount``, ``Amount``, ``price``, ``Price``,
          ``subtotal``, ``Subtotal`` (decimal; ``0.00`` if missing/unparseable).
        - **Currency** — ``currency``, ``Currency`` (read in upsert from ``flat``, max 8 chars).
        - **Referral / partner code** — ``ref``, ``Ref``, ``REF``, ``partner_ref``,
          ``referral``, ``ReferralCode`` (must mirror capture cookie / session ref).

    **Paid vs pending**
        Primary: first non-empty among
        ``paymentstatus``, ``PaymentStatus``, ``paid``, ``Paid``, ``is_paid``, ``st``.
        Unpaid tokens win over a loose ``payment`` / ``Payed`` flag (e.g. pending + payment=1
        stays pending). See ``_interpret_tilda_is_paid`` and ``_TILDA_*`` frozensets.
        If ``settings.REFERRAL_MVP_ASSUME_PAID_IF_AMOUNT_PRESENT`` is true, ``amount > 0`` can
        mark the order paid for commission when the primary status is empty or non-blocking;
        explicit unpaid primary status (e.g. ``pending``) still wins.

    **Return dict**
        Includes ``payment_status_raw`` and ``payment_flag_raw`` for logging only.
    """
    external_id = _first_str(
        data,
        (
            "tranid",
            "TranId",
            "transaction_id",
            "TransactionId",
            "transact",
            "orderid",
            "OrderId",
            "invoiceid",
            "InvoiceId",
            "paymentid",
            "PaymentId",
        ),
    )
    customer_email = _first_str(
        data,
        ("email", "Email", "E-mail", "mail", "EMail", "form_email", "Email_"),
    )
    ref_code = _first_str(
        data,
        ("ref", "Ref", "REF", "partner_ref", "referral", "ReferralCode"),
    )
    amount = _first_decimal(
        data,
        (
            "sum",
            "Sum",
            "amount",
            "Amount",
            "price",
            "Price",
            "subtotal",
            "Subtotal",
        ),
    )

    paid_raw = _first_str(
        data,
        (
            "paymentstatus",
            "PaymentStatus",
            "paid",
            "Paid",
            "is_paid",
            "st",
        ),
    )
    payment_flag = _first_str(data, ("payment", "Payment", "payed", "Payed"))

    # Conservative: explicit "not paid" from status-like fields wins over loose flags
    # (avoids e.g. hidden form field payment=1 while paymentstatus=pending).
    is_paid = _interpret_tilda_is_paid(status_text=paid_raw, loose_flag_text=payment_flag)

    return {
        "external_id": external_id,
        "customer_email": customer_email,
        "ref_code": ref_code,
        "amount": amount,
        "is_paid": is_paid,
        "payment_status_raw": paid_raw,
        "payment_flag_raw": payment_flag,
    }


def _resolve_customer_user_from_email(email: str):
    if not email:
        return None
    User = apps.get_model(settings.AUTH_USER_MODEL)
    return User.objects.filter(email__iexact=email.strip()).first()


def build_order_dedupe_key(*, source: str, external_id: str, fingerprint: str) -> str:
    ext = (external_id or "").strip()
    if ext:
        return f"{source}:{ext}"
    return f"fp:{fingerprint}"


def _apply_order_upsert_side_effects(
    order: Order,
    *,
    created: bool,
    flat: dict,
    fp: str,
    email: str,
    user,
    extracted: Mapping[str, Any],
    is_paid: bool,
    session_key: Optional[str],
) -> None:
    """Runs inside the same transaction.atomic() as the row lock."""
    if not created:
        order.raw_payload = flat
        order.payload_fingerprint = fp
        if email:
            order.customer_email = email[:254]
        if user and not order.customer_user_id:
            order.customer_user = user
        if extracted["amount"] > 0:
            order.amount = extracted["amount"]
        if is_paid:
            order.status = Order.Status.PAID
            if not order.paid_at:
                order.paid_at = timezone.now()
        elif order.status != Order.Status.PAID:
            order.status = Order.Status.PENDING
        order.save()

    if not order.partner_id:
        attach_attribution_to_order(
            order,
            session_key=session_key,
            customer_user=user or order.customer_user,
            ref_code_from_payload=extracted["ref_code"] or None,
        )
        order.refresh_from_db(fields=["partner_id", "ref_code"])

    if order.status == Order.Status.PAID:
        create_commission_for_paid_order(order)


def upsert_order_from_tilda_payload(
    data: Mapping[str, Any],
    *,
    session_key: Optional[str] = None,
    customer_user=None,
) -> Tuple[Order, bool]:
    """
    Persist or update an order from a Tilda-style webhook body.
    Returns (order, created).

    Field contract: see ``extract_tilda_order_fields`` docstring. Ingestion warnings
    are emitted on ``referrals.services`` logger (missing external id, unrecognized
    payment status); never logs full payload, email, or ref values.
    """
    flat = flatten_request_data(data)
    if not flat:
        raise ValueError(
            "Webhook payload is empty or could not be parsed as flat key/value fields."
        )

    fp = payload_fingerprint(flat)
    extracted = extract_tilda_order_fields(flat)
    ext = extracted["external_id"]
    dedupe_key = build_order_dedupe_key(
        source=Order.Source.TILDA,
        external_id=ext,
        fingerprint=fp,
    )
    _log_tilda_webhook_ingestion(flat=flat, extracted=extracted, dedupe_key=dedupe_key)

    email = extracted["customer_email"]
    user = customer_user
    if user is None and email:
        user = _resolve_customer_user_from_email(email)

    is_paid = effective_tilda_is_paid_for_upsert(extracted)
    status = Order.Status.PAID if is_paid else Order.Status.PENDING
    paid_at = timezone.now() if is_paid else None

    defaults = {
        "source": Order.Source.TILDA,
        "external_id": ext[:512],
        "payload_fingerprint": fp,
        "customer_email": email[:254] if email else "",
        "customer_user": user,
        "amount": extracted["amount"],
        "currency": _first_str(flat, ("currency", "Currency"))[:8],
        "status": status,
        "paid_at": paid_at,
        "raw_payload": flat,
    }

    created = False
    try:
        with transaction.atomic():
            order, created = Order.objects.select_for_update().get_or_create(
                dedupe_key=dedupe_key,
                defaults=defaults,
            )
            _apply_order_upsert_side_effects(
                order,
                created=created,
                flat=flat,
                fp=fp,
                email=email,
                user=user,
                extracted=extracted,
                is_paid=is_paid,
                session_key=session_key,
            )
    except IntegrityError:
        # Rare race on dedupe_key unique insert; other worker committed first.
        with transaction.atomic():
            order = Order.objects.select_for_update().get(dedupe_key=dedupe_key)
            created = False
            _apply_order_upsert_side_effects(
                order,
                created=created,
                flat=flat,
                fp=fp,
                email=email,
                user=user,
                extracted=extracted,
                is_paid=is_paid,
                session_key=session_key,
            )

    order.refresh_from_db()
    return order, created


def partner_dashboard_payload(partner: PartnerProfile, *, app_public_base_url: str) -> dict:
    """
    Aggregate partner dashboard fields for API responses.
    `app_public_base_url` should be the SPA origin without trailing slash, e.g. https://app.example.com

    `recent_leads` is intentionally minimal for partners (no raw name/phone/email/URL/query).
    """
    base = (app_public_base_url or "").rstrip("/")
    referral_link = f"{base}/?ref={partner.ref_code}" if base else f"/?ref={partner.ref_code}"

    visit_count = ReferralVisit.objects.filter(partner=partner).count()
    order_qs = Order.objects.filter(partner=partner)
    attributed_orders = order_qs.count()
    paid_orders = order_qs.filter(status=Order.Status.PAID).count()
    commissions_agg = Commission.objects.filter(partner=partner).aggregate(
        total=Sum("commission_amount")
    )
    commissions_total = commissions_agg["total"] or Decimal("0.00")

    history = (
        Commission.objects.filter(partner=partner)
        .select_related("order")
        .order_by("-created_at")[:50]
    )
    commission_rows = [
        {
            "id": c.id,
            "order_id": c.order_id,
            "base_amount": str(c.base_amount),
            "commission_percent": str(c.commission_percent),
            "commission_amount": str(c.commission_amount),
            "status": c.status,
            "created_at": c.created_at.isoformat(),
        }
        for c in history
    ]

    lead_qs = ReferralLeadEvent.objects.filter(partner=partner)
    total_leads_count = lead_qs.count()
    recent_lead_events = lead_qs.order_by("-created_at")[:50]
    recent_leads = [
        {
            "created_at": ev.created_at.isoformat(),
            "amount": str(ev.amount) if ev.amount is not None else None,
            "currency": ev.currency,
            "customer_email_masked": mask_email_for_partner_dashboard(ev.customer_email),
            "page_path": page_path_for_partner_dashboard(ev.page_url),
        }
        for ev in recent_lead_events
    ]

    return {
        "ref_code": partner.ref_code,
        "referral_link": referral_link,
        "commission_percent": str(partner.commission_percent),
        "status": partner.status,
        "balance_available": str(partner.balance_available),
        "balance_total": str(partner.balance_total),
        "visit_count": visit_count,
        "attributed_orders_count": attributed_orders,
        "paid_orders_count": paid_orders,
        "commissions_total": str(commissions_total),
        "commission_history": commission_rows,
        "total_leads_count": total_leads_count,
        "recent_leads": recent_leads,
    }


# --- Public widget / multi-site integration (v1) ---


def generate_publishable_key() -> str:
    """Return a unique publishable_key for Site (browser-exposed site credential)."""
    for _ in range(80):
        key = secrets.token_urlsafe(32)
        if not Site.objects.filter(publishable_key=key).exists():
            return key
    raise RuntimeError("Could not allocate a unique publishable_key")


def request_browser_origin(request) -> str:
    """Best-effort page origin for public embeds (Origin header, else Referer host)."""
    origin = (request.headers.get("Origin") or "").strip()
    if origin:
        return origin.rstrip("/")
    referer = (request.headers.get("Referer") or "").strip()
    if not referer:
        return ""
    try:
        p = urlparse(referer)
        if p.scheme and p.netloc:
            return f"{p.scheme}://{p.netloc}".rstrip("/")
    except Exception:
        return ""
    return ""


def site_allowed_origins_list(site: Site) -> list[str]:
    raw = site.allowed_origins
    if not isinstance(raw, list):
        return []
    return [str(x).strip().rstrip("/") for x in raw if str(x).strip()]


def idna_hostname_to_unicode(host: str) -> str:
    """Decode punycode (xn--) labels for human-readable domain display (best-effort)."""
    if not host or not isinstance(host, str):
        return ""
    host = host.strip().lower()
    if not host:
        return ""
    labels: list[str] = []
    for label in host.split("."):
        if not label:
            continue
        if label.startswith("xn--"):
            try:
                labels.append(label.encode("ascii").decode("idna"))
            except (UnicodeError, UnicodeDecodeError):
                labels.append(label)
        else:
            labels.append(label)
    return ".".join(labels)


def owner_site_list_origin_display(site: Site) -> tuple[str, str]:
    """
    Pick an origin for owner list cards (sidebar, overview): prefer the longest
    parseable hostname among allowed_origins instead of blindly using [0].

    Returns (primary_origin, primary_origin_label) where label is a Unicode hostname
    suitable for UI (IDNA decoded); primary_origin is the chosen raw entry from the list.
    """
    origins = site_allowed_origins_list(site)
    if not origins:
        return "", ""

    best_raw = ""
    best_score: tuple[int, int] = (-1, -1)

    for raw in origins:
        entry = (raw or "").strip()
        if not entry:
            continue
        try:
            parsed = urlparse(entry if "://" in entry else f"https://{entry}")
        except Exception:
            parsed = None
        host = (parsed.hostname or "").strip().lower() if parsed is not None else ""
        if not host:
            continue
        score = (len(host), len(entry))
        if score > best_score:
            best_score = score
            best_raw = entry

    if not best_raw:
        for raw in origins:
            e = (raw or "").strip()
            if e:
                return e, ""
        return "", ""

    try:
        parsed = urlparse(best_raw if "://" in best_raw else f"https://{best_raw}")
    except Exception:
        return best_raw, ""
    host = (parsed.hostname or "").strip()
    if not host:
        return best_raw, ""
    return best_raw, idna_hostname_to_unicode(host)


def site_origin_is_allowed(site: Site, origin_cmp: str) -> bool:
    if not origin_cmp:
        return False
    origin_cmp = origin_cmp.strip().rstrip("/")
    for entry in site_allowed_origins_list(site):
        e = (entry or "").strip().rstrip("/")
        if e and origin_cmp == e:
            return True
    return False


def extract_publishable_key_from_request(request) -> str:
    header = (request.headers.get("X-Publishable-Key") or "").strip()
    if header:
        return header
    auth = (request.headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


def validate_site_for_public_widget(
    *,
    site: Optional[Site],
    publishable_key: str,
    origin: str,
    require_publishable_key: bool = True,
) -> Optional[Tuple[int, dict, str]]:
    """
    Shared checks for public widget endpoints.

    Returns None if OK, or (http_status, body_dict, internal_reason) on failure.
    ``internal_reason`` is for logs/support; the public body may mask cases (e.g. disabled widget).
    """
    from .public_ingest_contract import (
        CODE_ALLOWED_ORIGINS_REQUIRED,
        CODE_INVALID_KEY,
        CODE_INVALID_ORIGIN,
        CODE_ORIGIN_REQUIRED,
        CODE_PUBLISHABLE_KEY_REQUIRED,
        CODE_SITE_NOT_FOUND,
        INTERNAL_WIDGET_DISABLED,
        public_ingest_error_body,
    )

    if site is None:
        return (
            404,
            public_ingest_error_body(
                code=CODE_SITE_NOT_FOUND,
                message="Site not found.",
            ),
            "site_not_found",
        )
    if not site.widget_enabled:
        # Public response matches unknown site; internal_reason distinguishes for logs.
        return (
            404,
            public_ingest_error_body(
                code=CODE_SITE_NOT_FOUND,
                message="Site not found.",
            ),
            INTERNAL_WIDGET_DISABLED,
        )
    allowed = site_allowed_origins_list(site)
    if not allowed:
        return (
            403,
            public_ingest_error_body(
                code=CODE_ALLOWED_ORIGINS_REQUIRED,
                message="Allowed origins are not configured for this site.",
            ),
            CODE_ALLOWED_ORIGINS_REQUIRED,
        )
    if not origin:
        if settings.DEBUG:
            return None
        return (
            403,
            public_ingest_error_body(
                code=CODE_ORIGIN_REQUIRED,
                message="Origin header is required.",
            ),
            CODE_ORIGIN_REQUIRED,
        )
    if not site_origin_is_allowed(site, origin):
        return (
            403,
            public_ingest_error_body(
                code=CODE_INVALID_ORIGIN,
                message="Origin is not allowed for this site.",
            ),
            CODE_INVALID_ORIGIN,
        )
    if require_publishable_key:
        if not publishable_key:
            return (
                401,
                public_ingest_error_body(
                    code=CODE_PUBLISHABLE_KEY_REQUIRED,
                    message="Publishable key is required.",
                ),
                CODE_PUBLISHABLE_KEY_REQUIRED,
            )
        if not _timing_safe_str_eq(site.publishable_key or "", publishable_key):
            return (
                403,
                public_ingest_error_body(
                    code=CODE_INVALID_KEY,
                    message="Invalid publishable key.",
                ),
                CODE_INVALID_KEY,
            )
    return None


def normalize_lead_event_payload(data: Any) -> dict[str, Any]:
    """
    Normalize heterogeneous client bodies into one internal dict for lead_submitted.
    """
    if not isinstance(data, dict):
        return {}

    def scalar(key: str, *alts: str, max_len: int = 5000) -> str:
        for k in (key,) + alts:
            v = data.get(k)
            if v is None:
                continue
            if isinstance(v, (list, dict)):
                continue
            out = str(v).strip()
            if out:
                return out[:max_len]
        return ""

    fields = data.get("fields")
    if not isinstance(fields, dict):
        fields = {}
    flat_fields = {
        str(k): str(v)[:2000]
        for k, v in fields.items()
        if not isinstance(v, (dict, list)) and v is not None
    }
    ev = str(data.get("event") or data.get("type") or "lead_submitted").strip() or "lead_submitted"
    customer_email = scalar("email", "Email", "customer_email", max_len=254)
    customer_phone = scalar("phone", "Phone", "tel", max_len=64)
    customer_name = scalar("name", "Name", "customer_name", max_len=255)
    if not customer_email and flat_fields:
        _lk = {
            str(k).lower().replace("-", "_"): str(v).strip()
            for k, v in flat_fields.items()
            if str(v).strip()
        }
        for key in (
            "email",
            "e_mail",
            "customer_email",
            "user_email",
            "contact_email",
        ):
            if key in _lk:
                customer_email = _lk[key][:254]
                break
    if not customer_phone and flat_fields:
        _lk = {
            str(k).lower().replace("-", "_"): str(v).strip()
            for k, v in flat_fields.items()
            if str(v).strip()
        }
        for key in ("phone", "tel", "mobile", "customer_phone", "telephone"):
            if key in _lk:
                customer_phone = _lk[key][:64]
                break
    if not customer_name and flat_fields:
        _lk = {
            str(k).lower().replace("-", "_"): str(v).strip()
            for k, v in flat_fields.items()
            if str(v).strip()
        }
        for key in ("name", "fullname", "full_name", "customer_name", "first_name"):
            if key in _lk:
                customer_name = _lk[key][:255]
                break
    amount_raw = scalar("amount", "lead_amount", max_len=32)
    currency = scalar("currency", max_len=8)
    product_name = scalar("product_name", "product", max_len=512)
    client_observed_outcome = scalar(
        "client_observed_outcome", "clientObservedOutcome", max_len=32
    )
    client_outcome_source = scalar("client_outcome_source", max_len=64)
    client_outcome_reason = scalar("client_outcome_reason", max_len=255)
    client_event_id = scalar("client_event_id", "clientEventId", max_len=64)
    return {
        "event": ev[:64],
        "ref_code": scalar("ref", "ref_code", "Ref", max_len=32),
        "customer_email": customer_email,
        "customer_phone": customer_phone,
        "customer_name": customer_name,
        "page_url": scalar("page_url", "landing_url", "url", max_len=2000),
        "form_id": scalar("form_id", "formId", "form", max_len=255),
        "amount": amount_raw,
        "currency": currency,
        "product_name": product_name,
        "fields": flat_fields,
        "client_observed_outcome": client_observed_outcome,
        "client_outcome_source": client_outcome_source,
        "client_outcome_reason": client_outcome_reason,
        "client_event_id": client_event_id,
    }


def _widget_lead_selector_keys(cfg: dict[str, Any]) -> dict[str, str]:
    """Expose Site.config_json lead keys at the top level for embed scripts."""
    out: dict[str, str] = {}
    for key in ("amount_selector", "currency", "product_name_selector"):
        raw = cfg.get(key)
        if isinstance(raw, str):
            s = raw.strip()
            if s:
                out[key] = s
    return out


def public_widget_runtime_config(cfg: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in cfg.items():
        if key in _PUBLIC_WIDGET_PRIVATE_CONFIG_KEYS:
            continue
        out[key] = value
    return out


def public_widget_config_dict(*, request, site: Site) -> dict[str, Any]:
    site_uuid = str(site.public_id)
    ingest = request.build_absolute_uri(f"/public/v1/events/leads?site={site_uuid}")
    cfg = site.config_json if isinstance(site.config_json, dict) else {}
    public_cfg = public_widget_runtime_config(cfg)
    selector_keys = _widget_lead_selector_keys(cfg)
    capture_cfg = site_capture_config_dict(site)

    def _truthy_config(key: str) -> bool:
        v = cfg.get(key)
        if v is True:
            return True
        s = str(v or "").strip().lower()
        return s in ("1", "true", "yes", "on")

    return {
        "version": 1,
        "site_public_id": site_uuid,
        "platform_preset": site.platform_preset,
        "lead_ingest_url": ingest,
        "storage_key": f"rs_ref_v1_{site_uuid}",
        "report_observed_outcome": _truthy_config("report_observed_outcome"),
        "capture_config": {
            "version": capture_cfg["version"],
            "enabled_optional_fields": list(capture_cfg["enabled_optional_fields"]),
        },
        "config": public_cfg,
        **selector_keys,
    }


def record_site_widget_seen(*, site: Site, origin: str) -> None:
    updates: dict[str, Any] = {"last_widget_seen_at": timezone.now()}
    if isinstance(origin, str) and origin.strip():
        updates["last_widget_seen_origin"] = origin.strip()[:255]
    Site.objects.filter(pk=site.pk).update(**updates)
    site.last_widget_seen_at = updates["last_widget_seen_at"]
    if "last_widget_seen_origin" in updates:
        site.last_widget_seen_origin = updates["last_widget_seen_origin"]


def build_site_connection_check(site: Site) -> dict[str, Any]:
    seen_at = getattr(site, "last_widget_seen_at", None)
    seen_origin = (getattr(site, "last_widget_seen_origin", "") or "").strip()
    return {
        "status": "found" if seen_at else "not_found",
        "last_seen_at": seen_at.isoformat() if seen_at else None,
        "last_seen_origin": seen_origin,
    }


def _parse_optional_lead_amount(raw: str) -> Decimal | None:
    if not (raw or "").strip():
        return None
    t = raw.strip().replace(",", ".")
    try:
        return Decimal(t)
    except InvalidOperation:
        return None


class LeadIngestOutcome(NamedTuple):
    """Result of idempotent public lead ingest (submit attempt, not a confirmed conversion)."""

    result: str  # "created" | "duplicate_suppressed"
    lead_event: ReferralLeadEvent


# Client-reported DOM/heuristic outcomes (optional; not business confirmation).
CLIENT_OBSERVED_OUTCOME_CODES = frozenset(
    {
        ReferralLeadEvent.ClientObservedOutcome.SUCCESS_OBSERVED,
        ReferralLeadEvent.ClientObservedOutcome.FAILURE_OBSERVED,
        ReferralLeadEvent.ClientObservedOutcome.NOT_OBSERVED,
    }
)


class LeadClientOutcomeIngestOutcome(NamedTuple):
    """Follow-up client outcome report on an existing ReferralLeadEvent row."""

    result: str  # "outcome_updated" | "outcome_unchanged"
    lead_event: ReferralLeadEvent


def validate_lead_submitted_optional_client_outcome(
    normalized: Mapping[str, Any],
) -> Optional[str]:
    """
    If ``client_observed_outcome`` is absent/empty, extra client outcome keys are ignored.
    If present, must be a known code.
    Returns None if OK, else a short machine reason for logging/tests.
    """
    raw = (normalized.get("client_observed_outcome") or "").strip()
    if not raw:
        return None
    if raw not in CLIENT_OBSERVED_OUTCOME_CODES:
        return "invalid_client_observed_outcome"
    return None


def normalize_lead_client_outcome_event_payload(data: Any) -> dict[str, Any]:
    """Normalize ``event: lead_client_outcome`` follow-up bodies."""
    if not isinstance(data, dict):
        return {"event": "lead_client_outcome", "lead_event_id": None}

    def scalar(key: str, *alts: str, max_len: int = 5000) -> str:
        for k in (key,) + alts:
            v = data.get(k)
            if v is None:
                continue
            if isinstance(v, (list, dict)):
                continue
            out = str(v).strip()
            if out:
                return out[:max_len]
        return ""

    raw_lead = data.get("lead_event_id")
    if raw_lead is None:
        raw_lead = data.get("leadEventId")
    lead_event_id: int | None = None
    if raw_lead is not None and raw_lead != "":
        try:
            lead_event_id = int(raw_lead)
        except (TypeError, ValueError):
            lead_event_id = None

    return {
        "event": "lead_client_outcome",
        "lead_event_id": lead_event_id,
        "client_observed_outcome": scalar("client_observed_outcome", max_len=32),
        "client_outcome_source": scalar("client_outcome_source", max_len=64),
        "client_outcome_reason": scalar("client_outcome_reason", max_len=255),
        "client_event_id": scalar("client_event_id", "clientEventId", max_len=64),
    }


def apply_client_observed_outcome_to_row(
    ev: ReferralLeadEvent,
    *,
    outcome_code: str,
    source: str,
    reason: str,
    client_event_id: str,
    now,
) -> str:
    """
    Idempotent in-process update of client-observed fields.

    Returns ``outcome_updated`` or ``outcome_unchanged`` (including duplicate delivery).
    Does not alter submission_stage (remains submit_attempt ingest semantics).
    """
    ceid = (client_event_id or "").strip()[:64]
    if ceid and (ev.client_outcome_event_id or "") == ceid:
        return "outcome_unchanged"

    current = (ev.client_observed_outcome or "").strip()
    if current == outcome_code and outcome_code:
        return "outcome_unchanged"

    src = (source or "").strip()[:64]
    rsn = (reason or "").strip()[:255]
    upd: dict[str, Any] = {
        "client_observed_outcome": outcome_code,
        "client_outcome_source": src,
        "client_outcome_reason": rsn,
        "client_outcome_observed_at": now,
    }
    if ceid:
        upd["client_outcome_event_id"] = ceid

    ReferralLeadEvent.objects.filter(pk=ev.pk).update(**upd)
    ev.client_observed_outcome = outcome_code
    ev.client_outcome_source = src
    ev.client_outcome_reason = rsn
    ev.client_outcome_observed_at = now
    if ceid:
        ev.client_outcome_event_id = ceid
    return "outcome_updated"


def _apply_optional_client_outcome_from_normalized(
    ev: ReferralLeadEvent,
    normalized: Mapping[str, Any],
    *,
    now,
) -> None:
    """Apply optional client outcome from a ``lead_submitted`` payload (inline, rare)."""
    raw = (normalized.get("client_observed_outcome") or "").strip()
    if not raw or raw not in CLIENT_OBSERVED_OUTCOME_CODES:
        return
    apply_client_observed_outcome_to_row(
        ev,
        outcome_code=raw,
        source=(normalized.get("client_outcome_source") or ""),
        reason=(normalized.get("client_outcome_reason") or ""),
        client_event_id=(normalized.get("client_event_id") or ""),
        now=now,
    )


def ingest_site_lead_client_outcome(
    *,
    site: Site,
    request,
    normalized: Mapping[str, Any],
) -> LeadClientOutcomeIngestOutcome:
    """
    Update client-observed outcome on an existing lead row for this site.

    ``lead_event_id`` must belong to ``site``; otherwise behaves as not found (anti-enumeration).
    """
    lead_event_id = normalized.get("lead_event_id")
    if lead_event_id is None:
        raise ValueError("missing_lead_event_id")

    raw_out = (normalized.get("client_observed_outcome") or "").strip()
    if raw_out not in CLIENT_OBSERVED_OUTCOME_CODES:
        raise ValueError("invalid_client_observed_outcome")

    now = timezone.now()
    with transaction.atomic():
        Site.objects.select_for_update().get(pk=site.pk)
        try:
            ev = ReferralLeadEvent.objects.select_for_update().get(pk=lead_event_id)
        except ReferralLeadEvent.DoesNotExist:
            raise LookupError("lead_event_not_found")

        if ev.site_id != site.pk:
            raise LookupError("lead_event_not_found")

        result = apply_client_observed_outcome_to_row(
            ev,
            outcome_code=raw_out,
            source=(normalized.get("client_outcome_source") or ""),
            reason=(normalized.get("client_outcome_reason") or ""),
            client_event_id=(normalized.get("client_event_id") or ""),
            now=now,
        )
        return LeadClientOutcomeIngestOutcome(result=result, lead_event=ev)


def normalize_lead_email_for_dedup(raw: str) -> str:
    return (raw or "").strip().lower()


def normalize_lead_phone_for_dedup(raw: str) -> str:
    """
    Canonical phone for dedup: digits only; common RU 8→7 for 11-digit mobile-style inputs.
    """
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    if len(digits) == 11 and digits[0] == "8":
        digits = "7" + digits[1:]
    return digits


def normalize_lead_name_for_storage(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    return re.sub(r"\s+", " ", s).strip()[:255]


def normalize_lead_form_id_for_dedup(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    return re.sub(r"\s+", " ", s).strip()[:255]


def normalize_lead_ref_code_for_dedup(raw: str) -> str:
    return (raw or "").strip().lower()[:32]


def page_key_from_page_url(page_url: str, *, max_len: int = 512) -> str:
    """
    Path-only key for dedup (no query string), aligned with partner dashboard path stripping.
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
    path = (path or "").strip() or "/"
    if len(path) > max_len:
        return path[:max_len]
    return path


class NormalizedLeadIdentity(NamedTuple):
    """Normalized scalar fields used for dedup comparison and persisted audit columns."""

    normalized_email: str
    normalized_phone: str
    form_id_norm: str
    page_key: str
    ref_norm: str


def normalize_lead_identity(
    *,
    customer_email: str,
    customer_phone: str,
    page_url: str,
    form_id: str,
    ref_snap: str,
) -> NormalizedLeadIdentity:
    """Trim/lowercase email, canonical phone digits, path key, normalized form id and ref."""
    return NormalizedLeadIdentity(
        normalized_email=normalize_lead_email_for_dedup(customer_email),
        normalized_phone=normalize_lead_phone_for_dedup(customer_phone),
        form_id_norm=normalize_lead_form_id_for_dedup(form_id),
        page_key=page_key_from_page_url(page_url),
        ref_norm=normalize_lead_ref_code_for_dedup(ref_snap),
    )


def _lead_identity_match(candidate: ReferralLeadEvent, identity: NormalizedLeadIdentity) -> bool:
    if identity.normalized_email and candidate.normalized_email == identity.normalized_email:
        return True
    if identity.normalized_phone and candidate.normalized_phone == identity.normalized_phone:
        return True
    return False


def _lead_structural_match(candidate: ReferralLeadEvent, identity: NormalizedLeadIdentity) -> bool:
    """
    Strong: same normalized form_id when the payload carries a form id.
    Fallback: same page_key when path is available (covers missing/empty form id).
    """
    if identity.form_id_norm:
        if normalize_lead_form_id_for_dedup(candidate.form_id) == identity.form_id_norm:
            return True
    if identity.page_key:
        if (candidate.page_key or "") == identity.page_key:
            return True
    return False


def find_recent_duplicate_lead(
    *,
    site: Site,
    identity: NormalizedLeadIdentity,
    now,
    window_seconds: int,
) -> Optional[ReferralLeadEvent]:
    """
    Return a recent event that counts as an obvious duplicate of this submit attempt.

    Requires at least one of normalized email or phone. Requires a structural match
    (same form id when present, else same page path key when present). Same site + ref.
    """
    if not identity.normalized_email and not identity.normalized_phone:
        return None
    if not identity.form_id_norm and not identity.page_key:
        return None

    cutoff = now - timezone.timedelta(seconds=max(1, int(window_seconds)))
    q = Q()
    if identity.normalized_email:
        q |= Q(normalized_email=identity.normalized_email)
    if identity.normalized_phone:
        q |= Q(normalized_phone=identity.normalized_phone)

    qs = (
        ReferralLeadEvent.objects.filter(
            site=site,
            created_at__gte=cutoff,
            submission_stage=ReferralLeadEvent.SubmissionStage.SUBMIT_ATTEMPT,
        )
        .filter(q)
        .order_by("-created_at")[:80]
    )

    for cand in qs:
        if normalize_lead_ref_code_for_dedup(cand.ref_code) != identity.ref_norm:
            continue
        if not _lead_identity_match(cand, identity):
            continue
        if not _lead_structural_match(cand, identity):
            continue
        return cand
    return None


def ingest_site_lead_submitted(
    *,
    site: Site,
    request,
    normalized: Mapping[str, Any],
) -> LeadIngestOutcome:
    """
    Persist a **submit attempt** from the public widget (v1 wire event ``lead_submitted``).

    Server-side dedup: obvious repeats inside ``settings.LEAD_INGEST_DEDUP_WINDOW_SECONDS``
    return ``duplicate_suppressed`` and do not insert a second row. Serialization per site
    uses ``select_for_update`` on ``Site`` to reduce races.
    """
    ref_code = (normalized.get("ref_code") or "").strip()[:32]
    email = (normalized.get("customer_email") or "").strip()[:254]
    phone = (normalized.get("customer_phone") or "").strip()[:64]
    name = normalize_lead_name_for_storage(normalized.get("customer_name") or "")
    page_url = (normalized.get("page_url") or "").strip()[:2000]
    form_id = (normalized.get("form_id") or "").strip()[:255]
    currency = (normalized.get("currency") or "").strip()[:8]
    product_name = (normalized.get("product_name") or "").strip()[:512]
    amount_val = _parse_optional_lead_amount(str(normalized.get("amount") or ""))

    raw = {str(k): normalized[k] for k in normalized}
    raw.setdefault("site_public_id", str(site.public_id))

    partner = None
    ref_snap = ""
    if ref_code:
        p = get_active_partner_by_ref_code(ref_code)
        if p and not would_be_self_referral(p, customer_email=email):
            partner = p
            ref_snap = p.ref_code
        elif ref_code:
            ref_snap = ref_code

    identity = normalize_lead_identity(
        customer_email=email,
        customer_phone=phone,
        page_url=page_url,
        form_id=form_id,
        ref_snap=ref_snap,
    )
    window_seconds = int(getattr(settings, "LEAD_INGEST_DEDUP_WINDOW_SECONDS", 120))
    now = timezone.now()

    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        ip = (xff.split(",")[0]).strip()
    else:
        ip = request.META.get("REMOTE_ADDR") or None

    ua = (request.META.get("HTTP_USER_AGENT") or "")[:2000]

    with transaction.atomic():
        Site.objects.select_for_update().get(pk=site.pk)
        dup = find_recent_duplicate_lead(
            site=site,
            identity=identity,
            now=now,
            window_seconds=window_seconds,
        )
        if dup is not None:
            _apply_optional_client_outcome_from_normalized(dup, normalized, now=now)
            dup.refresh_from_db(
                fields=[
                    "client_observed_outcome",
                    "client_outcome_source",
                    "client_outcome_reason",
                    "client_outcome_observed_at",
                    "client_outcome_event_id",
                ]
            )
            return LeadIngestOutcome(result="duplicate_suppressed", lead_event=dup)

        ev = ReferralLeadEvent.objects.create(
            site=site,
            event_type=ReferralLeadEvent.EventType.LEAD_SUBMITTED,
            submission_stage=ReferralLeadEvent.SubmissionStage.SUBMIT_ATTEMPT,
            partner=partner,
            ref_code=ref_snap,
            customer_email=email,
            customer_phone=phone,
            customer_name=name,
            page_url=page_url,
            form_id=form_id,
            amount=amount_val,
            currency=currency,
            product_name=product_name,
            raw_payload=raw,
            ip_address=ip,
            user_agent=ua,
            normalized_email=identity.normalized_email,
            normalized_phone=identity.normalized_phone,
            page_key=identity.page_key,
        )
        _apply_optional_client_outcome_from_normalized(ev, normalized, now=now)
        ev.refresh_from_db(
            fields=[
                "client_observed_outcome",
                "client_outcome_source",
                "client_outcome_reason",
                "client_outcome_observed_at",
                "client_outcome_event_id",
            ]
        )
        return LeadIngestOutcome(result="created", lead_event=ev)
