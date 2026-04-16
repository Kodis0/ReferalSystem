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


class Site(models.Model):
    """
    First-class integration target (multi-site / embed widget + optional webhook).
    ``public_id`` is the stable identifier in public URLs; ``publishable_key`` is
    sent by browser widgets (treat as a public site key, not a user secret).
    """

    class PlatformPreset(models.TextChoices):
        TILDA = "tilda", "Tilda"
        GENERIC = "generic", "Generic"

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="referral_sites",
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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Site {self.public_id} (owner={self.owner_id})"


class ReferralLeadEvent(models.Model):
    """Widget / public API lead capture — not a paid order; no commission here."""

    class EventType(models.TextChoices):
        LEAD_SUBMITTED = "lead_submitted", "Lead submitted"

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

    class Meta:
        ordering = ["-created_at"]


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
