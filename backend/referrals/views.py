from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db.models import Sum
from django.core.paginator import Paginator
from django.utils.dateparse import parse_date
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import PartnerProfile, ProgramBudgetTopUp, Project, Site, SiteOwnerActivityLog
from .owner_site_activity import (
    log_owner_project_created,
    log_owner_project_deleted,
    log_owner_project_updated,
    log_site_activated,
    log_site_connection_rechecked,
    log_site_created_in_project,
    log_site_status_refreshed_in_lk,
    log_site_verified,
    serialize_activity_rows,
)
from .owner_diagnostics import (
    build_embed_readiness,
    build_site_membership_owner_list_payload,
    build_site_owner_diagnostics_payload,
)
from .owner_site_analytics import build_site_owner_analytics_payload
from .page_scan import PageScanError, PageScanUrlValidationError, scan_page_url, validate_page_scan_url
from .platform_service_status import build_platform_service_status_payload
from .serializers import (
    PageScanRequestSerializer,
    ProjectOwnerCreateSerializer,
    ProjectOwnerUpdateSerializer,
    ProjectSiteOwnerCreateSerializer,
    ReferralCaptureSerializer,
    SiteOwnerCreateSerializer,
    SiteOwnerIntegrationSerializer,
    SiteOwnerIntegrationUpdateSerializer,
    serialize_owner_project_metadata,
)
from .owner_site_integration_update import (
    enable_widget_if_widget_seen_and_structurally_ready,
    ensure_site_verified_if_widget_seen,
    site_embed_ready,
)
from .widget_install_verify import (
    build_default_verify_page_url,
    human_message_for_page_scan_url_error,
    run_widget_install_headless_check,
)
from .site_archive import archive_site, find_archived_site_for_restore, restore_site
from .services import (
    SITE_DISPLAY_NAME_CONFIG_KEY,
    build_site_connection_check,
    check_site_http_reachability,
    capture_referral_attribution,
    create_project_for_site,
    ensure_default_owner_project,
    ensure_project_avatar_data_url,
    ensure_partner_profile,
    generate_publishable_key,
    partner_dashboard_payload,
    persist_project_avatar_if_empty,
    owner_site_list_origin_display,
    referral_capture_origin_allowed,
    site_owner_display_name,
    site_shell_avatar_data_url,
)


def _owner_api_error_body(detail: str, **extra: object) -> dict:
    """Add machine-readable ``code`` (same token as ``detail``) without changing ``detail`` text."""
    return {"detail": detail, "code": detail, **extra}


@method_decorator(csrf_exempt, name="dispatch")
class ReferralCaptureView(APIView):
    """
    Anonymous + authenticated: records last-click attribution (session + optional user).
    CSRF-exempt so the SPA can POST with session cookie without CSRF token (same pattern as Tilda webhook).
    CORS for this path is handled here (see ``core.settings.CORS_URLS_REGEX``) so Tilda origins
    do not need to be listed one-by-one in ``DJANGO_CORS_ALLOWED_ORIGINS``.
    """

    authentication_classes = [JWTAuthentication, SessionAuthentication]
    permission_classes = []

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        origin = (request.headers.get("Origin") or "").strip()
        if origin and referral_capture_origin_allowed(request):
            response["Access-Control-Allow-Origin"] = origin
            response["Access-Control-Allow-Credentials"] = "true"
            response["Vary"] = "Origin"
        return response

    def options(self, request, *args, **kwargs):
        if not referral_capture_origin_allowed(request):
            return Response({"detail": "forbidden_origin"}, status=status.HTTP_403_FORBIDDEN)
        resp = Response(status=status.HTTP_204_NO_CONTENT)
        origin = (request.headers.get("Origin") or "").strip()
        if origin:
            resp["Access-Control-Allow-Origin"] = origin
            resp["Access-Control-Allow-Credentials"] = "true"
            resp["Vary"] = "Origin"
        resp["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        resp["Access-Control-Allow-Headers"] = "Content-Type"
        resp["Access-Control-Max-Age"] = "86400"
        return resp

    def post(self, request):
        if not referral_capture_origin_allowed(request):
            return Response({"detail": "forbidden_origin"}, status=status.HTTP_403_FORBIDDEN)
        ser = ReferralCaptureSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        data = ser.validated_data
        ok, msg = capture_referral_attribution(
            request=request,
            ref_code=data["ref"],
            landing_url=data.get("landing_url") or "",
            utm_source=data.get("utm_source") or "",
            utm_medium=data.get("utm_medium") or "",
            utm_campaign=data.get("utm_campaign") or "",
        )
        if not ok:
            return Response({"detail": msg}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"status": "ok"}, status=status.HTTP_200_OK)


