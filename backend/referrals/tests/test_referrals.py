import json
import uuid
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import (
    Commission,
    CustomerAttribution,
    Order,
    PartnerProfile,
    PublicLeadIngestAudit,
    ReferralLeadEvent,
    ReferralVisit,
    Site,
    SiteMembership,
)
from referrals.public_ingest_contract import CODE_CREATED, CODE_RATE_LIMITED
from referrals.services import (
    attach_attribution_to_order,
    ensure_partner_profile,
    generate_ref_code,
    join_site_membership_cta_logged_in,
    link_session_attributions_to_user,
    mask_email_for_partner_dashboard,
    page_path_for_partner_dashboard,
    partner_dashboard_payload,
    resolve_valid_attribution,
    site_cta_display_label,
    upsert_order_from_tilda_payload,
)

User = get_user_model()


class RefCodeGenerationTests(TestCase):
    def test_generate_ref_code_unique(self):
        codes = {generate_ref_code() for _ in range(25)}
        self.assertEqual(len(codes), 25)


class ReferralCaptureTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="puser",
            email="p@example.com",
            password="x",
        )
        self.partner, _ = ensure_partner_profile(self.user)

    def test_capture_persists_visit_and_attribution(self):
        c = Client()
        res = c.post(
            "/referrals/capture/",
            data={"ref": self.partner.ref_code, "landing_url": "https://x/?ref=1"},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(ReferralVisit.objects.filter(partner=self.partner).count(), 1)
        self.assertEqual(CustomerAttribution.objects.filter(partner=self.partner).count(), 1)
        attr = CustomerAttribution.objects.get(partner=self.partner)
        self.assertGreater(attr.expires_at, timezone.now())

    def test_capture_invalid_ref(self):
        c = Client()
        res = c.post(
            "/referrals/capture/",
            data={"ref": "nosuchcode"},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 400)

    @override_settings(CORS_ALLOWED_ORIGINS=["http://allowed.example"])
    def test_capture_rejects_foreign_origin(self):
        c = Client()
        res = c.post(
            "/referrals/capture/",
            data={"ref": self.partner.ref_code},
            content_type="application/json",
            HTTP_ORIGIN="https://evil.example",
        )
        self.assertEqual(res.status_code, 403)


class OrderAttributionAndCommissionTests(TestCase):
    def setUp(self):
        self.partner_user = User.objects.create_user(
            username="partneruser",
            email="partner@example.com",
            password="x",
        )
        self.customer = User.objects.create_user(
            username="buyeruser",
            email="buyer@example.com",
            password="x",
        )
        self.partner, _ = ensure_partner_profile(self.partner_user)

    def test_order_gets_partner_from_payload_ref(self):
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-100",
                "Email": self.customer.email,
                "sum": "100.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "pending",
            }
        )
        order.refresh_from_db()
        self.assertEqual(order.partner_id, self.partner.id)
        self.assertEqual(order.ref_code, self.partner.ref_code)

    def test_commission_on_paid_order(self):
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-200",
                "Email": self.customer.email,
                "sum": "200.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            }
        )
        self.assertEqual(order.status, Order.Status.PAID)
        c = Commission.objects.get(order=order)
        self.assertEqual(c.partner_id, self.partner.id)
        self.assertEqual(c.commission_amount, Decimal("20.00"))
        self.partner.refresh_from_db()
        self.assertEqual(self.partner.balance_total, Decimal("20.00"))

    def test_self_referral_no_commission(self):
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-300",
                "Email": self.partner_user.email,
                "sum": "150.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            }
        )
        self.assertEqual(order.status, Order.Status.PAID)
        self.assertFalse(Commission.objects.filter(order=order).exists())

    def test_duplicate_commission_idempotent(self):
        payload = {
            "tranid": "t-400",
            "Email": self.customer.email,
            "sum": "80.00",
            "ref": self.partner.ref_code,
            "paymentstatus": "paid",
        }
        upsert_order_from_tilda_payload(payload)
        order = Order.objects.get(external_id="t-400")
        upsert_order_from_tilda_payload(payload)
        self.assertEqual(Commission.objects.filter(order=order).count(), 1)
        self.partner.refresh_from_db()
        self.assertEqual(self.partner.balance_total, Decimal("8.00"))

    def test_upsert_rejects_empty_payload(self):
        with self.assertRaises(ValueError):
            upsert_order_from_tilda_payload({})

    def test_attach_from_session_attribution(self):
        self.client.post(
            "/referrals/capture/",
            data={"ref": self.partner.ref_code},
            content_type="application/json",
        )
        sk = self.client.session.session_key
        self.assertTrue(sk)
        order = Order.objects.create(
            dedupe_key="tilda:manual-1",
            source=Order.Source.TILDA,
            external_id="manual-1",
            payload_fingerprint="manualfp0001",
            amount=Decimal("50.00"),
            status=Order.Status.PENDING,
            customer_user=self.customer,
        )
        attach_attribution_to_order(order, session_key=sk, customer_user=self.customer)
        order.refresh_from_db()
        self.assertEqual(order.partner_id, self.partner.id)

    def test_conflicting_payment_fields_stays_pending(self):
        """Loose payment=1 must not override explicit paymentstatus=pending."""
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-conflict-1",
                "Email": self.customer.email,
                "sum": "100.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "pending",
                "payment": "1",
            }
        )
        self.assertEqual(order.status, Order.Status.PENDING)
        self.assertFalse(Commission.objects.filter(order=order).exists())

    def test_paid_status_not_downgraded_by_pending_webhook(self):
        ext = "t-sticky-paid"
        upsert_order_from_tilda_payload(
            {
                "tranid": ext,
                "Email": self.customer.email,
                "sum": "10.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            }
        )
        upsert_order_from_tilda_payload(
            {
                "tranid": ext,
                "Email": self.customer.email,
                "sum": "10.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "pending",
                "payment": "0",
            }
        )
        order = Order.objects.get(external_id=ext)
        self.assertEqual(order.status, Order.Status.PAID)

    def test_paid_after_pending_creates_commission_once(self):
        ext = "t-conflict-2"
        upsert_order_from_tilda_payload(
            {
                "tranid": ext,
                "Email": self.customer.email,
                "sum": "100.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "pending",
                "payment": "1",
            }
        )
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": ext,
                "Email": self.customer.email,
                "sum": "100.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            }
        )
        self.assertEqual(order.status, Order.Status.PAID)
        self.assertEqual(Commission.objects.filter(order=order).count(), 1)

    def test_expired_attribution_not_attached(self):
        self.client.post(
            "/referrals/capture/",
            data={"ref": self.partner.ref_code},
            content_type="application/json",
        )
        sk = self.client.session.session_key
        attr = CustomerAttribution.objects.get(partner=self.partner)
        CustomerAttribution.objects.filter(pk=attr.pk).update(
            expires_at=timezone.now() - timezone.timedelta(days=1)
        )
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-expired-attrib",
                "Email": self.customer.email,
                "sum": "40.00",
                "paymentstatus": "paid",
            },
            session_key=sk,
            customer_user=self.customer,
        )
        order.refresh_from_db()
        self.assertIsNone(order.partner_id)

    def test_last_click_deterministic_tiebreak_higher_pk(self):
        p2_user = User.objects.create_user(
            username="p2user",
            email="p2@example.com",
            password="x",
        )
        partner2, _ = ensure_partner_profile(p2_user)
        t = timezone.now()
        exp = t + timezone.timedelta(days=30)
        v1 = ReferralVisit.objects.create(
            partner=self.partner,
            ref_code=self.partner.ref_code,
            session_key="sk-tie",
        )
        a1 = CustomerAttribution.objects.create(
            partner=self.partner,
            ref_code=self.partner.ref_code,
            session_key="sk-tie",
            source_visit=v1,
            attributed_at=t,
            expires_at=exp,
        )
        v2 = ReferralVisit.objects.create(
            partner=partner2,
            ref_code=partner2.ref_code,
            session_key="sk-tie",
        )
        a2 = CustomerAttribution.objects.create(
            partner=partner2,
            ref_code=partner2.ref_code,
            session_key="sk-tie",
            source_visit=v2,
            attributed_at=t,
            expires_at=exp,
        )
        picked = resolve_valid_attribution(session_key="sk-tie")
        self.assertGreater(a2.pk, a1.pk)
        self.assertEqual(picked.pk, a2.pk)
        self.assertEqual(picked.partner_id, partner2.id)

    def test_self_referral_payload_ref_not_attached(self):
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-self-payload",
                "Email": self.partner_user.email,
                "sum": "75.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            }
        )
        order.refresh_from_db()
        self.assertIsNone(order.partner_id)
        self.assertFalse(Commission.objects.filter(order=order).exists())

    def test_wrong_external_id_field_name_falls_back_to_fingerprint_and_logs(self):
        """Tilda field names must match supported aliases; unknown keys do not set external_id."""
        with self.assertLogs("referrals.services", level="WARNING") as cm:
            order, _ = upsert_order_from_tilda_payload(
                {
                    "TransactionID_TYPO": "ext-should-not-parse",
                    "Email": self.customer.email,
                    "sum": "11.00",
                    "ref": self.partner.ref_code,
                    "paymentstatus": "paid",
                }
            )
        self.assertTrue(order.dedupe_key.startswith("fp:"))
        self.assertEqual(order.external_id, "")
        self.assertIn("missing_external_id_for_dedupe", " ".join(cm.output))

    def test_unknown_payment_status_stays_pending_and_logs(self):
        with self.assertLogs("referrals.services", level="WARNING") as cm:
            order, _ = upsert_order_from_tilda_payload(
                {
                    "tranid": "t-unknown-pay-status",
                    "Email": self.customer.email,
                    "sum": "11.00",
                    "ref": self.partner.ref_code,
                    "paymentstatus": "acme_gateway_status_never_heard_of",
                }
            )
        self.assertEqual(order.status, Order.Status.PENDING)
        self.assertFalse(Commission.objects.filter(order=order).exists())
        self.assertIn("unrecognized_payment_status", " ".join(cm.output))

    @override_settings(ORDER_WEBHOOK_DEBUG_LOGGING=True)
    def test_debug_log_when_no_payment_status_fields(self):
        with self.assertLogs("referrals.services", level="INFO") as cm:
            upsert_order_from_tilda_payload(
                {
                    "tranid": "t-no-payment-fields",
                    "Email": self.customer.email,
                    "sum": "3.00",
                    "ref": self.partner.ref_code,
                }
            )
        self.assertIn("no_payment_status_fields", " ".join(cm.output))


