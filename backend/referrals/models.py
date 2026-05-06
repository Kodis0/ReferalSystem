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


class ProgramBudgetTopUp(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"
        CANCELED = "canceled", "Canceled"

    class PaymentMethod(models.TextChoices):
        BANK_CARD = "bank_card", "Bank card"

    class PaymentProvider(models.TextChoices):
        TBANK = "tbank", "T-Bank"

    partner = models.ForeignKey(
        PartnerProfile,
        on_delete=models.CASCADE,
        related_name="program_budget_topups",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3, default="RUB")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True)
    payment_method = models.CharField(max_length=32, choices=PaymentMethod.choices, default=PaymentMethod.BANK_CARD)
    provider = models.CharField(max_length=32, choices=PaymentProvider.choices, null=True, blank=True)
    provider_payment_id = models.CharField(max_length=128, null=True, blank=True)
    provider_order_id = models.CharField(max_length=128, null=True, blank=True)
    error_message = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["partner", "status", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"ProgramBudgetTopUp {self.pk} ({self.partner_id}, {self.amount} {self.currency})"


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


class ActiveSiteManager(models.Manager):
    """Default queryset excludes soft-archived sites (``archived_at`` set)."""

    def get_queryset(self):
        return super().get_queryset().filter(archived_at__isnull=True)


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

    class VerificationStatus(models.TextChoices):
        NOT_STARTED = "not_started", "Not started"
        PENDING = "pending", "Pending"
        HTML_FOUND = "html_found", "Html found"
        WIDGET_SEEN = "widget_seen", "Widget seen"
        FAILED = "failed", "Failed"

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
    verification_url = models.CharField(max_length=2048, blank=True, default="")
    verification_status = models.CharField(
        max_length=32,
        choices=VerificationStatus.choices,
        default=VerificationStatus.NOT_STARTED,
        db_index=True,
    )
    last_verification_at = models.DateTimeField(null=True, blank=True)
    last_verification_error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True)

    objects = ActiveSiteManager()
    all_objects = models.Manager()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Site {self.public_id} (owner={self.owner_id})"


class SiteOwnerActivityLog(models.Model):
    """
    Append-only owner-visible log for LK «История» (настройки сайта, статусы, и т.д.).
    ``owner`` is the account whose feed includes the row; ``site`` is optional after deletion.
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="site_owner_activity_feed",
        db_index=True,
    )
    site = models.ForeignKey(
        Site,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
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
            models.Index(fields=["owner", "-created_at"], name="referrals_s_owner_i_64dcde_idx"),
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
    site = models.ForeignKey(
        "Site",
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


class GamificationProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="gamification_profile",
    )
    xp_total = models.PositiveIntegerField(default=0)
    points_balance = models.PositiveIntegerField(default=0)
    points_lifetime_earned = models.PositiveIntegerField(default=0)
    points_lifetime_spent = models.PositiveIntegerField(default=0)
    streak_days = models.PositiveIntegerField(default=0)
    last_activity_date = models.DateField(null=True, blank=True)
    last_streak_increment_date = models.DateField(null=True, blank=True)
    best_challenge_score = models.PositiveIntegerField(default=0)
    lives_current = models.PositiveSmallIntegerField(default=5)
    lives_max = models.PositiveSmallIntegerField(default=5)
    streak_shields_available = models.PositiveSmallIntegerField(default=0)
    streak_shields_max = models.PositiveSmallIntegerField(default=3)
    next_life_at = models.DateTimeField(null=True, blank=True)
    last_life_refill_at = models.DateTimeField(null=True, blank=True)
    fast_life_regen_until = models.DateTimeField(null=True, blank=True)
    active_minigame_frame = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"GamificationProfile(user={self.user_id})"


class ReferralShopOwnedItem(models.Model):
    """Persisted referral-shop cosmetic / unlock rows (e.g. mini-game frames)."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="referral_shop_owned_items",
        db_index=True,
    )
    item_code = models.CharField(max_length=64, db_index=True)
    item_type = models.CharField(max_length=32, db_index=True)
    acquired_at = models.DateTimeField(auto_now_add=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "item_code"],
                name="referrals_shop_owned_user_item_uq",
            ),
        ]
        ordering = ["-acquired_at"]

    def __str__(self) -> str:
        return f"ReferralShopOwnedItem(user={self.user_id}, code={self.item_code!r})"


