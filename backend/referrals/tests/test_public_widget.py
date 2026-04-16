import uuid

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from referrals.models import ReferralLeadEvent, Site
from referrals.services import ensure_partner_profile, generate_publishable_key

User = get_user_model()


class PublicWidgetApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username="owner1",
            email="owner@example.com",
            password="x",
        )
        self.partner_user = User.objects.create_user(
            username="partner1",
            email="partner@example.com",
            password="x",
        )
        self.partner, _ = ensure_partner_profile(self.partner_user)
        self.site = Site.objects.create(
            owner=self.owner,
            publishable_key=generate_publishable_key(),
            allowed_origins=["https://landing.example"],
            widget_enabled=True,
            webhook_enabled=True,
            platform_preset=Site.PlatformPreset.TILDA,
            config_json={"accent": "blue"},
        )
        self.client = APIClient()
        self.origin = "https://landing.example"

    @override_settings(DEBUG=False)
    def test_widget_config_requires_key_and_origin(self):
        url = f"/public/v1/sites/{self.site.public_id}/widget-config"
        r = self.client.get(url)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json().get("detail"), "origin_required")

        r = self.client.get(url, HTTP_ORIGIN=self.origin)
        self.assertEqual(r.status_code, 401)

        r = self.client.get(
            url,
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["site_public_id"], str(self.site.public_id))
        self.assertIn("/public/v1/events/leads?site=", data["lead_ingest_url"])
        self.assertEqual(data["config"]["accent"], "blue")

    def test_widget_config_rejects_wrong_origin(self):
        url = f"/public/v1/sites/{self.site.public_id}/widget-config"
        r = self.client.get(
            url,
            HTTP_ORIGIN="https://evil.example",
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json().get("detail"), "forbidden_origin")

    def test_lead_ingest_creates_event_with_partner(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        body = {
            "event": "lead_submitted",
            "ref": self.partner.ref_code,
            "email": "buyer@example.com",
            "page_url": "https://landing.example/page",
            "form_id": "f1",
        }
        r = self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 201)
        ev = ReferralLeadEvent.objects.get(site=self.site)
        self.assertEqual(ev.event_type, ReferralLeadEvent.EventType.LEAD_SUBMITTED)
        self.assertEqual(ev.partner_id, self.partner.id)
        self.assertEqual(ev.ref_code, self.partner.ref_code)
        self.assertEqual(ev.customer_email, "buyer@example.com")

    def test_lead_self_referral_no_partner(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        body = {
            "event": "lead_submitted",
            "ref": self.partner.ref_code,
            "email": self.partner_user.email,
        }
        r = self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 201)
        ev = ReferralLeadEvent.objects.get(site=self.site)
        self.assertIsNone(ev.partner_id)

    def test_lead_rejects_bad_event_type(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r = self.client.post(
            url,
            data={"event": "order_paid", "ref": self.partner.ref_code},
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 400)

    def test_lead_unknown_site(self):
        url = "/public/v1/events/leads?site=" + str(uuid.uuid4())
        r = self.client.post(
            url,
            data={"event": "lead_submitted", "ref": "X"},
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 404)

    @override_settings(DEBUG=True)
    def test_widget_accepts_missing_origin_in_debug(self):
        bad_site = Site.objects.create(
            owner=self.owner,
            publishable_key=generate_publishable_key(),
            allowed_origins=["https://only.example"],
            widget_enabled=True,
        )
        url = f"/public/v1/sites/{bad_site.public_id}/widget-config"
        r = self.client.get(
            url,
            HTTP_X_PUBLISHABLE_KEY=bad_site.publishable_key,
        )
        self.assertEqual(r.status_code, 200)

    @override_settings(
        DEBUG=False,
        CORS_ALLOWED_ORIGINS=["https://spa-only.example"],
    )
    def test_widget_config_preflight_cors_not_blocked_by_global_cors(self):
        """Landing origin only on Site.allowed_origins must still pass OPTIONS."""
        url = f"/public/v1/sites/{self.site.public_id}/widget-config"
        r = self.client.options(
            url,
            HTTP_ORIGIN=self.origin,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="x-publishable-key",
        )
        self.assertEqual(r.status_code, 204)
        self.assertEqual(r["Access-Control-Allow-Origin"], self.origin)
        self.assertIn("X-Publishable-Key", r["Access-Control-Allow-Headers"])

    @override_settings(
        DEBUG=False,
        CORS_ALLOWED_ORIGINS=["https://spa-only.example"],
    )
    def test_lead_ingest_preflight_cors(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r = self.client.options(
            url,
            HTTP_ORIGIN=self.origin,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="content-type,x-publishable-key",
        )
        self.assertEqual(r.status_code, 204)
        self.assertEqual(r["Access-Control-Allow-Origin"], self.origin)

    def test_normalize_lead_fills_email_from_fields(self):
        from referrals.services import normalize_lead_event_payload

        n = normalize_lead_event_payload(
            {
                "event": "lead_submitted",
                "fields": {"user_email": "x@y.co", "foo": "bar"},
            }
        )
        self.assertEqual(n["customer_email"], "x@y.co")
