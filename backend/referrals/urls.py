from django.urls import path

from .views import PartnerDashboardView, PartnerOnboardView, ReferralCaptureView

urlpatterns = [
    path("capture/", ReferralCaptureView.as_view(), name="referral-capture"),
    path("partner/onboard/", PartnerOnboardView.as_view(), name="partner-onboard"),
    path("partner/me/", PartnerDashboardView.as_view(), name="partner-dashboard"),
]
