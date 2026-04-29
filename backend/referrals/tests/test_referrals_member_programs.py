import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import PartnerProfile, Site, SiteMembership

User = get_user_model()


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

    def test_programs_catalog_requires_auth(self):
        r = self.api.get("/users/programs/")
        self.assertEqual(r.status_code, 401)

    def test_programs_catalog_lists_joinable_sites_with_joined_flag(self):
        joined_site = self._site(
            "catalog_joined",
            allowed_origins=["https://joined.example"],
            config_json={"site_display_name": "Joined Site"},
        )
        available_site = self._site(
            "catalog_available",
            allowed_origins=["https://available.example"],
            config_json={"site_display_name": "Available Site"},
        )
        draft_site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_prog_catalog_draft_" + uuid.uuid4().hex,
            allowed_origins=["https://draft.example"],
            widget_enabled=False,
            status=Site.Status.DRAFT,
            config_json={"site_display_name": "Draft Site"},
        )
        empty_draft_site = Site.objects.create(
            owner=self.owner,
            publishable_key="",
            allowed_origins=[],
            widget_enabled=False,
            status=Site.Status.DRAFT,
            config_json={"site_display_name": "Empty Draft Site"},
        )
        membership = SiteMembership.objects.create(site=joined_site, user=self.user_a)

        self.api.force_authenticate(user=self.user_a)
        r = self.api.get("/users/programs/")
        self.assertEqual(r.status_code, 200)
        programs = r.data["programs"]
        ids = [x["site_public_id"] for x in programs]
        self.assertIn(str(joined_site.public_id), ids)
        self.assertIn(str(available_site.public_id), ids)
        self.assertIn(str(draft_site.public_id), ids)
        self.assertNotIn(str(empty_draft_site.public_id), ids)

        joined = next(x for x in programs if x["site_public_id"] == str(joined_site.public_id))
        available = next(x for x in programs if x["site_public_id"] == str(available_site.public_id))
        self.assertTrue(joined["joined"])
        self.assertEqual(joined["joined_at"], membership.created_at.isoformat())
        self.assertEqual(joined["site_origin_label"], "joined.example")
        self.assertFalse(available["joined"])
        self.assertNotIn("joined_at", available)

    def test_returns_only_current_user_memberships_newest_first(self):
        site_a = self._site("a", config_json={"site_display_name": "Shop Alpha"})
        site_b = self._site("b", config_json={"site_display_name": "Shop Beta"})
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
        self.assertEqual(programs[0]["site_origin_label"], "")
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

    def test_member_label_uses_site_not_project_display_name(self):
        site = self._site(
            "site_label",
            allowed_origins=["https://site-only.example"],
            config_json={"display_name": "Общий проект"},
        )
        SiteMembership.objects.create(site=site, user=self.user_a)

        self.api.force_authenticate(user=self.user_a)
        r = self.api.get("/users/me/programs/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["programs"][0]["site_display_label"], "site-only.example")
        self.assertEqual(r.data["programs"][0]["site_origin_label"], "site-only.example")

    def test_program_detail_requires_auth(self):
        site = self._site("detail_auth", config_json={"site_display_name": "Detail Shop"})
        r = self.api.get(f"/users/me/programs/{site.public_id}/")
        self.assertEqual(r.status_code, 401)

    def test_program_catalog_detail_requires_auth(self):
        site = self._site("catalog_detail_auth", config_json={"site_display_name": "Detail Shop"})
        r = self.api.get(f"/users/programs/{site.public_id}/")
        self.assertEqual(r.status_code, 401)

    def test_program_catalog_detail_returns_unjoined_program(self):
        site = self._site(
            "catalog_detail_unjoined",
            allowed_origins=["https://detail.example"],
            config_json={"site_display_name": "Detail Shop", "site_description": "Public terms"},
        )

        self.api.force_authenticate(user=self.user_a)
        r = self.api.get(f"/users/programs/{site.public_id}/")
        self.assertEqual(r.status_code, 200)
        prog = r.data["program"]
        self.assertEqual(prog["site_public_id"], str(site.public_id))
        self.assertEqual(prog["site_display_label"], "Detail Shop")
        self.assertEqual(prog["site_origin_label"], "detail.example")
        self.assertEqual(prog["site_description"], "Public terms")
        self.assertEqual(prog["site_status"], Site.Status.VERIFIED)
        self.assertTrue(prog["program_active"])
        self.assertFalse(prog["joined"])
        self.assertNotIn("joined_at", prog)
        self.assertNotIn("ref_code", prog)

    def test_program_catalog_detail_allows_widget_seen_draft_without_manual_verify(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_prog_catalog_detail_seen_" + uuid.uuid4().hex,
            widget_enabled=True,
            last_widget_seen_at=timezone.now(),
            last_widget_seen_origin="https://detail-seen.example",
            config_json={"site_display_name": "Seen Draft"},
        )

        self.api.force_authenticate(user=self.user_a)
        r = self.api.get(f"/users/programs/{site.public_id}/")
        self.assertEqual(r.status_code, 200)
        prog = r.data["program"]
        self.assertEqual(prog["site_public_id"], str(site.public_id))
        self.assertEqual(prog["site_status"], Site.Status.DRAFT)
        self.assertTrue(prog["program_active"])
        self.assertFalse(prog["joined"])

    @override_settings(FRONTEND_URL="https://app.example.com")
    def test_program_catalog_detail_returns_joined_member_fields(self):
        site = self._site("catalog_detail_joined", config_json={"site_display_name": "Joined Detail"})
        PartnerProfile.objects.create(user=self.user_a, ref_code="ABC123")
        m = SiteMembership.objects.create(site=site, user=self.user_a)
        SiteMembership.objects.filter(pk=m.pk).update(
            created_at=timezone.now() - timedelta(days=2)
        )
        m.refresh_from_db()

        self.api.force_authenticate(user=self.user_a)
        r = self.api.get(f"/users/programs/{site.public_id}/")
        self.assertEqual(r.status_code, 200)
        prog = r.data["program"]
        self.assertTrue(prog["joined"])
        self.assertEqual(prog["joined_at"], m.created_at.isoformat())
        self.assertEqual(prog["ref_code"], "ABC123")
        self.assertEqual(prog["referral_link"], "https://app.example.com/?ref=ABC123")

    def test_program_catalog_detail_unavailable_site_returns_404(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="",
            allowed_origins=[],
            widget_enabled=False,
            status=Site.Status.DRAFT,
            config_json={"site_display_name": "Unavailable Site"},
        )

        self.api.force_authenticate(user=self.user_a)
        r = self.api.get(f"/users/programs/{site.public_id}/")
        self.assertEqual(r.status_code, 404)

    def test_program_catalog_detail_then_join_creates_membership(self):
        site = self._site("catalog_detail_join_flow", config_json={"site_display_name": "Join Flow"})

        self.api.force_authenticate(user=self.user_a)
        detail = self.api.get(f"/users/programs/{site.public_id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertFalse(detail.data["program"]["joined"])

        joined = self.api.post(
            "/users/site/join/",
            data={"site_public_id": str(site.public_id)},
            format="json",
        )
        self.assertEqual(joined.status_code, 200)
        self.assertTrue(SiteMembership.objects.filter(site=site, user=self.user_a).exists())

    def test_program_detail_own_membership(self):
        site = self._site(
            "detail_own",
            config_json={"site_display_name": "Detail Own", "site_description": "Detail description"},
        )
        m = SiteMembership.objects.create(site=site, user=self.user_a)
        SiteMembership.objects.create(site=site, user=self.user_b)
        SiteMembership.objects.filter(pk=m.pk).update(
            created_at=timezone.now() - timedelta(days=3)
        )
        m.refresh_from_db()

        self.api.force_authenticate(user=self.user_a)
        r = self.api.get(f"/users/me/programs/{site.public_id}/")
        self.assertEqual(r.status_code, 200)
        prog = r.data["program"]
        self.assertEqual(prog["site_public_id"], str(site.public_id))
        self.assertEqual(prog["site_display_label"], "Detail Own")
        self.assertEqual(prog["site_origin_label"], "")
        self.assertEqual(prog["site_description"], "Detail description")
        self.assertEqual(prog["site_status"], Site.Status.VERIFIED)
        self.assertTrue(prog["program_active"])
        self.assertEqual(prog["referral_lock_days"], int(getattr(settings, "REFERRAL_ATTRIBUTION_TTL_DAYS", 30)))
        self.assertEqual(prog["participants_count"], 2)
        self.assertEqual(prog["joined_at"], m.created_at.isoformat())

    def test_program_detail_other_user_forbidden(self):
        site = self._site("detail_other", config_json={"site_display_name": "Other Only"})
        SiteMembership.objects.create(site=site, user=self.user_b)

        self.api.force_authenticate(user=self.user_a)
        r = self.api.get(f"/users/me/programs/{site.public_id}/")
        self.assertEqual(r.status_code, 404)

    def test_program_detail_unknown_site(self):
        self.api.force_authenticate(user=self.user_a)
        unknown = uuid.uuid4()
        r = self.api.get(f"/users/me/programs/{unknown}/")
        self.assertEqual(r.status_code, 404)
