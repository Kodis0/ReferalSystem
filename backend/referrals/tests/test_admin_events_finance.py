"""Шаг 11: read-only admin-обзор Order/Commission/ReferralLeadEvent/PublicLeadIngestAudit
через ``/referrals/admin/{orders,commissions,lead-events,ingest-audits}/``.

Проверяем access-контроль (anonymous/non-staff/staff-без-elevation) + базовый
list/detail + хотя бы один фильтр + cap пагинации page_size=100. Никаких write-actions.
"""

import uuid
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import (
    Commission,
    Order,
    PartnerProfile,
    PublicLeadIngestAudit,
    ReferralLeadEvent,
    Site,
)
from users.models import AdminSession


User = get_user_model()


def _elevate_admin(user):
    """Активная step-up admin-сессия (inline-копия helper'а из test_admin_partners)."""
    return AdminSession.objects.create(
        user=user,
        elevated_until=timezone.now() + timedelta(minutes=30),
        confirmed_with="development",
    )


def _make_user(email: str, *, is_staff: bool = False):
    return User.objects.create_user(
        email=email,
        username=email.split("@")[0],
        password="secret123",
        is_staff=is_staff,
    )


def _make_partner(*, email: str, ref_code: str):
    user = _make_user(email)
    return PartnerProfile.objects.create(user=user, ref_code=ref_code)


def _make_site(*, owner):
    return Site.objects.create(
        owner=owner,
        publishable_key=f"pk_admin_evf_{uuid.uuid4().hex}",
        allowed_origins=["https://example.test"],
        platform_preset=Site.PlatformPreset.TILDA,
    )


def _make_order(*, partner=None, site=None, status="pending", external_id="", amount="100.00"):
    return Order.objects.create(
        dedupe_key=f"tilda:{uuid.uuid4().hex}",
        external_id=external_id or "",
        payload_fingerprint=uuid.uuid4().hex,
        partner=partner,
        site=site,
        status=status,
        amount=Decimal(amount),
        currency="RUB",
        raw_payload={"sample": "payload", "external_id": external_id or ""},
    )


def _make_commission(*, partner, order, status="pending"):
    return Commission.objects.create(
        partner=partner,
        order=order,
        base_amount=Decimal("100.00"),
        commission_percent=Decimal("10.00"),
        commission_amount=Decimal("10.00"),
        status=status,
    )


def _make_lead_event(*, site, partner=None, customer_email="", form_id=""):
    return ReferralLeadEvent.objects.create(
        site=site,
        partner=partner,
        customer_email=customer_email,
        form_id=form_id,
        raw_payload={"form_id": form_id, "stage": "submit_attempt"},
    )


def _make_ingest_audit(*, site, public_code="ok", http_status=200, event_name="lead_submitted"):
    return PublicLeadIngestAudit.objects.create(
        site=site,
        event_name=event_name,
        public_code=public_code,
        http_status=http_status,
    )


# =============================================================================
# Orders
# =============================================================================


