import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone


class PartnerProfile(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACTIVE = "active", "Active"
        BLOCKED = "blocked", "Blocked"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="partner_profile",
    )
    ref_code = models.CharField(max_length=32, unique=True, db_index=True)
    commission_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("10.00"),
        help_text="Percent of paid order amount (e.g. 10.00 = 10%).",
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.ACTIVE,
        db_index=True,
    )
    balance_available = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    balance_total = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00")
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.ref_code} ({self.user_id})"


class Project(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="referral_projects",
    )
    is_default = models.BooleanField(default=False, db_index=True)
    name = models.CharField(max_length=200, blank=True, default="")
    description = models.TextField(blank=True, default="")
    avatar_data_url = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        label = self.name.strip() or str(self.pk)
        return f"Project {label} (owner={self.owner_id})"


class Site(models.Model):
    """
    First-class integration target (multi-site / embed widget + optional webhook).
    ``public_id`` is the stable identifier in public URLs; ``publishable_key`` is
    sent by browser widgets (treat as a public site key, not a user secret).
    """

    class PlatformPreset(models.TextChoices):
        TILDA = "tilda", "Tilda"
        GENERIC = "generic", "Generic"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        VERIFIED = "verified", "Verified"
        ACTIVE = "active", "Active"

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="referral_sites",
    )
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="sites",
        null=True,
        blank=True,
    )
    public_id = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        editable=False,
        db_index=True,
    )
    publishable_key = models.CharField(max_length=128, unique=True, db_index=True)
    allowed_origins = models.JSONField(
        default=list,
        blank=True,
        help_text='List of allowed browser origins, e.g. ["https://mysite.tilda.ws"].',
    )
    platform_preset = models.CharField(
        max_length=32,
        choices=PlatformPreset.choices,
        default=PlatformPreset.TILDA,
        db_index=True,
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    widget_enabled = models.BooleanField(default=True, db_index=True)
    webhook_enabled = models.BooleanField(
        default=True,
        help_text="Reserved for future per-site webhook toggles; MVP order webhook is global.",
    )
    config_json = models.JSONField(
        default=dict,
        blank=True,
        help_text="Optional widget keys: amount_selector, currency (literal), "
        "product_name_selector (CSS selectors resolved in the browser).",
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)
    last_widget_seen_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_widget_seen_origin = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Site {self.public_id} (owner={self.owner_id})"


class SiteOwnerActivityLog(models.Model):
    """
    Append-only owner-visible log for LK «История» (настройки сайта, статусы, и т.д.).
    """

    site = models.ForeignKey(
        Site,
        on_delete=models.CASCADE,
        related_name="owner_activity_logs",
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="site_owner_activity_logs",
    )
    action = models.CharField(max_length=64, db_index=True)
    message = models.TextField()
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["site", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"SiteOwnerActivityLog(site={self.site_id}, action={self.action!r})"


class SiteMembership(models.Model):
    class JoinedVia(models.TextChoices):
        CTA_SIGNUP = "cta_signup", "CTA signup"

    site = models.ForeignKey(
        Site,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="site_memberships",
    )
    partner = models.ForeignKey(
        PartnerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="site_memberships",
    )
    ref_code = models.CharField(max_length=32, blank=True, default="", db_index=True)
    joined_via = models.CharField(
        max_length=32,
        choices=JoinedVia.choices,
        default=JoinedVia.CTA_SIGNUP,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["site", "user"], name="uniq_site_membership"),
        ]
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["site", "-created_at"]),
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"SiteMembership site={self.site_id} user={self.user_id}"


