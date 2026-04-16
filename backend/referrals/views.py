from django.conf import settings
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import PartnerProfile
from .serializers import ReferralCaptureSerializer
from .services import (
    capture_referral_attribution,
    ensure_partner_profile,
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
