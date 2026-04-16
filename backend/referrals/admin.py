from django.contrib import admin

from .models import (
    Commission,
    CustomerAttribution,
    Order,
    PartnerProfile,
    ReferralVisit,
)


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
