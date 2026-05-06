from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from referrals.models import (
    Commission,
    CustomerAttribution,
    Order,
    ReferralVisit,
    Site,
    SiteMembership,
)
from referrals.services import (
    ensure_partner_profile,
    generate_ref_code,
    attach_attribution_to_order,
    partner_dashboard_payload,
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

    def test_order_gets_partner_ref_from_page_url_when_ref_key_missing(self):
        """Tilda shop blocks often omit ``ref`` but send Page URL containing ``?ref=``."""
        rc = self.partner.ref_code
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-from-pageurl",
                "Email": self.customer.email,
                "total": "42.50",
                "pageurl": f"https://shop.example/item?utm=1&ref={rc}&src=tilda",
                "paymentstatus": "pending",
            }
        )
        order.refresh_from_db()
        self.assertEqual(order.partner_id, self.partner.id)
        self.assertEqual(order.amount, Decimal("42.50"))

    def test_amount_reads_total_alias(self):
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-total-alias",
                "Email": self.customer.email,
                "total": "17.25",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            }
        )
        self.assertEqual(order.amount, Decimal("17.25"))

    def test_amount_reads_formprice_and_payment_sum_aliases(self):
        o1, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-formprice",
                "Email": self.customer.email,
                "Formprice": "88.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            }
        )
        self.assertEqual(o1.amount, Decimal("88.00"))
        o2, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-pay-sum",
                "Email": self.customer.email,
                "payment_sum": "55.25",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            }
        )
        self.assertEqual(o2.amount, Decimal("55.25"))

    def test_payment_field_numeric_amount_when_not_flag(self):
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-pay-field-amt",
                "Email": self.customer.email,
                "payment": "1999.50",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            }
        )
        self.assertEqual(order.amount, Decimal("1999.50"))

    def test_payment_flag_one_does_not_become_amount(self):
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-pay-flag-only",
                "Email": self.customer.email,
                "payment": "1",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            }
        )
        self.assertEqual(order.amount, Decimal("0.00"))

    def test_payment_phone_like_digits_not_used_as_amount(self):
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-pay-phone-ish",
                "Email": self.customer.email,
                "payment": "79161234567",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            }
        )
        self.assertEqual(order.amount, Decimal("0.00"))

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

    def test_commission_uses_site_percent_from_order_payload(self):
        site = Site.objects.create(
            owner=self.partner_user,
            publishable_key="pk-site-5pct",
            config_json={"commission_percent": "5.00"},
        )
        SiteMembership.objects.create(
            site=site,
            user=self.partner_user,
            partner=self.partner,
            ref_code=self.partner.ref_code,
        )
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-site-5pct",
                "Email": self.customer.email,
                "sum": "400000.00",
                "ref": self.partner.ref_code,
                "site_public_id": str(site.public_id),
                "paymentstatus": "paid",
            }
        )
        c = Commission.objects.get(order=order)
        self.assertEqual(c.commission_percent, Decimal("5.00"))
        self.assertEqual(c.commission_amount, Decimal("20000.00"))

    def test_commission_uses_site_percent_from_membership_fallback(self):
        site = Site.objects.create(
            owner=self.partner_user,
            publishable_key="pk-site-membership-7pct",
            config_json={"commission_percent": "7.00"},
        )
        SiteMembership.objects.create(
            site=site,
            user=self.partner_user,
            partner=self.partner,
            ref_code=self.partner.ref_code,
        )
        order, _ = upsert_order_from_tilda_payload(
            {
                "tranid": "t-site-member-7pct",
                "Email": self.customer.email,
                "sum": "1000.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
            }
        )
        c = Commission.objects.get(order=order)
        self.assertEqual(c.commission_percent, Decimal("7.00"))
        self.assertEqual(c.commission_amount, Decimal("70.00"))

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

    @override_settings(REFERRAL_MVP_ASSUME_PAID_IF_AMOUNT_PRESENT=False)
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
        self.assertEqual(dash["attributed_orders_amount_total"], "30.00")
        self.assertEqual(len(dash["recent_orders"]), 1)
        self.assertEqual(dash["recent_orders"][0]["status"], Order.Status.PAID)
        self.assertEqual(Decimal(dash["commissions_total"]), Decimal("3.00"))
        self.assertEqual(len(dash["commission_history"]), 1)
        self.assertEqual(dash["total_leads_count"], 0)
        self.assertEqual(dash["recent_leads"], [])

