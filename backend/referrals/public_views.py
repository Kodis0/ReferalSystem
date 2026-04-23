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
from .public_ingest_audit import record_public_lead_ingest_audit
from .public_ingest_contract import (
    CODE_INVALID_CLIENT_OUTCOME,
    CODE_INVALID_EVENT,
    CODE_INVALID_PAYLOAD,
    CODE_LEAD_EVENT_NOT_FOUND,
    CODE_RATE_LIMITED,
    CODE_VALIDATION_ERROR,
    public_ingest_client_outcome_success_body,
    public_ingest_error_body,
    public_ingest_success_body,
)
from .public_ingest_logging import (
    log_public_lead_gate_rejection,
    log_public_lead_ingest_success,
    log_public_lead_outcome_report,
    log_public_lead_rate_limited,
    log_public_lead_validation_error,
)
from .public_lead_throttles import PublicLeadIngestIPThrottle, PublicLeadIngestSiteThrottle
from .services import (
    extract_publishable_key_from_request,
    ingest_site_lead_client_outcome,
    ingest_site_lead_submitted,
    normalize_lead_client_outcome_event_payload,
    normalize_lead_event_payload,
    page_key_from_page_url,
    public_widget_config_dict,
    record_site_widget_seen,
    request_browser_origin,
    site_origin_is_allowed,
    validate_lead_submitted_optional_client_outcome,
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
        record_site_widget_seen(site=site, origin=origin)
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
            _status, body, internal = err
            log_public_lead_gate_rejection(
                request=request,
                internal_reason=internal,
                public_code=str(body.get("code") or ""),
                site=site,
            )
            record_public_lead_ingest_audit(
                site=site,
                request=request,
                event_name="",
                public_code=str(body.get("code") or ""),
                http_status=_status,
                internal_reason=str(internal or ""),
            )
            return Response(
                body,
                status=_status,
                headers=_cors_headers(request=request, site=site) if site else {},
            )
        assert site is not None

        request._public_lead_ingest_site_id = site.pk
        ip_thr = PublicLeadIngestIPThrottle()
        if not ip_thr.allow_request(request, self):
            log_public_lead_rate_limited(request=request, site=site, scope="ip")
            record_public_lead_ingest_audit(
                site=site,
                request=request,
                event_name="",
                public_code=CODE_RATE_LIMITED,
                http_status=status.HTTP_429_TOO_MANY_REQUESTS,
                throttle_scope="ip",
            )
            return Response(
                public_ingest_error_body(
                    code=CODE_RATE_LIMITED,
                    message="Too many requests from this network. Please try again later.",
                ),
                status=status.HTTP_429_TOO_MANY_REQUESTS,
                headers=_cors_headers(request=request, site=site),
            )
        site_thr = PublicLeadIngestSiteThrottle()
        if not site_thr.allow_request(request, self):
            log_public_lead_rate_limited(request=request, site=site, scope="site")
            record_public_lead_ingest_audit(
                site=site,
                request=request,
                event_name="",
                public_code=CODE_RATE_LIMITED,
                http_status=status.HTTP_429_TOO_MANY_REQUESTS,
                throttle_scope="site",
            )
            return Response(
                public_ingest_error_body(
                    code=CODE_RATE_LIMITED,
                    message="Too many requests for this site. Please try again later.",
                ),
                status=status.HTTP_429_TOO_MANY_REQUESTS,
                headers=_cors_headers(request=request, site=site),
            )

        if not isinstance(request.data, dict):
            log_public_lead_validation_error(
                request=request, site=site, code=CODE_INVALID_PAYLOAD
            )
            record_public_lead_ingest_audit(
                site=site,
                request=request,
                event_name="",
                public_code=CODE_INVALID_PAYLOAD,
                http_status=status.HTTP_400_BAD_REQUEST,
            )
            return Response(
                public_ingest_error_body(
                    code=CODE_INVALID_PAYLOAD,
                    message="Request body must be a JSON object.",
                ),
                status=status.HTTP_400_BAD_REQUEST,
                headers=_cors_headers(request=request, site=site),
            )

        raw_event = str(request.data.get("event") or "").strip()

        if raw_event == "lead_client_outcome":
            normalized_o = normalize_lead_client_outcome_event_payload(request.data)
            if normalized_o.get("lead_event_id") is None:
                log_public_lead_validation_error(
                    request=request, site=site, code=CODE_VALIDATION_ERROR
                )
                record_public_lead_ingest_audit(
                    site=site,
                    request=request,
                    event_name="lead_client_outcome",
                    public_code=CODE_VALIDATION_ERROR,
                    http_status=status.HTTP_400_BAD_REQUEST,
                )
                return Response(
                    public_ingest_error_body(
                        code=CODE_VALIDATION_ERROR,
                        message="lead_event_id is required.",
                    ),
                    status=status.HTTP_400_BAD_REQUEST,
                    headers=_cors_headers(request=request, site=site),
                )
            if not (normalized_o.get("client_observed_outcome") or "").strip():
                log_public_lead_validation_error(
                    request=request, site=site, code=CODE_VALIDATION_ERROR
                )
                record_public_lead_ingest_audit(
                    site=site,
                    request=request,
                    event_name="lead_client_outcome",
                    public_code=CODE_VALIDATION_ERROR,
                    http_status=status.HTTP_400_BAD_REQUEST,
                )
                return Response(
                    public_ingest_error_body(
                        code=CODE_VALIDATION_ERROR,
                        message="client_observed_outcome is required.",
                    ),
                    status=status.HTTP_400_BAD_REQUEST,
                    headers=_cors_headers(request=request, site=site),
                )
            try:
                oc = ingest_site_lead_client_outcome(
                    site=site, request=request, normalized=normalized_o
                )
            except LookupError:
                log_public_lead_validation_error(
                    request=request, site=site, code=CODE_LEAD_EVENT_NOT_FOUND
                )
                record_public_lead_ingest_audit(
                    site=site,
                    request=request,
                    event_name="lead_client_outcome",
                    public_code=CODE_LEAD_EVENT_NOT_FOUND,
                    http_status=status.HTTP_404_NOT_FOUND,
                )
                return Response(
                    public_ingest_error_body(
                        code=CODE_LEAD_EVENT_NOT_FOUND,
                        message="Lead event not found.",
                    ),
                    status=status.HTTP_404_NOT_FOUND,
                    headers=_cors_headers(request=request, site=site),
                )
            except ValueError:
                log_public_lead_validation_error(
                    request=request, site=site, code=CODE_INVALID_CLIENT_OUTCOME
                )
                record_public_lead_ingest_audit(
                    site=site,
                    request=request,
                    event_name="lead_client_outcome",
                    public_code=CODE_INVALID_CLIENT_OUTCOME,
                    http_status=status.HTTP_400_BAD_REQUEST,
                )
                return Response(
                    public_ingest_error_body(
                        code=CODE_INVALID_CLIENT_OUTCOME,
                        message="Invalid client_observed_outcome.",
                    ),
                    status=status.HTTP_400_BAD_REQUEST,
                    headers=_cors_headers(request=request, site=site),
                )
            log_public_lead_outcome_report(
                request=request,
                site=site,
                result=oc.result,
                lead_event_id=oc.lead_event.pk,
                outcome_code=(normalized_o.get("client_observed_outcome") or "")[:32],
            )
            body = public_ingest_client_outcome_success_body(
                result=oc.result,
                lead_event_id=oc.lead_event.pk,
            )
            record_public_lead_ingest_audit(
                site=site,
                request=request,
                event_name="lead_client_outcome",
                public_code=oc.result,
                http_status=status.HTTP_200_OK,
                lead_event=oc.lead_event,
                client_observed_outcome_snapshot=(normalized_o.get("client_observed_outcome") or "")[:32],
            )
            return Response(
                body,
                status=status.HTTP_200_OK,
                headers=_cors_headers(request=request, site=site),
            )

        normalized = normalize_lead_event_payload(request.data)
        if normalized.get("event") != "lead_submitted":
            log_public_lead_validation_error(
                request=request, site=site, code=CODE_INVALID_EVENT
            )
            record_public_lead_ingest_audit(
                site=site,
                request=request,
                event_name=str(normalized.get("event") or "")[:32],
                public_code=CODE_INVALID_EVENT,
                http_status=status.HTTP_400_BAD_REQUEST,
            )
            return Response(
                public_ingest_error_body(
                    code=CODE_INVALID_EVENT,
                    message="Unsupported event type.",
                ),
                status=status.HTTP_400_BAD_REQUEST,
                headers=_cors_headers(request=request, site=site),
            )

        bad_co = validate_lead_submitted_optional_client_outcome(normalized)
        if bad_co:
            log_public_lead_validation_error(
                request=request, site=site, code=CODE_INVALID_CLIENT_OUTCOME
            )
            record_public_lead_ingest_audit(
                site=site,
                request=request,
                event_name="lead_submitted",
                public_code=CODE_INVALID_CLIENT_OUTCOME,
                http_status=status.HTTP_400_BAD_REQUEST,
            )
            return Response(
                public_ingest_error_body(
                    code=CODE_INVALID_CLIENT_OUTCOME,
                    message="Invalid client_observed_outcome.",
                ),
                status=status.HTTP_400_BAD_REQUEST,
                headers=_cors_headers(request=request, site=site),
            )

        outcome = ingest_site_lead_submitted(site=site, request=request, normalized=normalized)
        page_key = page_key_from_page_url(normalized.get("page_url") or "")
        log_public_lead_ingest_success(
            request=request,
            site=site,
            result=outcome.result,
            lead_event_id=outcome.lead_event.pk,
            normalized=normalized,
            page_key=page_key,
        )
        body = public_ingest_success_body(
            result=outcome.result,
            lead_event_id=outcome.lead_event.pk,
        )
        http_status = (
            status.HTTP_201_CREATED
            if outcome.result == "created"
            else status.HTTP_200_OK
        )
        has_email = bool((normalized.get("customer_email") or "").strip())
        has_phone = bool((normalized.get("customer_phone") or "").strip())
        record_public_lead_ingest_audit(
            site=site,
            request=request,
            event_name="lead_submitted",
            public_code=outcome.result,
            http_status=http_status,
            lead_event=outcome.lead_event,
            form_id=(normalized.get("form_id") or "")[:255],
            page_key=page_key,
            submission_stage_snapshot=outcome.lead_event.submission_stage,
            client_observed_outcome_snapshot=(normalized.get("client_observed_outcome") or "")[:32],
            has_email=has_email,
            has_phone=has_phone,
        )
        return Response(
            body,
            status=http_status,
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
