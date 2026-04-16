from django.urls import path

from .public_views import PublicLeadIngestView, PublicWidgetConfigView

urlpatterns = [
    path(
        "sites/<uuid:public_id>/widget-config",
        PublicWidgetConfigView.as_view(),
        name="public-widget-config",
    ),
    path(
        "events/leads",
        PublicLeadIngestView.as_view(),
        name="public-lead-ingest",
    ),
]
