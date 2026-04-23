import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import (
    Commission,
    Order,
    Project,
    ReferralLeadEvent,
    ReferralVisit,
    Site,
    SiteMembership,
)
from referrals.services import ensure_partner_profile

User = get_user_model()


class SiteOwnerAnalyticsApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username="owner_analytics",
            email="owner-analytics@example.com",
            password="secret12",
        )
        self.ref_user = User.objects.create_user(
            username="ref_partner_analytics",
            email="ref-analytics@example.com",
            password="secret12",
        )
        self.api = APIClient()

    def _site_and_partner(self):
        project = Project.objects.create(owner=self.owner, name="P")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_analytics_" + uuid.uuid4().hex[:16],
            allowed_origins=["https://shop.example"],
        )
        partner, _created = ensure_partner_profile(self.ref_user)
        SiteMembership.objects.create(site=site, user=self.ref_user, partner=partner, ref_code=partner.ref_code)
        return site, partner

    def test_analytics_requires_auth(self):
        r = self.api.get("/referrals/site/integration/analytics/")
        self.assertEqual(r.status_code, 401)

    def test_analytics_7d_payload_shape(self):
        site, partner = self._site_and_partner()
        now = timezone.now()
        ReferralVisit.objects.create(partner=partner, ref_code=partner.ref_code, landing_url="https://x/a")
        ReferralLeadEvent.objects.create(site=site, partner=partner, ref_code=partner.ref_code, page_url="https://x/f")
        order = Order.objects.create(
            partner=partner,
            ref_code=partner.ref_code,
            dedupe_key="tilda:analytics-test-1",
            payload_fingerprint="a" * 64,
            amount=Decimal("100.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=now,
        )
        Commission.objects.create(
            partner=partner,
            order=order,
            base_amount=Decimal("100.00"),
            commission_percent=Decimal("10.00"),
            commission_amount=Decimal("10.00"),
        )

        self.api.force_authenticate(self.owner)
        url = f"/referrals/site/integration/analytics/?site_public_id={site.public_id}&period=7d"
        r = self.api.get(url)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["period"], "7d")
        self.assertEqual(r.data["kpis"]["referrals_count"], 1)
        self.assertEqual(r.data["kpis"]["visits_count"], 1)
        self.assertEqual(r.data["kpis"]["leads_count"], 1)
        self.assertEqual(r.data["kpis"]["sales_count"], 1)
        self.assertEqual(r.data["kpis"]["sales_amount"], "100.00")
        self.assertEqual(r.data["kpis"]["commissions_total"], "10.00")
        self.assertEqual(r.data["funnel"]["visits"], 1)
        self.assertEqual(r.data["funnel"]["leads"], 1)
        self.assertEqual(r.data["funnel"]["sales"], 1)
        self.assertTrue(isinstance(r.data["series"]["by_day"], list))
        self.assertGreaterEqual(len(r.data["series"]["by_day"]), 1)
        self.assertEqual(len(r.data["recent_sales"]), 1)
        self.assertEqual(r.data["recent_sales"][0]["amount"], "100.00")

    def test_analytics_stranger_forbidden(self):
        site, _ = self._site_and_partner()
        stranger = User.objects.create_user(
            username="stranger_analytics",
            email="stranger-analytics@example.com",
            password="secret12",
        )
        self.api.force_authenticate(stranger)
        url = f"/referrals/site/integration/analytics/?site_public_id={site.public_id}"
        r = self.api.get(url)
        self.assertEqual(r.status_code, 404)

    def test_analytics_empty_site(self):
        project = Project.objects.create(owner=self.owner, name="Empty")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_analytics_empty_" + uuid.uuid4().hex[:12],
            allowed_origins=["https://empty.example"],
        )
        self.api.force_authenticate(self.owner)
        url = f"/referrals/site/integration/analytics/?site_public_id={site.public_id}&period=all"
        r = self.api.get(url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["kpis"]["referrals_count"], 0)
        self.assertEqual(r.data["kpis"]["visits_count"], 0)
        self.assertEqual(r.data["kpis"]["sales_count"], 0)
        self.assertEqual(r.data["recent_sales"], [])
