"""Admin-only сериализаторы для `/referrals/admin/...` (read-only + 1 write).

Намеренно не дублируем sealed-поля баланса/комиссии: даже у Detail-сериализатора они
read-only — менять их можно только через будущие отдельные endpoint'ы, не через
moderation status PATCH.
"""

from rest_framework import serializers

from .models import (
    Commission,
    Order,
    PartnerProfile,
    Project,
    PublicLeadIngestAudit,
    ReferralLeadEvent,
    Site,
)


class AdminPartnerListItemSerializer(serializers.ModelSerializer):
    """Краткое представление PartnerProfile для админ-списка (read-only)."""

    user_id = serializers.IntegerField(source="user.id", read_only=True)
    user_email = serializers.EmailField(source="user.email", read_only=True)

    class Meta:
        model = PartnerProfile
        fields = [
            "id",
            "user_id",
            "user_email",
            "status",
            "balance_available",
            "balance_total",
            "commission_percent",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class AdminPartnerDetailSerializer(AdminPartnerListItemSerializer):
    """Подробное представление PartnerProfile для админ-кабинета (read-only).

    Считаемые поля (`*_count`) идут через локальные импорты с safe-fallback на 0,
    чтобы избежать циклов и не падать, если related-имя FK где-то отличается.
    """

    user_public_id = serializers.CharField(
        source="user.public_id", read_only=True, default=""
    )
    user_fio = serializers.CharField(source="user.fio", read_only=True, default="")
    user_phone = serializers.CharField(source="user.phone", read_only=True, default="")
    account_type = serializers.CharField(
        source="user.account_type", read_only=True, default=""
    )
    owned_projects_count = serializers.SerializerMethodField()
    owned_sites_count = serializers.SerializerMethodField()
    commissions_count = serializers.SerializerMethodField()
    orders_count = serializers.SerializerMethodField()

    class Meta(AdminPartnerListItemSerializer.Meta):
        fields = AdminPartnerListItemSerializer.Meta.fields + [
            "user_public_id",
            "user_fio",
            "user_phone",
            "account_type",
            "owned_projects_count",
            "owned_sites_count",
            "commissions_count",
            "orders_count",
        ]
        read_only_fields = fields

    def _safe_count(self, model_name: str, **filters) -> int:
        try:
            module = __import__("referrals.models", fromlist=[model_name])
            model = getattr(module, model_name)
        except Exception:
            return 0
        try:
            manager = getattr(model, "all_objects", None) or model.objects
            return manager.filter(**filters).count()
        except Exception:
            return 0

    def get_owned_projects_count(self, obj: PartnerProfile) -> int:
        return self._safe_count("Project", owner=obj.user)

    def get_owned_sites_count(self, obj: PartnerProfile) -> int:
        return self._safe_count("Site", owner=obj.user)

    def get_commissions_count(self, obj: PartnerProfile) -> int:
        count = self._safe_count("Commission", partner=obj)
        if count:
            return count
        return self._safe_count("Commission", partner_profile=obj)

    def get_orders_count(self, obj: PartnerProfile) -> int:
        count = self._safe_count("Order", partner=obj)
        if count:
            return count
        return self._safe_count("Order", partner_profile=obj)


def _safe_count_model(model_name: str, **filters) -> int:
    """Импорт ``referrals.models.<model_name>`` и filter().count() с safe-fallback на 0.

    Используется counts полями детальных сериализаторов: если related-имя FK
    у модели отличается (или сам атрибут отсутствует), возвращаем 0 вместо
    падения. `all_objects` (если есть) предпочитается, чтобы видеть archived.
    """

    try:
        module = __import__("referrals.models", fromlist=[model_name])
        model = getattr(module, model_name)
    except Exception:
        return 0
    try:
        manager = getattr(model, "all_objects", None) or model.objects
        return manager.filter(**filters).count()
    except Exception:
        return 0


class AdminProjectListItemSerializer(serializers.ModelSerializer):
    """Краткое представление Project для админ-списка (read-only).

    Project (см. ``referrals.models``) не имеет ``public_id``/``status``, поэтому
    в публичный набор полей попадают только реально существующие атрибуты:
    ``name``/``created_at``/``updated_at`` плюс счётчик связанных сайтов.
    """

    owner_id = serializers.IntegerField(source="owner.id", read_only=True, default=None)
    owner_email = serializers.EmailField(source="owner.email", read_only=True, default="")
    sites_count = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id",
            "owner_id",
            "owner_email",
            "name",
            "created_at",
            "updated_at",
            "sites_count",
        ]
        read_only_fields = fields

    def get_sites_count(self, obj: Project) -> int:
        manager = getattr(Site, "all_objects", None) or Site.objects
        try:
            return manager.filter(project=obj).count()
        except Exception:
            return 0


