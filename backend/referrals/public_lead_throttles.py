"""
Rate limits for POST /public/v1/events/leads (anonymous; IP + site id).

Invoked manually from the view after site resolution so error responses can attach
site-scoped CORS headers when appropriate.

Rates come from Django settings so tests can override LEAD_INGEST_THROTTLE_* .
"""
from __future__ import annotations

from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle


class PublicLeadIngestIPThrottle(SimpleRateThrottle):
    scope = "lead_ingest_ip"

    def get_rate(self):
        return getattr(settings, "LEAD_INGEST_THROTTLE_IP", "120/minute")

    def get_cache_key(self, request, view):
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }


class PublicLeadIngestSiteThrottle(SimpleRateThrottle):
    scope = "lead_ingest_site"

    def get_rate(self):
        return getattr(settings, "LEAD_INGEST_THROTTLE_SITE", "600/minute")

    def get_cache_key(self, request, view):
        sid = getattr(request, "_public_lead_ingest_site_id", None)
        if sid is None:
            return None
        return self.cache_format % {
            "scope": self.scope,
            "ident": str(sid),
        }
