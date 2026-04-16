"""
Referral domain services — explicit entry points (no Django signals).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import string
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping, Optional, Tuple
from urllib.parse import urlparse

from django.apps import apps
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F, Sum
from django.utils import timezone

from .models import (
    Commission,
    CustomerAttribution,
    Order,
    PartnerProfile,
    ReferralLeadEvent,
    ReferralVisit,
    Site,
)

logger = logging.getLogger(__name__)

# Unambiguous ref alphabet (no O/0/I/1 confusion).
_REF_ALPHABET = string.ascii_uppercase.replace("O", "").replace("I", "") + "23456789"


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
            "customer_name": ev.customer_name,
            "customer_email": ev.customer_email,
            "customer_phone": ev.customer_phone,
            "page_url": ev.page_url,
            "form_id": ev.form_id,
            "amount": str(ev.amount) if ev.amount is not None else None,
            "currency": ev.currency,
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
) -> Optional[Tuple[int, dict]]:
    """
    Shared checks for public widget endpoints.

    Returns None if OK, or (http_status, body_dict) on failure.
    """
    if site is None:
        return (404, {"detail": "site_not_found"})
    if not site.widget_enabled:
        return (404, {"detail": "site_not_found"})
    allowed = site_allowed_origins_list(site)
    if not allowed:
        return (403, {"detail": "allowed_origins_required"})
    if not origin:
        if settings.DEBUG:
            return None
        return (403, {"detail": "origin_required"})
    if not site_origin_is_allowed(site, origin):
        return (403, {"detail": "forbidden_origin"})
    if require_publishable_key:
        if not publishable_key:
            return (401, {"detail": "publishable_key_required"})
        if not _timing_safe_str_eq(site.publishable_key or "", publishable_key):
            return (403, {"detail": "invalid_publishable_key"})
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


def public_widget_config_dict(*, request, site: Site) -> dict[str, Any]:
    site_uuid = str(site.public_id)
    ingest = request.build_absolute_uri(f"/public/v1/events/leads?site={site_uuid}")
    cfg = site.config_json if isinstance(site.config_json, dict) else {}
    selector_keys = _widget_lead_selector_keys(cfg)
    return {
        "version": 1,
        "site_public_id": site_uuid,
        "platform_preset": site.platform_preset,
        "lead_ingest_url": ingest,
        "storage_key": f"rs_ref_v1_{site_uuid}",
        "config": dict(cfg),
        **selector_keys,
    }


def _parse_optional_lead_amount(raw: str) -> Decimal | None:
    if not (raw or "").strip():
        return None
    t = raw.strip().replace(",", ".")
    try:
        return Decimal(t)
    except InvalidOperation:
        return None


def ingest_site_lead_submitted(
    *,
    site: Site,
    request,
    normalized: Mapping[str, Any],
) -> ReferralLeadEvent:
    ref_code = (normalized.get("ref_code") or "").strip()[:32]
    email = (normalized.get("customer_email") or "").strip()[:254]
    phone = (normalized.get("customer_phone") or "").strip()[:64]
    name = (normalized.get("customer_name") or "").strip()[:255]
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

    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        ip = (xff.split(",")[0]).strip()
    else:
        ip = request.META.get("REMOTE_ADDR") or None

    ua = (request.META.get("HTTP_USER_AGENT") or "")[:2000]

    return ReferralLeadEvent.objects.create(
        site=site,
        event_type=ReferralLeadEvent.EventType.LEAD_SUBMITTED,
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
    )
