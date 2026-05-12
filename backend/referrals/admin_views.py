"""Admin views для модерации PartnerProfile (`/referrals/admin/partners/...`).

Минимальный набор:
  * GET list — поиск/фильтр по статусу/пагинация (cap 100).
  * GET detail — расширенные поля + safe counts по связанным сущностям.
  * PATCH status — единственный write-action; меняет ТОЛЬКО `status` и пишет audit.

Намеренно не трогаем `commission_percent`, `balance_available`, `balance_total` — это
будут отдельные шаги, если/когда понадобится.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.paginator import EmptyPage, Paginator
from django.db.models import Q, Sum
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users.admin_permissions import HasFreshAdminSession
from users.admin_views import _admin_error, _audit, _client_ip, _user_agent

from .admin_serializers import (
    AdminCommissionDetailSerializer,
    AdminCommissionListItemSerializer,
    AdminIngestAuditDetailSerializer,
    AdminIngestAuditListItemSerializer,
    AdminLeadEventDetailSerializer,
    AdminLeadEventListItemSerializer,
    AdminOrderDetailSerializer,
    AdminOrderListItemSerializer,
    AdminPartnerDetailSerializer,
    AdminPartnerListItemSerializer,
    AdminProjectDetailSerializer,
    AdminProjectListItemSerializer,
    AdminSiteDetailSerializer,
    AdminSiteListItemSerializer,
)
from .models import (
    Commission,
    Order,
    PartnerProfile,
    Project,
    PublicLeadIngestAudit,
    ReferralLeadEvent,
    Site,
)


_ALLOWED_STATUSES = ("pending", "active", "blocked")


def _paginate(qs, request, list_serializer):
    """Общая пагинация админ-листингов: `{count,page,page_size,total_pages,results}`.

    page_size cap = 100, дефолт 20; невалидные значения page/page_size → дефолт.
    """

    try:
        page_size = int(request.query_params.get("page_size") or 20)
    except (TypeError, ValueError):
        page_size = 20
    page_size = max(1, min(page_size, 100))

    try:
        page_num = int(request.query_params.get("page") or 1)
    except (TypeError, ValueError):
        page_num = 1
    page_num = max(1, page_num)

    paginator = Paginator(qs, page_size)
    try:
        page = paginator.page(page_num)
    except EmptyPage:
        page = paginator.page(paginator.num_pages) if paginator.num_pages else None

    if page is None:
        results = []
        page_number = page_num
    else:
        results = list_serializer(page.object_list, many=True).data
        page_number = page.number

    return {
        "count": paginator.count,
        "page": page_number,
        "page_size": page_size,
        "total_pages": paginator.num_pages,
        "results": results,
    }


class AdminPartnersListView(APIView):
    """``GET /referrals/admin/partners/`` — список партнёрских профилей для админ-кабинета.

    Query params:
      * ``q`` — подстрочный поиск по ``user.email``/``public_id``/``fio``/``phone`` (icontains).
      * ``status`` — pending/active/blocked (любое другое значение игнорируется).
      * ``page`` — 1-based; невалидное → 1.
      * ``page_size`` — 1..100; невалидное → 20; >100 → 100.
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request):
        qs = PartnerProfile.objects.select_related("user").all()

        q = (request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(user__email__icontains=q)
                | Q(user__public_id__icontains=q)
                | Q(user__fio__icontains=q)
                | Q(user__phone__icontains=q)
            ).distinct()

        status_param = (request.query_params.get("status") or "").strip().lower()
        if status_param in _ALLOWED_STATUSES:
            qs = qs.filter(status=status_param)

        qs = qs.order_by("-created_at", "-id")

        try:
            page_size = int(request.query_params.get("page_size") or 20)
        except (TypeError, ValueError):
            page_size = 20
        page_size = max(1, min(page_size, 100))

        try:
            page_num = int(request.query_params.get("page") or 1)
        except (TypeError, ValueError):
            page_num = 1
        page_num = max(1, page_num)

        paginator = Paginator(qs, page_size)
        try:
            page = paginator.page(page_num)
        except EmptyPage:
            page = paginator.page(paginator.num_pages) if paginator.num_pages else None

        if page is None:
            results = []
            page_number = page_num
        else:
            results = AdminPartnerListItemSerializer(page.object_list, many=True).data
            page_number = page.number

        return Response(
            {
                "count": paginator.count,
                "page": page_number,
                "page_size": page_size,
                "total_pages": paginator.num_pages,
                "results": results,
            }
        )


class AdminPartnerDetailView(APIView):
    """``GET /referrals/admin/partners/<id>/`` — подробности партнёра для админ-кабинета."""

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request, partner_id: int):
        partner = get_object_or_404(
            PartnerProfile.objects.select_related("user"), pk=partner_id
        )
        return Response(
            AdminPartnerDetailSerializer(partner, context={"request": request}).data
        )


