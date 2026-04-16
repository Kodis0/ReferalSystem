from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import Commission, CustomerAttribution, Order, PartnerProfile, ReferralVisit
from referrals.services import (
    attach_attribution_to_order,
    ensure_partner_profile,
    generate_ref_code,
    link_session_attributions_to_user,
    resolve_valid_attribution,
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
        r2 = self.api.get("/referrals/partner/me/")
        self.assertEqual(r2.status_code, 200)
        self.assertIn("referral_link", r2.data)


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