class PartnerOnboardView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        profile, created = ensure_partner_profile(request.user)
        base = getattr(settings, "FRONTEND_URL", "http://localhost:3000")
        payload = partner_dashboard_payload(profile, app_public_base_url=base)
        code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response(payload, status=code)


class PartnerDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            profile = request.user.partner_profile
        except PartnerProfile.DoesNotExist:
            return Response(
                _owner_api_error_body("partner_profile_missing"),
                status=status.HTTP_404_NOT_FOUND,
            )
        base = getattr(settings, "FRONTEND_URL", "http://localhost:3000")
        return Response(partner_dashboard_payload(profile, app_public_base_url=base))


def _program_budget_money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def _program_budget_balance_payload(profile: PartnerProfile) -> dict:
    available = (
        ProgramBudgetTopUp.objects.filter(partner=profile, status=ProgramBudgetTopUp.Status.SUCCEEDED).aggregate(
            total=Sum("amount")
        )["total"]
        or Decimal("0.00")
    )
    minimum = Decimal(str(getattr(settings, "PROGRAM_BUDGET_MINIMUM_ACTIVATION_AMOUNT", "1000.00")))
    return {
        "availableAmount": _program_budget_money(available),
        "holdAmount": "0.00",
        "currency": "RUB",
        "minimumActivationAmount": _program_budget_money(minimum),
        "isProgramActive": available >= minimum,
    }


def _program_budget_topup_payload(topup: ProgramBudgetTopUp) -> dict:
    return {
        "id": topup.id,
        "amount": _program_budget_money(topup.amount),
        "currency": topup.currency,
        "status": topup.status,
        "paymentMethod": topup.payment_method,
        "provider": topup.provider,
        "providerPaymentId": topup.provider_payment_id,
        "providerOrderId": topup.provider_order_id,
        "errorMessage": topup.error_message,
        "createdAt": topup.created_at.isoformat(),
        "paidAt": topup.paid_at.isoformat() if topup.paid_at else None,
    }


class ProgramBudgetBalanceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile, _ = ensure_partner_profile(request.user)
        return Response(_program_budget_balance_payload(profile))


class ProgramBudgetTopUpTransactionsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile, _ = ensure_partner_profile(request.user)
        rows = ProgramBudgetTopUp.objects.filter(partner=profile).order_by("-created_at")[:50]
        return Response({"transactions": [_program_budget_topup_payload(row) for row in rows]})


