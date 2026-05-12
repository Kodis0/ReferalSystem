"""Минимальная регистрация admin-моделей чувствительной зоны (для безопасного просмотра).

`code_hash` / `token_hash` объявлены readonly_fields — мы не открываем raw secret-полей
на редактирование через Django admin. Никаких списочных представлений, кроме компактных
``list_display`` для триажа.
"""

from django.contrib import admin

from .models import (
    AdminActionAudit,
    AdminMfaChallenge,
    AdminMfaDevice,
    AdminSession,
    AdminTelegramBindToken,
)


@admin.register(AdminSession)
class AdminSessionAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "confirmed_with", "elevated_until", "revoked_at", "created_at")
    list_filter = ("confirmed_with",)
    search_fields = ("user__email",)
    readonly_fields = (
        "user", "created_at", "elevated_until", "confirmed_with",
        "created_ip", "user_agent", "revoked_at",
    )


@admin.register(AdminMfaDevice)
class AdminMfaDeviceAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "type", "telegram_chat_id", "telegram_username", "is_active", "confirmed_at")
    list_filter = ("type", "is_active")
    search_fields = ("user__email", "telegram_chat_id", "telegram_username")
    readonly_fields = ("created_at", "updated_at", "confirmed_at")


@admin.register(AdminMfaChallenge)
class AdminMfaChallengeAdmin(admin.ModelAdmin):
    list_display = (
        "id", "user", "channel", "challenge_type", "status",
        "expires_at", "consumed_at", "attempts_count", "created_at",
    )
    list_filter = ("channel", "challenge_type", "status")
    search_fields = ("user__email",)
    readonly_fields = (
        "user", "device", "channel", "challenge_type", "status",
        "code_hash", "callback_nonce_hash", "telegram_message_id",
        "expires_at", "consumed_at", "approved_at", "denied_at",
        "attempts_count", "created_ip", "user_agent", "created_at",
    )


@admin.register(AdminTelegramBindToken)
class AdminTelegramBindTokenAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "purpose", "expires_at", "consumed_at", "created_at")
    list_filter = ("purpose",)
    search_fields = ("user__email",)
    readonly_fields = (
        "user", "token_hash", "purpose", "expires_at", "consumed_at",
        "created_ip", "user_agent", "created_at",
    )


@admin.register(AdminActionAudit)
class AdminActionAuditAdmin(admin.ModelAdmin):
    list_display = ("id", "actor", "action", "target_type", "target_id", "created_at")
    list_filter = ("action",)
    search_fields = ("actor__email", "action", "target_id")
    readonly_fields = (
        "actor", "action", "target_type", "target_id", "metadata",
        "ip_address", "user_agent", "created_at",
    )