class AdminProjectDetailSerializer(AdminProjectListItemSerializer):
    """Детальное представление Project для админ-кабинета (read-only)."""

    owner_public_id = serializers.CharField(
        source="owner.public_id", read_only=True, default=""
    )
    owner_fio = serializers.CharField(source="owner.fio", read_only=True, default="")
    owner_phone = serializers.CharField(source="owner.phone", read_only=True, default="")
    description = serializers.CharField(read_only=True, default="")
    active_sites_count = serializers.SerializerMethodField()
    archived_sites_count = serializers.SerializerMethodField()

    class Meta(AdminProjectListItemSerializer.Meta):
        fields = AdminProjectListItemSerializer.Meta.fields + [
            "owner_public_id",
            "owner_fio",
            "owner_phone",
            "description",
            "active_sites_count",
            "archived_sites_count",
        ]
        read_only_fields = fields

    def _site_qs(self, obj: Project):
        manager = getattr(Site, "all_objects", None) or Site.objects
        return manager.filter(project=obj)

    def get_active_sites_count(self, obj: Project) -> int:
        try:
            return self._site_qs(obj).filter(archived_at__isnull=True).count()
        except Exception:
            return 0

    def get_archived_sites_count(self, obj: Project) -> int:
        try:
            return self._site_qs(obj).filter(archived_at__isnull=False).count()
        except Exception:
            return 0