class ReferralPointTransaction(models.Model):
    """Ledger for referral shop points (separate from XP)."""

    class Type(models.TextChoices):
        PURCHASE_CONFIRMED = "purchase_confirmed", "Purchase confirmed"
        MANUAL_ADJUSTMENT = "manual_adjustment", "Manual adjustment"
        REWARD_SPEND = "reward_spend", "Reward spend"
        REWARD_REFUND = "reward_refund", "Reward refund"
        ORDER_REFUND_REVERSAL = "order_refund_reversal", "Order refund reversal"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="referral_point_transactions",
        db_index=True,
    )
    transaction_type = models.CharField(
        max_length=32,
        choices=Type.choices,
        db_index=True,
    )
    amount = models.IntegerField()
    idempotency_key = models.CharField(max_length=192, unique=True, null=True, blank=True)
    balance_after = models.IntegerField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self) -> str:
        return (
            f"ReferralPointTransaction(user={self.user_id}, type={self.transaction_type!r}, "
            f"amount={self.amount})"
        )


class XPEvent(models.Model):
    class Source(models.TextChoices):
        DAILY_CHALLENGE = "daily_challenge", "Daily challenge"
        LINK_CLICK = "link_click", "Link click"
        LEAD_CREATED = "lead_created", "Lead created"
        LEAD_CONFIRMED = "lead_confirmed", "Lead confirmed"
        PURCHASE_CONFIRMED = "purchase_confirmed", "Purchase confirmed"
        ACHIEVEMENT = "achievement", "Achievement"
        MANUAL = "manual", "Manual"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="xp_events",
        db_index=True,
    )
    source = models.CharField(max_length=32, choices=Source.choices, db_index=True)
    amount = models.PositiveIntegerField()
    base_amount = models.PositiveIntegerField(default=0)
    multiplier = models.DecimalField(
        max_digits=7,
        decimal_places=4,
        default=Decimal("1.0000"),
    )
    idempotency_key = models.CharField(max_length=128, unique=True)
    metadata_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"XPEvent(user={self.user_id}, source={self.source!r}, amount={self.amount})"


class UserAchievement(models.Model):
    """Unlocked achievement row; criteria evaluated by ``achievement_service``."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="user_achievements",
        db_index=True,
    )
    code = models.CharField(max_length=64, db_index=True)
    unlocked_at = models.DateTimeField(auto_now_add=True, db_index=True)
    xp_awarded = models.PositiveIntegerField(default=0)
    progress_current = models.PositiveIntegerField(default=0)
    progress_target = models.PositiveIntegerField(default=1)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-unlocked_at"]
        constraints = [
            models.UniqueConstraint(fields=["user", "code"], name="uniq_user_achievement_code"),
        ]
        indexes = [
            models.Index(fields=["user", "code"]),
        ]

    def __str__(self) -> str:
        return f"UserAchievement(user={self.user_id}, code={self.code!r})"


class DailyChallengeAttempt(models.Model):
    class Status(models.TextChoices):
        STARTED = "started", "Started"
        COMPLETED = "completed", "Completed"

    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="daily_challenge_attempts",
        db_index=True,
    )
    challenge_date = models.DateField(db_index=True)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.STARTED,
        db_index=True,
    )
    score = models.PositiveIntegerField(default=0)
    base_xp = models.PositiveIntegerField(default=0)
    multiplier = models.DecimalField(
        max_digits=7,
        decimal_places=4,
        default=Decimal("1.0000"),
    )
    awarded_xp = models.PositiveIntegerField(default=0)
    rng_seed = models.BigIntegerField(default=0)
    move_log = models.JSONField(default=list, blank=True)
    client_reported_score = models.PositiveIntegerField(null=True, blank=True)
    validation_error = models.CharField(max_length=128, blank=True, default="")
    started_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-challenge_date", "-id"]
        indexes = [
            models.Index(fields=["user", "challenge_date"], name="referrals_da_user_date_idx"),
        ]

    def __str__(self) -> str:
        return (
            f"DailyChallengeAttempt(user={self.user_id}, date={self.challenge_date}, "
            f"status={self.status!r})"
        )
