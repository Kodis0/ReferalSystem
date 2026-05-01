from decimal import Decimal
from urllib.parse import urlparse

from django.conf import settings
from rest_framework import serializers

from .gamification import MAX_CHALLENGE_SCORE
from .models import Site
from .services import (
    persist_project_avatar_if_empty,
    SITE_MAX_REFERRAL_LOCK_DAYS,
    SITE_MIN_REFERRAL_LOCK_DAYS,
    site_commission_percent,
    site_capture_config_dict,
    site_owner_display_name,
    site_owner_shell_description,
    site_referral_lock_days,
    site_shell_avatar_data_url,
)


def normalize_owner_site_origin(value: str) -> str:
    """Normalize partner input (host or URL) to a single browser Origin string."""
    s = (value or "").strip()
    if not s:
        raise serializers.ValidationError("Укажите домен или origin.")
    if "://" not in s:
        s = "https://" + s.split("/")[0]
    parsed = urlparse(s)
    if parsed.scheme not in ("http", "https"):
        raise serializers.ValidationError("Разрешены только адреса с http:// или https://.")
    if not parsed.hostname:
        raise serializers.ValidationError("Некорректный домен или origin.")
    host = parsed.hostname.lower()
    if parsed.port:
        return f"{parsed.scheme}://{host}:{parsed.port}"
    return f"{parsed.scheme}://{host}"


class ReferralCaptureSerializer(serializers.Serializer):
    ref = serializers.CharField(max_length=64, trim_whitespace=True)
    landing_url = serializers.CharField(required=False, allow_blank=True, default="")
    utm_source = serializers.CharField(required=False, allow_blank=True, default="")
    utm_medium = serializers.CharField(required=False, allow_blank=True, default="")
    utm_campaign = serializers.CharField(required=False, allow_blank=True, default="")


class PageScanRequestSerializer(serializers.Serializer):
    url = serializers.CharField(max_length=2048, trim_whitespace=True)
    mode = serializers.ChoiceField(
        choices=("map", "visual"),
        required=False,
        default="map",
    )
    preview_mode = serializers.ChoiceField(
        choices=("mobile", "tablet", "desktop"),
        required=False,
        default="desktop",
    )
    preload_preview_modes = serializers.BooleanField(required=False, default=False)


def build_widget_embed_snippet(
    *,
    widget_script_base: str,
    public_api_base: str,
    public_id: str,
    publishable_key: str,
) -> str:
    """HTML snippet for the v1 embed script (same attributes as `referral-widget.v1.js` header)."""
    script_url = f"{widget_script_base.rstrip('/')}/widgets/referral-widget.v1.js"
    api = public_api_base.rstrip("/")
    return (
        f'<script src="{script_url}"\n'
        f'  data-rs-api="{api}"\n'
        f'  data-rs-site="{public_id}"\n'
        f'  data-rs-key="{publishable_key}"\n'
        f'  async></script>'
    )


def serialize_owner_project_metadata(site: Site) -> dict[str, object]:
    project = getattr(site, "project", None)
    if project is None:
        return {
            "id": None,
            "name": "",
            "description": "",
            "avatar_data_url": "",
            "is_default": False,
        }
    return {
        "id": project.id,
        "name": project.name.strip(),
        "description": project.description.strip(),
        "avatar_data_url": persist_project_avatar_if_empty(project),
        "is_default": bool(project.is_default),
    }


class SiteOwnerIntegrationSerializer(serializers.ModelSerializer):
    """Owner-facing read model for widget install (no Django admin)."""

    project = serializers.SerializerMethodField()
    widget_embed_snippet = serializers.SerializerMethodField()
    public_api_base = serializers.SerializerMethodField()
    widget_script_base = serializers.SerializerMethodField()
    site_display_name = serializers.SerializerMethodField()
    site_description = serializers.SerializerMethodField()
    site_avatar_data_url = serializers.SerializerMethodField()
    capture_config = serializers.SerializerMethodField()
    commission_percent = serializers.SerializerMethodField()
    referral_lock_days = serializers.SerializerMethodField()

    class Meta:
        model = Site
        fields = (
            "public_id",
            "publishable_key",
            "allowed_origins",
            "platform_preset",
            "status",
            "verified_at",
            "activated_at",
            "widget_enabled",
            "config_json",
            "site_display_name",
            "site_description",
            "site_avatar_data_url",
            "capture_config",
            "commission_percent",
            "referral_lock_days",
            "project",
            "widget_embed_snippet",
            "public_api_base",
            "widget_script_base",
            "verification_url",
            "verification_status",
            "last_verification_at",
            "last_verification_error",
            "last_widget_seen_at",
            "last_widget_seen_origin",
        )
        read_only_fields = fields

    def get_project(self, obj: Site) -> dict[str, object]:
        return serialize_owner_project_metadata(obj)

    def get_site_display_name(self, obj: Site) -> str:
        return site_owner_display_name(obj)

    def get_site_description(self, obj: Site) -> str:
        return site_owner_shell_description(obj)

    def get_site_avatar_data_url(self, obj: Site) -> str:
        return site_shell_avatar_data_url(obj)

    def get_capture_config(self, obj: Site) -> dict[str, object]:
        return site_capture_config_dict(obj)

    def get_commission_percent(self, obj: Site) -> str:
        return str(site_commission_percent(obj))

    def get_referral_lock_days(self, obj: Site) -> int:
        return site_referral_lock_days(obj)

    def get_widget_script_base(self, obj: Site) -> str:
        return (getattr(settings, "FRONTEND_URL", "") or "").strip().rstrip("/")

    def get_public_api_base(self, obj: Site) -> str:
        explicit = (getattr(settings, "PUBLIC_API_BASE", "") or "").strip().rstrip("/")
        if explicit:
            return explicit
        request = self.context.get("request")
        if request is not None:
            return request.build_absolute_uri("/").rstrip("/")
        return ""

    def get_widget_embed_snippet(self, obj: Site) -> str:
        script_base = self.get_widget_script_base(obj)
        api_base = self.get_public_api_base(obj)
        return build_widget_embed_snippet(
            widget_script_base=script_base,
            public_api_base=api_base,
            public_id=str(obj.public_id),
            publishable_key=obj.publishable_key,
        )