class AdminOrdersListApiTests(TestCase):
    URL = "/referrals/admin/orders/"

    def setUp(self):
        self.staff = _make_user("admin-orders-staff@example.com", is_staff=True)
        _elevate_admin(self.staff)

        self.partner_a = _make_partner(email="partner-a@example.com", ref_code="PA01")
        self.partner_b = _make_partner(email="partner-b@example.com", ref_code="PB01")
        self.site_a = _make_site(owner=self.partner_a.user)

        self.order_a = _make_order(
            partner=self.partner_a, site=self.site_a, status="paid",
            external_id="ORD-A-1",
        )
        self.order_b = _make_order(
            partner=self.partner_b, status="pending", external_id="ORD-B-1",
        )

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    def test_anonymous_is_unauthorized(self):
        api = APIClient()
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.partner_a.user)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare = _make_user("admin-orders-bare@example.com", is_staff=True)
        api = APIClient()
        api.force_authenticate(bare)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    def test_staff_gets_paginated_list_with_expected_fields(self):
        api = self._staff_api()
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertIn("results", r.data)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.order_a.id, ids)
        first = next(row for row in r.data["results"] if row["id"] == self.order_a.id)
        for key in (
            "id", "partner_id", "partner_user_email", "site_id", "site_public_id",
            "external_id", "amount", "status", "created_at",
        ):
            self.assertIn(key, first)
        self.assertEqual(first["partner_user_email"], "partner-a@example.com")
        self.assertEqual(first["status"], "paid")

    def test_partner_id_filter(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?partner_id={self.partner_b.id}")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.order_b.id, ids)
        self.assertNotIn(self.order_a.id, ids)

    def test_status_filter(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?status=paid")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.order_a.id, ids)
        self.assertNotIn(self.order_b.id, ids)

    def test_page_size_is_capped_at_100(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?page_size=500")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["page_size"], 100)


class AdminOrderDetailApiTests(TestCase):
    def setUp(self):
        self.staff = _make_user("admin-order-detail-staff@example.com", is_staff=True)
        _elevate_admin(self.staff)
        self.partner = _make_partner(email="order-det@example.com", ref_code="OD01")
        self.order = _make_order(partner=self.partner, external_id="ORD-DET-1")

    def _url(self, oid):
        return f"/referrals/admin/orders/{oid}/"

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    def test_anonymous_is_unauthorized(self):
        r = APIClient().get(self._url(self.order.id))
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.partner.user)
        r = api.get(self._url(self.order.id))
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare = _make_user("admin-order-det-bare@example.com", is_staff=True)
        api = APIClient()
        api.force_authenticate(bare)
        r = api.get(self._url(self.order.id))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    def test_staff_gets_existing_order_detail(self):
        api = self._staff_api()
        r = api.get(self._url(self.order.id))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data["id"], self.order.id)
        self.assertEqual(r.data["external_id"], "ORD-DET-1")
        self.assertIn("raw_payload", r.data)
        self.assertEqual(r.data["partner_user_email"], "order-det@example.com")

    def test_unknown_id_returns_404(self):
        api = self._staff_api()
        r = api.get(self._url(999999))
        self.assertEqual(r.status_code, 404)


# =============================================================================
# Commissions
# =============================================================================


class AdminCommissionsListApiTests(TestCase):
    URL = "/referrals/admin/commissions/"

    def setUp(self):
        self.staff = _make_user("admin-comm-staff@example.com", is_staff=True)
        _elevate_admin(self.staff)
        self.partner_a = _make_partner(email="comm-a@example.com", ref_code="CA01")
        self.partner_b = _make_partner(email="comm-b@example.com", ref_code="CB01")
        self.order_a = _make_order(partner=self.partner_a, status="paid")
        self.order_b = _make_order(partner=self.partner_b, status="paid")
        self.commission_a = _make_commission(
            partner=self.partner_a, order=self.order_a, status="approved"
        )
        self.commission_b = _make_commission(
            partner=self.partner_b, order=self.order_b, status="pending"
        )

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    def test_anonymous_is_unauthorized(self):
        r = APIClient().get(self.URL)
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.partner_a.user)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare = _make_user("admin-comm-bare@example.com", is_staff=True)
        api = APIClient()
        api.force_authenticate(bare)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    def test_staff_gets_list_with_expected_fields(self):
        api = self._staff_api()
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.commission_a.id, ids)
        first = next(
            row for row in r.data["results"] if row["id"] == self.commission_a.id
        )
        for key in (
            "id", "partner_id", "partner_user_email", "order_id",
            "commission_amount", "status", "created_at",
        ):
            self.assertIn(key, first)
        self.assertEqual(first["partner_user_email"], "comm-a@example.com")

    def test_status_filter(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?status=approved")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.commission_a.id, ids)
        self.assertNotIn(self.commission_b.id, ids)

    def test_page_size_is_capped_at_100(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?page_size=500")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["page_size"], 100)


class AdminCommissionDetailApiTests(TestCase):
    def setUp(self):
        self.staff = _make_user("admin-comm-det-staff@example.com", is_staff=True)
        _elevate_admin(self.staff)
        self.partner = _make_partner(email="comm-det@example.com", ref_code="CD01")
        self.order = _make_order(partner=self.partner, status="paid")
        self.commission = _make_commission(partner=self.partner, order=self.order)

    def _url(self, cid):
        return f"/referrals/admin/commissions/{cid}/"

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    def test_anonymous_is_unauthorized(self):
        r = APIClient().get(self._url(self.commission.id))
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.partner.user)
        r = api.get(self._url(self.commission.id))
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare = _make_user("admin-comm-det-bare@example.com", is_staff=True)
        api = APIClient()
        api.force_authenticate(bare)
        r = api.get(self._url(self.commission.id))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    def test_staff_gets_existing_commission_detail(self):
        api = self._staff_api()
        r = api.get(self._url(self.commission.id))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data["id"], self.commission.id)
        self.assertEqual(r.data["partner_user_email"], "comm-det@example.com")
        self.assertEqual(r.data["order_id"], self.order.id)
        self.assertEqual(r.data["order_status"], "paid")

    def test_unknown_id_returns_404(self):
        api = self._staff_api()
        r = api.get(self._url(999999))
        self.assertEqual(r.status_code, 404)


# =============================================================================
# Lead events
# =============================================================================


