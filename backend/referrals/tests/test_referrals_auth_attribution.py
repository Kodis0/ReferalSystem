from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from referrals.models import CustomerAttribution, Order, ReferralVisit
from referrals.services import (
    ensure_partner_profile,
    link_session_attributions_to_user,
    resolve_valid_attribution,
)

User = get_user_model()


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


