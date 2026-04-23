import uuid

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import CustomerAttribution, Project, Site, SiteMembership
from referrals.services import (
    DEFAULT_OWNER_PROJECT_NAME,
    ensure_partner_profile,
    join_site_membership_cta_logged_in,
    site_cta_display_label,
)

User = get_user_model()


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

    def test_register_creates_default_owner_project(self):
        email = "default-project@example.com"
        r = self.client.post(
            "/users/register/",
            data={
                "email": email,
                "password": "joinpw123456",
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 201)
        user = User.objects.get(email=email)
        project = Project.objects.get(owner=user, is_default=True)
        self.assertEqual(project.name, DEFAULT_OWNER_PROJECT_NAME)
        self.assertEqual(project.description, "")
        self.assertTrue(project.avatar_data_url.startswith("data:image/svg+xml;base64,"))

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