class AdminProjectsListView(APIView):
    """``GET /referrals/admin/projects/`` — список Project для админ-кабинета.

    Query params:
      * ``q`` — icontains по ``name``/``owner.email`` (Project не имеет ``public_id``).
      * ``owner_id`` — числовой PK владельца.
      * ``page`` / ``page_size`` (cap 100, дефолт 20).
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request):
        qs = Project.objects.select_related("owner").all()

        q = (request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(name__icontains=q) | Q(owner__email__icontains=q)
            ).distinct()

        owner_id = (request.query_params.get("owner_id") or "").strip()
        if owner_id.isdigit():
            qs = qs.filter(owner_id=int(owner_id))

        qs = qs.order_by("-created_at", "-id")

        return Response(_paginate(qs, request, AdminProjectListItemSerializer))


class AdminProjectDetailView(APIView):
    """``GET /referrals/admin/projects/<id>/`` — подробности Project."""

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request, project_id: int):
        project = get_object_or_404(
            Project.objects.select_related("owner"), pk=project_id
        )
        return Response(
            AdminProjectDetailSerializer(project, context={"request": request}).data
        )


class AdminSitesListView(APIView):
    """``GET /referrals/admin/sites/`` — список Site (включая archived).

    ``Site.all_objects`` обязателен, чтобы админ видел архивные сайты — это явное
    требование (см. AGENTS.md / soft-archive семантика). Дефолтный менеджер
    ``Site.objects`` фильтрует ``archived_at IS NULL``.

    Query params:
      * ``q`` — icontains по ``public_id``/``owner.email``.
      * ``owner_id`` / ``project_id`` — числовые PK.
      * ``archived`` — ``true``/``false``/``all`` (дефолт ``all``).
      * ``page`` / ``page_size`` (cap 100, дефолт 20).
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request):
        manager = getattr(Site, "all_objects", None) or Site.objects
        qs = manager.select_related("owner", "project").all()

        q = (request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(public_id__icontains=q) | Q(owner__email__icontains=q)
            ).distinct()

        owner_id = (request.query_params.get("owner_id") or "").strip()
        if owner_id.isdigit():
            qs = qs.filter(owner_id=int(owner_id))

        project_id = (request.query_params.get("project_id") or "").strip()
        if project_id.isdigit():
            qs = qs.filter(project_id=int(project_id))

        archived = (request.query_params.get("archived") or "all").strip().lower()
        if archived == "true":
            qs = qs.filter(archived_at__isnull=False)
        elif archived == "false":
            qs = qs.filter(archived_at__isnull=True)
        # "all" / любое другое значение → без фильтра по archived_at

        qs = qs.order_by("-created_at", "-id")

        return Response(_paginate(qs, request, AdminSiteListItemSerializer))


class AdminSiteDetailView(APIView):
    """``GET /referrals/admin/sites/<id>/`` — подробности Site (включая archived)."""

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request, site_id: int):
        manager = getattr(Site, "all_objects", None) or Site.objects
        site = get_object_or_404(
            manager.select_related("owner", "project"), pk=site_id
        )
        return Response(
            AdminSiteDetailSerializer(site, context={"request": request}).data
        )


