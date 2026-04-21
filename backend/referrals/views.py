from django.conf import settings
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import PartnerProfile, Site
from .owner_diagnostics import build_site_owner_diagnostics_payload
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


class SiteOwnerBootstrapView(APIView):
    """
    Authenticated owner: create the first Site row for widget install (self-service).

    Idempotent: if a Site already exists for this user, returns the same payload as
    GET /referrals/site/integration/ (newest site) with 200 and does not create another row.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        existing = _site_for_install_owner(request.user)
        if existing is not None:
            ser = SiteOwnerIntegrationSerializer(existing, context={"request": request})
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
        site = _site_for_install_owner(request.user)
        if site is None:
            return Response({"detail": "site_missing"}, status=status.HTTP_404_NOT_FOUND)
        ser = SiteOwnerIntegrationSerializer(site, context={"request": request})
        return Response(ser.data)

    def patch(self, request):
        site = _site_for_install_owner(request.user)
        if site is None:
            return Response({"detail": "site_missing"}, status=status.HTTP_404_NOT_FOUND)
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
        site.save(update_fields=["allowed_origins", "platform_preset", "config_json", "widget_enabled", "updated_at"])
        ser = SiteOwnerIntegrationSerializer(site, context={"request": request})
        return Response(ser.data)


class SiteOwnerIntegrationDiagnosticsView(APIView):
    """
    Authenticated site owner: diagnostics + recent leads for the same newest Site row
    as ``SiteOwnerIntegrationView`` (read-only).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        site = _site_for_install_owner(request.user)
        if site is None:
            return Response({"detail": "site_missing"}, status=status.HTTP_404_NOT_FOUND)
        payload = build_site_owner_diagnostics_payload(site=site, recent_limit=50)
        return Response(payload)