class ProgramBudgetTopUpView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        profile, _ = ensure_partner_profile(request.user)
        payment_method = str(request.data.get("paymentMethod") or "").strip()
        if payment_method != ProgramBudgetTopUp.PaymentMethod.BANK_CARD:
            return Response(
                _owner_api_error_body("unsupported_payment_method"),
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            amount = Decimal(str(request.data.get("amount", ""))).quantize(Decimal("0.01"))
        except (InvalidOperation, ValueError):
            return Response(_owner_api_error_body("invalid_amount"), status=status.HTTP_400_BAD_REQUEST)

        if amount <= 0:
            return Response(_owner_api_error_body("invalid_amount"), status=status.HTTP_400_BAD_REQUEST)

        topup = ProgramBudgetTopUp.objects.create(
            partner=profile,
            amount=amount,
            currency="RUB",
            status=ProgramBudgetTopUp.Status.PENDING,
            payment_method=ProgramBudgetTopUp.PaymentMethod.BANK_CARD,
            provider=None,
            error_message="payment_provider_not_configured",
        )
        return Response(
            {
                "topup": _program_budget_topup_payload(topup),
                "balance": _program_budget_balance_payload(profile),
                "paymentUrl": None,
                "detail": "Оплата банковской картой скоро будет доступна.",
                "code": "payment_provider_not_configured",
            },
            status=status.HTTP_202_ACCEPTED,
        )


def _owner_sites_queryset(user):
    return Site.objects.filter(owner=user).select_related("project").order_by("-created_at", "-id")


def _site_for_install_owner(user):
    return _owner_sites_queryset(user).first()


def _owner_site_options(user):
    return list(_owner_sites_queryset(user))


def _owner_site_option_payload(site: Site) -> dict:
    primary_origin, primary_origin_label = owner_site_list_origin_display(site)
    project_meta = serialize_owner_project_metadata(site)
    return {
        "public_id": str(site.public_id),
        "project_id": site.project_id,
        "status": site.status,
        "created_at": site.created_at.isoformat(),
        "updated_at": site.updated_at.isoformat(),
        "widget_enabled": bool(site.widget_enabled),
        "allowed_origins_count": len(site.allowed_origins or []),
        "primary_origin": primary_origin,
        "primary_origin_label": primary_origin_label,
        "platform_preset": site.platform_preset,
        "display_name": site_owner_display_name(site),
        "description": project_meta["description"],
        "avatar_data_url": site_shell_avatar_data_url(site),
        "project": project_meta,
    }


def _owner_project_payload(*, project: Project | None, sites: list[Site]) -> dict:
    primary_site = sites[0] if sites else None
    if project is not None:
        project_meta = {
            "id": project.id,
            "name": project.name.strip(),
            "description": project.description.strip(),
            "avatar_data_url": persist_project_avatar_if_empty(project),
            "is_default": bool(project.is_default),
        }
    elif primary_site is not None:
        project_meta = serialize_owner_project_metadata(primary_site)
    else:
        project_meta = {
            "id": None,
            "name": "",
            "description": "",
            "avatar_data_url": "",
            "is_default": False,
        }
    return {
        "id": project_meta["id"],
        "is_default": bool(project_meta.get("is_default")),
        "project": project_meta,
        "primary_site_public_id": str(primary_site.public_id) if primary_site is not None else "",
        "sites_count": len(sites),
        "sites": [_owner_site_option_payload(site) for site in sites],
    }


def _owner_project_groups(user) -> list[dict]:
    grouped: dict[object, dict] = {}
    ordered_keys: list[object] = []
    for project in Project.objects.filter(owner=user).order_by("-is_default", "created_at", "id"):
        ordered_keys.append(project.id)
        grouped[project.id] = {"project": project, "sites": []}
    for site in _owner_site_options(user):
        key = site.project_id if site.project_id is not None else f"orphan:{site.id}"
        bucket = grouped.get(key)
        if bucket is None:
            ordered_keys.append(key)
            bucket = {"project": getattr(site, "project", None), "sites": []}
            grouped[key] = bucket
        bucket["sites"].append(site)
    return [
        _owner_project_payload(project=grouped[key]["project"], sites=grouped[key]["sites"])
        for key in ordered_keys
    ]


def _owner_site_selection_required_response(user):
    return Response(
        _owner_api_error_body(
            "site_selection_required",
            sites=[_owner_site_option_payload(site) for site in _owner_site_options(user)],
        ),
        status=status.HTTP_409_CONFLICT,
    )


def _requested_site_public_id(request):
    if request.method in ("PATCH", "POST", "DELETE"):
        body = request.data if isinstance(request.data, dict) else {}
        if "site_public_id" in body:
            raw = body.get("site_public_id")
            if raw is not None and str(raw).strip():
                return raw
    qp = request.query_params.get("site_public_id")
    return qp if (qp or "").strip() else None


def _resolve_owner_site(request):
    requested_public_id = _requested_site_public_id(request)
    qs = _owner_sites_queryset(request.user)
    if requested_public_id:
        try:
            site = qs.filter(public_id=requested_public_id).first()
        except ValidationError:
            site = None
        if site is None:
            return None, Response(_owner_api_error_body("site_missing"), status=status.HTTP_404_NOT_FOUND)
        return site, None

    sites = list(qs[:2])
    if not sites:
        return None, Response(_owner_api_error_body("site_missing"), status=status.HTTP_404_NOT_FOUND)
    if len(sites) == 1:
        return sites[0], None
    return None, _owner_site_selection_required_response(request.user)


class SiteOwnerBootstrapView(APIView):
    """
    Authenticated owner: create the first Site row for widget install (self-service).

    Idempotent: if a Site already exists for this user, returns the same payload as
    GET /referrals/site/integration/ (newest site) with 200 and does not create another row.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        sites = _owner_site_options(request.user)
        if len(sites) > 1:
            return _owner_site_selection_required_response(request.user)
        if len(sites) == 1:
            ser = SiteOwnerIntegrationSerializer(sites[0], context={"request": request})
            return Response(ser.data, status=status.HTTP_200_OK)
        site = Site.objects.create(
            owner=request.user,
            publishable_key=generate_publishable_key(),
        )
        create_project_for_site(site)
        log_site_created_in_project(site=site, actor=request.user)
        ser = SiteOwnerIntegrationSerializer(site, context={"request": request})
        return Response(ser.data, status=status.HTTP_201_CREATED)


class SiteOwnerCreateView(APIView):
    """
    Authenticated owner: always create a new Site row (partner \"project\").

    Unlike ``SiteOwnerBootstrapView``, this is not idempotent and does not return an
    existing site when the user already has one.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = SiteOwnerCreateSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        data = ser.validated_data
        cfg = {"display_name": data["display_name"]}
        desc = (data.get("description") or "").strip()
        if desc:
            cfg["description"] = desc
        origin_val = (data.get("origin") or "").strip()
        allowed_origins = [origin_val] if origin_val else []
        site = Site.objects.create(
            owner=request.user,
            publishable_key=generate_publishable_key(),
            allowed_origins=allowed_origins,
            platform_preset=data["platform_preset"],
            config_json=cfg,
        )
        create_project_for_site(site)
        log_site_created_in_project(site=site, actor=request.user)
        out = SiteOwnerIntegrationSerializer(site, context={"request": request})
        return Response(out.data, status=status.HTTP_201_CREATED)


class ProjectOwnerCreateView(APIView):
    """Authenticated owner: create an empty Project without creating a Site."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = ProjectOwnerCreateSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        data = ser.validated_data
        project = Project.objects.create(
            owner=request.user,
            name=(data.get("display_name") or "").strip(),
            description=(data.get("description") or "").strip(),
            avatar_data_url=ensure_project_avatar_data_url(data.get("avatar_data_url")),
        )
        log_owner_project_created(
            owner=request.user,
            actor=request.user,
            project_name=project.name,
            project_id=project.id,
        )
        return Response(_owner_project_payload(project=project, sites=[]), status=status.HTTP_201_CREATED)


class ProjectOwnerDetailView(APIView):
    """Authenticated owner: read/update project metadata without resolving a Site."""

    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        project = Project.objects.filter(pk=project_id, owner=request.user).first()
        if project is None:
            return Response(_owner_api_error_body("project_missing"), status=status.HTTP_404_NOT_FOUND)
        sites = list(project.sites.all().order_by("-created_at", "-id"))
        return Response(_owner_project_payload(project=project, sites=sites), status=status.HTTP_200_OK)

    def patch(self, request, project_id):
        project = Project.objects.filter(pk=project_id, owner=request.user).first()
        if project is None:
            return Response(_owner_api_error_body("project_missing"), status=status.HTTP_404_NOT_FOUND)
        ser = ProjectOwnerUpdateSerializer(data=request.data, partial=True)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        data = ser.validated_data
        update_fields = []
        if "display_name" in data:
            project.name = (data.get("display_name") or "").strip()
            update_fields.append("name")
        if "description" in data:
            project.description = (data.get("description") or "").strip()
            update_fields.append("description")
        if "avatar_data_url" in data:
            project.avatar_data_url = (data.get("avatar_data_url") or "").strip()
            update_fields.append("avatar_data_url")
        if update_fields:
            project.save(update_fields=[*update_fields, "updated_at"])
            log_owner_project_updated(
                owner=request.user,
                actor=request.user,
                project_name=project.name,
                project_id=project.id,
            )
        sites = list(project.sites.all().order_by("-created_at", "-id"))
        return Response(_owner_project_payload(project=project, sites=sites), status=status.HTTP_200_OK)

    def delete(self, request, project_id):
        project = Project.objects.filter(pk=project_id, owner=request.user).first()
        if project is None:
            return Response(_owner_api_error_body("project_missing"), status=status.HTTP_404_NOT_FOUND)
        if project.is_default:
            return Response(
                _owner_api_error_body("project_default_locked"),
                status=status.HTTP_409_CONFLICT,
            )
        if project.sites.exists():
            return Response(_owner_api_error_body("project_not_empty"), status=status.HTTP_409_CONFLICT)
        log_owner_project_deleted(
            owner=request.user,
            actor=request.user,
            project_name=project.name,
            project_id=project.id,
        )
        project.delete()
        return Response({"status": "deleted"}, status=status.HTTP_200_OK)


class SiteOwnerSitesListView(APIView):
    """
    Authenticated owner: all Sites for LK project cards and sidebar.
    Always ``200`` with ``sites`` (possibly empty); avoids 409 vs 200 ambiguity
    of ``GET /site/integration/`` when listing projects.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        ensure_default_owner_project(request.user)
        sites = _owner_site_options(request.user)
        return Response(
            {
                "projects": _owner_project_groups(request.user),
                "sites": [_owner_site_option_payload(site) for site in sites],
            }
        )


class ProjectSiteOwnerCreateView(APIView):
    """Authenticated owner: add a new child Site to an existing Project."""

    permission_classes = [IsAuthenticated]

    def post(self, request, project_id):
        project = Project.objects.filter(pk=project_id, owner=request.user).first()
        if project is None:
            return Response(_owner_api_error_body("project_missing"), status=status.HTTP_404_NOT_FOUND)
        ser = ProjectSiteOwnerCreateSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        data = ser.validated_data
        origin_val = (data.get("origin") or "").strip()
        allowed_origins = [origin_val] if origin_val else []

        archived = find_archived_site_for_restore(
            owner_id=request.user.pk,
            project_id=project.pk,
            allowed_origins=allowed_origins,
        )
        if archived is not None:
            restore_site(archived)
            archived.allowed_origins = allowed_origins
            archived.platform_preset = data["platform_preset"]
            cfg = dict(archived.config_json or {})
            cfg[SITE_DISPLAY_NAME_CONFIG_KEY] = data["site_display_name"]
            archived.config_json = cfg
            archived.save(
                update_fields=["allowed_origins", "platform_preset", "config_json", "updated_at"]
            )
            out = SiteOwnerIntegrationSerializer(archived, context={"request": request})
            return Response(out.data, status=status.HTTP_200_OK)

        site = Site.objects.create(
            owner=request.user,
            project=project,
            publishable_key=generate_publishable_key(),
            allowed_origins=allowed_origins,
            platform_preset=data["platform_preset"],
            config_json={SITE_DISPLAY_NAME_CONFIG_KEY: data["site_display_name"]},
        )
        log_site_created_in_project(site=site, actor=request.user)
        out = SiteOwnerIntegrationSerializer(site, context={"request": request})
        return Response(out.data, status=status.HTTP_201_CREATED)

    def delete(self, request, project_id):
        project = Project.objects.filter(pk=project_id, owner=request.user).first()
        if project is None:
            return Response(_owner_api_error_body("project_missing"), status=status.HTTP_404_NOT_FOUND)
        requested_public_id = _requested_site_public_id(request)
        if not requested_public_id:
            return Response(
                _owner_api_error_body("site_public_id_required"),
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            site = Site.objects.filter(
                owner=request.user,
                project=project,
                public_id=requested_public_id,
            ).first()
        except ValidationError:
            site = None
        if site is None:
            return Response(_owner_api_error_body("site_missing"), status=status.HTTP_404_NOT_FOUND)
        archive_site(site=site, actor=request.user, via="project_child")
        return Response({"status": "deleted"}, status=status.HTTP_200_OK)


class SiteOwnerIntegrationView(APIView):
    """
    Authenticated site owner: read/update integration fields used by the embed widget.
    Uses the newest Site row for this user when multiple exist (admin-created).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        site, error = _resolve_owner_site(request)
        if error is not None:
            return error
        ser = SiteOwnerIntegrationSerializer(site, context={"request": request})
        return Response(ser.data)

    def patch(self, request):
        site, error = _resolve_owner_site(request)
        if error is not None:
            return error
        upd = SiteOwnerIntegrationUpdateSerializer(
            site,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        if not upd.is_valid():
            return Response(upd.errors, status=status.HTTP_400_BAD_REQUEST)
        if not upd.validated_data:
            ser = SiteOwnerIntegrationSerializer(site, context={"request": request})
            return Response(ser.data)
        upd.save()
        site.refresh_from_db()
        ser = SiteOwnerIntegrationSerializer(site, context={"request": request})
        return Response(ser.data)

    def delete(self, request):
        """
        Owner-only hard delete of the resolved Site (project). Requires explicit
        ``site_public_id`` (query or JSON body) so multi-site owners never delete implicitly.
        """
        if not _requested_site_public_id(request):
            return Response(
                _owner_api_error_body("site_public_id_required"),
                status=status.HTTP_400_BAD_REQUEST,
            )
        site, error = _resolve_owner_site(request)
        if error is not None:
            return error
        archive_site(site=site, actor=request.user, via="integration")
        return Response({"status": "deleted"}, status=status.HTTP_200_OK)


class SiteOwnerIntegrationDiagnosticsView(APIView):
    """
    Authenticated site owner: diagnostics + recent leads for the resolved Site
    (same ``site_public_id`` rules as ``SiteOwnerIntegrationView``; read-only).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        site, error = _resolve_owner_site(request)
        if error is not None:
            return error
        if (
            (request.headers.get("X-Site-Owner-Activity-Refresh") or "").strip() == "1"
            or (request.query_params.get("owner_activity_refresh") or "").strip() == "1"
        ):
            log_site_status_refreshed_in_lk(site=site, actor=request.user)
        payload = build_site_owner_diagnostics_payload(site=site, recent_limit=50)
        return Response(payload)


class SiteOwnerReachabilityView(APIView):
    """
    Authenticated owner: HTTP reachability of the site's primary origin.
    Query ``site_public_id`` is required (same as members list).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not (request.query_params.get("site_public_id") or "").strip():
            return Response(
                _owner_api_error_body("site_public_id_required"),
                status=status.HTTP_400_BAD_REQUEST,
            )
        site, error = _resolve_owner_site(request)
        if error is not None:
            return error
        return Response(check_site_http_reachability(site))


class SiteOwnerPageScanView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PageScanRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = scan_page_url(
                serializer.validated_data["url"],
                mode=serializer.validated_data.get("mode") or "map",
                preview_mode=serializer.validated_data.get("preview_mode") or "desktop",
                preload_preview_modes=bool(serializer.validated_data.get("preload_preview_modes")),
            )
        except PageScanError:
            return Response(
                {"detail": "Не удалось просканировать страницу"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(payload, status=status.HTTP_200_OK)


class SiteOwnerIntegrationAnalyticsView(APIView):
    """
    Site owner: KPIs, funnel, daily series, recent paid orders for the LK site dashboard.

    Query: ``site_public_id`` (optional if a single site), ``period`` = ``7d`` | ``30d`` | ``all``.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        site, error = _resolve_owner_site(request)
        if error is not None:
            return error
        period = (request.query_params.get("period") or "").strip()
        payload = build_site_owner_analytics_payload(site=site, period=period or None)
        return Response(payload)


class SiteOwnerSiteMembersListView(APIView):
    """
    Authenticated site owner: SiteMembership rows for exactly one Site.
    ``site_public_id`` query param is required (project-scoped owner screens).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not (request.query_params.get("site_public_id") or "").strip():
            return Response(
                _owner_api_error_body("site_public_id_required"),
                status=status.HTTP_400_BAD_REQUEST,
            )
        site, error = _resolve_owner_site(request)
        if error is not None:
            return error
        return Response(build_site_membership_owner_list_payload(site=site, list_limit=200))


class SiteOwnerIntegrationVerifyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        site, error = _resolve_owner_site(request)
        if error is not None:
            return error
        readiness = build_embed_readiness(site)
        connection_check = build_site_connection_check(site)
        if not site_embed_ready(site):
            return Response(
                _owner_api_error_body(
                    "site_not_ready_for_verify",
                    site_status=site.status,
                    embed_readiness=readiness,
                    connection_check=connection_check,
                ),
                status=status.HTTP_409_CONFLICT,
            )

        explicit_verification = (site.verification_url or "").strip()
        if explicit_verification:
            target_raw = explicit_verification
        else:
            target_raw = build_default_verify_page_url(site)

        if not target_raw:
            return Response(
                {
                    "detail": "Не удалось определить адрес сайта для проверки. Укажите домен сайта в расширенных настройках.",
                    "code": "site_verification_home_url_missing",
                    "connection_check": build_site_connection_check(site),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            normalized = validate_page_scan_url(target_raw)
        except PageScanUrlValidationError as exc:
            human = human_message_for_page_scan_url_error(exc)
            site.verification_status = Site.VerificationStatus.FAILED
            site.last_verification_error = human
            site.last_verification_at = timezone.now()
            site.save(
                update_fields=[
                    "verification_status",
                    "last_verification_error",
                    "last_verification_at",
                    "updated_at",
                ]
            )
            return Response(
                {
                    "detail": human,
                    "code": "site_verification_url_invalid",
                    "connection_check": build_site_connection_check(site),
                    "verification_status": site.verification_status,
                    "last_verification_error": site.last_verification_error,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        throttle_key = f"referrals:widget_verify_throttle:{site.pk}"
        if not cache.add(throttle_key, "1", timeout=45):
            return Response(
                {
                    "detail": "Слишком частые проверки. Подождите около минуты.",
                    "code": "widget_verify_rate_limited",
                    "connection_check": build_site_connection_check(site),
                    "verification_status": site.verification_status,
                    "last_verification_error": site.last_verification_error,
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        check_started_at = timezone.now()
        Site.objects.filter(pk=site.pk).update(
            verification_status=Site.VerificationStatus.PENDING,
            last_verification_at=check_started_at,
            last_verification_error="",
            updated_at=timezone.now(),
        )
        site.refresh_from_db()
        run_widget_install_headless_check(
            site_pk=site.pk,
            normalized_url=normalized,
            check_started_at=check_started_at,
            widget_public_id=str(site.public_id),
            publishable_key=site.publishable_key,
        )
        site.refresh_from_db()

        connection_check = build_site_connection_check(site)
        ok_verify = site.verification_status == Site.VerificationStatus.WIDGET_SEEN and connection_check["status"] == "found"

        if not ok_verify:
            detail = (site.last_verification_error or "").strip() or (
                "Мы открыли страницу, но виджет не запросил конфиг. Проверьте, что код вставлен именно на эту страницу, "
                "страница опубликована, домен добавлен в allowed origins и скрипт не заблокирован."
            )
            return Response(
                {
                    "detail": detail,
                    "code": "site_widget_verify_incomplete",
                    "site_status": site.status,
                    "embed_readiness": readiness,
                    "connection_check": connection_check,
                    "verification_status": site.verification_status,
                    "last_verification_error": site.last_verification_error,
                    "last_verification_at": site.last_verification_at.isoformat() if site.last_verification_at else None,
                },
                status=status.HTTP_409_CONFLICT,
            )
        if site.status == Site.Status.DRAFT:
            site.status = Site.Status.VERIFIED
            if site.verified_at is None:
                site.verified_at = timezone.now()
            site.save(update_fields=["status", "verified_at", "updated_at"])
            log_site_verified(site=site, actor=request.user)
        else:
            log_site_connection_rechecked(site=site, actor=request.user)
        ser = SiteOwnerIntegrationSerializer(site, context={"request": request})
        payload = dict(ser.data)
        payload["connection_check"] = build_site_connection_check(site)
        return Response(payload)


class SiteOwnerIntegrationActivateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        site, error = _resolve_owner_site(request)
        if error is not None:
            return error
        enable_widget_if_widget_seen_and_structurally_ready(site)
        site.refresh_from_db()
        readiness = build_embed_readiness(site)
        if not site_embed_ready(site):
            return Response(
                _owner_api_error_body(
                    "site_not_ready_for_activate",
                    site_status=site.status,
                    embed_readiness=readiness,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        if ensure_site_verified_if_widget_seen(site):
            log_site_verified(site=site, actor=request.user)
        site.refresh_from_db()
        if site.status == Site.Status.DRAFT:
            return Response(
                _owner_api_error_body(
                    "site_not_verified",
                    site_status=site.status,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        if site.status != Site.Status.ACTIVE:
            site.status = Site.Status.ACTIVE
            if site.verified_at is None:
                site.verified_at = timezone.now()
            if site.activated_at is None:
                site.activated_at = timezone.now()
            site.save(update_fields=["status", "verified_at", "activated_at", "updated_at"])
            log_site_activated(site=site, actor=request.user)
        ser = SiteOwnerIntegrationSerializer(site, context={"request": request})
        return Response(ser.data)


class SiteOwnerSiteActivityListView(APIView):
    """
    Paginated owner activity log for one Site (LK «История»).
    Query: ``site_public_id`` (required), ``page`` (1-based), ``page_size`` (max 100),
    optional ``date`` (YYYY-MM-DD) to restrict rows to that calendar day in the active timezone.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not (request.query_params.get("site_public_id") or "").strip():
            return Response(
                _owner_api_error_body("site_public_id_required"),
                status=status.HTTP_400_BAD_REQUEST,
            )
        site, error = _resolve_owner_site(request)
        if error is not None:
            return error
        try:
            page = max(1, int(request.query_params.get("page") or 1))
        except ValueError:
            page = 1
        try:
            page_size = int(request.query_params.get("page_size") or 20)
        except ValueError:
            page_size = 20
        page_size = max(1, min(page_size, 100))
        qs = SiteOwnerActivityLog.objects.filter(site=site).select_related("site", "actor")
        date_raw = (request.query_params.get("date") or "").strip()
        if date_raw:
            d = parse_date(date_raw)
            if d is not None:
                qs = qs.filter(created_at__date=d)
        paginator = Paginator(qs, page_size)
        p = paginator.get_page(page)
        return Response(
            {
                "results": serialize_activity_rows(p.object_list),
                "count": paginator.count,
                "page": p.number,
                "page_size": page_size,
                "num_pages": paginator.num_pages,
            }
        )


def _account_activity_feed_owner(user):
    """Activity rows are stored under the primary account; additional users share that feed."""
    if getattr(user, "account_owner_id", None):
        return user.account_owner
    return user


class SiteOwnerAccountActivityListView(APIView):
    """
    Paginated activity log for the whole account (projects, sites, integration).
    Query: ``page`` (1-based), ``page_size`` (max 100), optional ``date`` (YYYY-MM-DD).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            page = max(1, int(request.query_params.get("page") or 1))
        except ValueError:
            page = 1
        try:
            page_size = int(request.query_params.get("page_size") or 20)
        except ValueError:
            page_size = 20
        page_size = max(1, min(page_size, 100))
        feed_owner = _account_activity_feed_owner(request.user)
        qs = SiteOwnerActivityLog.objects.filter(owner=feed_owner).select_related("site", "actor")
        date_raw = (request.query_params.get("date") or "").strip()
        if date_raw:
            d = parse_date(date_raw)
            if d is not None:
                qs = qs.filter(created_at__date=d)
        paginator = Paginator(qs, page_size)
        p = paginator.get_page(page)
        return Response(
            {
                "results": serialize_activity_rows(p.object_list),
                "count": paginator.count,
                "page": p.number,
                "page_size": page_size,
                "num_pages": paginator.num_pages,
            }
        )


class PlatformServiceStatusView(APIView):
    """
    Public GET: per-service ok/message for LK support sidebar.
    Ops may set ``PLATFORM_SERVICE_STATUS_OVERRIDES_JSON`` in Django settings (env).
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(build_platform_service_status_payload())