class AdminPartnerSetStatusView(APIView):
    """``PATCH /referrals/admin/partners/<id>/status/`` — смена статуса партнёра.

    Меняет ТОЛЬКО ``status`` (pending/active/blocked). ``commission_percent``,
    ``balance_available``, ``balance_total`` не трогает. Идемпотентный запрос
    (значение совпадает) — без записи в audit.
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def patch(self, request, partner_id: int):
        new_status = (request.data or {}).get("status")
        if not isinstance(new_status, str) or new_status not in _ALLOWED_STATUSES:
            return _admin_error(
                "ADMIN_PARTNER_STATUS_INVALID",
                "Допустимые статусы: pending, active, blocked",
                status.HTTP_400_BAD_REQUEST,
            )

        partner = get_object_or_404(
            PartnerProfile.objects.select_related("user"), pk=partner_id
        )
        previous = partner.status
        if previous != new_status:
            partner.status = new_status
            partner.save(update_fields=["status"])
            _audit(
                request.user,
                "admin.partner.status_changed",
                target_type="partner_profile",
                target_id=partner.id,
                metadata={
                    "user_id": getattr(partner.user, "id", None),
                    "user_email": getattr(partner.user, "email", "") or "",
                    "previous_status": previous,
                    "new_status": new_status,
                },
                ip=_client_ip(request),
                user_agent=_user_agent(request),
            )

        return Response(
            AdminPartnerDetailSerializer(partner, context={"request": request}).data
        )


# -----------------------------------------------------------------------------
# Read-only финансовая/событийная плоскость:
# Orders / Commissions / ReferralLeadEvents / PublicLeadIngestAudits.
#
# Все эти views ТОЛЬКО ``GET`` — никаких POST/PATCH/DELETE/PUT (write-actions
# для платежей/комиссий/перепривязок здесь не вводятся, см. AGENTS.md).
# Каждая list-вью прогоняется через общий ``_paginate`` (cap page_size=100,
# дефолт 20). Ordering — ``-created_at, -id``.
# -----------------------------------------------------------------------------

_ORDER_STATUSES = ("pending", "paid", "cancelled")
_COMMISSION_STATUSES = ("pending", "approved")


class AdminOrdersListView(APIView):
    """``GET /referrals/admin/orders/`` — список Order для админ-кабинета.

    Query params:
      * ``q`` — icontains по ``external_id``/``dedupe_key``/``customer_email``/``ref_code``.
      * ``status`` — pending/paid/cancelled.
      * ``partner_id`` / ``site_id`` — числовые PK (FK на ``PartnerProfile``/``Site``).
      * ``page`` / ``page_size`` (cap 100, дефолт 20).
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request):
        qs = Order.objects.select_related("partner__user", "site").all()

        q = (request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(external_id__icontains=q)
                | Q(dedupe_key__icontains=q)
                | Q(customer_email__icontains=q)
                | Q(ref_code__icontains=q)
            ).distinct()

        status_param = (request.query_params.get("status") or "").strip().lower()
        if status_param in _ORDER_STATUSES:
            qs = qs.filter(status=status_param)

        partner_id = (request.query_params.get("partner_id") or "").strip()
        if partner_id.isdigit():
            qs = qs.filter(partner_id=int(partner_id))

        site_id = (request.query_params.get("site_id") or "").strip()
        if site_id.isdigit():
            qs = qs.filter(site_id=int(site_id))

        qs = qs.order_by("-created_at", "-id")
        return Response(_paginate(qs, request, AdminOrderListItemSerializer))


class AdminOrderDetailView(APIView):
    """``GET /referrals/admin/orders/<id>/`` — подробности Order (включая ``raw_payload``)."""

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request, order_id: int):
        order = get_object_or_404(
            Order.objects.select_related("partner__user", "site"), pk=order_id
        )
        return Response(
            AdminOrderDetailSerializer(order, context={"request": request}).data
        )


class AdminCommissionsListView(APIView):
    """``GET /referrals/admin/commissions/`` — список Commission для админ-кабинета.

    Query params:
      * ``status`` — pending/approved.
      * ``partner_id`` / ``order_id`` — числовые PK.
      * ``page`` / ``page_size`` (cap 100, дефолт 20).
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request):
        qs = Commission.objects.select_related("partner__user", "order").all()

        status_param = (request.query_params.get("status") or "").strip().lower()
        if status_param in _COMMISSION_STATUSES:
            qs = qs.filter(status=status_param)

        partner_id = (request.query_params.get("partner_id") or "").strip()
        if partner_id.isdigit():
            qs = qs.filter(partner_id=int(partner_id))

        order_id = (request.query_params.get("order_id") or "").strip()
        if order_id.isdigit():
            qs = qs.filter(order_id=int(order_id))

        qs = qs.order_by("-created_at", "-id")
        return Response(_paginate(qs, request, AdminCommissionListItemSerializer))


class AdminCommissionDetailView(APIView):
    """``GET /referrals/admin/commissions/<id>/`` — подробности Commission."""

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request, commission_id: int):
        commission = get_object_or_404(
            Commission.objects.select_related("partner__user", "order"),
            pk=commission_id,
        )
        return Response(
            AdminCommissionDetailSerializer(commission, context={"request": request}).data
        )


class AdminLeadEventsListView(APIView):
    """``GET /referrals/admin/lead-events/`` — список ReferralLeadEvent.

    Query params:
      * ``q`` — icontains по ``customer_email``/``customer_phone``/``ref_code``/
        ``form_id``/``product_name``.
      * ``site_id`` / ``partner_id`` — числовые PK.
      * ``event_type`` / ``submission_stage`` — точечные фильтры по choice-полям.
      * ``page`` / ``page_size`` (cap 100, дефолт 20).
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request):
        qs = ReferralLeadEvent.objects.select_related("site", "partner").all()

        q = (request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(customer_email__icontains=q)
                | Q(customer_phone__icontains=q)
                | Q(ref_code__icontains=q)
                | Q(form_id__icontains=q)
                | Q(product_name__icontains=q)
            ).distinct()

        site_id = (request.query_params.get("site_id") or "").strip()
        if site_id.isdigit():
            qs = qs.filter(site_id=int(site_id))

        partner_id = (request.query_params.get("partner_id") or "").strip()
        if partner_id.isdigit():
            qs = qs.filter(partner_id=int(partner_id))

        event_type = (request.query_params.get("event_type") or "").strip()
        if event_type:
            qs = qs.filter(event_type=event_type)

        submission_stage = (request.query_params.get("submission_stage") or "").strip()
        if submission_stage:
            qs = qs.filter(submission_stage=submission_stage)

        qs = qs.order_by("-created_at", "-id")
        return Response(_paginate(qs, request, AdminLeadEventListItemSerializer))


