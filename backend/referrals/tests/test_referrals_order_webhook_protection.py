from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings

from referrals.models import Commission, Order
from referrals.services import ensure_partner_profile

User = get_user_model()


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