class AdminLeadEventsListApiTests(TestCase):
    URL = "/referrals/admin/lead-events/"

    def setUp(self):
        self.staff = _make_user("admin-leads-staff@example.com", is_staff=True)
        _elevate_admin(self.staff)
        self.owner = _make_user("leads-owner@example.com")
        self.other_owner = _make_user("leads-other@example.com")
        self.site_a = _make_site(owner=self.owner)
        self.site_b = _make_site(owner=self.other_owner)
        self.event_a = _make_lead_event(site=self.site_a, customer_email="alice@example.com", form_id="fa")
        self.event_b = _make_lead_event(site=self.site_b, customer_email="bob@example.com", form_id="fb")

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    def test_anonymous_is_unauthorized(self):
        r = APIClient().get(self.URL)
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.owner)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare = _make_user("admin-leads-bare@example.com", is_staff=True)
        api = APIClient()
        api.force_authenticate(bare)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    def test_staff_gets_list_with_expected_fields(self):
        api = self._staff_api()
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.event_a.id, ids)
        first = next(row for row in r.data["results"] if row["id"] == self.event_a.id)
        for key in (
            "id", "site_id", "site_public_id", "event_type",
            "submission_stage", "form_id", "created_at",
        ):
            self.assertIn(key, first)

    def test_site_id_filter(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?site_id={self.site_b.id}")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.event_b.id, ids)
        self.assertNotIn(self.event_a.id, ids)

    def test_page_size_is_capped_at_100(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?page_size=500")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["page_size"], 100)


class AdminLeadEventDetailApiTests(TestCase):
    def setUp(self):
        self.staff = _make_user("admin-lead-det-staff@example.com", is_staff=True)
        _elevate_admin(self.staff)
        self.owner = _make_user("lead-det-owner@example.com")
        self.site = _make_site(owner=self.owner)
        self.event = _make_lead_event(
            site=self.site, customer_email="lead-customer@example.com", form_id="form42"
        )

    def _url(self, eid):
        return f"/referrals/admin/lead-events/{eid}/"

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    def test_anonymous_is_unauthorized(self):
        r = APIClient().get(self._url(self.event.id))
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.owner)
        r = api.get(self._url(self.event.id))
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare = _make_user("admin-lead-det-bare@example.com", is_staff=True)
        api = APIClient()
        api.force_authenticate(bare)
        r = api.get(self._url(self.event.id))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    def test_staff_gets_existing_lead_event_detail(self):
        api = self._staff_api()
        r = api.get(self._url(self.event.id))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data["id"], self.event.id)
        self.assertEqual(r.data["customer_email"], "lead-customer@example.com")
        self.assertIn("raw_payload", r.data)

    def test_unknown_id_returns_404(self):
        api = self._staff_api()
        r = api.get(self._url(999999))
        self.assertEqual(r.status_code, 404)


# =============================================================================
# Ingest audits
# =============================================================================


class AdminIngestAuditsListApiTests(TestCase):
    URL = "/referrals/admin/ingest-audits/"

    def setUp(self):
        self.staff = _make_user("admin-audits-staff@example.com", is_staff=True)
        _elevate_admin(self.staff)
        self.owner = _make_user("audit-owner@example.com")
        self.site_a = _make_site(owner=self.owner)
        self.site_b = _make_site(owner=self.owner)
        self.audit_a = _make_ingest_audit(site=self.site_a, public_code="ok", http_status=200)
        self.audit_b = _make_ingest_audit(site=self.site_b, public_code="invalid_payload", http_status=400)

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    def test_anonymous_is_unauthorized(self):
        r = APIClient().get(self.URL)
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.owner)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare = _make_user("admin-audits-bare@example.com", is_staff=True)
        api = APIClient()
        api.force_authenticate(bare)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    def test_staff_gets_list_with_expected_fields(self):
        api = self._staff_api()
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.audit_a.id, ids)
        first = next(row for row in r.data["results"] if row["id"] == self.audit_a.id)
        for key in (
            "id", "site_id", "site_public_id", "public_code",
            "http_status", "event_name", "created_at",
        ):
            self.assertIn(key, first)

    def test_public_code_filter(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?public_code=invalid_payload")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.audit_b.id, ids)
        self.assertNotIn(self.audit_a.id, ids)

    def test_page_size_is_capped_at_100(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?page_size=500")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["page_size"], 100)


class AdminIngestAuditDetailApiTests(TestCase):
    def setUp(self):
        self.staff = _make_user("admin-audit-det-staff@example.com", is_staff=True)
        _elevate_admin(self.staff)
        self.owner = _make_user("audit-det-owner@example.com")
        self.site = _make_site(owner=self.owner)
        self.audit = _make_ingest_audit(site=self.site, public_code="ok", http_status=200)

    def _url(self, aid):
        return f"/referrals/admin/ingest-audits/{aid}/"

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    def test_anonymous_is_unauthorized(self):
        r = APIClient().get(self._url(self.audit.id))
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.owner)
        r = api.get(self._url(self.audit.id))
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare = _make_user("admin-audit-det-bare@example.com", is_staff=True)
        api = APIClient()
        api.force_authenticate(bare)
        r = api.get(self._url(self.audit.id))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    def test_staff_gets_existing_audit_detail(self):
        api = self._staff_api()
        r = api.get(self._url(self.audit.id))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data["id"], self.audit.id)
        self.assertEqual(r.data["public_code"], "ok")
        self.assertEqual(r.data["http_status"], 200)
        self.assertIn("submission_stage_snapshot", r.data)

    def test_unknown_id_returns_404(self):
        api = self._staff_api()
        r = api.get(self._url(999999))
        self.assertEqual(r.status_code, 404)