class AdminSiteListItemSerializer(serializers.ModelSerializer):
    """Краткое представление Site для админ-списка (read-only).

    Site не имеет полей ``name``/``domain``/``url`` (см. ``referrals.models``):
    идентификатор сайта в UI — ``public_id`` (UUID).
    """

    owner_id = serializers.IntegerField(source="owner.id", read_only=True, default=None)
    owner_email = serializers.EmailField(source="owner.email", read_only=True, default="")
    project_id = serializers.IntegerField(source="project.id", read_only=True, default=None)

    class Meta:
        model = Site
        fields = [
            "id",
            "public_id",
            "owner_id",
            "owner_email",
            "project_id",
            "status",
            "platform_preset",
            "archived_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class AdminSiteDetailSerializer(AdminSiteListItemSerializer):
    """Детальное представление Site для админ-кабинета (read-only)."""

    owner_public_id = serializers.CharField(
        source="owner.public_id", read_only=True, default=""
    )
    project_public_id = serializers.CharField(
        source="project.public_id", read_only=True, default=""
    )
    project_name = serializers.CharField(source="project.name", read_only=True, default="")
    allowed_origins = serializers.JSONField(read_only=True, required=False)
    visits_count = serializers.SerializerMethodField()
    leads_count = serializers.SerializerMethodField()
    orders_count = serializers.SerializerMethodField()
    commissions_count = serializers.SerializerMethodField()

    class Meta(AdminSiteListItemSerializer.Meta):
        fields = AdminSiteListItemSerializer.Meta.fields + [
            "owner_public_id",
            "project_public_id",
            "project_name",
            "allowed_origins",
            "visits_count",
            "leads_count",
            "orders_count",
            "commissions_count",
        ]
        read_only_fields = fields

    def get_visits_count(self, obj: Site) -> int:
        return _safe_count_model("ReferralVisit", site=obj)

    def get_leads_count(self, obj: Site) -> int:
        return _safe_count_model("ReferralLeadEvent", site=obj)

    def get_orders_count(self, obj: Site) -> int:
        return _safe_count_model("Order", site=obj)

    def get_commissions_count(self, obj: Site) -> int:
        return _safe_count_model("Commission", site=obj)


# -----------------------------------------------------------------------------
# Read-only admin сериализаторы для финансовой/событийной плоскости
# -----------------------------------------------------------------------------
#
# Никаких write-полей и никаких миграций: только реально существующие поля моделей
# `Order`, `Commission`, `ReferralLeadEvent`, `PublicLeadIngestAudit`. Полный
# `raw_payload` отдаётся ТОЛЬКО в Detail-сериализаторах (см. Risks в отчёте шага):
# Django admin тоже отдаёт сырые поля, поэтому admin-роль здесь ничем не более
# privileged, чем существующая `/admin/`-плоскость; ничего нового мы не раскрываем.


class AdminOrderListItemSerializer(serializers.ModelSerializer):
    """Краткое представление Order для админ-списка (read-only)."""

    partner_id = serializers.IntegerField(
        source="partner.id", read_only=True, default=None
    )
    partner_user_email = serializers.EmailField(
        source="partner.user.email", read_only=True, default=""
    )
    site_id = serializers.IntegerField(
        source="site.id", read_only=True, default=None
    )
    site_public_id = serializers.CharField(
        source="site.public_id", read_only=True, default=""
    )

    class Meta:
        model = Order
        fields = [
            "id",
            "partner_id",
            "partner_user_email",
            "site_id",
            "site_public_id",
            "source",
            "external_id",
            "dedupe_key",
            "ref_code",
            "amount",
            "currency",
            "status",
            "customer_email",
            "paid_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class AdminOrderDetailSerializer(AdminOrderListItemSerializer):
    """Детальное представление Order: добавляет fingerprint и ``raw_payload``."""

    raw_payload = serializers.JSONField(read_only=True, required=False)

    class Meta(AdminOrderListItemSerializer.Meta):
        fields = AdminOrderListItemSerializer.Meta.fields + [
            "payload_fingerprint",
            "raw_payload",
        ]
        read_only_fields = fields


class AdminCommissionListItemSerializer(serializers.ModelSerializer):
    """Краткое представление Commission для админ-списка (read-only)."""

    partner_id = serializers.IntegerField(
        source="partner.id", read_only=True, default=None
    )
    partner_user_email = serializers.EmailField(
        source="partner.user.email", read_only=True, default=""
    )
    order_id = serializers.IntegerField(
        source="order.id", read_only=True, default=None
    )
    order_external_id = serializers.CharField(
        source="order.external_id", read_only=True, default=""
    )

    class Meta:
        model = Commission
        fields = [
            "id",
            "partner_id",
            "partner_user_email",
            "order_id",
            "order_external_id",
            "base_amount",
            "commission_percent",
            "commission_amount",
            "status",
            "created_at",
            "approved_at",
        ]
        read_only_fields = fields


class AdminCommissionDetailSerializer(AdminCommissionListItemSerializer):
    """Детальное представление Commission: + статус и сумма заказа-источника."""

    order_status = serializers.CharField(
        source="order.status", read_only=True, default=""
    )
    order_amount = serializers.DecimalField(
        source="order.amount",
        max_digits=12,
        decimal_places=2,
        read_only=True,
        required=False,
        default=None,
    )
    order_currency = serializers.CharField(
        source="order.currency", read_only=True, default=""
    )

    class Meta(AdminCommissionListItemSerializer.Meta):
        fields = AdminCommissionListItemSerializer.Meta.fields + [
            "order_status",
            "order_amount",
            "order_currency",
        ]
        read_only_fields = fields


class AdminLeadEventListItemSerializer(serializers.ModelSerializer):
    """Краткое представление ReferralLeadEvent для админ-списка (read-only).

    ``raw_payload`` НЕ включаем в list — может быть тяжёлым.
    """

    site_id = serializers.IntegerField(
        source="site.id", read_only=True, default=None
    )
    site_public_id = serializers.CharField(
        source="site.public_id", read_only=True, default=""
    )
    partner_id = serializers.IntegerField(
        source="partner.id", read_only=True, default=None
    )

    class Meta:
        model = ReferralLeadEvent
        fields = [
            "id",
            "site_id",
            "site_public_id",
            "partner_id",
            "ref_code",
            "event_type",
            "submission_stage",
            "client_observed_outcome",
            "form_id",
            "amount",
            "currency",
            "created_at",
        ]
        read_only_fields = fields


class AdminLeadEventDetailSerializer(AdminLeadEventListItemSerializer):
    """Детальное представление ReferralLeadEvent: + контактные/payload поля.

    Admin видит ``customer_email``/``customer_phone`` без маски (как в Django admin):
    owner/partner-эндпоинты маскируют только потому, что показывают чужие данные
    партнёру; для admin это та же модель, что и через ``/admin/referrals/``.
    """

    raw_payload = serializers.JSONField(read_only=True, required=False)

    class Meta(AdminLeadEventListItemSerializer.Meta):
        fields = AdminLeadEventListItemSerializer.Meta.fields + [
            "client_outcome_source",
            "client_outcome_reason",
            "client_outcome_observed_at",
            "client_outcome_event_id",
            "customer_email",
            "customer_phone",
            "customer_name",
            "page_url",
            "product_name",
            "ip_address",
            "user_agent",
            "normalized_email",
            "normalized_phone",
            "page_key",
            "raw_payload",
        ]
        read_only_fields = fields


class AdminIngestAuditListItemSerializer(serializers.ModelSerializer):
    """Краткое представление PublicLeadIngestAudit для админ-списка (read-only)."""

    site_id = serializers.IntegerField(
        source="site.id", read_only=True, default=None
    )
    site_public_id = serializers.CharField(
        source="site.public_id", read_only=True, default=""
    )
    lead_event_id = serializers.IntegerField(
        source="lead_event.id", read_only=True, default=None
    )

    class Meta:
        model = PublicLeadIngestAudit
        fields = [
            "id",
            "site_id",
            "site_public_id",
            "lead_event_id",
            "event_name",
            "public_code",
            "internal_reason",
            "http_status",
            "throttle_scope",
            "client_ip",
            "form_id",
            "created_at",
        ]
        read_only_fields = fields


class AdminIngestAuditDetailSerializer(AdminIngestAuditListItemSerializer):
    """Детальное представление PublicLeadIngestAudit: + origin/snapshot-поля."""

    class Meta(AdminIngestAuditListItemSerializer.Meta):
        fields = AdminIngestAuditListItemSerializer.Meta.fields + [
            "origin_present",
            "origin_header_prefix",
            "page_key",
            "submission_stage_snapshot",
            "client_observed_outcome_snapshot",
            "has_email",
            "has_phone",
        ]
        read_only_fields = fields