class ReferralLeadEvent(models.Model):
    """
    Widget / public API lead capture — not a paid order; no commission here.

    The v1 wire event name is ``lead_submitted`` (see ``EventType``). That name is kept
    for embed compatibility; it records a **browser submit attempt** (form submit / click),
    not a guaranteed successful delivery or a confirmed marketing conversion. Use
    ``submission_stage`` for explicit semantics.
    """

    class EventType(models.TextChoices):
        # Wire/API label from the embed script; not "confirmed lead".
        LEAD_SUBMITTED = "lead_submitted", "Lead submitted (wire)"

    class SubmissionStage(models.TextChoices):
        SUBMIT_ATTEMPT = (
            "submit_attempt",
            "Submit attempt (not a confirmed conversion)",
        )

    class ClientObservedOutcome(models.TextChoices):
        """
        Browser-side observation only (heuristics). Not a confirmed lead or conversion.
        Kept separate from submission_stage / submit_attempt semantics.
        """

        UNSET = "", "Not reported"
        SUCCESS_OBSERVED = (
            "success_observed",
            "Client observed success (not a confirmed conversion)",
        )
        FAILURE_OBSERVED = (
            "failure_observed",
            "Client observed failure (heuristic)",
        )
        NOT_OBSERVED = (
            "not_observed",
            "No confirmation / inconclusive (not a failure)",
        )

    site = models.ForeignKey(
        Site,
        on_delete=models.CASCADE,
        related_name="lead_events",
    )
    event_type = models.CharField(
        max_length=32,
        choices=EventType.choices,
        default=EventType.LEAD_SUBMITTED,
        db_index=True,
        help_text="Public wire name from the widget (v1: lead_submitted).",
    )
    submission_stage = models.CharField(
        max_length=32,
        choices=SubmissionStage.choices,
        default=SubmissionStage.SUBMIT_ATTEMPT,
        db_index=True,
        help_text="What the row actually represents (ingest is a submit attempt by default).",
    )
    client_observed_outcome = models.CharField(
        max_length=32,
        choices=ClientObservedOutcome.choices,
        blank=True,
        default="",
        db_index=True,
        help_text="Optional client-side observation (heuristic; not a confirmed conversion).",
    )
    client_outcome_source = models.CharField(
        max_length=64,
        blank=True,
        default="",
        help_text="Origin of client_observed_outcome (e.g. tilda_dom_heuristic).",
    )
    client_outcome_reason = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="Short opaque reason from the client (no PII).",
    )
    client_outcome_observed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the client last reported an observed outcome.",
    )
    client_outcome_event_id = models.CharField(
        max_length=64,
        blank=True,
        default="",
        help_text="Last client idempotency key applied for outcome reporting.",
    )
    partner = models.ForeignKey(
        PartnerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="lead_events",
    )
    ref_code = models.CharField(max_length=32, blank=True, default="", db_index=True)
    customer_email = models.CharField(max_length=254, blank=True, default="")
    customer_phone = models.CharField(max_length=64, blank=True, default="")
    customer_name = models.CharField(max_length=255, blank=True, default="")
    page_url = models.TextField(blank=True, default="")
    form_id = models.CharField(max_length=255, blank=True, default="")
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Optional monetary amount from widget (not an order).",
    )
    currency = models.CharField(max_length=8, blank=True, default="")
    product_name = models.CharField(max_length=512, blank=True, default="")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    raw_payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    # Populated on ingest for dedup queries and debugging (not a user-facing contract).
    normalized_email = models.CharField(max_length=254, blank=True, default="", db_index=True)
    normalized_phone = models.CharField(max_length=64, blank=True, default="", db_index=True)
    page_key = models.CharField(
        max_length=512,
        blank=True,
        default="",
        help_text="Normalized page path for dedup (URL path only, no query).",
    )

    class Meta:
        ordering = ["-created_at"]


