"""
Public, unauthenticated integration API (widget embed).

CSRF-exempt: browser widgets POST JSON with publishable key + Origin allowlist.
"""
from __future__ import annotations

import uuid

from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Site
from .services import (
    extract_publishable_key_from_request,
    ingest_site_lead_submitted,
    normalize_lead_event_payload,
    public_widget_config_dict,
    request_browser_origin,
    site_origin_is_allowed,
    validate_site_for_public_widget,
)

_PUBLIC_CORS_MAX_AGE = "7200"


def _cors_headers(*, request, site: Site) -> dict[str, str]:
    origin = request_browser_origin(request)
    if not origin or not site_origin_is_allowed(site, origin):
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Publishable-Key, Authorization",
        "Access-Control-Max-Age": _PUBLIC_CORS_MAX_AGE,
        "Vary": "Origin",
    }


@method_decorator(csrf_exempt, name="dispatch")
class PublicWidgetConfigView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def options(self, request, public_id):
        site = _get_site(public_id)
        err = validate_site_for_public_widget(
            site=site,
            publishable_key="",
            origin=request_browser_origin(request),
            require_publishable_key=False,
        )
        if err:
            return Response(err[1], status=err[0])
        assert site is not None
        return Response(status=status.HTTP_204_NO_CONTENT, headers=_cors_headers(request=request, site=site))

    def get(self, request, public_id):
        site = _get_site(public_id)
        key = extract_publishable_key_from_request(request)
        origin = request_browser_origin(request)
        err = validate_site_for_public_widget(
            site=site,
            publishable_key=key,
            origin=origin,
            require_publishable_key=True,
        )
        if err:
            return Response(err[1], status=err[0], headers=_cors_headers(request=request, site=site) if site else {})
        assert site is not None
        body = public_widget_config_dict(request=request, site=site)
        return Response(body, status=status.HTTP_200_OK, headers=_cors_headers(request=request, site=site))


@method_decorator(csrf_exempt, name="dispatch")
class PublicLeadIngestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def options(self, request):
        site = _get_site_from_query(request)
        err = validate_site_for_public_widget(
            site=site,
            publishable_key="",
            origin=request_browser_origin(request),
            require_publishable_key=False,
        )
        if err:
            return Response(err[1], status=err[0])
        assert site is not None
        return Response(status=status.HTTP_204_NO_CONTENT, headers=_cors_headers(request=request, site=site))

    def post(self, request):
        site = _get_site_from_query(request)
        key = extract_publishable_key_from_request(request)
        origin = request_browser_origin(request)
        err = validate_site_for_public_widget(
            site=site,
            publishable_key=key,
            origin=origin,
            require_publishable_key=True,
        )
        if err:
            return Response(
                err[1],
                status=err[0],
                headers=_cors_headers(request=request, site=site) if site else {},
            )
        assert site is not None

        normalized = normalize_lead_event_payload(request.data)
        if normalized.get("event") != "lead_submitted":
            return Response(
                {"detail": "unsupported_event"},
                status=status.HTTP_400_BAD_REQUEST,
                headers=_cors_headers(request=request, site=site),
            )

        ingest_site_lead_submitted(site=site, request=request, normalized=normalized)
        return Response(
            {"status": "ok", "event": "lead_submitted"},
            status=status.HTTP_201_CREATED,
            headers=_cors_headers(request=request, site=site),
        )


def _get_site(public_id) -> Site | None:
    try:
        uid = uuid.UUID(str(public_id))
    except (ValueError, TypeError, AttributeError):
        return None
    return Site.objects.filter(public_id=uid).first()


def _get_site_from_query(request) -> Site | None:
    raw = (request.query_params.get("site") or request.GET.get("site") or "").strip()
    return _get_site(raw)
