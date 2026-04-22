from django.urls import path

from .views import (
    PartnerDashboardView,
    PartnerOnboardView,
    ReferralCaptureView,
    SiteOwnerCreateView,
    SiteOwnerIntegrationActivateView,
    SiteOwnerBootstrapView,
    SiteOwnerIntegrationDiagnosticsView,
    SiteOwnerIntegrationView,
    SiteOwnerIntegrationVerifyView,
    SiteOwnerSiteMembersListView,
)

urlpatterns = [
    path("capture/", ReferralCaptureView.as_view(), name="referral-capture"),
    path("partner/onboard/", PartnerOnboardView.as_view(), name="partner-onboard"),
    path("partner/me/", PartnerDashboardView.as_view(), name="partner-dashboard"),
    path(
        "site/bootstrap/",
        SiteOwnerBootstrapView.as_view(),
        name="site-owner-bootstrap",
    ),
    path(
        "site/create/",
        SiteOwnerCreateView.as_view(),
        name="site-owner-create",
    ),
    path(
        "site/integration/",
        SiteOwnerIntegrationView.as_view(),
        name="site-owner-integration",
    ),
    path(
        "site/integration/diagnostics/",
        SiteOwnerIntegrationDiagnosticsView.as_view(),
        name="site-owner-integration-diagnostics",
    ),
    path(
        "site/integration/members/",
        SiteOwnerSiteMembersListView.as_view(),
        name="site-owner-site-members",
    ),
    path(
        "site/integration/verify/",
        SiteOwnerIntegrationVerifyView.as_view(),
        name="site-owner-integration-verify",
    ),
    path(
        "site/integration/activate/",
        SiteOwnerIntegrationActivateView.as_view(),
        name="site-owner-integration-activate",
    ),
]