@override_settings(REFERRAL_MVP_ASSUME_PAID_IF_AMOUNT_PRESENT=True)
class MvpAssumePaidCommissionTests(TestCase):
    """REFERRAL_MVP_ASSUME_PAID_IF_AMOUNT_PRESENT: amount-only paid assumption for Tilda webhooks."""

    def setUp(self):
        self.partner_user = User.objects.create_user(
            username="mvp_partner_u",
            email="mvp_partner@example.com",
            password="x",
        )
        self.customer = User.objects.create_user(
            username="mvp_buyer_u",
            email="mvp_buyer@example.com",
            password="x",
        )
        self.partner, _ = ensure_partner_profile(self.partner_user)

    def test_mvp_amount_positive_no_payment_fields_creates_commission(self):
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "mvp-t-1",
                "Email": self.customer.email,
                "sum": "100.00",
                "ref": self.partner.ref_code,
            }
        )
        self.assertEqual(order.status, Order.Status.PAID)
        c = Commission.objects.get(order=order)
        self.assertEqual(c.commission_amount, Decimal("10.00"))
        self.partner.refresh_from_db()
        self.assertEqual(self.partner.balance_total, Decimal("10.00"))

    def test_mvp_amount_zero_no_commission(self):
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "mvp-t-zero",
                "Email": self.customer.email,
                "sum": "0",
                "ref": self.partner.ref_code,
            }
        )
        self.assertEqual(order.status, Order.Status.PENDING)
        self.assertFalse(Commission.objects.filter(order=order).exists())

    def test_mvp_explicit_pending_not_treated_as_paid(self):
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "mvp-t-pending",
                "Email": self.customer.email,
                "sum": "50.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "pending",
            }
        )
        self.assertEqual(order.status, Order.Status.PENDING)
        self.assertFalse(Commission.objects.filter(order=order).exists())

    def test_mvp_real_paid_paymentstatus_still_commissions(self):
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "mvp-t-real-paid",
                "Email": self.customer.email,
                "sum": "200.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            }
        )
        self.assertEqual(order.status, Order.Status.PAID)
        c = Commission.objects.get(order=order)
        self.assertEqual(c.commission_amount, Decimal("20.00"))

    def test_mvp_duplicate_webhook_no_double_commission(self):
        body = {
            "tranid": "mvp-t-dup",
            "Email": self.customer.email,
            "sum": "80.00",
            "ref": self.partner.ref_code,
        }
        upsert_order_from_tilda_payload(body)
        upsert_order_from_tilda_payload(body)
        order = Order.objects.get(external_id="mvp-t-dup")
        self.assertEqual(Commission.objects.filter(order=order).count(), 1)
        self.partner.refresh_from_db()
        self.assertEqual(self.partner.balance_total, Decimal("8.00"))

    def test_mvp_self_referral_no_commission(self):
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "mvp-t-self",
                "Email": self.partner_user.email,
                "sum": "120.00",
                "ref": self.partner.ref_code,
            }
        )
        self.assertEqual(order.status, Order.Status.PAID)
        self.assertFalse(Commission.objects.filter(order=order).exists())

    def test_mvp_paid_orders_in_partner_dashboard_payload(self):
        upsert_order_from_tilda_payload(
            {
                "tranid": "mvp-t-dash",
                "Email": self.customer.email,
                "sum": "30.00",
                "ref": self.partner.ref_code,
            }
        )
        dash = partner_dashboard_payload(
            self.partner, app_public_base_url="https://app.example.com"
        )
        self.assertEqual(dash["paid_orders_count"], 1)
        self.assertEqual(Decimal(dash["commissions_total"]), Decimal("3.00"))
        self.assertEqual(len(dash["commission_history"]), 1)
        self.assertEqual(dash["total_leads_count"], 0)
        self.assertEqual(dash["recent_leads"], [])


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


class SiteOwnerIntegrationApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username="siteowner_api",
            email="owner-api@example.com",
            password="secret12",
        )
        self.stranger = User.objects.create_user(
            username="nostranger",
            email="stranger@example.com",
            password="secret12",
        )
        self.api = APIClient()

    @override_settings(
        FRONTEND_URL="https://app.example.com",
        PUBLIC_API_BASE="https://api.example.com",
    )
    def test_get_integration_includes_snippet(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_integration_test",
            allowed_origins=["https://shop.example"],
            platform_preset=Site.PlatformPreset.TILDA,
            config_json={"amount_selector": ".price"},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["publishable_key"], "pk_integration_test")
        self.assertEqual(r.data["allowed_origins"], ["https://shop.example"])
        self.assertEqual(r.data["platform_preset"], Site.PlatformPreset.TILDA)
        self.assertEqual(r.data["config_json"], {"amount_selector": ".price"})
        self.assertTrue(r.data["widget_enabled"])
        snippet = r.data["widget_embed_snippet"]
        self.assertIn("https://app.example.com/widgets/referral-widget.v1.js", snippet)
        self.assertIn('data-rs-api="https://api.example.com"', snippet)
        self.assertIn(f'data-rs-site="{site.public_id}"', snippet)
        self.assertIn('data-rs-key="pk_integration_test"', snippet)

    def test_get_requires_auth(self):
        r = self.api.get("/referrals/site/integration/")
        self.assertEqual(r.status_code, 401)

    def test_bootstrap_requires_auth(self):
        r = self.api.post("/referrals/site/bootstrap/")
        self.assertEqual(r.status_code, 401)

    def test_get_missing_site(self):
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data["detail"], "site_missing")

    @override_settings(
        FRONTEND_URL="https://app.example.com",
        PUBLIC_API_BASE="https://api.example.com",
    )
    def test_bootstrap_creates_first_site(self):
        self.api.force_authenticate(self.owner)
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 0)
        r = self.api.post("/referrals/site/bootstrap/")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 1)
        self.assertIn("publishable_key", r.data)
        self.assertIn("widget_embed_snippet", r.data)
        site = Site.objects.get(owner=self.owner)
        self.assertEqual(r.data["publishable_key"], site.publishable_key)

    def test_bootstrap_idempotent_no_second_site(self):
        self.api.force_authenticate(self.owner)
        r1 = self.api.post("/referrals/site/bootstrap/")
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 1)
        pk = r1.data["publishable_key"]
        r2 = self.api.post("/referrals/site/bootstrap/")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 1)
        self.assertEqual(r2.data["publishable_key"], pk)

    def test_bootstrap_does_not_touch_other_owner_sites(self):
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_existing_" + uuid.uuid4().hex,
        )
        self.api.force_authenticate(self.stranger)
        r = self.api.post("/referrals/site/bootstrap/")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Site.objects.filter(owner=self.stranger).count(), 1)
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 1)

    def test_site_create_requires_auth(self):
        r = self.api.post(
            "/referrals/site/create/",
            data={"display_name": "A", "origin": "https://a.example"},
            format="json",
        )
        self.assertEqual(r.status_code, 401)

    @override_settings(
        FRONTEND_URL="https://app.example.com",
        PUBLIC_API_BASE="https://api.example.com",
    )
    def test_owner_can_create_second_site_via_create_endpoint(self):
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_first_" + uuid.uuid4().hex,
            allowed_origins=["https://first.example"],
        )
        self.api.force_authenticate(self.owner)
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 1)
        r = self.api.post(
            "/referrals/site/create/",
            data={
                "display_name": "Second shop",
                "origin": "second.example",
                "platform_preset": Site.PlatformPreset.TILDA,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 2)
        newest = Site.objects.filter(owner=self.owner).order_by("-created_at", "-id").first()
        self.assertEqual(r.data["public_id"], str(newest.public_id))
        self.assertEqual(newest.allowed_origins, ["https://second.example"])
        self.assertEqual(newest.config_json.get("display_name"), "Second shop")
        self.assertEqual(newest.platform_preset, Site.PlatformPreset.TILDA)

    def test_site_create_assigns_owner_to_authenticated_user_only(self):
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_owner_only_" + uuid.uuid4().hex,
        )
        self.api.force_authenticate(self.stranger)
        r = self.api.post(
            "/referrals/site/create/",
            data={"display_name": "Stranger project", "origin": "https://s.example"},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        site = Site.objects.get(public_id=r.data["public_id"])
        self.assertEqual(site.owner_id, self.stranger.id)
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 1)
        self.assertEqual(Site.objects.filter(owner=self.stranger).count(), 1)

    def test_site_list_payload_includes_display_name_when_multiple_sites(self):
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_a_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            config_json={"display_name": "Alpha"},
        )
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_b_" + uuid.uuid4().hex,
            allowed_origins=["https://b.example"],
            config_json={"display_name": "Beta"},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/")
        self.assertEqual(r.status_code, 409)
        names = {row["display_name"] for row in r.data["sites"]}
        self.assertEqual(names, {"Alpha", "Beta"})

    @override_settings(
        FRONTEND_URL="https://app.example.com",
        PUBLIC_API_BASE="https://api.example.com",
    )
    def test_integration_works_after_bootstrap(self):
        self.api.force_authenticate(self.owner)
        b = self.api.post("/referrals/site/bootstrap/")
        self.assertEqual(b.status_code, 201)
        r = self.api.get("/referrals/site/integration/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["publishable_key"], b.data["publishable_key"])

    def test_diagnostics_works_after_bootstrap(self):
        self.api.force_authenticate(self.owner)
        self.api.post("/referrals/site/bootstrap/")
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("site_public_id", r.data)
        self.assertEqual(r.data["site_status"], Site.Status.DRAFT)

    def test_selection_required_when_multiple_sites_and_no_site_public_id(self):
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_older_" + uuid.uuid4().hex,
        )
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_newer_" + uuid.uuid4().hex,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["detail"], "site_selection_required")
        self.assertEqual(len(r.data["sites"]), 2)

    def test_can_select_site_by_site_public_id_when_multiple(self):
        older = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_older_select_" + uuid.uuid4().hex,
        )
        newer = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_newer_select_" + uuid.uuid4().hex,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get(f"/referrals/site/integration/?site_public_id={older.public_id}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["public_id"], str(older.public_id))
        self.assertNotEqual(r.data["public_id"], str(newer.public_id))

    def test_patch_updates_fields(self):
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_patch_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            platform_preset=Site.PlatformPreset.TILDA,
            widget_enabled=True,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.patch(
            "/referrals/site/integration/",
            data={
                "allowed_origins": ["https://b.example", "https://c.example"],
                "platform_preset": Site.PlatformPreset.GENERIC,
                "widget_enabled": False,
                "config_json": {"currency": "RUB"},
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["allowed_origins"], ["https://b.example", "https://c.example"])
        self.assertEqual(r.data["platform_preset"], Site.PlatformPreset.GENERIC)
        self.assertFalse(r.data["widget_enabled"])
        self.assertEqual(r.data["config_json"], {"currency": "RUB"})

    def test_patch_demotes_verified_site_to_draft_when_embed_not_ready(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_patch_demote_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            widget_enabled=True,
            status=Site.Status.VERIFIED,
            verified_at=timezone.now(),
        )
        self.api.force_authenticate(self.owner)
        r = self.api.patch(
            f"/referrals/site/integration/?site_public_id={site.public_id}",
            data={"widget_enabled": False},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], Site.Status.DRAFT)
        site.refresh_from_db()
        self.assertEqual(site.status, Site.Status.DRAFT)
        self.assertIsNone(site.verified_at)
        self.assertIsNone(site.activated_at)

    def test_verify_promotes_ready_draft_site(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_verify_" + uuid.uuid4().hex,
            allowed_origins=["https://verify.example"],
            widget_enabled=True,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            f"/referrals/site/integration/verify/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], Site.Status.VERIFIED)
        self.assertIsNotNone(r.data["verified_at"])
        site.refresh_from_db()
        self.assertEqual(site.status, Site.Status.VERIFIED)
        self.assertIsNotNone(site.verified_at)

    def test_verify_rejects_incomplete_site(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_verify_fail_" + uuid.uuid4().hex,
            allowed_origins=[],
            widget_enabled=True,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            f"/referrals/site/integration/verify/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["detail"], "site_not_ready_for_verify")
        self.assertFalse(r.data["embed_readiness"]["origins_configured"])
        site.refresh_from_db()
        self.assertEqual(site.status, Site.Status.DRAFT)

    def test_activate_requires_verified_site(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_activate_draft_" + uuid.uuid4().hex,
            allowed_origins=["https://activate.example"],
            widget_enabled=True,
            status=Site.Status.DRAFT,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            f"/referrals/site/integration/activate/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["detail"], "site_not_verified")

    def test_activate_promotes_verified_site(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_activate_verified_" + uuid.uuid4().hex,
            allowed_origins=["https://activate.example"],
            widget_enabled=True,
            status=Site.Status.VERIFIED,
            verified_at=timezone.now(),
        )
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            f"/referrals/site/integration/activate/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], Site.Status.ACTIVE)
        self.assertIsNotNone(r.data["activated_at"])
        site.refresh_from_db()
        self.assertEqual(site.status, Site.Status.ACTIVE)
        self.assertIsNotNone(site.activated_at)

    def test_patch_display_name_and_origin_scoped_by_site_public_id(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_settings_" + uuid.uuid4().hex,
            allowed_origins=["https://old.example"],
            platform_preset=Site.PlatformPreset.TILDA,
            config_json={"display_name": "Old", "amount_selector": ".x"},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.patch(
            f"/referrals/site/integration/?site_public_id={site.public_id}",
            data={
                "display_name": "New title",
                "origin": "https://new.example",
                "platform_preset": Site.PlatformPreset.GENERIC,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["allowed_origins"], ["https://new.example"])
        self.assertEqual(r.data["platform_preset"], Site.PlatformPreset.GENERIC)
        self.assertEqual(r.data["config_json"].get("display_name"), "New title")
        self.assertEqual(r.data["config_json"].get("amount_selector"), ".x")
        site.refresh_from_db()
        self.assertEqual(site.config_json.get("display_name"), "New title")
        self.assertEqual(site.config_json.get("amount_selector"), ".x")

    def test_stranger_cannot_patch_other_owner_site(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_stranger_patch_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
        )
        self.api.force_authenticate(self.stranger)
        r = self.api.patch(
            f"/referrals/site/integration/?site_public_id={site.public_id}",
            data={"display_name": "Hacked"},
            format="json",
        )
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data["detail"], "site_missing")
        site.refresh_from_db()
        self.assertNotIn("display_name", site.config_json)

    def test_delete_requires_site_public_id(self):
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_del_noid_" + uuid.uuid4().hex,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.delete("/referrals/site/integration/", format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data["detail"], "site_public_id_required")

    def test_owner_can_delete_site_and_cascades_related(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_del_own_" + uuid.uuid4().hex,
            allowed_origins=["https://del.example"],
        )
        partner_user = User.objects.create_user(
            username="member_for_del",
            email="member-del@example.com",
            password="secret12",
        )
        partner_profile, _ = ensure_partner_profile(partner_user)
        SiteMembership.objects.create(site=site, user=partner_user, partner=partner_profile)
        ReferralLeadEvent.objects.create(site=site, partner=partner_profile, customer_email="a@b.co")
        PublicLeadIngestAudit.objects.create(
            site=site,
            public_code="ok",
            http_status=200,
        )
        self.api.force_authenticate(self.owner)
        sid = site.public_id
        r = self.api.delete(
            f"/referrals/site/integration/?site_public_id={sid}",
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], "deleted")
        self.assertFalse(Site.objects.filter(public_id=sid).exists())
        self.assertEqual(SiteMembership.objects.filter(site_id=site.id).count(), 0)
        self.assertEqual(ReferralLeadEvent.objects.filter(site_id=site.id).count(), 0)
        self.assertEqual(PublicLeadIngestAudit.objects.filter(site_id=site.id).count(), 0)

    def test_stranger_cannot_delete_other_owner_site(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_del_stranger_" + uuid.uuid4().hex,
        )
        self.api.force_authenticate(self.stranger)
        r = self.api.delete(
            f"/referrals/site/integration/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r.status_code, 404)
        self.assertTrue(Site.objects.filter(id=site.id).exists())

    def test_after_delete_site_missing_from_owner_integration_list(self):
        a = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_list_a_" + uuid.uuid4().hex,
            config_json={"display_name": "A"},
        )
        b = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_list_b_" + uuid.uuid4().hex,
            config_json={"display_name": "B"},
        )
        self.api.force_authenticate(self.owner)
        r_del = self.api.delete(
            f"/referrals/site/integration/?site_public_id={a.public_id}",
            format="json",
        )
        self.assertEqual(r_del.status_code, 200)
        r_list = self.api.get("/referrals/site/integration/")
        self.assertEqual(r_list.status_code, 200)
        self.assertEqual(r_list.data["public_id"], str(b.public_id))


class SiteOwnerDiagnosticsApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username="diag_owner",
            email="diag-owner@example.com",
            password="secret12",
        )
        self.stranger = User.objects.create_user(
            username="diag_stranger",
            email="diag-stranger@example.com",
            password="secret12",
        )
        self.api = APIClient()

    def test_diagnostics_requires_auth(self):
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 401)

    def test_diagnostics_missing_site(self):
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data["detail"], "site_missing")

    def test_diagnostics_summary_and_leads(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_diag_" + uuid.uuid4().hex,
            allowed_origins=["https://shop.example"],
            platform_preset=Site.PlatformPreset.TILDA,
            widget_enabled=True,
            config_json={
                "observe_success": True,
                "report_observed_outcome": True,
                "amount_selector": ".p",
            },
        )
        ReferralLeadEvent.objects.create(
            site=site,
            event_type=ReferralLeadEvent.EventType.LEAD_SUBMITTED,
            submission_stage=ReferralLeadEvent.SubmissionStage.SUBMIT_ATTEMPT,
            client_observed_outcome=ReferralLeadEvent.ClientObservedOutcome.SUCCESS_OBSERVED,
            ref_code="REF1",
            customer_email="lead@example.com",
            customer_phone="+79990001122",
            page_url="https://shop.example/order",
            form_id="f99",
            amount=Decimal("10.00"),
            currency="RUB",
            product_name="Item",
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["site_public_id"], str(site.public_id))
        self.assertEqual(r.data["integration_status"], "healthy")
        self.assertIn("integration_warnings", r.data)
        self.assertTrue(r.data["has_recent_leads"])
        self.assertEqual(r.data["windows"]["24h"]["submit_attempt_count"], 1)
        self.assertEqual(r.data["windows"]["24h"]["success_observed_count"], 1)
        self.assertEqual(r.data["ingest_quality"]["source"], "public_lead_ingest_audit")
        self.assertIn("total_requests", r.data["ingest_quality"]["24h"])
        row = r.data["recent_leads"][0]
        self.assertEqual(row["submission_stage"], ReferralLeadEvent.SubmissionStage.SUBMIT_ATTEMPT)
        self.assertIn("submission_stage_label", row)
        self.assertEqual(row["client_observed_outcome"], "success_observed")
        self.assertIn("client_outcome_label", row)
        self.assertEqual(row["customer_email_masked"], "l***@example.com")
        self.assertEqual(row["customer_phone_masked"], "***1122")
        self.assertEqual(r.data["site_membership"]["count"], 0)
        self.assertEqual(r.data["site_membership"]["recent_joins"], [])

    def test_diagnostics_not_leaking_other_site(self):
        other = User.objects.create_user(
            username="other_site_owner",
            email="other-so@example.com",
            password="secret12",
        )
        my_site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_mine_" + uuid.uuid4().hex,
            allowed_origins=["https://mine.example"],
        )
        other_site = Site.objects.create(
            owner=other,
            publishable_key="pk_other_" + uuid.uuid4().hex,
            allowed_origins=["https://other.example"],
        )
        ReferralLeadEvent.objects.create(
            site=other_site,
            event_type=ReferralLeadEvent.EventType.LEAD_SUBMITTED,
            submission_stage=ReferralLeadEvent.SubmissionStage.SUBMIT_ATTEMPT,
            ref_code="X",
            customer_email="secret@other.com",
        )
        other_member = User.objects.create_user(
            username="other_site_member",
            email="member-on-other@example.com",
            password="secret12",
        )
        SiteMembership.objects.create(site=other_site, user=other_member)
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["site_public_id"], str(my_site.public_id))
        self.assertEqual(r.data["windows"]["7d"]["submit_attempt_count"], 0)
        self.assertEqual(r.data["recent_leads"], [])
        self.assertEqual(r.data["site_membership"]["count"], 0)
        self.assertEqual(r.data["site_membership"]["recent_joins"], [])

    def test_diagnostics_membership_count_and_recent_joins(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_ms_" + uuid.uuid4().hex,
            allowed_origins=["https://shop.example"],
        )
        u1 = User.objects.create_user(username="m1", email="alice-ms@example.com", password="secret12")
        u2 = User.objects.create_user(username="m2", email="bob-ms@example.org", password="secret12")
        SiteMembership.objects.create(site=site, user=u1)
        SiteMembership.objects.create(site=site, user=u2)
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 200)
        sm = r.data["site_membership"]
        self.assertEqual(sm["count"], 2)
        self.assertEqual(len(sm["recent_joins"]), 2)
        emails = {row["identity_masked"] for row in sm["recent_joins"]}
        self.assertEqual(emails, {"a***@example.com", "b***@example.org"})

    def test_diagnostics_membership_scoped_to_selected_site(self):
        site_a = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_ms_a_" + uuid.uuid4().hex,
        )
        site_b = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_ms_b_" + uuid.uuid4().hex,
        )
        ua = User.objects.create_user(username="ma", email="a-ms@example.com", password="secret12")
        ub = User.objects.create_user(username="mb", email="b-ms@example.com", password="secret12")
        uc = User.objects.create_user(username="mc", email="c-ms@example.com", password="secret12")
        SiteMembership.objects.create(site=site_a, user=ua)
        SiteMembership.objects.create(site=site_a, user=ub)
        SiteMembership.objects.create(site=site_b, user=uc)
        self.api.force_authenticate(self.owner)
        r_a = self.api.get(f"/referrals/site/integration/diagnostics/?site_public_id={site_a.public_id}")
        self.assertEqual(r_a.status_code, 200)
        self.assertEqual(r_a.data["site_membership"]["count"], 2)
        r_b = self.api.get(f"/referrals/site/integration/diagnostics/?site_public_id={site_b.public_id}")
        self.assertEqual(r_b.status_code, 200)
        self.assertEqual(r_b.data["site_membership"]["count"], 1)

    def test_diagnostics_stranger_cannot_read_foreign_site_summary(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_foreign_" + uuid.uuid4().hex,
        )
        member = User.objects.create_user(
            username="foreign_m",
            email="foreign-m@example.com",
            password="secret12",
        )
        SiteMembership.objects.create(site=site, user=member)
        self.api.force_authenticate(self.stranger)
        r = self.api.get(f"/referrals/site/integration/diagnostics/?site_public_id={site.public_id}")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data["detail"], "site_missing")

    def test_diagnostics_requires_site_selection_when_multiple_sites(self):
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_diag_multi_1_" + uuid.uuid4().hex,
        )
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_diag_multi_2_" + uuid.uuid4().hex,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["detail"], "site_selection_required")

    def test_diagnostics_ingest_quality_counts(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_iq_" + uuid.uuid4().hex,
            allowed_origins=["https://metrics.example"],
        )
        PublicLeadIngestAudit.objects.create(
            site=site,
            event_name="lead_submitted",
            public_code=CODE_CREATED,
            http_status=201,
        )
        PublicLeadIngestAudit.objects.create(
            site=site,
            event_name="",
            public_code=CODE_RATE_LIMITED,
            http_status=429,
            throttle_scope="ip",
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 200)
        iq = r.data["ingest_quality"]["7d"]
        self.assertEqual(iq["created_count"], 1)
        self.assertEqual(iq["rate_limited_count"], 1)
        self.assertEqual(iq["total_requests"], 2)
        self.assertEqual(iq["rejected_count"], 0)


class SiteOwnerMembersListApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username="mem_owner",
            email="mem-owner@example.com",
            password="secret12",
        )
        self.other_owner = User.objects.create_user(
            username="mem_other_owner",
            email="mem-other-owner@example.com",
            password="secret12",
        )
        self.api = APIClient()

    def test_members_requires_auth(self):
        r = self.api.get("/referrals/site/integration/members/?site_public_id=00000000-0000-0000-0000-000000000001")
        self.assertEqual(r.status_code, 401)

    def test_members_requires_site_public_id(self):
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/members/")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data["detail"], "site_public_id_required")

    def test_owner_sees_masked_members_newest_first_for_selected_site(self):
        site_a = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_mem_a_" + uuid.uuid4().hex,
        )
        site_b = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_mem_b_" + uuid.uuid4().hex,
        )
        ua = User.objects.create_user(username="mem_a1", email="alice-mem@example.com", password="secret12")
        ub = User.objects.create_user(username="mem_a2", email="bob-mem@example.com", password="secret12")
        uc = User.objects.create_user(username="mem_b1", email="carol-mem@example.com", password="secret12")
        m_old = SiteMembership.objects.create(site=site_a, user=ua, ref_code="")
        m_new = SiteMembership.objects.create(
            site=site_a,
            user=ub,
            ref_code="REF_SNAP",
        )
        SiteMembership.objects.filter(pk=m_old.pk).update(
            created_at=timezone.now() - timedelta(days=2)
        )
        SiteMembership.objects.filter(pk=m_new.pk).update(created_at=timezone.now() - timedelta(hours=1))
        SiteMembership.objects.create(site=site_b, user=uc)

        self.api.force_authenticate(self.owner)
        r = self.api.get(f"/referrals/site/integration/members/?site_public_id={site_a.public_id}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["site_public_id"], str(site_a.public_id))
        self.assertEqual(r.data["count"], 2)
        self.assertEqual(len(r.data["members"]), 2)
        self.assertEqual(r.data["members"][0]["identity_masked"], "b***@example.com")
        self.assertEqual(r.data["members"][0]["ref_code"], "REF_SNAP")
        self.assertEqual(r.data["members"][1]["identity_masked"], "a***@example.com")

        r_b = self.api.get(f"/referrals/site/integration/members/?site_public_id={site_b.public_id}")
        self.assertEqual(r_b.status_code, 200)
        self.assertEqual(r_b.data["count"], 1)
        self.assertEqual(r_b.data["members"][0]["identity_masked"], "c***@example.com")

    def test_other_owner_cannot_read_foreign_site_members(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_mem_foreign_" + uuid.uuid4().hex,
        )
        member = User.objects.create_user(
            username="mem_foreign_m",
            email="foreign-mem@example.com",
            password="secret12",
        )
        SiteMembership.objects.create(site=site, user=member)
        self.api.force_authenticate(self.other_owner)
        r = self.api.get(f"/referrals/site/integration/members/?site_public_id={site.public_id}")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data["detail"], "site_missing")


class SiteCtaDisplayLabelTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username="cta_label_owner",
            email="cta-label-owner@example.com",
            password="secret12",
        )

    def test_prefers_config_json_display_name(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_cta_lbl_1_" + uuid.uuid4().hex,
            config_json={"display_name": "  My Shop  "},
        )
        self.assertEqual(site_cta_display_label(site), "My Shop")

    def test_falls_back_to_site_title_key(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_cta_lbl_title_" + uuid.uuid4().hex,
            config_json={"site_title": "Title case"},
        )
        self.assertEqual(site_cta_display_label(site), "Title case")

    def test_falls_back_to_allowed_origins_hostname(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_cta_lbl_origin_" + uuid.uuid4().hex,
            allowed_origins=["https://www.shop.example/path"],
        )
        self.assertEqual(site_cta_display_label(site), "shop.example")

    def test_returns_empty_when_no_hints(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_cta_lbl_empty_" + uuid.uuid4().hex,
        )
        self.assertEqual(site_cta_display_label(site), "")


class SiteSignupJoinTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username="site_join_owner",
            email="site-join-owner@example.com",
            password="secret12",
        )
        self.partner_user = User.objects.create_user(
            username="site_join_partner",
            email="site-join-partner@example.com",
            password="secret12",
        )
        self.partner, _ = ensure_partner_profile(self.partner_user)
        self.site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_site_join_" + uuid.uuid4().hex,
        )
        self.site.status = Site.Status.VERIFIED
        self.site.verified_at = timezone.now()
        self.site.save(update_fields=["status", "verified_at", "updated_at"])

    def test_site_defaults_to_draft_lifecycle(self):
        fresh = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_fresh_draft_" + uuid.uuid4().hex,
        )
        self.assertEqual(fresh.status, Site.Status.DRAFT)
        self.assertIsNone(fresh.verified_at)
        self.assertIsNone(fresh.activated_at)

    def test_register_rejects_site_not_verified(self):
        draft_site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_join_draft_" + uuid.uuid4().hex,
        )
        self.assertEqual(draft_site.status, Site.Status.DRAFT)
        email = "draft-blocked@example.com"
        r = self.client.post(
            "/users/register/",
            data={
                "email": email,
                "password": "joinpw123456",
                "site_public_id": str(draft_site.public_id),
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("detail"), "site_not_joinable")
        self.assertEqual(r.data.get("site_status"), Site.Status.DRAFT)
        self.assertFalse(User.objects.filter(email=email).exists())
        self.assertEqual(SiteMembership.objects.filter(site=draft_site).count(), 0)

    def test_register_with_site_public_id_creates_site_membership(self):
        email = "site-member@example.com"
        r = self.client.post(
            "/users/register/",
            data={
                "email": email,
                "password": "joinpw123456",
                "site_public_id": str(self.site.public_id),
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 201)
        user = User.objects.get(email=email)
        membership = SiteMembership.objects.get(site=self.site, user=user)
        self.assertEqual(membership.joined_via, SiteMembership.JoinedVia.CTA_SIGNUP)
        self.assertEqual(membership.ref_code, "")
        self.assertIsNone(membership.partner_id)
        self.assertEqual(r.data.get("cta_join", {}).get("status"), "joined")
        self.assertEqual(
            r.data.get("cta_join", {}).get("site_public_id"),
            str(self.site.public_id),
        )
        self.assertEqual(r.data.get("cta_join", {}).get("site_display_label"), "")

    def test_register_cta_join_includes_site_display_label_from_config(self):
        self.site.config_json = {"display_name": "Магазин Омега"}
        self.site.save(update_fields=["config_json", "updated_at"])
        email = "site-member-labelled@example.com"
        r = self.client.post(
            "/users/register/",
            data={
                "email": email,
                "password": "joinpw123456",
                "site_public_id": str(self.site.public_id),
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(
            r.data.get("cta_join", {}).get("site_display_label"),
            "Магазин Омега",
        )

    def test_register_with_session_attribution_snapshots_partner_to_membership(self):
        capture = self.client.post(
            "/referrals/capture/",
            data={"ref": self.partner.ref_code},
            content_type="application/json",
        )
        self.assertEqual(capture.status_code, 200)
        email = "site-attributed@example.com"
        r = self.client.post(
            "/users/register/",
            data={
                "email": email,
                "password": "joinpw123456",
                "site_public_id": str(self.site.public_id),
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 201)
        user = User.objects.get(email=email)
        membership = SiteMembership.objects.get(site=self.site, user=user)
        self.assertEqual(membership.partner_id, self.partner.id)
        self.assertEqual(membership.ref_code, self.partner.ref_code)
        attr = CustomerAttribution.objects.get(partner=self.partner)
        self.assertEqual(attr.customer_user_id, user.id)

    def test_register_with_explicit_ref_code_snapshots_partner_to_membership(self):
        email = "site-explicit-ref@example.com"
        r = self.client.post(
            "/users/register/",
            data={
                "email": email,
                "password": "joinpw123456",
                "site_public_id": str(self.site.public_id),
                "ref_code": self.partner.ref_code,
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 201)
        user = User.objects.get(email=email)
        membership = SiteMembership.objects.get(site=self.site, user=user)
        self.assertEqual(membership.partner_id, self.partner.id)
        self.assertEqual(membership.ref_code, self.partner.ref_code)

    def test_register_explicit_ref_overrides_session_attribution(self):
        other_user = User.objects.create_user(
            username="site_join_partner2",
            email="site-join-partner2@example.com",
            password="secret12",
        )
        other_partner, _ = ensure_partner_profile(other_user)
        self.assertNotEqual(other_partner.id, self.partner.id)

        cap = self.client.post(
            "/referrals/capture/",
            data={"ref": self.partner.ref_code},
            content_type="application/json",
        )
        self.assertEqual(cap.status_code, 200)

        email = "explicit-pref@example.com"
        r = self.client.post(
            "/users/register/",
            data={
                "email": email,
                "password": "joinpw123456",
                "site_public_id": str(self.site.public_id),
                "ref": other_partner.ref_code,
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 201)
        user = User.objects.get(email=email)
        membership = SiteMembership.objects.get(site=self.site, user=user)
        self.assertEqual(membership.partner_id, other_partner.id)
        self.assertEqual(membership.ref_code, other_partner.ref_code)

    def test_register_with_ref_alias_snapshots_partner_like_ref_code(self):
        email = "site-ref-alias@example.com"
        r = self.client.post(
            "/users/register/",
            data={
                "email": email,
                "password": "joinpw123456",
                "site_public_id": str(self.site.public_id),
                "ref": self.partner.ref_code,
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 201)
        user = User.objects.get(email=email)
        membership = SiteMembership.objects.get(site=self.site, user=user)
        self.assertEqual(membership.partner_id, self.partner.id)
        self.assertEqual(membership.ref_code, self.partner.ref_code)

    def test_register_with_active_site_creates_membership(self):
        active_site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_site_active_" + uuid.uuid4().hex,
        )
        active_site.status = Site.Status.ACTIVE
        active_site.activated_at = timezone.now()
        active_site.save(update_fields=["status", "activated_at", "updated_at"])

        email = "active-site-member@example.com"
        r = self.client.post(
            "/users/register/",
            data={
                "email": email,
                "password": "joinpw123456",
                "site_public_id": str(active_site.public_id),
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 201)
        user = User.objects.get(email=email)
        SiteMembership.objects.get(site=active_site, user=user)

    def test_register_rejects_unknown_site_public_id(self):
        email = "missing-site@example.com"
        r = self.client.post(
            "/users/register/",
            data={
                "email": email,
                "password": "joinpw123456",
                "site_public_id": str(uuid.uuid4()),
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("site_public_id", r.data)
        self.assertFalse(User.objects.filter(email=email).exists())
        self.assertEqual(SiteMembership.objects.count(), 0)


class LoggedInSiteCtaJoinTests(TestCase):
    """POST /users/site/join/ — authenticated CTA join (no registration)."""

    def setUp(self):
        self.api = APIClient()
        self.owner = User.objects.create_user(
            username="join_api_owner",
            email="join-api-owner@example.com",
            password="secret12",
        )
        self.member_user = User.objects.create_user(
            username="join_api_member",
            email="join-api-member@example.com",
            password="secret12",
        )
        self.partner_user = User.objects.create_user(
            username="join_api_partner",
            email="join-api-partner@example.com",
            password="secret12",
        )
        self.partner, _ = ensure_partner_profile(self.partner_user)
        self.site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_join_api_" + uuid.uuid4().hex,
        )
        self.site.status = Site.Status.VERIFIED
        self.site.verified_at = timezone.now()
        self.site.save(update_fields=["status", "verified_at", "updated_at"])

    def _post_join(self, user, **body):
        self.api.force_authenticate(user=user)
        return self.api.post("/users/site/join/", data=body, format="json")

    def test_join_creates_membership(self):
        r = self._post_join(
            self.member_user, site_public_id=str(self.site.public_id)
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], "joined")
        self.assertEqual(r.data["site_public_id"], str(self.site.public_id))
        self.assertEqual(r.data.get("site_display_label"), "")
        m = SiteMembership.objects.get(site=self.site, user=self.member_user)
        self.assertEqual(m.joined_via, SiteMembership.JoinedVia.CTA_SIGNUP)

    def test_duplicate_join_is_idempotent(self):
        self._post_join(self.member_user, site_public_id=str(self.site.public_id))
        r2 = self._post_join(
            self.member_user, site_public_id=str(self.site.public_id)
        )
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.data["status"], "already_joined")
        self.assertEqual(SiteMembership.objects.filter(site=self.site).count(), 1)

    def test_join_rejects_draft_site(self):
        draft = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_join_draft_api_" + uuid.uuid4().hex,
        )
        r = self._post_join(self.member_user, site_public_id=str(draft.public_id))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("detail"), "site_not_joinable")
        self.assertEqual(r.data.get("site_status"), Site.Status.DRAFT)

    def test_join_rejects_unknown_site(self):
        r = self._post_join(
            self.member_user, site_public_id=str(uuid.uuid4())
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("site_public_id", r.data)

    def test_explicit_ref_snapshots_partner(self):
        r = self._post_join(
            self.member_user,
            site_public_id=str(self.site.public_id),
            ref_code=self.partner.ref_code,
        )
        self.assertEqual(r.status_code, 200)
        m = SiteMembership.objects.get(site=self.site, user=self.member_user)
        self.assertEqual(m.partner_id, self.partner.id)
        self.assertEqual(m.ref_code, self.partner.ref_code)

    def test_requires_auth(self):
        self.api.force_authenticate(user=None)
        r = self.api.post(
            "/users/site/join/",
            data={"site_public_id": str(self.site.public_id)},
            format="json",
        )
        self.assertEqual(r.status_code, 401)

    def test_service_duplicate_alignment(self):
        m1, o1 = join_site_membership_cta_logged_in(
            site_public_id=self.site.public_id,
            user=self.member_user,
            session_key=None,
            ref_code="",
        )
        m2, o2 = join_site_membership_cta_logged_in(
            site_public_id=self.site.public_id,
            user=self.member_user,
            session_key=None,
            ref_code="",
        )
        self.assertEqual(o1, "joined")
        self.assertEqual(o2, "already_joined")
        self.assertEqual(m1.pk, m2.pk)


class MyProgramsApiTests(TestCase):
    """GET /users/me/programs/ — member list of SiteMembership (referral programs)."""

    def setUp(self):
        self.api = APIClient()
        self.owner = User.objects.create_user(
            username="programs_owner",
            email="programs-owner@example.com",
            password="secret12",
        )
        self.user_a = User.objects.create_user(
            username="programs_a",
            email="programs-a@example.com",
            password="secret12",
        )
        self.user_b = User.objects.create_user(
            username="programs_b",
            email="programs-b@example.com",
            password="secret12",
        )

    def _site(self, key_suffix, **extra):
        s = Site.objects.create(
            owner=self.owner,
            publishable_key=f"pk_prog_{key_suffix}_" + uuid.uuid4().hex,
            **extra,
        )
        s.status = Site.Status.VERIFIED
        s.verified_at = timezone.now()
        s.save(update_fields=["status", "verified_at", "updated_at"])
        return s

    def test_requires_auth(self):
        r = self.api.get("/users/me/programs/")
        self.assertEqual(r.status_code, 401)

    def test_returns_only_current_user_memberships_newest_first(self):
        site_a = self._site("a", config_json={"display_name": "Shop Alpha"})
        site_b = self._site("b", config_json={"display_name": "Shop Beta"})
        m_a = SiteMembership.objects.create(site=site_a, user=self.user_a)
        m_b = SiteMembership.objects.create(site=site_b, user=self.user_a)
        SiteMembership.objects.filter(pk=m_a.pk).update(
            created_at=timezone.now() - timedelta(days=10)
        )
        SiteMembership.objects.filter(pk=m_b.pk).update(
            created_at=timezone.now() - timedelta(days=1)
        )

        other_site = self._site("other")
        SiteMembership.objects.create(site=other_site, user=self.user_b)

        self.api.force_authenticate(user=self.user_a)
        r = self.api.get("/users/me/programs/")
        self.assertEqual(r.status_code, 200)
        programs = r.data["programs"]
        self.assertEqual(len(programs), 2)
        self.assertEqual(programs[0]["site_public_id"], str(site_b.public_id))
        self.assertEqual(programs[0]["site_display_label"], "Shop Beta")
        self.assertEqual(programs[0]["site_status"], Site.Status.VERIFIED)
        self.assertEqual(programs[1]["site_public_id"], str(site_a.public_id))
        self.assertEqual(programs[1]["site_display_label"], "Shop Alpha")
        self.assertNotIn(str(other_site.public_id), [x["site_public_id"] for x in programs])

    def test_other_user_memberships_not_leaked(self):
        site = self._site("leak")
        SiteMembership.objects.create(site=site, user=self.user_b)

        self.api.force_authenticate(user=self.user_a)
        r = self.api.get("/users/me/programs/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["programs"], [])


@override_settings(DEBUG=True, ORDER_WEBHOOK_SHARED_SECRET="")
class AuthAttributionPersistenceTests(TestCase):
    """Session key rotation + anonymous rows must still resolve after login/register."""

    def setUp(self):
        self.partner_user = User.objects.create_user(
            username="persist_partner",
            email="persist_partner@example.com",
            password="pw12345678",
        )
        self.customer = User.objects.create_user(
            username="persist_buyer",
            email="persist_buyer@example.com",
            password="pw12345678",
        )
        self.partner, _ = ensure_partner_profile(self.partner_user)

    def test_anonymous_capture_login_order_attribution_preserved(self):
        c = self.client
        r_cap = c.post(
            "/referrals/capture/",
            data={"ref": self.partner.ref_code},
            content_type="application/json",
        )
        self.assertEqual(r_cap.status_code, 200)
        r_login = c.post(
            "/users/login/",
            data={"email": self.customer.email, "password": "pw12345678"},
            content_type="application/json",
        )
        self.assertEqual(r_login.status_code, 200)
        attr = CustomerAttribution.objects.get(partner=self.partner)
        self.assertEqual(attr.customer_user_id, self.customer.id)

        r_order = c.post(
            "/users/api/orders/",
            data={
                "tranid": "t-login-persist-1",
                "Email": self.customer.email,
                "sum": "60.00",
                "paymentstatus": "paid",
            },
            content_type="application/json",
        )
        self.assertEqual(r_order.status_code, 200)
        order = Order.objects.get(external_id="t-login-persist-1")
        self.assertEqual(order.partner_id, self.partner.id)
        self.assertEqual(order.ref_code, self.partner.ref_code)

    def test_anonymous_capture_register_order_attribution_preserved(self):
        c = self.client
        r_cap = c.post(
            "/referrals/capture/",
            data={"ref": self.partner.ref_code},
            content_type="application/json",
        )
        self.assertEqual(r_cap.status_code, 200)
        new_email = "brand_new_buyer@example.com"
        r_reg = c.post(
            "/users/register/",
            data={
                "email": new_email,
                "password": "newpw123456",
            },
            content_type="application/json",
        )
        self.assertEqual(r_reg.status_code, 201)
        new_user = User.objects.get(email=new_email)
        attr = CustomerAttribution.objects.get(partner=self.partner)
        self.assertEqual(attr.customer_user_id, new_user.id)

        r_order = c.post(
            "/users/api/orders/",
            data={
                "tranid": "t-reg-persist-1",
                "Email": new_email,
                "sum": "70.00",
                "paymentstatus": "paid",
            },
            content_type="application/json",
        )
        self.assertEqual(r_order.status_code, 200)
        order = Order.objects.get(external_id="t-reg-persist-1")
        self.assertEqual(order.partner_id, self.partner.id)

    def test_link_skips_expired_session_attribution(self):
        c = self.client
        c.post(
            "/referrals/capture/",
            data={"ref": self.partner.ref_code},
            content_type="application/json",
        )
        sk = c.session.session_key
        attr = CustomerAttribution.objects.get(partner=self.partner)
        CustomerAttribution.objects.filter(pk=attr.pk).update(
            expires_at=timezone.now() - timezone.timedelta(days=1)
        )
        n = link_session_attributions_to_user(session_key=sk, user=self.customer)
        self.assertEqual(n, 0)
        attr.refresh_from_db()
        self.assertIsNone(attr.customer_user_id)

    def test_newer_user_attribution_not_supplanted_by_linking_older_session_row(self):
        p2_user = User.objects.create_user(
            username="persist_p2",
            email="persist_p2@example.com",
            password="pw12345678",
        )
        partner2, _ = ensure_partner_profile(p2_user)
        t_old = timezone.now() - timezone.timedelta(hours=2)
        t_new = timezone.now() - timezone.timedelta(hours=1)
        exp = timezone.now() + timezone.timedelta(days=30)
        visit = ReferralVisit.objects.create(
            partner=self.partner,
            ref_code=self.partner.ref_code,
            session_key="sk-persist-tie",
        )
        old_row = CustomerAttribution.objects.create(
            partner=self.partner,
            ref_code=self.partner.ref_code,
            customer_user=None,
            session_key="sk-persist-tie",
            source_visit=visit,
            attributed_at=t_old,
            expires_at=exp,
        )
        CustomerAttribution.objects.create(
            partner=partner2,
            ref_code=partner2.ref_code,
            customer_user=self.customer,
            session_key="",
            source_visit=None,
            attributed_at=t_new,
            expires_at=exp,
        )
        link_session_attributions_to_user(session_key="sk-persist-tie", user=self.customer)
        old_row.refresh_from_db()
        self.assertEqual(old_row.customer_user_id, self.customer.id)
        picked = resolve_valid_attribution(user=self.customer)
        self.assertEqual(picked.partner_id, partner2.id)


class OrderWebhookProtectionTests(TestCase):
    def setUp(self):
        self.partner_user = User.objects.create_user(
            username="wh_partner",
            email="wh_partner@example.com",
            password="pw12345678",
        )
        self.customer = User.objects.create_user(
            username="wh_buyer",
            email="wh_buyer@example.com",
            password="pw12345678",
        )
        self.partner, _ = ensure_partner_profile(self.partner_user)

    def test_get_webhook_probe_returns_200_without_secret(self):
        c = Client()
        with override_settings(DEBUG=False, ORDER_WEBHOOK_SHARED_SECRET="hooksecret"):
            r = c.get("/users/api/orders/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            r.json(),
            {"status": "ok", "endpoint": "orders_webhook"},
        )

    def test_head_webhook_probe_returns_200_without_secret(self):
        c = Client()
        with override_settings(DEBUG=False, ORDER_WEBHOOK_SHARED_SECRET="hooksecret"):
            r = c.head("/users/api/orders/")
        self.assertEqual(r.status_code, 200)

    @override_settings(DEBUG=False, ORDER_WEBHOOK_SHARED_SECRET="hooksecret")
    def test_prod_post_without_secret_still_rejected(self):
        c = Client()
        r = c.post(
            "/users/api/orders/",
            data={
                "tranid": "wh-prod-no-secret",
                "Email": self.customer.email,
                "sum": "1.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 401)

    @override_settings(DEBUG=False, ORDER_WEBHOOK_SHARED_SECRET="hooksecret")
    def test_prod_post_with_valid_secret_accepts(self):
        c = Client()
        body = {
            "tranid": "wh-prod-ok",
            "Email": self.customer.email,
            "sum": "9.00",
            "ref": self.partner.ref_code,
            "paymentstatus": "paid",
        }
        r = c.post(
            "/users/api/orders/",
            data=body,
            content_type="application/json",
            HTTP_X_ORDER_WEBHOOK_SECRET="hooksecret",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Order.objects.filter(external_id="wh-prod-ok").count(), 1)

    @override_settings(DEBUG=True, ORDER_WEBHOOK_SHARED_SECRET="hooksecret")
    def test_missing_or_wrong_secret_rejected(self):
        c = Client()
        body = {
            "tranid": "wh-1",
            "Email": self.customer.email,
            "sum": "10.00",
            "ref": self.partner.ref_code,
            "paymentstatus": "paid",
        }
        r0 = c.post("/users/api/orders/", data=body, content_type="application/json")
        self.assertEqual(r0.status_code, 401)
        r1 = c.post(
            "/users/api/orders/",
            data=body,
            content_type="application/json",
            HTTP_X_ORDER_WEBHOOK_SECRET="wrong",
        )
        self.assertEqual(r1.status_code, 401)

    @override_settings(DEBUG=True, ORDER_WEBHOOK_SHARED_SECRET="hooksecret")
    def test_header_secret_accepts(self):
        c = Client()
        body = {
            "tranid": "wh-2",
            "Email": self.customer.email,
            "sum": "12.00",
            "ref": self.partner.ref_code,
            "paymentstatus": "paid",
        }
        r = c.post(
            "/users/api/orders/",
            data=body,
            content_type="application/json",
            HTTP_X_ORDER_WEBHOOK_SECRET="hooksecret",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Order.objects.filter(external_id="wh-2").count(), 1)

    @override_settings(DEBUG=True, ORDER_WEBHOOK_SHARED_SECRET="hooksecret")
    def test_bearer_token_accepts(self):
        c = Client()
        body = {
            "tranid": "wh-3",
            "Email": self.customer.email,
            "sum": "15.00",
            "ref": self.partner.ref_code,
            "paymentstatus": "paid",
        }
        r = c.post(
            "/users/api/orders/",
            data=body,
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer hooksecret",
        )
        self.assertEqual(r.status_code, 200)

    @override_settings(DEBUG=False, ORDER_WEBHOOK_SHARED_SECRET="")
    def test_prod_requires_secret_config(self):
        c = Client()
        r = c.post(
            "/users/api/orders/",
            data={"tranid": "x"},
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 503)
        self.assertIn(b"webhook_secret_not_configured", r.content)

    @override_settings(DEBUG=True, ORDER_WEBHOOK_SHARED_SECRET="hooksecret")
    def test_empty_json_body_rejected(self):
        c = Client()
        r = c.post(
            "/users/api/orders/",
            data={},
            content_type="application/json",
            HTTP_X_ORDER_WEBHOOK_SECRET="hooksecret",
        )
        self.assertEqual(r.status_code, 400)

    @override_settings(DEBUG=True, ORDER_WEBHOOK_SHARED_SECRET="hooksecret")
    def test_duplicate_paid_webhook_http_no_double_commission(self):
        c = Client()
        body = {
            "tranid": "wh-dup-1",
            "Email": self.customer.email,
            "sum": "100.00",
            "ref": self.partner.ref_code,
            "paymentstatus": "paid",
        }
        hdr = {"HTTP_X_ORDER_WEBHOOK_SECRET": "hooksecret"}
        r1 = c.post(
            "/users/api/orders/", data=body, content_type="application/json", **hdr
        )
        r2 = c.post(
            "/users/api/orders/", data=body, content_type="application/json", **hdr
        )
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        order = Order.objects.get(external_id="wh-dup-1")
        self.assertEqual(order.status, Order.Status.PAID)
        self.assertEqual(Commission.objects.filter(order=order).count(), 1)
        self.partner.refresh_from_db()
        self.assertEqual(self.partner.balance_total, Decimal("10.00"))
