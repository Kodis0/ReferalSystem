import json
import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from referrals.models import ReferralLeadEvent, Site
from referrals.services import (
    ensure_partner_profile,
    mask_email_for_partner_dashboard,
    page_path_for_partner_dashboard,
    partner_dashboard_payload,
)

User = get_user_model()


class PartnerDashboardLeadsTests(TestCase):
    """Partner dashboard recent_leads: minimal fields only (masked email, path, amount)."""

    def setUp(self):
        self.owner = User.objects.create_user(
            username="siteowner",
            email="owner-leads@example.com",
            password="secret12",
        )
        self.partner_a_user = User.objects.create_user(
            username="partner_a",
            email="partner-a@example.com",
            password="secret12",
        )
        self.partner_b_user = User.objects.create_user(
            username="partner_b",
            email="partner-b@example.com",
            password="secret12",
        )
        self.partner_a, _ = ensure_partner_profile(self.partner_a_user)
        self.partner_b, _ = ensure_partner_profile(self.partner_b_user)
        self.site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_" + uuid.uuid4().hex,
            allowed_origins=["https://landing.example"],
        )

    def test_partner_dashboard_payload_leads_empty(self):
        dash = partner_dashboard_payload(
            self.partner_a, app_public_base_url="https://app.example.com"
        )
        self.assertEqual(dash["total_leads_count"], 0)
        self.assertEqual(dash["recent_leads"], [])

    def test_partner_dashboard_payload_leads_scoped_to_partner(self):
        ReferralLeadEvent.objects.create(
            site=self.site,
            partner=self.partner_a,
            customer_name="Alice",
            customer_email="alice@example.com",
            customer_phone="+100",
            page_url="https://landing.example/a?utm=1",
            form_id="form-a",
            amount=Decimal("10.50"),
            currency="USD",
        )
        ReferralLeadEvent.objects.create(
            site=self.site,
            partner=self.partner_b,
            customer_name="Bob",
            customer_email="bob@example.com",
            customer_phone="+200",
            page_url="https://landing.example/b",
            form_id="form-b",
            amount=Decimal("20.00"),
            currency="EUR",
        )
        dash_a = partner_dashboard_payload(
            self.partner_a, app_public_base_url="https://app.example.com"
        )
        dash_b = partner_dashboard_payload(
            self.partner_b, app_public_base_url="https://app.example.com"
        )
        self.assertEqual(dash_a["total_leads_count"], 1)
        self.assertEqual(len(dash_a["recent_leads"]), 1)
        row_a = dash_a["recent_leads"][0]
        self.assertEqual(row_a["customer_email_masked"], "a***@example.com")
        self.assertEqual(row_a["page_path"], "/a")
        self.assertEqual(row_a["amount"], "10.50")
        self.assertEqual(row_a["currency"], "USD")
        self.assertIn("created_at", row_a)
        for forbidden in (
            "customer_name",
            "customer_phone",
            "customer_email",
            "page_url",
            "form_id",
        ):
            self.assertNotIn(forbidden, row_a)
        leads_json = json.dumps(dash_a["recent_leads"], default=str)
        self.assertNotIn("alice@example.com", leads_json)
        self.assertNotIn("Alice", leads_json)
        self.assertNotIn("+100", leads_json)
        self.assertNotIn("utm=1", leads_json)

        self.assertEqual(dash_b["total_leads_count"], 1)
        self.assertEqual(dash_b["recent_leads"][0]["customer_email_masked"], "b***@example.com")

    def test_mask_email_for_partner_dashboard(self):
        self.assertEqual(
            mask_email_for_partner_dashboard("alice@Example.com"),
            "a***@example.com",
        )
        self.assertIsNone(mask_email_for_partner_dashboard(""))
        self.assertIsNone(mask_email_for_partner_dashboard("not-an-email"))
        self.assertEqual(mask_email_for_partner_dashboard("a@b.co"), "*@b.co")

    def test_page_path_for_partner_dashboard_strips_query(self):
        self.assertEqual(
            page_path_for_partner_dashboard(
                "https://shop.example/p/x?token=secret&other=1"
            ),
            "/p/x",
        )

    def test_partner_dashboard_excludes_unattributed_leads(self):
        ReferralLeadEvent.objects.create(
            site=self.site,
            partner=None,
            customer_email="orphan@example.com",
        )
        dash = partner_dashboard_payload(
            self.partner_a, app_public_base_url="https://app.example.com"
        )
        self.assertEqual(dash["total_leads_count"], 0)
        self.assertEqual(dash["recent_leads"], [])

    def test_partner_dashboard_lead_amount_null_serialized(self):
        ReferralLeadEvent.objects.create(
            site=self.site,
            partner=self.partner_a,
            customer_email="noamt@example.com",
            amount=None,
        )
        dash = partner_dashboard_payload(
            self.partner_a, app_public_base_url="https://app.example.com"
        )
        self.assertEqual(dash["recent_leads"][0]["amount"], None)
        self.assertEqual(dash["recent_leads"][0]["customer_email_masked"], "n***@example.com")

    def test_partner_dashboard_lead_without_email(self):
        ReferralLeadEvent.objects.create(
            site=self.site,
            partner=self.partner_a,
            customer_name="Secret User",
            customer_phone="+79990001122",
            customer_email="",
            page_url="https://x.com/checkout",
            amount=Decimal("1.00"),
            currency="USD",
        )
        dash = partner_dashboard_payload(
            self.partner_a, app_public_base_url="https://app.example.com"
        )
        row = dash["recent_leads"][0]
        self.assertIsNone(row["customer_email_masked"])
        payload = json.dumps(dash["recent_leads"], default=str)
        self.assertNotIn("Secret", payload)
        self.assertNotIn("79990001122", payload)


class PartnerApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="apiuser",
            email="api@example.com",
            password="secret12",
        )
        self.api = APIClient()

    def test_onboard_and_dashboard(self):
        self.api.force_authenticate(self.user)
        r = self.api.post("/referrals/partner/onboard/")
        self.assertIn(r.status_code, (200, 201))
        self.assertIn("ref_code", r.data)
        self.assertIn("total_leads_count", r.data)
        self.assertIn("recent_leads", r.data)
        self.assertEqual(r.data["total_leads_count"], 0)
        self.assertEqual(r.data["recent_leads"], [])
        r2 = self.api.get("/referrals/partner/me/")
        self.assertEqual(r2.status_code, 200)
        self.assertIn("referral_link", r2.data)
        self.assertIn("recent_leads", r2.data)


