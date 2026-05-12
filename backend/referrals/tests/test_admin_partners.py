"""Шаг 8: модерация PartnerProfile через `/referrals/admin/partners/...`."""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import PartnerProfile
from users.models import AdminActionAudit, AdminSession


User = get_user_model()


def _elevate_admin(user):
    """Минимальная inline-копия helper'а из users.tests: активная step-up admin-сессия."""
    return AdminSession.objects.create(
        user=user,
        elevated_until=timezone.now() + timedelta(minutes=30),
        confirmed_with="development",
    )


def _make_partner(*, email: str, ref_code: str, status: str = "pending", **profile_kwargs):
    user = User.objects.create_user(
        email=email,
        username=email.split("@")[0],
        password="secret123",
    )
    return PartnerProfile.objects.create(
        user=user, ref_code=ref_code, status=status, **profile_kwargs
    )


class AdminPartnersListApiTests(TestCase):
    """``GET /referrals/admin/partners/`` — список + фильтры + пагинация."""

    URL = "/referrals/admin/partners/"

    def setUp(self):
        self.staff = User.objects.create_user(
            email="admin-partners-staff@example.com",
            username="adminpartnersstaff",
            password="secret123",
            is_staff=True,
        )
        _elevate_admin(self.staff)

        self.partner_alice = _make_partner(
            email="alice@example.com",
            ref_code="ALICE01",
            status="pending",
            balance_available=Decimal("1.25"),
            balance_total=Decimal("3.50"),
            commission_percent=Decimal("12.00"),
        )
        self.partner_bob = _make_partner(
            email="bob@example.com",
            ref_code="BOB001",
            status="active",
        )
        self.partner_charlie = _make_partner(
            email="charlie@example.com",
            ref_code="CHA001",
            status="blocked",
        )

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    # ---- access ------------------------------------------------------------

    def test_anonymous_is_unauthorized(self):
        api = APIClient()
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.partner_alice.user)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare_staff = User.objects.create_user(
            email="admin-partners-bare-staff@example.com",
            username="adminpartnersbarestaff",
            password="secret123",
            is_staff=True,
        )
        api = APIClient()
        api.force_authenticate(bare_staff)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    # ---- happy paths -------------------------------------------------------

    def test_staff_gets_paginated_list(self):
        api = self._staff_api()
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 200)
        self.assertIn("results", r.data)
        self.assertIn("count", r.data)
        self.assertEqual(r.data["page"], 1)
        self.assertEqual(r.data["page_size"], 20)
        self.assertGreaterEqual(r.data["count"], 3)
        first = r.data["results"][0]
        for key in (
            "id",
            "user_id",
            "user_email",
            "status",
            "balance_available",
            "balance_total",
            "commission_percent",
        ):
            self.assertIn(key, first)

    def test_q_filters_by_user_email(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?q=alice@")
        self.assertEqual(r.status_code, 200)
        emails = [row["user_email"] for row in r.data["results"]]
        self.assertEqual(emails, ["alice@example.com"])

    def test_status_filter_returns_only_pending(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?status=pending")
        self.assertEqual(r.status_code, 200)
        statuses = {row["status"] for row in r.data["results"]}
        self.assertEqual(statuses, {"pending"})
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.partner_alice.id, ids)
        self.assertNotIn(self.partner_bob.id, ids)

    def test_unknown_status_filter_is_ignored(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?status=garbage")
        self.assertEqual(r.status_code, 200)
        # Полный список (фильтр проигнорирован).
        self.assertGreaterEqual(r.data["count"], 3)

    def test_page_size_is_capped_at_100(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?page_size=500")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["page_size"], 100)


class AdminPartnerDetailApiTests(TestCase):
    """``GET /referrals/admin/partners/<id>/`` — детали + counts."""

    def setUp(self):
        self.staff = User.objects.create_user(
            email="admin-partner-detail-staff@example.com",
            username="adminpartnerdetailstaff",
            password="secret123",
            is_staff=True,
        )
        _elevate_admin(self.staff)
        self.partner = _make_partner(
            email="alice-detail@example.com",
            ref_code="ALCD01",
            status="pending",
        )

    def _url(self, partner_id):
        return f"/referrals/admin/partners/{partner_id}/"

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    # ---- access ------------------------------------------------------------

    def test_anonymous_is_unauthorized(self):
        api = APIClient()
        r = api.get(self._url(self.partner.id))
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.partner.user)
        r = api.get(self._url(self.partner.id))
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare_staff = User.objects.create_user(
            email="admin-partner-detail-bare@example.com",
            username="adminpartnerdetailbare",
            password="secret123",
            is_staff=True,
        )
        api = APIClient()
        api.force_authenticate(bare_staff)
        r = api.get(self._url(self.partner.id))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    # ---- happy paths -------------------------------------------------------

    def test_staff_gets_existing_partner_detail(self):
        api = self._staff_api()
        r = api.get(self._url(self.partner.id))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        for key in (
            "id",
            "user_id",
            "user_email",
            "status",
            "balance_available",
            "balance_total",
            "commission_percent",
            "user_public_id",
            "user_fio",
            "user_phone",
            "account_type",
            "owned_projects_count",
            "owned_sites_count",
            "commissions_count",
            "orders_count",
        ):
            self.assertIn(key, r.data)
        self.assertEqual(r.data["id"], self.partner.id)
        self.assertEqual(r.data["user_email"], "alice-detail@example.com")
        self.assertEqual(r.data["status"], "pending")
        self.assertEqual(r.data["owned_sites_count"], 0)
        self.assertEqual(r.data["commissions_count"], 0)
        self.assertEqual(r.data["orders_count"], 0)

    def test_unknown_id_returns_404(self):
        api = self._staff_api()
        r = api.get(self._url(999999))
        self.assertEqual(r.status_code, 404)


class AdminPartnerSetStatusApiTests(TestCase):
    """``PATCH /referrals/admin/partners/<id>/status/`` — единственный write-action."""

    def setUp(self):
        self.actor = User.objects.create_user(
            email="admin-partner-status-actor@example.com",
            username="adminpartnerstatusactor",
            password="secret123",
            is_staff=True,
        )
        _elevate_admin(self.actor)
        self.partner = _make_partner(
            email="patch-target@example.com",
            ref_code="PATCH1",
            status="pending",
            balance_available=Decimal("11.00"),
            balance_total=Decimal("22.00"),
            commission_percent=Decimal("9.50"),
        )

    def _url(self, partner_id):
        return f"/referrals/admin/partners/{partner_id}/status/"

    def _actor_api(self):
        api = APIClient()
        api.force_authenticate(self.actor)
        return api

    # ---- access ------------------------------------------------------------

    def test_anonymous_is_unauthorized(self):
        api = APIClient()
        r = api.patch(self._url(self.partner.id), {"status": "active"}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.partner.user)
        r = api.patch(self._url(self.partner.id), {"status": "active"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare_staff = User.objects.create_user(
            email="admin-partner-status-bare@example.com",
            username="adminpartnerstatusbare",
            password="secret123",
            is_staff=True,
        )
        api = APIClient()
        api.force_authenticate(bare_staff)
        r = api.patch(self._url(self.partner.id), {"status": "active"}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    # ---- happy paths -------------------------------------------------------

    def test_change_status_creates_audit(self):
        api = self._actor_api()
        r = api.patch(self._url(self.partner.id), {"status": "active"}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data["id"], self.partner.id)
        self.assertEqual(r.data["status"], "active")

        self.partner.refresh_from_db()
        self.assertEqual(self.partner.status, "active")

        audit = AdminActionAudit.objects.filter(
            actor=self.actor,
            action="admin.partner.status_changed",
            target_type="partner_profile",
            target_id=str(self.partner.id),
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.metadata.get("user_email"), "patch-target@example.com")
        self.assertEqual(audit.metadata.get("previous_status"), "pending")
        self.assertEqual(audit.metadata.get("new_status"), "active")

    def test_idempotent_same_status_no_audit(self):
        api = self._actor_api()
        before = AdminActionAudit.objects.count()
        r = api.patch(self._url(self.partner.id), {"status": "pending"}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.partner.refresh_from_db()
        self.assertEqual(self.partner.status, "pending")
        self.assertEqual(AdminActionAudit.objects.count(), before)

    def test_invalid_status_returns_400(self):
        api = self._actor_api()
        r = api.patch(self._url(self.partner.id), {"status": "foo"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "ADMIN_PARTNER_STATUS_INVALID")
        self.partner.refresh_from_db()
        self.assertEqual(self.partner.status, "pending")

    def test_missing_status_returns_400(self):
        api = self._actor_api()
        r = api.patch(self._url(self.partner.id), {}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "ADMIN_PARTNER_STATUS_INVALID")

    def test_unknown_partner_returns_404(self):
        api = self._actor_api()
        r = api.patch(self._url(999999), {"status": "active"}, format="json")
        self.assertEqual(r.status_code, 404)

    def test_does_not_change_commission_or_balance(self):
        api = self._actor_api()
        before_commission = self.partner.commission_percent
        before_available = self.partner.balance_available
        before_total = self.partner.balance_total

        r = api.patch(self._url(self.partner.id), {"status": "blocked"}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))

        self.partner.refresh_from_db()
        self.assertEqual(self.partner.status, "blocked")
        self.assertEqual(self.partner.commission_percent, before_commission)
        self.assertEqual(self.partner.balance_available, before_available)
        self.assertEqual(self.partner.balance_total, before_total)
