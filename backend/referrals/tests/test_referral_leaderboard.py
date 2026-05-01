import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone as dj_timezone

from referrals.gamification import build_gamification_leaderboard
from referrals.models import Order
from referrals.services import ensure_partner_profile
from rest_framework.test import APIClient

User = get_user_model()


def _mk_order(*, partner, amount: Decimal, currency: str, status: str, paid_at):
    return Order.objects.create(
        dedupe_key=f"t:lb-{uuid.uuid4().hex}",
        source=Order.Source.TILDA,
        external_id=f"ext-{uuid.uuid4().hex[:8]}",
        payload_fingerprint=uuid.uuid4().hex[:64],
        partner=partner,
        amount=amount,
        currency=currency,
        status=status,
        paid_at=paid_at,
    )


class ReferralLeaderboardAggregationTests(TestCase):
    """build_gamification_leaderboard: paid RUB orders, periods, sort, privacy."""

    def setUp(self):
        self.user_a = User.objects.create_user(username="pa", email="a@example.com", password="x")
        self.user_b = User.objects.create_user(username="pb", email="b@example.com", password="x")
        self.user_c = User.objects.create_user(username="pc", email="c@example.com", password="x")
        self.partner_a, _ = ensure_partner_profile(self.user_a)
        self.partner_b, _ = ensure_partner_profile(self.user_b)
        self.partner_c, _ = ensure_partner_profile(self.user_c)

    def test_counts_only_paid_rub_orders(self):
        now = dj_timezone.now()
        _mk_order(
            partner=self.partner_a,
            amount=Decimal("100.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=now,
        )
        _mk_order(
            partner=self.partner_a,
            amount=Decimal("999.00"),
            currency="RUB",
            status=Order.Status.PENDING,
            paid_at=now,
        )
        out = build_gamification_leaderboard(self.user_a, "all", now=now)
        self.assertFalse(out["leaderboard_empty"])
        row_a = next(e for e in out["entries"] if e["user_id"] == self.user_a.id)
        self.assertEqual(row_a["sales_amount"], 100)
        self.assertEqual(row_a["paid_orders_count"], 1)

    def test_excludes_non_rub_currency(self):
        now = dj_timezone.now()
        _mk_order(
            partner=self.partner_a,
            amount=Decimal("50.00"),
            currency="USD",
            status=Order.Status.PAID,
            paid_at=now,
        )
        out = build_gamification_leaderboard(self.user_a, "all", now=now)
        self.assertTrue(out["leaderboard_empty"])

    def test_sort_sales_then_orders_then_xp(self):
        from referrals.models import GamificationProfile

        now = dj_timezone.now()
        GamificationProfile.objects.create(user=self.user_a, xp_total=50, streak_days=1)
        GamificationProfile.objects.create(user=self.user_b, xp_total=200, streak_days=1)
        GamificationProfile.objects.create(user=self.user_c, xp_total=200, streak_days=1)

        _mk_order(
            partner=self.partner_a,
            amount=Decimal("300.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=now,
        )
        _mk_order(
            partner=self.partner_b,
            amount=Decimal("100.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=now,
        )
        _mk_order(
            partner=self.partner_b,
            amount=Decimal("100.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=now,
        )
        _mk_order(
            partner=self.partner_c,
            amount=Decimal("100.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=now,
        )

        out = build_gamification_leaderboard(self.user_a, "all", now=now)
        ids = [e["user_id"] for e in out["entries"]]
        self.assertEqual(ids[0], self.user_a.id)
        self.assertEqual(ids[1], self.user_b.id)
        self.assertEqual(ids[2], self.user_c.id)
        b_entry = next(e for e in out["entries"] if e["user_id"] == self.user_b.id)
        c_entry = next(e for e in out["entries"] if e["user_id"] == self.user_c.id)
        self.assertGreater(b_entry["paid_orders_count"], c_entry["paid_orders_count"])

    def test_period_month_filters_paid_at(self):
        fixed = dj_timezone.make_aware(datetime(2026, 6, 15, 12, 0, 0))
        may_end = dj_timezone.make_aware(datetime(2026, 5, 31, 23, 0, 0))
        june_mid = dj_timezone.make_aware(datetime(2026, 6, 10, 10, 0, 0))

        _mk_order(
            partner=self.partner_a,
            amount=Decimal("500.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=may_end,
        )
        _mk_order(
            partner=self.partner_a,
            amount=Decimal("100.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=june_mid,
        )

        out_m = build_gamification_leaderboard(self.user_a, "month", now=fixed)
        self.assertFalse(out_m["leaderboard_empty"])
        row = next(e for e in out_m["entries"] if e["user_id"] == self.user_a.id)
        self.assertEqual(row["sales_amount"], 100)

        out_all = build_gamification_leaderboard(self.user_a, "all", now=fixed)
        row_all = next(e for e in out_all["entries"] if e["user_id"] == self.user_a.id)
        self.assertEqual(row_all["sales_amount"], 600)

    def test_current_user_even_when_last_rank(self):
        now = dj_timezone.now()
        _mk_order(
            partner=self.partner_a,
            amount=Decimal("300.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=now,
        )
        _mk_order(
            partner=self.partner_b,
            amount=Decimal("100.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=now,
        )

        out = build_gamification_leaderboard(self.user_b, "all", now=now)
        cu = out["current_user"]
        self.assertEqual(cu["rank"], 2)
        self.assertEqual(cu["sales_amount"], 100)

    def test_display_names_do_not_include_at_sign(self):
        now = dj_timezone.now()
        u_email = User.objects.create_user(username="onlyemail@z.com", email="onlyemail@z.com", password="x")
        p_email, _ = ensure_partner_profile(u_email)
        _mk_order(
            partner=p_email,
            amount=Decimal("10.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=now,
        )
        out = build_gamification_leaderboard(u_email, "all", now=now)
        for e in out["entries"]:
            self.assertNotIn("@", e["display_name"])

    def test_period_week_excludes_orders_older_than_seven_days(self):
        fixed = dj_timezone.make_aware(datetime(2026, 6, 15, 12, 0, 0))
        old_paid_at = fixed - timedelta(days=10)
        _mk_order(
            partner=self.partner_a,
            amount=Decimal("999.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=old_paid_at,
        )
        out = build_gamification_leaderboard(self.user_a, "week", now=fixed)
        self.assertTrue(out["leaderboard_empty"])

    def test_invalid_period_raises(self):
        with self.assertRaises(ValueError):
            build_gamification_leaderboard(self.user_a, "quarter")


class ReferralLeaderboardApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="apiu", email="apiu@example.com", password="x")
        self.partner, _ = ensure_partner_profile(self.user)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_get_leaderboard_default_month(self):
        now = dj_timezone.now()
        _mk_order(
            partner=self.partner,
            amount=Decimal("50.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=now,
        )
        r = self.client.get("/referrals/gamification/leaderboard/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["period"], "month")
        self.assertIn("entries", body)
        self.assertIn("current_user", body)
        self.assertFalse(body["leaderboard_empty"])

    def test_invalid_period_400(self):
        r = self.client.get("/referrals/gamification/leaderboard/", {"period": "yesterday"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json().get("code"), "invalid_period")
