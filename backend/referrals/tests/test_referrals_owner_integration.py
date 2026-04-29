import datetime
import uuid
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import (
    Project,
    PublicLeadIngestAudit,
    ReferralLeadEvent,
    Site,
    SiteMembership,
    SiteOwnerActivityLog,
)
from referrals.owner_site_activity import normalize_legacy_activity_message
from referrals.serializers import SiteOwnerIntegrationUpdateSerializer
from referrals.services import DEFAULT_OWNER_PROJECT_NAME, ensure_partner_profile
from referrals.widget_install_verify import build_default_verify_page_url
from users.views import _member_program_payload

User = get_user_model()


class SiteOwnerIntegrationApiTests(TestCase):
    def setUp(self):
        cache.clear()
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
        project = Project.objects.create(
            owner=self.owner,
            name="Canonical project",
            description="Canonical description",
            avatar_data_url="data:image/png;base64,AAA",
        )
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_integration_test",
            allowed_origins=["https://shop.example"],
            platform_preset=Site.PlatformPreset.TILDA,
            config_json={"amount_selector": ".price", "display_name": "Legacy site name"},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["publishable_key"], "pk_integration_test")
        self.assertEqual(r.data["allowed_origins"], ["https://shop.example"])
        self.assertEqual(r.data["platform_preset"], Site.PlatformPreset.TILDA)
        self.assertEqual(r.data["config_json"], {"amount_selector": ".price", "display_name": "Legacy site name"})
        self.assertEqual(
            r.data["project"],
            {
                "id": project.id,
                "name": "Canonical project",
                "description": "Canonical description",
                "avatar_data_url": "data:image/png;base64,AAA",
                "is_default": False,
            },
        )
        self.assertTrue(r.data["widget_enabled"])
        snippet = r.data["widget_embed_snippet"]
        self.assertIn("https://app.example.com/widgets/referral-widget.v1.js", snippet)
        self.assertIn('data-rs-api="https://api.example.com"', snippet)
        self.assertIn(f'data-rs-site="{site.public_id}"', snippet)
        self.assertIn('data-rs-key="pk_integration_test"', snippet)
        self.assertEqual(r.data.get("site_avatar_data_url"), "")
        self.assertEqual(r.data.get("commission_percent"), "5.00")
        self.assertEqual(r.data.get("referral_lock_days"), 30)
        self.assertEqual(r.data.get("verification_url"), "")
        self.assertEqual(r.data.get("verification_status"), Site.VerificationStatus.NOT_STARTED)
        self.assertIsNone(r.data.get("last_verification_at"))

    def test_patch_site_commission_percent_validates_minimum(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_commission_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            config_json={},
        )
        self.api.force_authenticate(self.owner)
        url = f"/referrals/site/integration/?site_public_id={site.public_id}"

        r_low = self.api.patch(url, {"commission_percent": "4.99"}, format="json")
        self.assertEqual(r_low.status_code, 400)
        self.assertIn("commission_percent", r_low.data)

        r = self.api.patch(url, {"commission_percent": "7.50"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["commission_percent"], "7.50")
        site.refresh_from_db()
        self.assertEqual(site.config_json.get("commission_percent"), "7.50")

    def test_patch_site_referral_lock_days(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_lock_days_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            config_json={},
        )
        self.api.force_authenticate(self.owner)
        url = f"/referrals/site/integration/?site_public_id={site.public_id}"

        r_low = self.api.patch(url, {"referral_lock_days": 0}, format="json")
        self.assertEqual(r_low.status_code, 400)
        self.assertIn("referral_lock_days", r_low.data)

        r_high = self.api.patch(url, {"referral_lock_days": 366}, format="json")
        self.assertEqual(r_high.status_code, 400)
        self.assertIn("referral_lock_days", r_high.data)

        r_invalid = self.api.patch(url, {"referral_lock_days": "abc"}, format="json")
        self.assertEqual(r_invalid.status_code, 400)
        self.assertIn("referral_lock_days", r_invalid.data)

        r_empty = self.api.patch(url, {"referral_lock_days": ""}, format="json")
        self.assertEqual(r_empty.status_code, 400)
        self.assertIn("referral_lock_days", r_empty.data)

        r = self.api.patch(url, {"referral_lock_days": 45}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["referral_lock_days"], 45)
        site.refresh_from_db()
        self.assertEqual(site.config_json.get("referral_lock_days"), 45)

        r_get = self.api.get(url)
        self.assertEqual(r_get.status_code, 200)
        self.assertEqual(r_get.data["referral_lock_days"], 45)

    def test_site_owner_integration_update_serializer_save_merges_referral_lock_days(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_ser_rld_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            config_json={"site_display_name": "Old"},
        )
        ser = SiteOwnerIntegrationUpdateSerializer(site, data={"referral_lock_days": 60}, partial=True)
        self.assertTrue(ser.is_valid(), ser.errors)
        self.assertEqual(ser.validated_data.get("referral_lock_days"), 60)
        obj = ser.save()
        self.assertEqual(obj.pk, site.pk)
        site.refresh_from_db()
        self.assertEqual(site.config_json.get("referral_lock_days"), 60)
        self.assertEqual(site.config_json.get("site_display_name"), "Old")

    def test_patch_referral_lock_days_reflects_in_program_payload(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_payload_rld_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            config_json={},
        )
        self.api.force_authenticate(self.owner)
        url = f"/referrals/site/integration/?site_public_id={site.public_id}"
        r = self.api.patch(url, {"referral_lock_days": 60}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["referral_lock_days"], 60)
        site.refresh_from_db()
        self.assertEqual(site.config_json.get("referral_lock_days"), 60)
        r_get = self.api.get(url)
        self.assertEqual(r_get.status_code, 200)
        self.assertEqual(r_get.data["referral_lock_days"], 60)
        payload = _member_program_payload(site)
        self.assertEqual(payload["referral_lock_days"], 60)

    def test_patch_site_avatar_does_not_change_project_avatar(self):
        project = Project.objects.create(
            owner=self.owner,
            name="Proj",
            description="",
            avatar_data_url="data:image/png;base64,PROJ",
        )
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_site_av_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            config_json={},
        )
        self.api.force_authenticate(self.owner)
        url = f"/referrals/site/integration/?site_public_id={site.public_id}"
        r = self.api.patch(url, {"site_avatar_data_url": "data:image/png;base64,SITE"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("site_avatar_data_url"), "data:image/png;base64,SITE")
        site.refresh_from_db()
        self.assertEqual(site.config_json.get("site_avatar_data_url"), "data:image/png;base64,SITE")
        project.refresh_from_db()
        self.assertEqual(project.avatar_data_url, "data:image/png;base64,PROJ")

        r2 = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r2.status_code, 200)
        flat = r2.data.get("sites") or []
        row = next((s for s in flat if s["public_id"] == str(site.public_id)), None)
        self.assertIsNotNone(row)
        self.assertEqual(row.get("avatar_data_url"), "data:image/png;base64,SITE")

    def test_patch_referral_builder_workspace_merges_into_config_json(self):
        project = Project.objects.create(owner=self.owner, name="P", description="")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_rb_ws_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            config_json={"display_name": "X", "amount_selector": ".price"},
        )
        self.api.force_authenticate(self.owner)
        url = f"/referrals/site/integration/?site_public_id={site.public_id}"
        workspace = {
            "v": 1,
            "scanUrl": "https://shop.example/page",
            "scannedBlocks": [],
            "scanMeta": {"visualMode": "screenshot"},
            "builderBlocks": [],
            "flowNodePositions": {"imported-page-stack": {"x": 12, "y": 34}},
            "selectedInsertionSlotId": "",
        }
        r = self.api.patch(url, {"referral_builder_workspace": workspace}, format="json")
        self.assertEqual(r.status_code, 200)
        site.refresh_from_db()
        cfg = site.config_json
        self.assertEqual(cfg.get("referral_builder_workspace"), workspace)
        self.assertEqual(cfg.get("amount_selector"), ".price")
        # Integration PATCH re-applies project metadata into config_json (display_name follows Project.name).
        self.assertEqual(cfg.get("display_name"), "P")

    def test_get_requires_auth(self):
        r = self.api.get("/referrals/site/integration/")
        self.assertEqual(r.status_code, 401)

    def test_owner_sites_list_requires_auth(self):
        r = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r.status_code, 401)

    def test_owner_sites_list_empty(self):
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data["projects"]), 1)
        default_card = r.data["projects"][0]
        self.assertTrue(default_card["is_default"])
        self.assertEqual(default_card["project"]["name"], DEFAULT_OWNER_PROJECT_NAME)
        self.assertEqual(default_card["sites_count"], 0)
        self.assertEqual(r.data["sites"], [])

    def test_owner_sites_list_contract_nested_project_and_flat_site_keys(self):
        """Load-bearing LK shape: top-level ``projects`` / ``sites``, card keys, nested ``sites`` keys."""
        project = Project.objects.create(owner=self.owner, name="ContractProj", description="d")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_contract_" + uuid.uuid4().hex,
            allowed_origins=["https://contract.example"],
            config_json={"display_name": "Shown"},
            platform_preset=Site.PlatformPreset.GENERIC,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r.status_code, 200)
        data = r.data
        self.assertIsInstance(data.get("projects"), list)
        self.assertIsInstance(data.get("sites"), list)
        self.assertEqual(len(data["projects"]), 2)
        card = next(p for p in data["projects"] if p["id"] == project.id)
        for key in ("id", "is_default", "project", "primary_site_public_id", "sites_count", "sites"):
            self.assertIn(key, card, msg=f"missing project-card key: {key}")
        self.assertEqual(card["id"], project.id)
        self.assertEqual(card["sites_count"], 1)
        self.assertEqual(card["primary_site_public_id"], str(site.public_id))
        proj_meta = card["project"]
        for key in ("id", "name", "description", "avatar_data_url", "is_default"):
            self.assertIn(key, proj_meta, msg=f"missing nested project meta key: {key}")
        self.assertEqual(len(card["sites"]), 1)
        nested = card["sites"][0]
        for key in (
            "public_id",
            "project_id",
            "primary_origin",
            "primary_origin_label",
            "display_name",
            "widget_enabled",
            "platform_preset",
            "project",
        ):
            self.assertIn(key, nested, msg=f"missing nested site key: {key}")
        self.assertEqual(nested["public_id"], str(site.public_id))
        self.assertEqual(len(data["sites"]), 1)
        flat = data["sites"][0]
        self.assertEqual(flat["public_id"], str(site.public_id))
        for key in ("public_id", "project_id", "primary_origin", "display_name", "project"):
            self.assertIn(key, flat, msg=f"missing flat site list key: {key}")

    def test_owner_sites_list_includes_empty_projects(self):
        project = Project.objects.create(
            owner=self.owner,
            name="Empty project",
            description="No sites yet",
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data["projects"]), 2)
        row = next(p for p in r.data["projects"] if p["id"] == project.id)
        self.assertEqual(row["project"]["name"], "Empty project")
        self.assertEqual(row["sites_count"], 0)
        self.assertEqual(row["primary_site_public_id"], "")
        self.assertEqual(row["sites"], [])

    def test_owner_sites_list_persists_generated_avatar_when_project_avatar_empty(self):
        project = Project.objects.create(
            owner=self.owner,
            name="Legacy empty avatar",
            description="",
            avatar_data_url="",
        )
        self.assertEqual(project.avatar_data_url, "")
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r.status_code, 200)
        row = next(p for p in r.data["projects"] if p["id"] == project.id)
        url = row["project"]["avatar_data_url"]
        self.assertTrue(url.startswith("data:image/svg+xml;base64,"))
        project.refresh_from_db()
        self.assertEqual(project.avatar_data_url, url)

    def test_owner_sites_list_projects_ordered_oldest_first_newest_last(self):
        older_project = Project.objects.create(
            owner=self.owner,
            name="Older project",
            description="Older description",
        )
        older = Site.objects.create(
            owner=self.owner,
            project=older_project,
            publishable_key="pk_older_" + uuid.uuid4().hex,
            allowed_origins=["https://older.example"],
            config_json={"display_name": "Legacy older"},
        )
        newer_project = Project.objects.create(
            owner=self.owner,
            name="Newer project",
            description="Newer description",
        )
        newer = Site.objects.create(
            owner=self.owner,
            project=newer_project,
            publishable_key="pk_newer_" + uuid.uuid4().hex,
            allowed_origins=["https://newer.example"],
            config_json={"display_name": "Legacy newer"},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data["projects"]), 3)
        self.assertTrue(r.data["projects"][0]["is_default"])
        self.assertEqual(r.data["projects"][0]["sites_count"], 0)
        self.assertEqual(r.data["projects"][1]["primary_site_public_id"], str(older.public_id))
        self.assertEqual(r.data["projects"][2]["primary_site_public_id"], str(newer.public_id))
        self.assertEqual(r.data["projects"][1]["project"]["name"], "Older project")
        self.assertEqual(r.data["projects"][2]["project"]["name"], "Newer project")
        ids = [row["public_id"] for row in r.data["sites"]]
        self.assertEqual(len(ids), 2)
        self.assertEqual(ids[0], str(newer.public_id))
        self.assertEqual(ids[1], str(older.public_id))
        names = {row["public_id"]: row["display_name"] for row in r.data["sites"]}
        self.assertEqual(names[str(older.public_id)], "Older project")
        self.assertEqual(names[str(newer.public_id)], "Newer project")
        projects = {row["public_id"]: row["project"] for row in r.data["sites"]}
        self.assertEqual(projects[str(older.public_id)]["description"], "Older description")
        self.assertEqual(projects[str(newer.public_id)]["description"], "Newer description")
        for row in r.data["sites"]:
            self.assertIn("description", row)
            self.assertIn("project", row)

    def test_owner_sites_list_default_project_first_even_if_newer_than_others(self):
        """Default owner project stays first in /owner-sites/ even if created_at is newest."""
        legacy = Project.objects.create(
            owner=self.owner,
            name="Legacy non-default",
            description="",
            is_default=False,
        )
        Site.objects.create(
            owner=self.owner,
            project=legacy,
            publishable_key="pk_legacy_order_" + uuid.uuid4().hex,
            allowed_origins=["https://legacy-order.example"],
            config_json={"display_name": "Legacy non-default"},
        )
        default = Project.objects.get(owner=self.owner, is_default=True)
        future = timezone.now() + datetime.timedelta(days=30)
        past = timezone.now() - datetime.timedelta(days=30)
        Project.objects.filter(pk=default.pk).update(created_at=future)
        Project.objects.filter(pk=legacy.pk).update(created_at=past)

        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["projects"][0]["is_default"])
        self.assertEqual(r.data["projects"][0]["id"], default.id)
        self.assertEqual(r.data["projects"][1]["id"], legacy.id)

    def test_owner_sites_list_primary_origin_prefers_longest_hostname(self):
        project = Project.objects.create(owner=self.owner, name="Mixed origins", description="")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_mixed_" + uuid.uuid4().hex,
            allowed_origins=[
                "xn--80aa",
                "https://aaaaaaaa-long-hostname.example.com/path",
            ],
            config_json={},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r.status_code, 200)
        row = next(s for s in r.data["sites"] if s["public_id"] == str(site.public_id))
        self.assertEqual(row["primary_origin"], "https://aaaaaaaa-long-hostname.example.com/path")
        self.assertEqual(row["primary_origin_label"], "aaaaaaaa-long-hostname.example.com")

    def test_owner_sites_list_primary_origin_label_decodes_idna(self):
        project = Project.objects.create(owner=self.owner, name="IDNA project", description="")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_idna_" + uuid.uuid4().hex,
            allowed_origins=["https://xn--e1afmkfd.xn--p1ai"],
            config_json={},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r.status_code, 200)
        row = next(s for s in r.data["sites"] if s["public_id"] == str(site.public_id))
        self.assertEqual(row["primary_origin"], "https://xn--e1afmkfd.xn--p1ai")
        self.assertEqual(row["primary_origin_label"], "пример.рф")

    def test_bootstrap_requires_auth(self):
        r = self.api.post("/referrals/site/bootstrap/")
        self.assertEqual(r.status_code, 401)

    def test_get_missing_site(self):
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data["detail"], "site_missing")
        self.assertEqual(r.data.get("code"), "site_missing")

    @override_settings(
        FRONTEND_URL="https://app.example.com",
        PUBLIC_API_BASE="https://api.example.com",
    )
    def test_bootstrap_creates_first_site(self):
        self.api.force_authenticate(self.owner)
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 0)
        self.assertEqual(Project.objects.filter(owner=self.owner).count(), 1)
        r = self.api.post("/referrals/site/bootstrap/")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 1)
        self.assertEqual(Project.objects.filter(owner=self.owner).count(), 2)
        self.assertIn("publishable_key", r.data)
        self.assertIn("widget_embed_snippet", r.data)
        site = Site.objects.select_related("project").get(owner=self.owner)
        self.assertEqual(r.data["publishable_key"], site.publishable_key)
        self.assertIsNotNone(site.project)
        self.assertEqual(site.project.owner_id, self.owner.id)
        self.assertEqual(site.project.name, "")
        self.assertEqual(site.project.description, "")
        self.assertTrue(site.project.avatar_data_url.startswith("data:image/svg+xml;base64,"))

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
    def test_owner_can_create_first_site_via_create_endpoint(self):
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            "/referrals/site/create/",
            data={
                "display_name": "First shop",
                "description": "First description",
                "origin": "first.example",
                "platform_preset": Site.PlatformPreset.TILDA,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 1)
        self.assertEqual(Project.objects.filter(owner=self.owner).count(), 2)
        newest = (
            Site.objects.select_related("project")
            .filter(owner=self.owner)
            .order_by("-created_at", "-id")
            .first()
        )
        self.assertEqual(r.data["public_id"], str(newest.public_id))
        self.assertEqual(newest.allowed_origins, ["https://first.example"])
        self.assertEqual(newest.config_json.get("display_name"), "First shop")
        self.assertEqual(newest.config_json.get("description"), "First description")
        self.assertEqual(newest.platform_preset, Site.PlatformPreset.TILDA)
        self.assertIsNotNone(newest.project)
        self.assertEqual(newest.project.owner_id, self.owner.id)
        self.assertEqual(newest.project.name, "First shop")
        self.assertEqual(newest.project.description, "First description")
        self.assertTrue(newest.project.avatar_data_url.startswith("data:image/svg+xml;base64,"))
        r_owner = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r_owner.status_code, 200)
        card = next(p for p in r_owner.data["projects"] if p["id"] == newest.project_id)
        self.assertEqual(card["sites_count"], 1)
        self.assertEqual(card["primary_site_public_id"], str(newest.public_id))
        self.assertEqual(len(card["sites"]), 1)
        self.assertEqual(card["sites"][0]["public_id"], str(newest.public_id))

    def test_owner_can_create_project_without_creating_site(self):
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            "/referrals/project/create/",
            data={
                "display_name": "Standalone project",
                "description": "Only project",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Project.objects.filter(owner=self.owner).count(), 2)
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 0)
        project = Project.objects.get(owner=self.owner, name="Standalone project")
        self.assertEqual(project.name, "Standalone project")
        self.assertEqual(project.description, "Only project")
        self.assertTrue(project.avatar_data_url.startswith("data:image/svg+xml;base64,"))
        self.assertEqual(r.data["id"], project.id)
        self.assertEqual(r.data["sites_count"], 0)
        self.assertEqual(r.data["primary_site_public_id"], "")

    def test_owner_can_get_and_patch_project_without_site(self):
        project = Project.objects.create(owner=self.owner, name="Before", description="Before description")
        self.api.force_authenticate(self.owner)
        r_get = self.api.get(f"/referrals/project/{project.id}/")
        self.assertEqual(r_get.status_code, 200)
        d = r_get.data
        self.assertEqual(
            set(d.keys()),
            {"id", "is_default", "project", "primary_site_public_id", "sites_count", "sites"},
        )
        self.assertEqual(d["id"], project.id)
        self.assertIsInstance(d["is_default"], bool)
        self.assertEqual(d["sites_count"], 0)
        self.assertEqual(d["primary_site_public_id"], "")
        self.assertIsInstance(d["sites"], list)
        self.assertEqual(d["sites"], [])
        pm = d["project"]
        self.assertEqual(
            set(pm.keys()),
            {"id", "name", "description", "avatar_data_url", "is_default"},
        )
        self.assertEqual(pm["id"], project.id)
        self.assertEqual(pm["name"], "Before")
        self.assertIsInstance(pm["avatar_data_url"], str)
        r_patch = self.api.patch(
            f"/referrals/project/{project.id}/",
            data={"display_name": "After", "description": "After description"},
            format="json",
        )
        self.assertEqual(r_patch.status_code, 200)
        project.refresh_from_db()
        self.assertEqual(project.name, "After")
        self.assertEqual(project.description, "After description")

    def test_owner_get_project_detail_contract_with_ordered_sites(self):
        """GET /referrals/project/<id>/ matches LK: same ordering as ProjectOwnerDetailView (-created_at, -id)."""
        project = Project.objects.create(owner=self.owner, name="Grouped", description="Desc")
        older = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_prjdet_old_" + uuid.uuid4().hex,
            allowed_origins=["https://old.example"],
        )
        newer = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_prjdet_new_" + uuid.uuid4().hex,
            allowed_origins=["https://new.example"],
            platform_preset=Site.PlatformPreset.GENERIC,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get(f"/referrals/project/{project.id}/")
        self.assertEqual(r.status_code, 200)
        d = r.data
        self.assertEqual(
            set(d.keys()),
            {"id", "is_default", "project", "primary_site_public_id", "sites_count", "sites"},
        )
        self.assertEqual(d["id"], project.id)
        self.assertEqual(d["sites_count"], 2)
        self.assertEqual(d["primary_site_public_id"], str(newer.public_id))
        rows = d["sites"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(
            [row["public_id"] for row in rows],
            [str(newer.public_id), str(older.public_id)],
        )
        required_site_keys = {
            "public_id",
            "project_id",
            "status",
            "created_at",
            "updated_at",
            "widget_enabled",
            "allowed_origins_count",
            "primary_origin",
            "primary_origin_label",
            "platform_preset",
            "display_name",
            "description",
            "avatar_data_url",
            "project",
        }
        for row in rows:
            self.assertTrue(required_site_keys.issubset(set(row.keys())))
            self.assertEqual(row["project_id"], project.id)
            self.assertIsInstance(row["widget_enabled"], bool)
            self.assertIsInstance(row["allowed_origins_count"], int)
            self.assertEqual(
                set(row["project"].keys()),
                {"id", "name", "description", "avatar_data_url", "is_default"},
            )
            self.assertEqual(row["project"]["id"], project.id)

    def test_owner_can_delete_empty_project(self):
        project = Project.objects.create(owner=self.owner, name="Disposable project")
        self.api.force_authenticate(self.owner)
        r = self.api.delete(f"/referrals/project/{project.id}/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], "deleted")
        self.assertFalse(Project.objects.filter(pk=project.id).exists())

    def test_owner_cannot_delete_default_project(self):
        project = Project.objects.create(
            owner=self.owner,
            name=DEFAULT_OWNER_PROJECT_NAME,
            is_default=True,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.delete(f"/referrals/project/{project.id}/")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["detail"], "project_default_locked")
        self.assertEqual(r.data.get("code"), "project_default_locked")
        self.assertTrue(Project.objects.filter(pk=project.id).exists())

    def test_owner_cannot_delete_non_empty_project(self):
        project = Project.objects.create(owner=self.owner, name="Project with site")
        Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_delete_blocked_" + uuid.uuid4().hex,
            allowed_origins=["https://keep.example"],
        )
        self.api.force_authenticate(self.owner)
        r = self.api.delete(f"/referrals/project/{project.id}/")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["detail"], "project_not_empty")
        self.assertEqual(r.data.get("code"), "project_not_empty")
        self.assertTrue(Project.objects.filter(pk=project.id).exists())

    def test_add_site_to_existing_project_creates_second_site_under_same_project(self):
        """POST ``/referrals/project/<id>/site/create/`` creates a site; DELETE uses the same URL (see also delete-child test)."""
        project = Project.objects.create(owner=self.owner, name="Shared project")
        existing = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_existing_" + uuid.uuid4().hex,
            allowed_origins=["https://old.example"],
            platform_preset=Site.PlatformPreset.TILDA,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            f"/referrals/project/{project.id}/site/create/",
            data={
                "site_display_name": "Landing beta",
                "origin": "https://new.example",
                "platform_preset": Site.PlatformPreset.GENERIC,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 2)
        self.assertEqual(Project.objects.filter(owner=self.owner).count(), 2)
        created = Site.objects.exclude(id=existing.id).get(owner=self.owner)
        self.assertEqual(created.project_id, project.id)
        self.assertEqual(created.allowed_origins, ["https://new.example"])
        self.assertEqual(created.platform_preset, Site.PlatformPreset.GENERIC)
        self.assertEqual(created.config_json.get("site_display_name"), "Landing beta")
        self.assertEqual(r.data["public_id"], str(created.public_id))
        self.assertEqual(r.data["project"]["id"], project.id)
        self.assertEqual(r.data["project"]["name"], "Shared project")
        self.assertEqual(r.data["site_display_name"], "Landing beta")
        site_create_url = f"/referrals/project/{project.id}/site/create/"
        r_detail = self.api.get(f"/referrals/project/{project.id}/")
        self.assertEqual(r_detail.status_code, 200)
        self.assertEqual(r_detail.data["sites_count"], 2)
        self.assertEqual(r_detail.data["primary_site_public_id"], str(created.public_id))
        r_owner = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r_owner.status_code, 200)
        card = next(p for p in r_owner.data["projects"] if p["id"] == project.id)
        self.assertEqual(card["sites_count"], 2)
        self.assertEqual(card["primary_site_public_id"], str(created.public_id))
        self.assertEqual(
            [s["public_id"] for s in card["sites"]],
            [str(created.public_id), str(existing.public_id)],
        )
        r_del_no_id = self.api.delete(site_create_url, format="json")
        self.assertEqual(r_del_no_id.status_code, 400)
        self.assertEqual(r_del_no_id.data["detail"], "site_public_id_required")
        self.assertEqual(r_del_no_id.data.get("code"), "site_public_id_required")

    def test_other_owner_cannot_add_site_into_foreign_project(self):
        project = Project.objects.create(owner=self.owner, name="Foreign project")
        self.api.force_authenticate(self.stranger)
        r = self.api.post(
            f"/referrals/project/{project.id}/site/create/",
            data={"origin": "https://intrude.example"},
            format="json",
        )
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data["detail"], "project_missing")
        self.assertEqual(r.data.get("code"), "project_missing")
        self.assertEqual(Site.objects.filter(project=project).count(), 0)

    def test_owner_sites_list_groups_multiple_sites_under_one_project(self):
        project = Project.objects.create(owner=self.owner, name="Grouped project", description="One card")
        older = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_group_old_" + uuid.uuid4().hex,
            allowed_origins=["https://old.example"],
        )
        newer = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_group_new_" + uuid.uuid4().hex,
            allowed_origins=["https://new.example"],
            platform_preset=Site.PlatformPreset.GENERIC,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data["projects"]), 2)
        project_row = next(p for p in r.data["projects"] if p["id"] == project.id)
        self.assertEqual(project_row["id"], project.id)
        self.assertEqual(project_row["project"]["name"], "Grouped project")
        self.assertEqual(project_row["sites_count"], 2)
        self.assertEqual(project_row["primary_site_public_id"], str(newer.public_id))
        child_ids = [row["public_id"] for row in project_row["sites"]]
        self.assertEqual(child_ids, [str(newer.public_id), str(older.public_id)])
        self.assertEqual(project_row["sites"][0]["platform_preset"], Site.PlatformPreset.GENERIC)

    def test_site_create_without_origin_uses_empty_allowed_origins(self):
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            "/referrals/site/create/",
            data={"display_name": "No domain yet"},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        site = Site.objects.get(public_id=r.data["public_id"])
        self.assertEqual(site.allowed_origins, [])
        self.assertEqual(site.config_json.get("display_name"), "No domain yet")

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
        project_a = Project.objects.create(owner=self.owner, name="Alpha project")
        Site.objects.create(
            owner=self.owner,
            project=project_a,
            publishable_key="pk_a_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            config_json={"display_name": "Legacy alpha"},
        )
        project_b = Project.objects.create(owner=self.owner, name="Beta project")
        Site.objects.create(
            owner=self.owner,
            project=project_b,
            publishable_key="pk_b_" + uuid.uuid4().hex,
            allowed_origins=["https://b.example"],
            config_json={"display_name": "Legacy beta"},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["detail"], "site_selection_required")
        self.assertEqual(r.data.get("code"), "site_selection_required")
        names = {row["display_name"] for row in r.data["sites"]}
        self.assertEqual(names, {"Alpha project", "Beta project"})

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
        self.assertEqual(r.data.get("code"), "site_selection_required")
        self.assertEqual(len(r.data["sites"]), 2)

    def test_patch_verify_activate_without_site_public_id_when_multiple_sites_return_selection_required(self):
        """Write + lifecycle POSTs use the same resolver as GET; contract includes additive ``code``."""
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_multi_write_a_" + uuid.uuid4().hex,
        )
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_multi_write_b_" + uuid.uuid4().hex,
        )
        self.api.force_authenticate(self.owner)
        for path, method, body in (
            ("/referrals/site/integration/", "patch", {"widget_enabled": False}),
            ("/referrals/site/integration/verify/", "post", {}),
            ("/referrals/site/integration/activate/", "post", {}),
        ):
            call = getattr(self.api, method)
            r = call(path, data=body, format="json")
            self.assertEqual(r.status_code, 409, msg=path)
            self.assertEqual(r.data["detail"], "site_selection_required", msg=path)
            self.assertEqual(r.data.get("code"), "site_selection_required", msg=path)
            self.assertEqual(len(r.data["sites"]), 2, msg=path)

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
        self.assertEqual(r.data["config_json"]["currency"], "RUB")
        self.assertTrue(
            r.data["config_json"]["avatar_data_url"].startswith(
                "data:image/svg+xml;base64,"
            )
        )

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

    @patch("referrals.views.run_widget_install_headless_check")
    def test_verify_promotes_ready_draft_site(self, mock_run):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_verify_" + uuid.uuid4().hex,
            allowed_origins=["https://verify.example"],
            widget_enabled=True,
            last_widget_seen_at=timezone.now(),
            last_widget_seen_origin="https://verify.example",
        )

        def _fake(**kwargs):
            Site.objects.filter(pk=kwargs["site_pk"]).update(
                last_widget_seen_at=kwargs["check_started_at"] + datetime.timedelta(seconds=2),
                last_widget_seen_origin="https://verify.example",
                verification_status=Site.VerificationStatus.WIDGET_SEEN,
                last_verification_error="",
                last_verification_at=timezone.now(),
                updated_at=timezone.now(),
            )

        mock_run.side_effect = _fake
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
        self.assertEqual(r.data["connection_check"]["status"], "found")
        mock_run.assert_called_once()
        self.assertEqual(mock_run.call_args.kwargs["normalized_url"], "https://verify.example/")

    @patch("referrals.views.run_widget_install_headless_check")
    def test_verify_repeat_on_verified_site_logs_connection_recheck(self, mock_run):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_verify_repeat_" + uuid.uuid4().hex,
            allowed_origins=["https://verify-repeat.example"],
            widget_enabled=True,
            status=Site.Status.VERIFIED,
            verified_at=timezone.now(),
            last_widget_seen_at=timezone.now(),
            last_widget_seen_origin="https://verify-repeat.example",
        )

        def _fake(**kwargs):
            Site.objects.filter(pk=kwargs["site_pk"]).update(
                last_widget_seen_at=kwargs["check_started_at"] + datetime.timedelta(seconds=1),
                last_widget_seen_origin="https://verify-repeat.example",
                verification_status=Site.VerificationStatus.WIDGET_SEEN,
                last_verification_error="",
                last_verification_at=timezone.now(),
                updated_at=timezone.now(),
            )

        mock_run.side_effect = _fake
        self.api.force_authenticate(self.owner)
        before = SiteOwnerActivityLog.objects.filter(site=site).count()
        r = self.api.post(
            f"/referrals/site/integration/verify/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(SiteOwnerActivityLog.objects.filter(site=site).count(), before + 1)
        last = SiteOwnerActivityLog.objects.filter(site=site).order_by("-created_at").first()
        self.assertEqual(last.action, "connection_recheck")

    def test_diagnostics_refresh_header_writes_activity_log(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_diag_refresh_" + uuid.uuid4().hex,
            allowed_origins=["https://diag.example"],
            widget_enabled=True,
        )
        self.api.force_authenticate(self.owner)
        before = SiteOwnerActivityLog.objects.filter(site=site).count()
        r = self.api.get(
            f"/referrals/site/integration/diagnostics/?site_public_id={site.public_id}",
            HTTP_X_SITE_OWNER_ACTIVITY_REFRESH="1",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(SiteOwnerActivityLog.objects.filter(site=site).count(), before + 1)
        last = SiteOwnerActivityLog.objects.filter(site=site).order_by("-created_at").first()
        self.assertEqual(last.action, "status_refresh")

    def test_diagnostics_owner_activity_refresh_query_writes_activity_log(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_diag_qs_" + uuid.uuid4().hex,
            allowed_origins=["https://diag-qs.example"],
            widget_enabled=True,
        )
        self.api.force_authenticate(self.owner)
        before = SiteOwnerActivityLog.objects.filter(site=site).count()
        r = self.api.get(
            f"/referrals/site/integration/diagnostics/?site_public_id={site.public_id}&owner_activity_refresh=1",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(SiteOwnerActivityLog.objects.filter(site=site).count(), before + 1)
        last = SiteOwnerActivityLog.objects.filter(site=site).order_by("-created_at").first()
        self.assertEqual(last.action, "status_refresh")

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
        self.assertEqual(r.data.get("code"), "site_not_ready_for_verify")
        self.assertFalse(r.data["embed_readiness"]["origins_configured"])
        site.refresh_from_db()
        self.assertEqual(site.status, Site.Status.DRAFT)

    @patch("referrals.views.run_widget_install_headless_check")
    def test_verify_reports_incomplete_when_widget_signal_absent(self, mock_run):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_verify_missing_" + uuid.uuid4().hex,
            allowed_origins=["https://verify.example"],
            widget_enabled=True,
        )

        def _fake(**kwargs):
            Site.objects.filter(pk=kwargs["site_pk"]).update(
                verification_status=Site.VerificationStatus.FAILED,
                last_verification_error="На странице не найден фрагмент кода виджета. Проверьте URL, публикацию и что код вставлен на эту страницу.",
                last_verification_at=timezone.now(),
                updated_at=timezone.now(),
            )

        mock_run.side_effect = _fake
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            f"/referrals/site/integration/verify/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data.get("code"), "site_widget_verify_incomplete")
        self.assertEqual(r.data["connection_check"]["status"], "not_found")
        site.refresh_from_db()
        self.assertEqual(site.status, Site.Status.DRAFT)
        mock_run.assert_called_once()
        self.assertEqual(mock_run.call_args.kwargs["normalized_url"], "https://verify.example/")

    @patch("referrals.views.build_default_verify_page_url", return_value="")
    def test_verify_home_url_missing_returns_400(self, _mock_build):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_home_miss_" + uuid.uuid4().hex,
            allowed_origins=["https://forced.example"],
            widget_enabled=True,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            f"/referrals/site/integration/verify/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "site_verification_home_url_missing")

    def test_build_default_verify_page_url_strips_path(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_home_url_" + uuid.uuid4().hex,
            allowed_origins=["https://shop.example/path/deep"],
            widget_enabled=True,
        )
        self.assertEqual(build_default_verify_page_url(site), "https://shop.example/")

    @patch("referrals.views.run_widget_install_headless_check")
    def test_verify_explicit_verification_url_overrides_home(self, mock_run):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_explicit_home_" + uuid.uuid4().hex,
            allowed_origins=["https://home.example"],
            widget_enabled=True,
            verification_url="https://shop.example/landing",
            status=Site.Status.DRAFT,
        )

        def _fake(**kwargs):
            Site.objects.filter(pk=kwargs["site_pk"]).update(
                last_widget_seen_at=kwargs["check_started_at"] + datetime.timedelta(seconds=1),
                last_widget_seen_origin="https://shop.example",
                verification_status=Site.VerificationStatus.WIDGET_SEEN,
                last_verification_error="",
                last_verification_at=timezone.now(),
                updated_at=timezone.now(),
            )

        mock_run.side_effect = _fake
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            f"/referrals/site/integration/verify/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(mock_run.call_args.kwargs["normalized_url"], "https://shop.example/landing")

    def test_patch_saves_verification_url(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_vurl_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            widget_enabled=True,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.patch(
            f"/referrals/site/integration/?site_public_id={site.public_id}",
            data={"verification_url": "https://shop.example/landing"},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["verification_url"], "https://shop.example/landing")
        self.assertEqual(r.data["verification_status"], Site.VerificationStatus.NOT_STARTED)

    def test_verify_rejects_private_verification_url_without_headless(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_priv_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            widget_enabled=True,
            verification_url="http://127.0.0.1/nope",
        )
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            f"/referrals/site/integration/verify/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data["code"], "site_verification_url_invalid")
        site.refresh_from_db()
        self.assertEqual(site.verification_status, Site.VerificationStatus.FAILED)

    @patch("referrals.views.run_widget_install_headless_check")
    def test_verify_with_url_promotes_when_headless_records_widget(self, mock_run):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_head_ok_" + uuid.uuid4().hex,
            allowed_origins=["https://verify.example"],
            widget_enabled=True,
            verification_url="https://verify.example/page",
            status=Site.Status.DRAFT,
        )

        def _fake(**kwargs):
            Site.objects.filter(pk=kwargs["site_pk"]).update(
                last_widget_seen_at=kwargs["check_started_at"] + datetime.timedelta(seconds=2),
                last_widget_seen_origin="https://verify.example",
                verification_status=Site.VerificationStatus.WIDGET_SEEN,
                last_verification_error="",
                last_verification_at=timezone.now(),
                updated_at=timezone.now(),
            )

        mock_run.side_effect = _fake
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            f"/referrals/site/integration/verify/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], Site.Status.VERIFIED)
        mock_run.assert_called_once()

    @patch("referrals.views.run_widget_install_headless_check")
    def test_verify_with_url_409_when_headless_does_not_see_widget(self, mock_run):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_head_bad_" + uuid.uuid4().hex,
            allowed_origins=["https://verify.example"],
            widget_enabled=True,
            verification_url="https://verify.example/page",
        )

        def _fake(**kwargs):
            Site.objects.filter(pk=kwargs["site_pk"]).update(
                verification_status=Site.VerificationStatus.FAILED,
                last_verification_error=(
                    "На странице не найден фрагмент кода виджета. Проверьте URL, публикацию и что код вставлен на эту страницу."
                ),
                last_verification_at=timezone.now(),
                updated_at=timezone.now(),
            )

        mock_run.side_effect = _fake
        self.api.force_authenticate(self.owner)
        r = self.api.post(
            f"/referrals/site/integration/verify/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["code"], "site_widget_verify_incomplete")

    @patch("referrals.views.run_widget_install_headless_check")
    def test_verify_with_url_rate_limit_second_call(self, mock_run):
        mock_run.side_effect = lambda **kwargs: Site.objects.filter(pk=kwargs["site_pk"]).update(
            last_widget_seen_at=kwargs["check_started_at"] + datetime.timedelta(seconds=1),
            last_widget_seen_origin="https://verify.example",
            verification_status=Site.VerificationStatus.WIDGET_SEEN,
            last_verification_error="",
            last_verification_at=timezone.now(),
            updated_at=timezone.now(),
        )
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_rate_" + uuid.uuid4().hex,
            allowed_origins=["https://verify.example"],
            widget_enabled=True,
            verification_url="https://verify.example/page",
            status=Site.Status.DRAFT,
        )
        self.api.force_authenticate(self.owner)
        r1 = self.api.post(
            f"/referrals/site/integration/verify/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r1.status_code, 200)
        r2 = self.api.post(
            f"/referrals/site/integration/verify/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r2.status_code, 429)
        self.assertEqual(r2.data.get("code"), "widget_verify_rate_limited")

    def test_verify_stranger_cannot_access_owner_site(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_str_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            widget_enabled=True,
        )
        self.api.force_authenticate(self.stranger)
        r = self.api.post(
            f"/referrals/site/integration/verify/?site_public_id={site.public_id}",
            format="json",
        )
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data.get("code"), "site_missing")

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
        self.assertEqual(r.data.get("code"), "site_not_verified")

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
        project = Project.objects.create(owner=self.owner, name="Old", description="Old description")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_settings_" + uuid.uuid4().hex,
            allowed_origins=["https://old.example"],
            platform_preset=Site.PlatformPreset.TILDA,
            config_json={"display_name": "Old", "description": "Old description", "amount_selector": ".x"},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.patch(
            f"/referrals/site/integration/?site_public_id={site.public_id}",
            data={
                "display_name": "New title",
                "description": "New description",
                "origin": "https://new.example",
                "platform_preset": Site.PlatformPreset.GENERIC,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["allowed_origins"], ["https://new.example"])
        self.assertEqual(r.data["platform_preset"], Site.PlatformPreset.GENERIC)
        self.assertEqual(r.data["config_json"].get("display_name"), "Old")
        self.assertEqual(r.data["config_json"].get("description"), "Old description")
        self.assertEqual(r.data["config_json"].get("amount_selector"), ".x")
        self.assertEqual(r.data["site_display_name"], "New title")
        self.assertEqual(r.data["site_description"], "New description")
        self.assertEqual(r.data["project"]["name"], "Old")
        self.assertEqual(r.data["project"]["description"], "Old description")
        site.refresh_from_db()
        site.project.refresh_from_db()
        self.assertEqual(site.config_json.get("site_display_name"), "New title")
        self.assertEqual(site.config_json.get("site_description"), "New description")
        self.assertEqual(site.config_json.get("amount_selector"), ".x")
        self.assertEqual(site.project.name, "Old")
        self.assertEqual(site.project.description, "Old description")

    def test_patch_integration_shell_fields_do_not_touch_project_or_sibling_site(self):
        project = Project.objects.create(owner=self.owner, name="Shared", description="ProjDesc")
        site_a = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_shell_a_" + uuid.uuid4().hex,
            allowed_origins=["https://a.example"],
            platform_preset=Site.PlatformPreset.TILDA,
            config_json={"site_display_name": "Site A", "site_description": "Desc A"},
        )
        site_b = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_shell_b_" + uuid.uuid4().hex,
            allowed_origins=["https://b.example"],
            platform_preset=Site.PlatformPreset.TILDA,
            config_json={"site_display_name": "Site B", "site_description": "Desc B"},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.patch(
            f"/referrals/site/integration/?site_public_id={site_a.public_id}",
            data={
                "site_display_name": "Site A updated",
                "site_description": "Only A",
                "origin": "https://a-new.example",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        project.refresh_from_db()
        site_a.refresh_from_db()
        site_b.refresh_from_db()
        self.assertEqual(project.name, "Shared")
        self.assertEqual(project.description, "ProjDesc")
        self.assertEqual(site_a.config_json.get("site_display_name"), "Site A updated")
        self.assertEqual(site_a.config_json.get("site_description"), "Only A")
        self.assertEqual(site_a.allowed_origins, ["https://a-new.example"])
        self.assertEqual(site_b.config_json.get("site_display_name"), "Site B")
        self.assertEqual(site_b.config_json.get("site_description"), "Desc B")

    def test_patch_config_json_avatar_updates_project_and_preserves_runtime_keys(self):
        project = Project.objects.create(owner=self.owner, name="Avatar project")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_avatar_patch_" + uuid.uuid4().hex,
            allowed_origins=["https://avatar.example"],
            config_json={"amount_selector": ".price"},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.patch(
            f"/referrals/site/integration/?site_public_id={site.public_id}",
            data={
                "config_json": {
                    "amount_selector": ".price",
                    "avatar_data_url": "data:image/png;base64,BBB",
                }
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["config_json"].get("amount_selector"), ".price")
        self.assertEqual(r.data["config_json"].get("avatar_data_url"), "data:image/png;base64,BBB")
        self.assertEqual(r.data["project"]["avatar_data_url"], "data:image/png;base64,BBB")
        site.refresh_from_db()
        site.project.refresh_from_db()
        self.assertEqual(site.config_json.get("amount_selector"), ".price")
        self.assertEqual(site.config_json.get("avatar_data_url"), "data:image/png;base64,BBB")
        self.assertEqual(site.project.avatar_data_url, "data:image/png;base64,BBB")

    def test_patch_capture_config_persists_nested_site_payload_rules(self):
        project = Project.objects.create(owner=self.owner, name="Payload project")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_capture_patch_" + uuid.uuid4().hex,
            allowed_origins=["https://capture.example"],
            config_json={"amount_selector": ".price"},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.patch(
            f"/referrals/site/integration/?site_public_id={site.public_id}",
            data={
                "capture_config": {
                    "enabled_optional_fields": ["email", "phone", "email", "unknown"],
                }
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["capture_config"]["required_fields"], ["ref", "page_url", "form_id"])
        self.assertEqual(r.data["capture_config"]["recommended_fields"], ["name", "email", "phone"])
        self.assertEqual(r.data["capture_config"]["enabled_optional_fields"], ["email", "phone"])
        self.assertEqual(r.data["config_json"]["capture_config"]["version"], 1)
        self.assertEqual(
            r.data["config_json"]["capture_config"]["enabled_optional_fields"],
            ["email", "phone"],
        )
        site.refresh_from_db()
        self.assertEqual(site.config_json.get("amount_selector"), ".price")
        self.assertEqual(
            site.config_json.get("capture_config", {}).get("enabled_optional_fields"),
            ["email", "phone"],
        )

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
        self.assertEqual(r.data.get("code"), "site_missing")
        site.refresh_from_db()
        self.assertNotIn("display_name", site.config_json)
        self.assertEqual(site.project_id, None)

    def test_delete_requires_site_public_id(self):
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_del_noid_" + uuid.uuid4().hex,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.delete("/referrals/site/integration/", format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data["detail"], "site_public_id_required")
        self.assertEqual(r.data.get("code"), "site_public_id_required")

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

    def test_owner_can_delete_single_project_child_site_without_deleting_project(self):
        """DELETE ``/referrals/project/<id>/site/create/`` with ``site_public_id`` removes one child site (same path as POST create)."""
        project = Project.objects.create(owner=self.owner, name="Project delete child")
        first_site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_project_child_a_" + uuid.uuid4().hex,
        )
        second_site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_project_child_b_" + uuid.uuid4().hex,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.delete(
            f"/referrals/project/{project.id}/site/create/",
            data={"site_public_id": str(first_site.public_id)},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["status"], "deleted")
        self.assertFalse(Site.objects.filter(id=first_site.id).exists())
        self.assertTrue(Site.objects.filter(id=second_site.id).exists())
        self.assertTrue(Project.objects.filter(id=project.id).exists())
        r_after = self.api.get(f"/referrals/project/{project.id}/")
        self.assertEqual(r_after.status_code, 200)
        self.assertEqual(r_after.data["sites_count"], 1)
        self.assertEqual(r_after.data["primary_site_public_id"], str(second_site.public_id))
        r_owner = self.api.get("/referrals/site/owner-sites/")
        self.assertEqual(r_owner.status_code, 200)
        card = next(p for p in r_owner.data["projects"] if p["id"] == project.id)
        self.assertEqual(card["sites_count"], 1)
        self.assertEqual(card["primary_site_public_id"], str(second_site.public_id))
        self.assertEqual(len(card["sites"]), 1)
        self.assertEqual(card["sites"][0]["public_id"], str(second_site.public_id))

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
        self.assertEqual(r.data.get("detail"), "site_missing")
        self.assertEqual(r.data.get("code"), "site_missing")
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

    def test_site_activity_list_requires_site_public_id_query(self):
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/activity/")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "site_public_id_required")

    def test_site_activity_list_after_integration_patch(self):
        project = Project.objects.create(owner=self.owner, name="P", description="")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_act_" + uuid.uuid4().hex,
            allowed_origins=["https://one.example"],
        )
        self.api.force_authenticate(self.owner)
        url = f"/referrals/site/integration/?site_public_id={site.public_id}"
        r_patch = self.api.patch(url, {"display_name": "Новое имя"}, format="json")
        self.assertEqual(r_patch.status_code, 200)
        r = self.api.get(f"/referrals/site/integration/activity/?site_public_id={site.public_id}")
        self.assertEqual(r.status_code, 200)
        self.assertIn("results", r.data)
        self.assertGreaterEqual(len(r.data["results"]), 1)
        self.assertEqual(r.data["results"][0]["actor_display"], "owner-api@example.com")
        self.assertIn("имя сайта", r.data["results"][0]["message"].lower())
        self.assertEqual(r.data["results"][0]["action"], "site_settings")
        self.assertTrue(SiteOwnerActivityLog.objects.filter(site=site).exists())

    def test_site_activity_api_normalizes_legacy_messages(self):
        project = Project.objects.create(owner=self.owner, name="P", description="")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_leg_msg_" + uuid.uuid4().hex,
        )
        SiteOwnerActivityLog.objects.create(
            owner=self.owner,
            site=site,
            actor=self.owner,
            action="site_settings",
            message="Изменены имя сайта, черновик блока.",
            details={},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get(f"/referrals/site/integration/activity/?site_public_id={site.public_id}")
        self.assertEqual(r.status_code, 200)
        msg = r.data["results"][0]["message"]
        self.assertIn("Имя сайта: изменено", msg)
        self.assertIn("Реферальный блок: изменения сохранены", msg)
        self.assertNotIn("черновик блока", msg)

        jumbled = "Изменения настроек сайта: черновик конструктора реферального блока."
        self.assertEqual(
            normalize_legacy_activity_message("site_settings", jumbled, {}),
            "Реферальный блок: изменения сохранены.",
        )

    def test_site_activity_list_filters_by_date(self):
        project = Project.objects.create(owner=self.owner, name="P", description="")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_act_date_" + uuid.uuid4().hex,
            allowed_origins=["https://one.example"],
        )
        log_old = SiteOwnerActivityLog.objects.create(
            owner=self.owner,
            site=site,
            actor=self.owner,
            action="site_settings",
            message="Событие в прошлом",
            details={},
        )
        past = timezone.make_aware(datetime.datetime(2019, 6, 10, 8, 30, 0))
        SiteOwnerActivityLog.objects.filter(pk=log_old.pk).update(created_at=past)

        self.api.force_authenticate(self.owner)
        r_day = self.api.get(
            f"/referrals/site/integration/activity/?site_public_id={site.public_id}&date=2019-06-10"
        )
        self.assertEqual(r_day.status_code, 200)
        self.assertEqual(r_day.data["count"], 1)
        self.assertEqual(len(r_day.data["results"]), 1)
        self.assertIn("прошлом", r_day.data["results"][0]["message"].lower())

        r_all = self.api.get(f"/referrals/site/integration/activity/?site_public_id={site.public_id}")
        self.assertEqual(r_all.status_code, 200)
        self.assertGreaterEqual(r_all.data["count"], 1)

    def test_account_activity_list_ok(self):
        project = Project.objects.create(owner=self.owner, name="AccFeed", description="")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_acc_feed_" + uuid.uuid4().hex,
        )
        SiteOwnerActivityLog.objects.create(
            owner=self.owner,
            site=site,
            actor=self.owner,
            action="site_settings",
            message="Событие для ленты аккаунта",
            details={},
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/account/activity/")
        self.assertEqual(r.status_code, 200)
        self.assertGreaterEqual(r.data["count"], 1)
        self.assertTrue(any("ленты" in row.get("message", "") for row in r.data["results"]))
        feed_row = next(row for row in r.data["results"] if "ленты" in row.get("message", ""))
        self.assertEqual(feed_row.get("service_label"), "AccFeed")
        self.assertEqual(feed_row.get("project_id"), project.id)

    def test_account_activity_visible_to_additional_user(self):
        additional = User.objects.create_user(
            username="add_account_feed",
            email="additional-feed@example.com",
            password="secret12",
        )
        additional.account_owner = self.owner
        additional.save(update_fields=["account_owner"])
        project = Project.objects.create(owner=self.owner, name="MultiUserProj", description="")
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_add_feed_" + uuid.uuid4().hex,
        )
        SiteOwnerActivityLog.objects.create(
            owner=self.owner,
            site=site,
            actor=additional,
            action="site_settings",
            message="Действие от доп. пользователя",
            details={},
        )
        self.api.force_authenticate(additional)
        r = self.api.get("/referrals/account/activity/")
        self.assertEqual(r.status_code, 200)
        self.assertGreaterEqual(r.data["count"], 1)
        self.assertTrue(
            any("доп. пользователя" in row.get("message", "") for row in r.data["results"])
        )
        extra_row = next(
            row for row in r.data["results"] if "доп. пользователя" in row.get("message", "")
        )
        self.assertEqual(extra_row.get("service_label"), "MultiUserProj")
        self.assertEqual(extra_row.get("project_id"), project.id)

    def test_account_activity_after_empty_project_delete(self):
        project = Project.objects.create(owner=self.owner, name="ToDeleteEmpty", description="")
        self.api.force_authenticate(self.owner)
        r_del = self.api.delete(f"/referrals/project/{project.id}/")
        self.assertEqual(r_del.status_code, 200)
        r = self.api.get("/referrals/account/activity/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(any("удалён" in row.get("message", "").lower() for row in r.data["results"]))

