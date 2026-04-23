import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import PublicLeadIngestAudit, ReferralLeadEvent, Site
from referrals.public_ingest_contract import (
    CODE_CREATED,
    CODE_DUPLICATE_SUPPRESSED,
    CODE_INVALID_CLIENT_OUTCOME,
    CODE_INVALID_EVENT,
    CODE_INVALID_KEY,
    CODE_INVALID_ORIGIN,
    CODE_INVALID_PAYLOAD,
    CODE_LEAD_EVENT_NOT_FOUND,
    CODE_ORIGIN_REQUIRED,
    CODE_RATE_LIMITED,
    CODE_SITE_NOT_FOUND,
    INTERNAL_WIDGET_DISABLED,
    RESULT_OUTCOME_UPDATED,
)
from referrals.public_ingest_logging import get_ingest_counters_snapshot, reset_ingest_counters_for_tests
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

    def tearDown(self):
        cache.clear()
        reset_ingest_counters_for_tests()
        super().tearDown()

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

    def test_widget_config_exposes_lead_selectors_from_config_json(self):
        self.site.config_json = {
            "accent": "blue",
            "amount_selector": "#price",
            "currency": "RUB",
            "product_name_selector": ".product-title",
        }
        self.site.save(update_fields=["config_json"])
        url = f"/public/v1/sites/{self.site.public_id}/widget-config"
        r = self.client.get(
            url,
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["amount_selector"], "#price")
        self.assertEqual(data["currency"], "RUB")
        self.assertEqual(data["product_name_selector"], ".product-title")
        self.assertEqual(data["config"]["amount_selector"], "#price")

    def test_widget_config_records_runtime_signal_for_site(self):
        url = f"/public/v1/sites/{self.site.public_id}/widget-config"
        before = timezone.now()
        r = self.client.get(
            url,
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 200)
        self.site.refresh_from_db()
        self.assertIsNotNone(self.site.last_widget_seen_at)
        self.assertGreaterEqual(self.site.last_widget_seen_at, before)
        self.assertEqual(self.site.last_widget_seen_origin, self.origin)

    def test_widget_config_includes_safe_public_capture_config(self):
        self.site.config_json = {
            "capture_config": {
                "enabled_optional_fields": ["email", "product_name", "unknown"],
            },
            "site_display_name": "Owner-only label",
        }
        self.site.save(update_fields=["config_json"])
        url = f"/public/v1/sites/{self.site.public_id}/widget-config"
        r = self.client.get(
            url,
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(
            data["capture_config"],
            {
                "version": 1,
                "enabled_optional_fields": ["email", "product_name"],
            },
        )
        self.assertNotIn("site_display_name", data["config"])
        self.assertNotIn("capture_config", data["config"])
        self.assertNotIn("site_display_name", data["capture_config"])

    def test_widget_config_rejects_wrong_origin(self):
        url = f"/public/v1/sites/{self.site.public_id}/widget-config"
        r = self.client.get(
            url,
            HTTP_ORIGIN="https://evil.example",
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json().get("code"), "invalid_origin")
        self.assertEqual(r.json().get("detail"), "invalid_origin")

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
        data = r.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["result"], CODE_CREATED)
        self.assertEqual(data["code"], CODE_CREATED)
        self.assertEqual(data["event"], "lead_submitted")
        ev = ReferralLeadEvent.objects.get(site=self.site)
        self.assertEqual(data["lead_event_id"], ev.id)
        self.assertEqual(ev.event_type, ReferralLeadEvent.EventType.LEAD_SUBMITTED)
        self.assertEqual(ev.submission_stage, ReferralLeadEvent.SubmissionStage.SUBMIT_ATTEMPT)
        self.assertEqual(ev.partner_id, self.partner.id)
        self.assertEqual(ev.ref_code, self.partner.ref_code)
        self.assertEqual(ev.customer_email, "buyer@example.com")
        self.assertEqual(ev.normalized_email, "buyer@example.com")
        self.assertEqual(ev.page_key, "/page")

    def test_lead_ingest_stores_amount_currency_product_name(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        body = {
            "event": "lead_submitted",
            "ref": self.partner.ref_code,
            "email": "buyer@example.com",
            "amount": "199.50",
            "currency": "EUR",
            "product_name": "Pro plan",
        }
        r = self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["result"], "created")
        ev = ReferralLeadEvent.objects.get(site=self.site)
        self.assertEqual(str(ev.amount), "199.50")
        self.assertEqual(ev.currency, "EUR")
        self.assertEqual(ev.product_name, "Pro plan")

    def test_lead_ingest_invalid_amount_stored_as_null(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        body = {
            "event": "lead_submitted",
            "email": "buyer@example.com",
            "amount": "not-a-number",
            "currency": "USD",
        }
        r = self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["result"], "created")
        ev = ReferralLeadEvent.objects.get(site=self.site)
        self.assertIsNone(ev.amount)
        self.assertEqual(ev.currency, "USD")

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
        self.assertEqual(r.json()["result"], "created")
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
        j = r.json()
        self.assertEqual(j.get("status"), "error")
        self.assertEqual(j.get("code"), CODE_INVALID_EVENT)
        self.assertEqual(j.get("detail"), CODE_INVALID_EVENT)
        self.assertIn("message", j)

    def test_lead_rejects_non_object_json(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r = self.client.post(
            url,
            data=[1, 2, 3],
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 400)
        j = r.json()
        self.assertEqual(j.get("status"), "error")
        self.assertEqual(j.get("code"), CODE_INVALID_PAYLOAD)
        self.assertEqual(j.get("detail"), CODE_INVALID_PAYLOAD)
        self.assertIn("message", j)

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
        j = r.json()
        self.assertEqual(j.get("status"), "error")
        self.assertEqual(j.get("code"), CODE_SITE_NOT_FOUND)
        self.assertEqual(j.get("detail"), CODE_SITE_NOT_FOUND)
        self.assertIn("message", j)

    @override_settings(DEBUG=False)
    def test_lead_widget_disabled_public_same_as_not_found(self):
        self.site.widget_enabled = False
        self.site.save(update_fields=["widget_enabled"])
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r = self.client.post(
            url,
            data={"event": "lead_submitted", "email": "a@b.co"},
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 404)
        j = r.json()
        self.assertEqual(j.get("status"), "error")
        self.assertEqual(j.get("code"), CODE_SITE_NOT_FOUND)
        self.assertEqual(j.get("detail"), CODE_SITE_NOT_FOUND)
        self.assertIn("message", j)

    @override_settings(
        LEAD_INGEST_THROTTLE_IP="3/minute",
        LEAD_INGEST_THROTTLE_SITE="5000/minute",
    )
    def test_lead_ingest_rate_limited_by_ip(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        body = {
            "event": "lead_submitted",
            "ref": self.partner.ref_code,
            "email": "iprl@example.com",
            "page_url": "https://landing.example/iprl",
            "form_id": "iprl-f",
        }
        for i in range(4):
            r = self.client.post(
                url,
                data=body,
                format="json",
                HTTP_ORIGIN=self.origin,
                HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
            )
            if i < 3:
                self.assertIn(r.status_code, (200, 201), msg=r.content)
            else:
                self.assertEqual(r.status_code, 429)
                jr = r.json()
                self.assertEqual(jr.get("status"), "error")
                self.assertEqual(jr.get("code"), CODE_RATE_LIMITED)
                self.assertEqual(jr.get("detail"), CODE_RATE_LIMITED)
                self.assertIn("message", jr)
                self.assertEqual(r["Access-Control-Allow-Origin"], self.origin)

    @override_settings(
        LEAD_INGEST_THROTTLE_IP="5000/minute",
        LEAD_INGEST_THROTTLE_SITE="3/minute",
    )
    def test_lead_ingest_rate_limited_by_site(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        body = {
            "event": "lead_submitted",
            "ref": self.partner.ref_code,
            "email": "siterl@example.com",
            "page_url": "https://landing.example/siterl",
            "form_id": "site-f",
        }
        for i in range(4):
            r = self.client.post(
                url,
                data={**body, "email": f"u{i}@example.com"},
                format="json",
                HTTP_ORIGIN=self.origin,
                HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
            )
            if i < 3:
                self.assertEqual(r.status_code, 201, msg=r.content)
            else:
                self.assertEqual(r.status_code, 429)
                jr = r.json()
                self.assertEqual(jr.get("status"), "error")
                self.assertEqual(jr.get("code"), CODE_RATE_LIMITED)
                self.assertEqual(jr.get("detail"), CODE_RATE_LIMITED)
                self.assertIn("message", jr)

    @override_settings(DEBUG=False)
    def test_lead_ingest_invalid_key_has_cors(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r = self.client.post(
            url,
            data={"event": "lead_submitted", "email": "x@y.co"},
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY="wrong-key",
        )
        self.assertEqual(r.status_code, 403)
        j = r.json()
        self.assertEqual(j.get("status"), "error")
        self.assertEqual(j.get("code"), CODE_INVALID_KEY)
        self.assertEqual(j.get("detail"), CODE_INVALID_KEY)
        self.assertIn("message", j)
        self.assertEqual(r["Access-Control-Allow-Origin"], self.origin)

    @override_settings(DEBUG=False)
    def test_lead_ingest_post_rejects_invalid_origin_contract(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r = self.client.post(
            url,
            data={"event": "lead_submitted", "email": "x@y.co"},
            format="json",
            HTTP_ORIGIN="https://evil.example",
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 403)
        j = r.json()
        self.assertEqual(j.get("status"), "error")
        self.assertEqual(j.get("code"), CODE_INVALID_ORIGIN)
        self.assertEqual(j.get("detail"), CODE_INVALID_ORIGIN)
        self.assertIn("message", j)
        # Gate rejects disallowed origins before CORS headers are attached (_cors_headers is empty).

    @override_settings(DEBUG=False)
    def test_lead_ingest_missing_origin_structured(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r = self.client.post(
            url,
            data={"event": "lead_submitted", "email": "x@y.co"},
            format="json",
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 403)
        j = r.json()
        self.assertEqual(j.get("status"), "error")
        self.assertEqual(j.get("code"), CODE_ORIGIN_REQUIRED)
        self.assertEqual(j.get("detail"), CODE_ORIGIN_REQUIRED)
        self.assertIn("message", j)

    @override_settings(
        LEAD_INGEST_EXPOSE_COUNTERS=True,
        LEAD_INGEST_THROTTLE_IP="5000/minute",
        LEAD_INGEST_THROTTLE_SITE="5000/minute",
    )
    def test_ingest_counters_created_and_duplicate(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        body = {
            "event": "lead_submitted",
            "ref": self.partner.ref_code,
            "email": "ctr@example.com",
            "page_url": "https://landing.example/c",
            "form_id": "c1",
        }
        self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        snap = get_ingest_counters_snapshot()
        self.assertGreaterEqual(snap.get("outcome:created", 0), 1)
        self.assertGreaterEqual(snap.get("outcome:duplicate_suppressed", 0), 1)

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

    def test_normalize_lead_extracts_amount_currency_product_name(self):
        from referrals.services import normalize_lead_event_payload

        n = normalize_lead_event_payload(
            {
                "event": "lead_submitted",
                "amount": "1 234,56",
                "currency": "usd",
                "product_name": "Widget",
            }
        )
        self.assertEqual(n["amount"], "1 234,56")
        self.assertEqual(n["currency"], "usd")
        self.assertEqual(n["product_name"], "Widget")

    @override_settings(LEAD_INGEST_DEDUP_WINDOW_SECONDS=120)
    def test_lead_ingest_duplicate_suppressed_same_payload(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        body = {
            "event": "lead_submitted",
            "ref": self.partner.ref_code,
            "email": "buyer@example.com",
            "page_url": "https://landing.example/page?utm=1",
            "form_id": "f1",
        }
        r1 = self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r1.status_code, 201)
        j1 = r1.json()
        self.assertEqual(j1["result"], "created")
        lead_id = j1["lead_event_id"]

        r2 = self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r2.status_code, 200)
        j2 = r2.json()
        self.assertEqual(j2["result"], "duplicate_suppressed")
        self.assertEqual(j2["lead_event_id"], lead_id)
        self.assertEqual(ReferralLeadEvent.objects.filter(site=self.site).count(), 1)

    @override_settings(LEAD_INGEST_DEDUP_WINDOW_SECONDS=120)
    def test_lead_ingest_creates_new_after_dedup_window(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        body = {
            "event": "lead_submitted",
            "ref": self.partner.ref_code,
            "email": "buyer@example.com",
            "page_url": "https://landing.example/page",
            "form_id": "f1",
        }
        r1 = self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r1.status_code, 201)
        ev = ReferralLeadEvent.objects.get(pk=r1.json()["lead_event_id"])
        old_ts = timezone.now() - timedelta(seconds=500)
        ReferralLeadEvent.objects.filter(pk=ev.pk).update(created_at=old_ts)

        r2 = self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(r2.json()["result"], "created")
        self.assertEqual(ReferralLeadEvent.objects.filter(site=self.site).count(), 2)

    @override_settings(LEAD_INGEST_DEDUP_WINDOW_SECONDS=120)
    def test_lead_ingest_dedup_email_case_insensitive(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        base = {
            "event": "lead_submitted",
            "ref": self.partner.ref_code,
            "page_url": "https://landing.example/p",
            "form_id": "form-x",
        }
        r1 = self.client.post(
            url,
            data={**base, "email": "Buyer@Example.com"},
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r1.status_code, 201)
        r2 = self.client.post(
            url,
            data={**base, "email": "buyer@example.com"},
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["result"], "duplicate_suppressed")

    @override_settings(LEAD_INGEST_DEDUP_WINDOW_SECONDS=120)
    def test_lead_ingest_dedup_phone_normalization(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        base = {
            "event": "lead_submitted",
            "ref": self.partner.ref_code,
            "email": "",
            "phone": "+7 (900) 111-22-33",
            "page_url": "https://landing.example/contact",
            "form_id": "c1",
        }
        r1 = self.client.post(
            url,
            data=base,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r1.status_code, 201)
        r2 = self.client.post(
            url,
            data={**base, "phone": "8 900 111-22-33"},
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["result"], "duplicate_suppressed")
        self.assertEqual(ReferralLeadEvent.objects.filter(site=self.site).count(), 1)

    @override_settings(LEAD_INGEST_DEDUP_WINDOW_SECONDS=120)
    def test_lead_ingest_dedup_scoped_per_site(self):
        site_b = Site.objects.create(
            owner=self.owner,
            publishable_key=generate_publishable_key(),
            allowed_origins=["https://landing.example"],
            widget_enabled=True,
        )
        body = {
            "event": "lead_submitted",
            "ref": self.partner.ref_code,
            "email": "same@example.com",
            "page_url": "https://landing.example/x",
            "form_id": "f",
        }
        url_a = f"/public/v1/events/leads?site={self.site.public_id}"
        url_b = f"/public/v1/events/leads?site={site_b.public_id}"
        ra = self.client.post(
            url_a,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        rb = self.client.post(
            url_b,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=site_b.publishable_key,
        )
        self.assertEqual(ra.status_code, 201)
        self.assertEqual(rb.status_code, 201)
        self.assertEqual(ReferralLeadEvent.objects.filter(site=self.site).count(), 1)
        self.assertEqual(ReferralLeadEvent.objects.filter(site=site_b).count(), 1)

    def test_normalize_lead_phone_and_page_key_helpers(self):
        from referrals.services import (
            normalize_lead_phone_for_dedup,
            page_key_from_page_url,
        )

        self.assertEqual(normalize_lead_phone_for_dedup("+7 (900) 111-22-33"), "79001112233")
        self.assertEqual(normalize_lead_phone_for_dedup("8 900 111-22-33"), "79001112233")
        self.assertEqual(
            page_key_from_page_url("https://landing.example/a?x=1#h"),
            "/a",
        )

    def test_widget_config_exposes_report_observed_outcome(self):
        self.site.config_json = {"report_observed_outcome": True}
        self.site.save(update_fields=["config_json"])
        url = f"/public/v1/sites/{self.site.public_id}/widget-config"
        r = self.client.get(
            url,
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json().get("report_observed_outcome"))

    def test_lead_submitted_inline_client_observed_outcome_persisted(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        body = {
            "event": "lead_submitted",
            "email": "inline@example.com",
            "page_url": "https://landing.example/p",
            "form_id": "f-inline",
            "client_observed_outcome": "success_observed",
            "client_outcome_source": "test_inline",
            "client_outcome_reason": "unit",
            "client_event_id": "eid-1",
        }
        r = self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 201)
        ev = ReferralLeadEvent.objects.get(pk=r.json()["lead_event_id"])
        self.assertEqual(ev.submission_stage, ReferralLeadEvent.SubmissionStage.SUBMIT_ATTEMPT)
        self.assertEqual(ev.client_observed_outcome, ReferralLeadEvent.ClientObservedOutcome.SUCCESS_OBSERVED)
        self.assertEqual(ev.client_outcome_source, "test_inline")
        self.assertEqual(ev.client_outcome_reason, "unit")
        self.assertEqual(ev.client_outcome_event_id, "eid-1")
        self.assertIsNotNone(ev.client_outcome_observed_at)

    def test_lead_submitted_rejects_invalid_client_observed_outcome(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        body = {
            "event": "lead_submitted",
            "email": "bad@example.com",
            "client_observed_outcome": "confirmed_conversion",
        }
        r = self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json().get("code"), CODE_INVALID_CLIENT_OUTCOME)

    @override_settings(LEAD_INGEST_DEDUP_WINDOW_SECONDS=120)
    def test_duplicate_lead_submitted_merges_optional_client_outcome(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        base = {
            "event": "lead_submitted",
            "ref": self.partner.ref_code,
            "email": "merge@example.com",
            "page_url": "https://landing.example/merge",
            "form_id": "merge-f",
        }
        r1 = self.client.post(
            url,
            data=base,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r1.status_code, 201)
        lead_id = r1.json()["lead_event_id"]
        r2 = self.client.post(
            url,
            data={
                **base,
                "client_observed_outcome": "not_observed",
                "client_outcome_source": "dup_path",
                "client_event_id": "merge-1",
            },
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["result"], "duplicate_suppressed")
        ev = ReferralLeadEvent.objects.get(pk=lead_id)
        self.assertEqual(ev.client_observed_outcome, ReferralLeadEvent.ClientObservedOutcome.NOT_OBSERVED)

    def test_lead_client_outcome_followup_and_idempotent(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r0 = self.client.post(
            url,
            data={
                "event": "lead_submitted",
                "email": "fu@example.com",
                "page_url": "https://landing.example/fu",
                "form_id": "fu1",
            },
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r0.status_code, 201)
        lead_id = r0.json()["lead_event_id"]
        follow = {
            "event": "lead_client_outcome",
            "lead_event_id": lead_id,
            "client_observed_outcome": "failure_observed",
            "client_outcome_source": "tilda_dom_heuristic",
            "client_outcome_reason": "dom_marker",
            "client_event_id": "oc-1",
        }
        r1 = self.client.post(
            url,
            data=follow,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r1.status_code, 200)
        j1 = r1.json()
        self.assertEqual(j1["event"], "lead_client_outcome")
        self.assertEqual(j1["result"], "outcome_updated")
        ev = ReferralLeadEvent.objects.get(pk=lead_id)
        self.assertEqual(ev.client_observed_outcome, ReferralLeadEvent.ClientObservedOutcome.FAILURE_OBSERVED)
        self.assertEqual(ev.submission_stage, ReferralLeadEvent.SubmissionStage.SUBMIT_ATTEMPT)

        r2 = self.client.post(
            url,
            data=follow,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["result"], "outcome_unchanged")

    def test_lead_client_outcome_unknown_lead_returns_404(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r = self.client.post(
            url,
            data={
                "event": "lead_client_outcome",
                "lead_event_id": 999999999,
                "client_observed_outcome": "not_observed",
            },
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json().get("code"), CODE_LEAD_EVENT_NOT_FOUND)

    def test_lead_client_outcome_wrong_site_returns_404(self):
        site_b = Site.objects.create(
            owner=self.owner,
            publishable_key=generate_publishable_key(),
            allowed_origins=["https://landing.example"],
            widget_enabled=True,
        )
        q_a = f"?site={self.site.public_id}"
        url_a = "/public/v1/events/leads" + q_a
        r0 = self.client.post(
            url_a,
            data={
                "event": "lead_submitted",
                "email": "ws@example.com",
                "page_url": "https://landing.example/ws",
                "form_id": "ws1",
            },
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        lead_id = r0.json()["lead_event_id"]
        url_b = f"/public/v1/events/leads?site={site_b.public_id}"
        r = self.client.post(
            url_b,
            data={
                "event": "lead_client_outcome",
                "lead_event_id": lead_id,
                "client_observed_outcome": "success_observed",
            },
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=site_b.publishable_key,
        )
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json().get("code"), CODE_LEAD_EVENT_NOT_FOUND)


class PublicLeadIngestAuditPersistenceTests(TestCase):
    """One PublicLeadIngestAudit row per handled POST /public/v1/events/leads outcome."""

    def setUp(self):
        self.owner = User.objects.create_user(
            username="audit_owner",
            email="audit-owner@example.com",
            password="x",
        )
        self.partner_user = User.objects.create_user(
            username="audit_partner",
            email="audit-partner@example.com",
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
            config_json={},
        )
        self.client = APIClient()
        self.origin = "https://landing.example"

    def tearDown(self):
        cache.clear()
        reset_ingest_counters_for_tests()
        super().tearDown()

    def test_audit_row_on_created(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r = self.client.post(
            url,
            data={
                "event": "lead_submitted",
                "ref": self.partner.ref_code,
                "email": "a@b.co",
                "page_url": "https://landing.example/p",
                "form_id": "f1",
            },
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 201)
        ev = ReferralLeadEvent.objects.get(site=self.site)
        row = PublicLeadIngestAudit.objects.get(site=self.site)
        self.assertEqual(row.public_code, CODE_CREATED)
        self.assertEqual(row.http_status, 201)
        self.assertEqual(row.event_name, "lead_submitted")
        self.assertEqual(row.lead_event_id, ev.pk)
        self.assertTrue(row.has_email)

    def test_audit_row_on_duplicate_suppressed(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        body = {
            "event": "lead_submitted",
            "ref": self.partner.ref_code,
            "email": "dup@example.com",
            "page_url": "https://landing.example/dup",
            "form_id": "dup-f",
        }
        self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        r2 = self.client.post(
            url,
            data=body,
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["result"], CODE_DUPLICATE_SUPPRESSED)
        dup_rows = PublicLeadIngestAudit.objects.filter(
            site=self.site, public_code=CODE_DUPLICATE_SUPPRESSED
        )
        self.assertEqual(dup_rows.count(), 1)

    def test_audit_invalid_event(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r = self.client.post(
            url,
            data={"event": "nope"},
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 400)
        row = PublicLeadIngestAudit.objects.get(site=self.site)
        self.assertEqual(row.public_code, CODE_INVALID_EVENT)
        self.assertEqual(row.http_status, 400)

    def test_audit_invalid_payload(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r = self.client.post(
            url,
            data=[1, 2],
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 400)
        row = PublicLeadIngestAudit.objects.get(site=self.site)
        self.assertEqual(row.public_code, CODE_INVALID_PAYLOAD)

    def test_audit_unknown_site_null_fk(self):
        url = "/public/v1/events/leads?site=" + str(uuid.uuid4())
        r = self.client.post(
            url,
            data={"event": "lead_submitted"},
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY="x",
        )
        self.assertEqual(r.status_code, 404)
        row = PublicLeadIngestAudit.objects.get(site__isnull=True)
        self.assertEqual(row.public_code, CODE_SITE_NOT_FOUND)
        self.assertEqual(row.internal_reason, "site_not_found")

    @override_settings(DEBUG=False)
    def test_audit_widget_disabled_internal_reason(self):
        self.site.widget_enabled = False
        self.site.save(update_fields=["widget_enabled"])
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r = self.client.post(
            url,
            data={"event": "lead_submitted", "email": "a@b.co"},
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 404)
        row = PublicLeadIngestAudit.objects.get(site=self.site)
        self.assertEqual(row.public_code, CODE_SITE_NOT_FOUND)
        self.assertEqual(row.internal_reason, INTERNAL_WIDGET_DISABLED)

    def test_audit_outcome_updated(self):
        q = f"?site={self.site.public_id}"
        url = "/public/v1/events/leads" + q
        r0 = self.client.post(
            url,
            data={
                "event": "lead_submitted",
                "email": "oc@example.com",
                "page_url": "https://landing.example/oc",
                "form_id": "oc1",
            },
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        lid = r0.json()["lead_event_id"]
        r = self.client.post(
            url,
            data={
                "event": "lead_client_outcome",
                "lead_event_id": lid,
                "client_observed_outcome": "success_observed",
            },
            format="json",
            HTTP_ORIGIN=self.origin,
            HTTP_X_PUBLISHABLE_KEY=self.site.publishable_key,
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["result"], RESULT_OUTCOME_UPDATED)
        oc_row = PublicLeadIngestAudit.objects.get(
            site=self.site, event_name="lead_client_outcome", public_code=RESULT_OUTCOME_UPDATED
        )
        self.assertEqual(oc_row.lead_event_id, lid)
