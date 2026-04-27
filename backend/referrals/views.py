from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.paginator import Paginator
from django.utils.dateparse import parse_date
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import PartnerProfile, Project, Site, SiteOwnerActivityLog
from .owner_site_activity import (
    log_integration_patch,
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
from .page_scan import PageScanError, scan_page_url
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
from .services import (
    REFERRAL_BUILDER_WORKSPACE_KEY,
    SITE_SHELL_AVATAR_CONFIG_KEY,
    SITE_CAPTURE_CONFIG_KEY,
    SITE_DISPLAY_NAME_CONFIG_KEY,
    SITE_SHELL_DESCRIPTION_CONFIG_KEY,
    build_site_connection_check,
    check_site_http_reachability,
    capture_referral_attribution,
    create_project_for_site,
    ensure_project_avatar_data_url,
    ensure_partner_profile,
    generate_publishable_key,
    partner_dashboard_payload,
    persist_project_avatar_if_empty,
    owner_site_list_origin_display,
    referral_capture_origin_allowed,
    sanitize_site_capture_config,
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
    """

    authentication_classes = [JWTAuthentication, SessionAuthentication]
    permission_classes = []

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
    for project in Project.objects.filter(owner=user).order_by("-created_at", "-id"):
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


def _site_embed_ready(site: Site) -> bool:
    readiness = build_embed_readiness(site)
    return all(bool(v) for v in readiness.values())


def _project_metadata_updates_from_owner_payload(data: dict, cfg: dict) -> dict[str, str]:
    updates: dict[str, str] = {}
    if "display_name" in data:
        updates["name"] = (data.get("display_name") or "").strip()
    elif "config_json" in data and "display_name" in cfg:
        raw = cfg.get("display_name")
        updates["name"] = raw.strip() if isinstance(raw, str) else ""

    if "description" in data:
        updates["description"] = (data.get("description") or "").strip()
    elif "config_json" in data and "description" in cfg:
        raw = cfg.get("description")
        updates["description"] = raw.strip() if isinstance(raw, str) else ""

    if "avatar_data_url" in data:
        updates["avatar_data_url"] = (data.get("avatar_data_url") or "").strip()
    elif "config_json" in data and "avatar_data_url" in cfg:
        raw = cfg.get("avatar_data_url")
        updates["avatar_data_url"] = raw.strip() if isinstance(raw, str) else ""

    return updates


def _apply_project_metadata_dual_write(cfg: dict, *, project_name: str, project_description: str, avatar_data_url: str):
    if project_name:
        cfg["display_name"] = project_name
    else:
        cfg.pop("display_name", None)

    if project_description:
        cfg["description"] = project_description
    else:
        cfg.pop("description", None)

    if avatar_data_url:
        cfg["avatar_data_url"] = avatar_data_url
    else:
        cfg.pop("avatar_data_url", None)


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
        site.delete()
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
        upd = SiteOwnerIntegrationUpdateSerializer(data=request.data, partial=True)
        if not upd.is_valid():
            return Response(upd.errors, status=status.HTTP_400_BAD_REQUEST)
        data = upd.validated_data
        if not data:
            ser = SiteOwnerIntegrationSerializer(site, context={"request": request})
            return Response(ser.data)
        if "allowed_origins" in data:
            site.allowed_origins = data["allowed_origins"]
        elif "origin" in data and data.get("origin"):
            site.allowed_origins = [data["origin"]]
        if "platform_preset" in data:
            site.platform_preset = data["platform_preset"]
        cfg = dict(site.config_json) if isinstance(site.config_json, dict) else {}
        if "config_json" in data:
            cfg = dict(data["config_json"] or {})
        if "site_display_name" in data:
            site_display_name = (data.get("site_display_name") or "").strip()
            if site_display_name:
                cfg[SITE_DISPLAY_NAME_CONFIG_KEY] = site_display_name
            else:
                cfg.pop(SITE_DISPLAY_NAME_CONFIG_KEY, None)
        elif "display_name" in data:
            # Top-level ``display_name`` on integration PATCH is the site shell label (not Project.name).
            dn = (data.get("display_name") or "").strip()
            if dn:
                cfg[SITE_DISPLAY_NAME_CONFIG_KEY] = dn
            else:
                cfg.pop(SITE_DISPLAY_NAME_CONFIG_KEY, None)
        if "capture_config" in data:
            cfg[SITE_CAPTURE_CONFIG_KEY] = sanitize_site_capture_config(data.get("capture_config"))
        elif "config_json" in data and SITE_CAPTURE_CONFIG_KEY in cfg:
            cfg[SITE_CAPTURE_CONFIG_KEY] = sanitize_site_capture_config(cfg.get(SITE_CAPTURE_CONFIG_KEY))
        if "site_avatar_data_url" in data:
            site_avatar = (data.get("site_avatar_data_url") or "").strip()
            if site_avatar:
                cfg[SITE_SHELL_AVATAR_CONFIG_KEY] = site_avatar
            else:
                cfg.pop(SITE_SHELL_AVATAR_CONFIG_KEY, None)
        if "site_description" in data:
            site_desc = (data.get("site_description") or "").strip()
            if site_desc:
                cfg[SITE_SHELL_DESCRIPTION_CONFIG_KEY] = site_desc
            else:
                cfg.pop(SITE_SHELL_DESCRIPTION_CONFIG_KEY, None)
        elif "description" in data:
            # Top-level ``description`` on integration PATCH is per-site (not Project.description).
            site_desc = (data.get("description") or "").strip()
            if site_desc:
                cfg[SITE_SHELL_DESCRIPTION_CONFIG_KEY] = site_desc
            else:
                cfg.pop(SITE_SHELL_DESCRIPTION_CONFIG_KEY, None)
        if "referral_builder_workspace" in data:
            wb = data.get("referral_builder_workspace")
            if wb is None or wb == {}:
                cfg.pop(REFERRAL_BUILDER_WORKSPACE_KEY, None)
            elif isinstance(wb, dict):
                cfg[REFERRAL_BUILDER_WORKSPACE_KEY] = wb
        data_for_project = {k: v for k, v in data.items() if k not in ("display_name", "description", "site_description")}
        project_updates = _project_metadata_updates_from_owner_payload(data_for_project, cfg)
        project = None
        if project_updates or "config_json" in data or "referral_builder_workspace" in data:
            project = create_project_for_site(site)
        if project_updates and project is not None:
            for field, value in project_updates.items():
                setattr(project, field, value)
            project.save(update_fields=[*project_updates.keys()])
        current_project_meta = (
            serialize_owner_project_metadata(site)
            if project is not None or site.project_id
            else {"name": "", "description": "", "avatar_data_url": ""}
        )
        project_name = project_updates.get("name", current_project_meta["name"])
        project_description = project_updates.get("description", current_project_meta["description"])
        project_avatar_data_url = project_updates.get("avatar_data_url", current_project_meta["avatar_data_url"])
        if (
            "config_json" in data
            or "capture_config" in data
            or "site_display_name" in data
            or "display_name" in data
            or "description" in data
            or "site_description" in data
            or "referral_builder_workspace" in data
            or project_updates
        ):
            _apply_project_metadata_dual_write(
                cfg,
                project_name=project_name,
                project_description=project_description,
                avatar_data_url=project_avatar_data_url,
            )
            site.config_json = cfg
        elif "site_avatar_data_url" in data:
            site.config_json = cfg
        if "widget_enabled" in data:
            site.widget_enabled = data["widget_enabled"]
        update_fields = ["allowed_origins", "platform_preset", "config_json", "widget_enabled", "updated_at"]
        if not _site_embed_ready(site) and site.status != Site.Status.DRAFT:
            site.status = Site.Status.DRAFT
            site.verified_at = None
            site.activated_at = None
            update_fields.extend(["status", "verified_at", "activated_at"])
        site.save(update_fields=update_fields)
        log_integration_patch(
            site=site,
            actor=request.user,
            validated=data,
            status_reset_to_draft="status" in update_fields,
        )
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
        site.delete()
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
        if not _site_embed_ready(site):
            return Response(
                _owner_api_error_body(
                    "site_not_ready_for_verify",
                    site_status=site.status,
                    embed_readiness=readiness,
                    connection_check=connection_check,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        if connection_check["status"] != "found":
            return Response(
                _owner_api_error_body(
                    "site_connection_not_found",
                    site_status=site.status,
                    embed_readiness=readiness,
                    connection_check=connection_check,
                ),
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
        readiness = build_embed_readiness(site)
        if not _site_embed_ready(site):
            return Response(
                _owner_api_error_body(
                    "site_not_ready_for_activate",
                    site_status=site.status,
                    embed_readiness=readiness,
                ),
                status=status.HTTP_409_CONFLICT,
            )
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
        qs = SiteOwnerActivityLog.objects.filter(site=site)
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