class PublicLeadIngestAudit(models.Model):
    """
    One row per handled public POST /public/v1/events/leads (technical plane).

    Not a business lead row — use ReferralLeadEvent for canonical submit attempts.
    ``public_code`` aligns with JSON ``code`` / result strings from public_ingest_contract.
    ``internal_reason`` stores masked distinctions (e.g. widget_disabled vs unknown site).
    """

    site = models.ForeignKey(
        Site,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="public_ingest_audits",
        help_text="Null when site UUID in query did not resolve.",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    event_name = models.CharField(
        max_length=32,
        blank=True,
        default="",
        db_index=True,
        help_text="Wire event: lead_submitted, lead_client_outcome, or empty.",
    )
    public_code = models.CharField(
        max_length=64,
        db_index=True,
        help_text="Stable code from public response (same as client-visible code).",
    )
    internal_reason = models.CharField(
        max_length=64,
        blank=True,
        default="",
        help_text="Operator-only reason when public body is masked.",
    )
    http_status = models.PositiveSmallIntegerField(db_index=True)
    lead_event = models.ForeignKey(
        ReferralLeadEvent,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="public_ingest_audits",
    )
    origin_present = models.BooleanField(default=False)
    origin_header_prefix = models.CharField(max_length=256, blank=True, default="")
    client_ip = models.GenericIPAddressField(null=True, blank=True)
    form_id = models.CharField(max_length=255, blank=True, default="")
    page_key = models.CharField(max_length=512, blank=True, default="")
    submission_stage_snapshot = models.CharField(max_length=32, blank=True, default="")
    client_observed_outcome_snapshot = models.CharField(max_length=32, blank=True, default="")
    throttle_scope = models.CharField(max_length=16, blank=True, default="")
    has_email = models.BooleanField(default=False)
    has_phone = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["site", "-created_at"]),
            models.Index(fields=["site", "public_code", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"IngestAudit {self.public_code} site={self.site_id} at {self.created_at}"


class ReferralVisit(models.Model):
    partner = models.ForeignKey(
        PartnerProfile,
        on_delete=models.CASCADE,
        related_name="visits",
    )
    ref_code = models.CharField(max_length=32, db_index=True)
    session_key = models.CharField(max_length=64, blank=True, default="")
    landing_url = models.TextField(blank=True, default="")
    utm_source = models.CharField(max_length=255, blank=True, default="")
    utm_medium = models.CharField(max_length=255, blank=True, default="")
    utm_campaign = models.CharField(max_length=255, blank=True, default="")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]


class CustomerAttribution(models.Model):
    """Last-click attribution row; newest valid row wins in resolver."""

    partner = models.ForeignKey(
        PartnerProfile,
        on_delete=models.CASCADE,
        related_name="attributions",
    )
    ref_code = models.CharField(max_length=32, db_index=True)
    customer_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="referral_attributions",
    )
    session_key = models.CharField(max_length=64, blank=True, default="", db_index=True)
    source_visit = models.ForeignKey(
        ReferralVisit,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attributions",
    )
    attributed_at = models.DateTimeField(default=timezone.now, db_index=True)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        ordering = ["-attributed_at"]
        indexes = [
            models.Index(fields=["session_key", "-attributed_at"]),
            models.Index(fields=["customer_user", "-attributed_at"]),
        ]


class Order(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PAID = "paid", "Paid"
        CANCELLED = "cancelled", "Cancelled"

    class Source(models.TextChoices):
        TILDA = "tilda", "Tilda"

    source = models.CharField(
        max_length=32,
        choices=Source.choices,
        default=Source.TILDA,
        db_index=True,
    )
    dedupe_key = models.CharField(
        max_length=768,
        unique=True,
        db_index=True,
        help_text="Stable id for upserts: tilda:<external_id> or fp:<sha256> if no external id.",
    )
    external_id = models.CharField(
        max_length=512,
        blank=True,
        default="",
        db_index=True,
        help_text="External reference from payment or form (when available).",
    )
    payload_fingerprint = models.CharField(
        max_length=64,
        db_index=True,
        help_text="SHA-256 hex of normalized payload (audit / fallback).",
    )
    customer_email = models.CharField(max_length=254, blank=True, default="")
    customer_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="referral_orders",
    )
    partner = models.ForeignKey(
        PartnerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="orders",
    )
    ref_code = models.CharField(max_length=32, blank=True, default="")
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    currency = models.CharField(max_length=8, blank=True, default="")
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    raw_payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]


class Commission(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"

    partner = models.ForeignKey(
        PartnerProfile,
        on_delete=models.CASCADE,
        related_name="commissions",
    )
    order = models.OneToOneField(
        Order,
        on_delete=models.CASCADE,
        related_name="commission",
    )
    base_amount = models.DecimalField(max_digits=12, decimal_places=2)
    commission_percent = models.DecimalField(max_digits=5, decimal_places=2)
    commission_amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
