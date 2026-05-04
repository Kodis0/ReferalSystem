from django.contrib import admin

from .models import (
    Commission,
    CustomerAttribution,
    Order,
    PartnerProfile,
    ProgramBudgetTopUp,
    PublicLeadIngestAudit,
    ReferralLeadEvent,
    ReferralVisit,
    Site,
)
from .services import generate_publishable_key


@admin.register(Site)
class SiteAdmin(admin.ModelAdmin):
    readonly_fields = ("public_id", "created_at", "updated_at")
    list_display = (
        "id",
        "owner",
        "public_id",
        "platform_preset",
        "widget_enabled",
        "webhook_enabled",
        "created_at",
    )
    list_filter = ("platform_preset", "widget_enabled", "webhook_enabled")
    search_fields = ("public_id", "owner__email", "publishable_key")

    def save_model(self, request, obj, form, change):
        if not (obj.publishable_key or "").strip():
            obj.publishable_key = generate_publishable_key()
        super().save_model(request, obj, form, change)


@admin.register(PublicLeadIngestAudit)
class PublicLeadIngestAuditAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "created_at",
        "site",
        "event_name",
        "public_code",
        "internal_reason",
        "http_status",
        "lead_event",
        "throttle_scope",
    )
    list_filter = ("public_code", "event_name", "http_status", "created_at")
    search_fields = ("page_key", "form_id", "internal_reason", "public_code")
    raw_id_fields = ("site", "lead_event")
    readonly_fields = ("created_at",)
    date_hierarchy = "created_at"


@admin.register(ReferralLeadEvent)
class ReferralLeadEventAdmin(admin.ModelAdmin):
    date_hierarchy = "created_at"
    list_display = (
        "id",
        "site",
        "event_type",
        "submission_stage",
        "client_observed_outcome",
        "partner",
        "ref_code",
        "customer_email",
        "normalized_email",
        "amount",
        "currency",
        "created_at",
    )
    list_filter = ("event_type", "submission_stage", "client_observed_outcome", "created_at")
    search_fields = ("ref_code", "customer_email", "form_id", "product_name")
    raw_id_fields = ("site", "partner")


@admin.register(PartnerProfile)
class PartnerProfileAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "ref_code",
        "status",
        "commission_percent",
        "balance_available",
        "balance_total",
        "created_at",
    )
    list_filter = ("status",)
    search_fields = ("ref_code", "user__email")


@admin.register(ProgramBudgetTopUp)
class ProgramBudgetTopUpAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "partner",
        "amount",
        "currency",
        "status",
        "payment_method",
        "provider",
        "created_at",
        "paid_at",
    )
    list_filter = ("status", "payment_method", "provider", "created_at")
    search_fields = ("partner__ref_code", "partner__user__email", "provider_payment_id", "provider_order_id")
    readonly_fields = ("created_at",)


@admin.register(ReferralVisit)
class ReferralVisitAdmin(admin.ModelAdmin):
    list_display = ("id", "partner", "ref_code", "session_key", "created_at")
    list_filter = ("created_at",)
    search_fields = ("ref_code", "session_key", "landing_url")


@admin.register(CustomerAttribution)
class CustomerAttributionAdmin(admin.ModelAdmin):
    list_display = ("id", "partner", "ref_code", "session_key", "customer_user", "expires_at")
    list_filter = ("expires_at",)
    search_fields = ("ref_code", "session_key")


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "dedupe_key",
        "status",
        "amount",
        "partner",
        "ref_code",
        "customer_email",
        "paid_at",
        "created_at",
    )
    list_filter = ("status", "source")
    search_fields = ("dedupe_key", "external_id", "customer_email", "ref_code")


@admin.register(Commission)
class CommissionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "partner",
        "order",
        "commission_amount",
        "status",
        "created_at",
    )
    list_filter = ("status",)
    search_fields = ("order__dedupe_key",)
