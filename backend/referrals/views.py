from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import PartnerProfile, Site
from .owner_diagnostics import build_embed_readiness, build_site_owner_diagnostics_payload
from .serializers import (
    ReferralCaptureSerializer,
    SiteOwnerIntegrationSerializer,
    SiteOwnerIntegrationUpdateSerializer,
)
from .services import (
    capture_referral_attribution,
    ensure_partner_profile,
    generate_publishable_key,
    partner_dashboard_payload,
    referral_capture_origin_allowed,
)

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
                {"detail": "partner_profile_missing"},
                status=status.HTTP_404_NOT_FOUND,
            )
        base = getattr(settings, "FRONTEND_URL", "http://localhost:3000")
        return Response(partner_dashboard_payload(profile, app_public_base_url=base))


def _site_for_install_owner(user):
    return Site.objects.filter(owner=user).order_by("-created_at", "-id").first()


def _owner_site_options(user):
    return list(Site.objects.filter(owner=user).order_by("-created_at", "-id"))


def _owner_site_option_payload(site: Site) -> dict:
    return {
        "public_id": str(site.public_id),
        "status": site.status,
        "created_at": site.created_at.isoformat(),
        "updated_at": site.updated_at.isoformat(),
        "widget_enabled": bool(site.widget_enabled),
        "allowed_origins_count": len(site.allowed_origins or []),
    }


def _owner_site_selection_required_response(user):
    return Response(
        {
            "detail": "site_selection_required",
            "sites": [_owner_site_option_payload(site) for site in _owner_site_options(user)],
        },
        status=status.HTTP_409_CONFLICT,
    )


def _requested_site_public_id(request):
    if request.method in ("PATCH", "POST"):
        body = request.data if isinstance(request.data, dict) else {}
        if "site_public_id" in body:
            return body.get("site_public_id")
    return request.query_params.get("site_public_id")


def _resolve_owner_site(request):
    requested_public_id = _requested_site_public_id(request)
    qs = Site.objects.filter(owner=request.user).order_by("-created_at", "-id")
    if requested_public_id:
        try:
            site = qs.filter(public_id=requested_public_id).first()
        except ValidationError:
            site = None
        if site is None:
            return None, Response({"detail": "site_missing"}, status=status.HTTP_404_NOT_FOUND)
        return site, None

    sites = list(qs[:2])
    if not sites:
        return None, Response({"detail": "site_missing"}, status=status.HTTP_404_NOT_FOUND)
    if len(sites) == 1:
        return sites[0], None
    return None, _owner_site_selection_required_response(request.user)


def _site_embed_ready(site: Site) -> bool:
    readiness = build_embed_readiness(site)
    return all(bool(v) for v in readiness.values())


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
        ser = SiteOwnerIntegrationSerializer(site, context={"request": request})
        return Response(ser.data, status=status.HTTP_201_CREATED)


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
        if "platform_preset" in data:
            site.platform_preset = data["platform_preset"]
        if "config_json" in data:
            site.config_json = data["config_json"]
        if "widget_enabled" in data:
            site.widget_enabled = data["widget_enabled"]
        update_fields = ["allowed_origins", "platform_preset", "config_json", "widget_enabled", "updated_at"]
        if not _site_embed_ready(site) and site.status != Site.Status.DRAFT:
            site.status = Site.Status.DRAFT
            site.verified_at = None
            site.activated_at = None
            update_fields.extend(["status", "verified_at", "activated_at"])
        site.save(update_fields=update_fields)
        ser = SiteOwnerIntegrationSerializer(site, context={"request": request})
        return Response(ser.data)


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
        payload = build_site_owner_diagnostics_payload(site=site, recent_limit=50)
        return Response(payload)


class SiteOwnerIntegrationVerifyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        site, error = _resolve_owner_site(request)
        if error is not None:
            return error
        readiness = build_embed_readiness(site)
        if not _site_embed_ready(site):
            return Response(
                {
                    "detail": "site_not_ready_for_verify",
                    "site_status": site.status,
                    "embed_readiness": readiness,
                },
                status=status.HTTP_409_CONFLICT,
            )
        if site.status == Site.Status.DRAFT:
            site.status = Site.Status.VERIFIED
            if site.verified_at is None:
                site.verified_at = timezone.now()
            site.save(update_fields=["status", "verified_at", "updated_at"])
        ser = SiteOwnerIntegrationSerializer(site, context={"request": request})
        return Response(ser.data)


class SiteOwnerIntegrationActivateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        site, error = _resolve_owner_site(request)
        if error is not None:
            return error
        readiness = build_embed_readiness(site)
        if not _site_embed_ready(site):
            return Response(
                {
                    "detail": "site_not_ready_for_activate",
                    "site_status": site.status,
                    "embed_readiness": readiness,
                },
                status=status.HTTP_409_CONFLICT,
            )
        if site.status == Site.Status.DRAFT:
            return Response(
                {
                    "detail": "site_not_verified",
                    "site_status": site.status,
                },
                status=status.HTTP_409_CONFLICT,
            )
        if site.status != Site.Status.ACTIVE:
            site.status = Site.Status.ACTIVE
            if site.verified_at is None:
                site.verified_at = timezone.now()
            if site.activated_at is None:
                site.activated_at = timezone.now()
            site.save(update_fields=["status", "verified_at", "activated_at", "updated_at"])
        ser = SiteOwnerIntegrationSerializer(site, context={"request": request})
        return Response(ser.data)
