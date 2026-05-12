"""Admin dashboard stats: ``GET /referrals/admin/dashboard/stats/``.

Метрики: users_count, partners_count, orders_total_amount, partners_payout_amount,
platform_revenue_amount (=orders_total − partners_payout). Только paid-ордера и
approved-комиссии, currency in {"", "RUB"} (см. AdminDashboardStatsView docstring).
"""

import uuid
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import Commission, Order, PartnerProfile
from users.models import AdminSession


User = get_user_model()


URL = "/referrals/admin/dashboard/stats/"


def _elevate_admin(user):
    return AdminSession.objects.create(
        user=user,
        elevated_until=timezone.now() + timedelta(minutes=30),
        confirmed_with="development",
    )


def _make_user(email, *, is_staff=False):
    return User.objects.create_user(
        email=email,
        username=email.split("@")[0],
        password="secret123",
        is_staff=is_staff,
    )


def _make_partner(*, email, ref_code):
    user = _make_user(email)
    return PartnerProfile.objects.create(user=user, ref_code=ref_code)


def _make_order(*, partner=None, status="pending", amount="100.00", currency="RUB"):
    return Order.objects.create(
        dedupe_key=f"tilda:{uuid.uuid4().hex}",
        payload_fingerprint=uuid.uuid4().hex,
        partner=partner,
        status=status,
        amount=Decimal(amount),
        currency=currency,
        raw_payload={"sample": "payload"},
    )


def _make_commission(*, partner, order, status="pending", amount="10.00"):
    return Commission.objects.create(
        partner=partner,
        order=order,
        base_amount=order.amount,
        commission_percent=Decimal("10.00"),
        commission_amount=Decimal(amount),
        status=status,
    )


class AdminDashboardStatsApiTests(TestCase):
    def setUp(self):
        self.staff = _make_user("admin-dashboard-staff@example.com", is_staff=True)
        _elevate_admin(self.staff)

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    # ---- access ------------------------------------------------------------

    def test_anonymous_is_unauthorized(self):
        api = APIClient()
        r = api.get(URL)
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        regular = _make_user("regular-user@example.com")
        api = APIClient()
        api.force_authenticate(regular)
        r = api.get(URL)
        self.assertEqual(r.status_code, 403)

    def test_staff_without_elevated_session_blocked_with_mfa_code(self):
        bare_staff = _make_user("admin-dashboard-bare@example.com", is_staff=True)
        api = APIClient()
        api.force_authenticate(bare_staff)
        r = api.get(URL)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    # ---- empty DB ----------------------------------------------------------

    def test_empty_db_returns_zero_values(self):
        api = self._staff_api()
        r = api.get(URL)
        self.assertEqual(r.status_code, 200)
        # staff из setUp уже один пользователь; партнёров нет.
        self.assertEqual(r.data["users_count"], 1)
        self.assertEqual(r.data["partners_count"], 0)
        self.assertEqual(r.data["orders_total_amount"], "0.00")
        self.assertEqual(r.data["partners_payout_amount"], "0.00")
        self.assertEqual(r.data["platform_revenue_amount"], "0.00")
        self.assertEqual(r.data["platform_revenue_currency"], "RUB")

    # ---- happy path --------------------------------------------------------

    def test_aggregates_paid_orders_and_approved_commissions(self):
        _make_user("u1@example.com")
        _make_user("u2@example.com")
        partner1 = _make_partner(email="p1@example.com", ref_code="P1")
        partner2 = _make_partner(email="p2@example.com", ref_code="P2")

        paid_order_a = _make_order(partner=partner1, status="paid", amount="100.00")
        paid_order_b = _make_order(partner=partner2, status="paid", amount="200.00")
        # эти не должны учитываться
        _make_order(partner=partner1, status="pending", amount="999.00")
        _make_order(partner=partner2, status="cancelled", amount="777.00")

        _make_commission(
            partner=partner1, order=paid_order_a, status="approved", amount="10.00"
        )
        _make_commission(
            partner=partner2, order=paid_order_b, status="approved", amount="20.00"
        )

        api = self._staff_api()
        r = api.get(URL)
        self.assertEqual(r.status_code, 200)

        # users: staff (setUp) + u1 + u2 + 2 partner-users = 5.
        self.assertEqual(r.data["users_count"], 5)
        self.assertEqual(r.data["partners_count"], 2)
        self.assertEqual(r.data["orders_total_amount"], "300.00")
        self.assertEqual(r.data["partners_payout_amount"], "30.00")
        self.assertEqual(r.data["platform_revenue_amount"], "270.00")
        self.assertEqual(r.data["platform_revenue_currency"], "RUB")

    def test_ignores_non_rub_orders_and_unapproved_commissions(self):
        partner = _make_partner(email="px@example.com", ref_code="PX")

        # RUB paid: учитываем оба (currency=""/"RUB" — fallback).
        rub_order = _make_order(partner=partner, status="paid", amount="100.00", currency="RUB")
        empty_order = _make_order(partner=partner, status="paid", amount="50.00", currency="")

        # USD paid: игнорируем по валютной стратегии MVP.
        usd_order = _make_order(partner=partner, status="paid", amount="9999.00", currency="USD")

        # approved-commission на RUB-order — в подсчёте partners_payout.
        _make_commission(partner=partner, order=rub_order, status="approved", amount="10.00")
        # pending-commission — не учитываем.
        _make_commission(partner=partner, order=empty_order, status="pending", amount="5.00")
        # approved-commission на USD-order — отфильтрована по currency.
        _make_commission(partner=partner, order=usd_order, status="approved", amount="900.00")

        api = self._staff_api()
        r = api.get(URL)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["orders_total_amount"], "150.00")
        self.assertEqual(r.data["partners_payout_amount"], "10.00")
        self.assertEqual(r.data["platform_revenue_amount"], "140.00")