class SiteOwnerIntegrationUpdateSerializer(serializers.Serializer):
    allowed_origins = serializers.ListField(
        child=serializers.CharField(max_length=512),
        required=False,
    )
    origin = serializers.CharField(max_length=512, trim_whitespace=True, required=False, allow_blank=True)
    display_name = serializers.CharField(max_length=200, trim_whitespace=True, required=False, allow_blank=True)
    site_display_name = serializers.CharField(max_length=200, trim_whitespace=True, required=False, allow_blank=True)
    site_description = serializers.CharField(max_length=2000, trim_whitespace=True, required=False, allow_blank=True)
    description = serializers.CharField(max_length=2000, trim_whitespace=True, required=False, allow_blank=True)
    avatar_data_url = serializers.CharField(required=False, allow_blank=True)
    site_avatar_data_url = serializers.CharField(required=False, allow_blank=True)
    platform_preset = serializers.ChoiceField(
        choices=Site.PlatformPreset.choices,
        required=False,
    )
    config_json = serializers.JSONField(required=False)
    capture_config = serializers.JSONField(required=False)
    commission_percent = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        min_value=Decimal("5.00"),
        required=False,
    )
    referral_lock_days = serializers.IntegerField(
        min_value=SITE_MIN_REFERRAL_LOCK_DAYS,
        max_value=SITE_MAX_REFERRAL_LOCK_DAYS,
        required=False,
    )
    referral_builder_workspace = serializers.JSONField(required=False, allow_null=True)
    widget_enabled = serializers.BooleanField(required=False)
    verification_url = serializers.CharField(max_length=2048, required=False, allow_blank=True)

    def validate_origin(self, value: str) -> str:
        if not (value or "").strip():
            return ""
        return normalize_owner_site_origin(value)

    def update(self, instance: Site, validated_data: dict) -> Site:
        from .owner_site_integration_update import apply_site_owner_integration_update

        request = self.context.get("request")
        actor = getattr(request, "user", None) if request else None
        return apply_site_owner_integration_update(instance, validated_data, log_actor=actor)


class SiteOwnerCreateSerializer(serializers.Serializer):
    """Explicit create of a new Site (multi-site); not idempotent like bootstrap."""

    display_name = serializers.CharField(max_length=200, trim_whitespace=True)
    description = serializers.CharField(max_length=2000, trim_whitespace=True, required=False, allow_blank=True)
    origin = serializers.CharField(max_length=512, trim_whitespace=True, required=False, allow_blank=True)
    platform_preset = serializers.ChoiceField(
        choices=Site.PlatformPreset.choices,
        default=Site.PlatformPreset.TILDA,
    )

    def validate_origin(self, value: str) -> str:
        s = (value or "").strip()
        if not s:
            return ""
        return normalize_owner_site_origin(value)


class ProjectOwnerCreateSerializer(serializers.Serializer):
    """Create an empty owner Project without creating any child Site rows."""

    display_name = serializers.CharField(max_length=200, trim_whitespace=True)
    description = serializers.CharField(max_length=2000, trim_whitespace=True, required=False, allow_blank=True)
    avatar_data_url = serializers.CharField(required=False, allow_blank=True)


class ProjectOwnerUpdateSerializer(serializers.Serializer):
    """Update owner Project metadata without requiring a child Site."""

    display_name = serializers.CharField(max_length=200, trim_whitespace=True, required=False, allow_blank=True)
    description = serializers.CharField(max_length=2000, trim_whitespace=True, required=False, allow_blank=True)
    avatar_data_url = serializers.CharField(required=False, allow_blank=True)


class ProjectSiteOwnerCreateSerializer(serializers.Serializer):
    """Create an additional Site inside an existing owner Project."""

    site_display_name = serializers.CharField(max_length=200, trim_whitespace=True)
    origin = serializers.CharField(max_length=512, trim_whitespace=True, required=False, allow_blank=True)
    platform_preset = serializers.ChoiceField(
        choices=Site.PlatformPreset.choices,
        default=Site.PlatformPreset.TILDA,
    )

    def validate_origin(self, value: str) -> str:
        s = (value or "").strip()
        if not s:
            return ""
        return normalize_owner_site_origin(value)


class DailyChallengeFinishSerializer(serializers.Serializer):
    attempt_id = serializers.UUIDField()
    moves = serializers.ListField(
        child=serializers.JSONField(),
        max_length=500,
        allow_empty=True,
    )
    client_score = serializers.IntegerField(
        required=False,
        allow_null=True,
        min_value=0,
        max_value=MAX_CHALLENGE_SCORE,
    )