class AdminLeadEventDetailView(APIView):
    """``GET /referrals/admin/lead-events/<id>/`` — подробности ReferralLeadEvent."""

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request, lead_event_id: int):
        event = get_object_or_404(
            ReferralLeadEvent.objects.select_related("site", "partner"),
            pk=lead_event_id,
        )
        return Response(
            AdminLeadEventDetailSerializer(event, context={"request": request}).data
        )


class AdminIngestAuditsListView(APIView):
    """``GET /referrals/admin/ingest-audits/`` — список PublicLeadIngestAudit.

    Query params:
      * ``site_id`` — числовой PK.
      * ``public_code`` / ``event_name`` / ``http_status`` — точечные фильтры.
      * ``page`` / ``page_size`` (cap 100, дефолт 20). Ordering ``-created_at`` +
        cap page_size — мягкая защита от тяжёлых выборок (таблица растёт быстро).
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request):
        qs = PublicLeadIngestAudit.objects.select_related("site", "lead_event").all()

        site_id = (request.query_params.get("site_id") or "").strip()
        if site_id.isdigit():
            qs = qs.filter(site_id=int(site_id))

        public_code = (request.query_params.get("public_code") or "").strip()
        if public_code:
            qs = qs.filter(public_code=public_code)

        event_name = (request.query_params.get("event_name") or "").strip()
        if event_name:
            qs = qs.filter(event_name=event_name)

        http_status_raw = (request.query_params.get("http_status") or "").strip()
        if http_status_raw.isdigit():
            qs = qs.filter(http_status=int(http_status_raw))

        qs = qs.order_by("-created_at", "-id")
        return Response(_paginate(qs, request, AdminIngestAuditListItemSerializer))


class AdminIngestAuditDetailView(APIView):
    """``GET /referrals/admin/ingest-audits/<id>/`` — подробности PublicLeadIngestAudit."""

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request, audit_id: int):
        audit = get_object_or_404(
            PublicLeadIngestAudit.objects.select_related("site", "lead_event"),
            pk=audit_id,
        )
        return Response(
            AdminIngestAuditDetailSerializer(audit, context={"request": request}).data
        )


class AdminDashboardStatsView(APIView):
    """``GET /referrals/admin/dashboard/stats/`` — агрегаты для admin-dashboard.

    Возвращает:
      * ``users_count`` — общее число CustomUser.
      * ``partners_count`` — общее число PartnerProfile.
      * ``orders_total_amount`` — сумма ``Order.amount`` по paid-ордерам.
      * ``partners_payout_amount`` — сумма ``Commission.commission_amount`` по approved
        комиссиям (которые лежат поверх paid-ордеров).
      * ``platform_revenue_amount`` = ``orders_total_amount`` − ``partners_payout_amount``.
      * ``platform_revenue_currency`` — фиксированная RUB (см. ниже).

    MVP-стратегия по валютам: считаем только в RUB. Order.currency может быть пустой
    строкой (исторический default до миграции) либо ``"RUB"``; такие записи и
    учитываем. Все прочие валюты игнорируем — это намеренное упрощение под текущую
    кодовую базу, где основной поток в RUB (см. ``gamification.py``: тот же фильтр
    ``Q(currency="") | Q(currency="RUB")``).

    No audit: чистый read-only, дашборд может опрашиваться UI-ом часто.
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request):
        User = get_user_model()

        users_count = User.objects.count()
        partners_count = PartnerProfile.objects.count()

        rub_orders = Order.objects.filter(
            status=Order.Status.PAID
        ).filter(Q(currency="") | Q(currency="RUB"))
        rub_commissions = Commission.objects.filter(
            status=Commission.Status.APPROVED,
            order__status=Order.Status.PAID,
        ).filter(Q(order__currency="") | Q(order__currency="RUB"))

        orders_total = (
            rub_orders.aggregate(total=Sum("amount")).get("total") or Decimal("0")
        )
        payout_total = (
            rub_commissions.aggregate(total=Sum("commission_amount")).get("total")
            or Decimal("0")
        )
        platform_revenue = orders_total - payout_total

        def _money(value: Decimal) -> str:
            return f"{value.quantize(Decimal('0.01')):f}"

        return Response(
            {
                "users_count": users_count,
                "partners_count": partners_count,
                "platform_revenue_amount": _money(platform_revenue),
                "platform_revenue_currency": "RUB",
                "orders_total_amount": _money(orders_total),
                "partners_payout_amount": _money(payout_total),
            }
        )
