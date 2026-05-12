"""Шаг 10: read-only admin-обзор Project/Site через ``/referrals/admin/projects|sites/...``."""

import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import Project, Site
from users.models import AdminSession


User = get_user_model()


def _elevate_admin(user):
    """Активная step-up admin-сессия (inline-копия helper'а из test_admin_partners)."""
    return AdminSession.objects.create(
        user=user,
        elevated_until=timezone.now() + timedelta(minutes=30),
        confirmed_with="development",
    )


def _make_user(email: str, *, is_staff: bool = False):
    return User.objects.create_user(
        email=email,
        username=email.split("@")[0],
        password="secret123",
        is_staff=is_staff,
    )


def _make_site(*, owner, project=None, archived: bool = False):
    site = Site.objects.create(
        owner=owner,
        project=project,
        publishable_key=f"pk_admin_{uuid.uuid4().hex}",
        allowed_origins=["https://example.test"],
        platform_preset=Site.PlatformPreset.TILDA,
    )
    if archived:
        site.archived_at = timezone.now()
        site.save(update_fields=["archived_at"])
    return site


# -----------------------------------------------------------------------------
# Projects: list
# -----------------------------------------------------------------------------


class AdminProjectsListApiTests(TestCase):
    URL = "/referrals/admin/projects/"

    def setUp(self):
        self.staff = _make_user("admin-projects-staff@example.com", is_staff=True)
        _elevate_admin(self.staff)

        self.owner_alice = _make_user("alice-proj@example.com")
        self.owner_bob = _make_user("bob-proj@example.com")

        self.project_alpha = Project.objects.create(
            owner=self.owner_alice, name="Alpha launch"
        )
        self.project_beta = Project.objects.create(
            owner=self.owner_bob, name="Beta site"
        )

        # Один активный + один архивный сайт у Alpha — для проверки sites_count.
        _make_site(owner=self.owner_alice, project=self.project_alpha)
        _make_site(
            owner=self.owner_alice, project=self.project_alpha, archived=True
        )

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    def test_anonymous_is_unauthorized(self):
        api = APIClient()
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.owner_alice)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare = _make_user("admin-projects-bare@example.com", is_staff=True)
        api = APIClient()
        api.force_authenticate(bare)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    def test_staff_gets_paginated_list_with_expected_fields(self):
        api = self._staff_api()
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertIn("results", r.data)
        self.assertEqual(r.data["page"], 1)
        self.assertEqual(r.data["page_size"], 20)
        self.assertGreaterEqual(r.data["count"], 2)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.project_alpha.id, ids)
        first = next(
            row for row in r.data["results"] if row["id"] == self.project_alpha.id
        )
        for key in ("id", "owner_email", "name", "sites_count", "created_at"):
            self.assertIn(key, first)
        self.assertEqual(first["owner_email"], "alice-proj@example.com")
        self.assertEqual(first["sites_count"], 2)

    def test_q_filters_by_owner_email(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?q=alice-proj@")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.project_alpha.id, ids)
        self.assertNotIn(self.project_beta.id, ids)

    def test_q_filters_by_project_name(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?q=Beta")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.project_beta.id, ids)
        self.assertNotIn(self.project_alpha.id, ids)

    def test_owner_id_filter(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?owner_id={self.owner_bob.id}")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        # Все возвращённые проекты принадлежат указанному владельцу.
        self.assertIn(self.project_beta.id, ids)
        self.assertNotIn(self.project_alpha.id, ids)
        # Плюс дефолтный проект Боба, если signals автоматически его создают.

    def test_page_size_is_capped_at_100(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?page_size=500")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["page_size"], 100)


# -----------------------------------------------------------------------------
# Projects: detail
# -----------------------------------------------------------------------------


class AdminProjectDetailApiTests(TestCase):
    def setUp(self):
        self.staff = _make_user("admin-project-detail-staff@example.com", is_staff=True)
        _elevate_admin(self.staff)
        self.owner = _make_user("proj-detail-owner@example.com")
        self.project = Project.objects.create(
            owner=self.owner,
            name="Detail project",
            description="Demo description",
        )
        _make_site(owner=self.owner, project=self.project)
        _make_site(owner=self.owner, project=self.project, archived=True)

    def _url(self, project_id):
        return f"/referrals/admin/projects/{project_id}/"

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    def test_anonymous_is_unauthorized(self):
        api = APIClient()
        r = api.get(self._url(self.project.id))
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.owner)
        r = api.get(self._url(self.project.id))
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare = _make_user("admin-project-detail-bare@example.com", is_staff=True)
        api = APIClient()
        api.force_authenticate(bare)
        r = api.get(self._url(self.project.id))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    def test_staff_gets_existing_project_detail(self):
        api = self._staff_api()
        r = api.get(self._url(self.project.id))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        for key in (
            "id",
            "owner_id",
            "owner_email",
            "name",
            "description",
            "sites_count",
            "active_sites_count",
            "archived_sites_count",
            "owner_public_id",
            "owner_fio",
            "owner_phone",
        ):
            self.assertIn(key, r.data)
        self.assertEqual(r.data["id"], self.project.id)
        self.assertEqual(r.data["owner_email"], "proj-detail-owner@example.com")
        self.assertEqual(r.data["sites_count"], 2)
        self.assertEqual(r.data["active_sites_count"], 1)
        self.assertEqual(r.data["archived_sites_count"], 1)

    def test_unknown_id_returns_404(self):
        api = self._staff_api()
        r = api.get(self._url(999999))
        self.assertEqual(r.status_code, 404)


# -----------------------------------------------------------------------------
# Sites: list (includes archived through Site.all_objects)
# -----------------------------------------------------------------------------


class AdminSitesListApiTests(TestCase):
    URL = "/referrals/admin/sites/"

    def setUp(self):
        self.staff = _make_user("admin-sites-staff@example.com", is_staff=True)
        _elevate_admin(self.staff)

        self.owner = _make_user("sites-owner@example.com")
        self.other_owner = _make_user("sites-other-owner@example.com")

        self.project_a = Project.objects.create(owner=self.owner, name="Sites A")
        self.project_b = Project.objects.create(owner=self.other_owner, name="Sites B")

        self.site_active = _make_site(owner=self.owner, project=self.project_a)
        self.site_archived = _make_site(
            owner=self.owner, project=self.project_a, archived=True
        )
        self.site_other = _make_site(
            owner=self.other_owner, project=self.project_b
        )

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    # ---- access ----------------------------------------------------------

    def test_anonymous_is_unauthorized(self):
        api = APIClient()
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.owner)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare = _make_user("admin-sites-bare@example.com", is_staff=True)
        api = APIClient()
        api.force_authenticate(bare)
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    # ---- archived semantics ---------------------------------------------

    def test_default_includes_active_and_archived(self):
        api = self._staff_api()
        r = api.get(self.URL)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.site_active.id, ids)
        self.assertIn(self.site_archived.id, ids)
        self.assertIn(self.site_other.id, ids)

    def test_archived_true_returns_only_archived(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?archived=true")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        self.assertEqual(ids, {self.site_archived.id})

    def test_archived_false_returns_only_active(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?archived=false")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        self.assertNotIn(self.site_archived.id, ids)
        self.assertIn(self.site_active.id, ids)
        self.assertIn(self.site_other.id, ids)

    def test_archived_all_returns_both(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?archived=all")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.site_active.id, ids)
        self.assertIn(self.site_archived.id, ids)

    # ---- filters ---------------------------------------------------------

    def test_project_id_filter(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?project_id={self.project_a.id}")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        self.assertEqual(ids, {self.site_active.id, self.site_archived.id})

    def test_owner_id_filter(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?owner_id={self.other_owner.id}")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        self.assertEqual(ids, {self.site_other.id})

    def test_page_size_is_capped_at_100(self):
        api = self._staff_api()
        r = api.get(f"{self.URL}?page_size=500")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["page_size"], 100)


# -----------------------------------------------------------------------------
# Sites: detail (must work for archived through Site.all_objects)
# -----------------------------------------------------------------------------


class AdminSiteDetailApiTests(TestCase):
    def setUp(self):
        self.staff = _make_user("admin-site-detail-staff@example.com", is_staff=True)
        _elevate_admin(self.staff)
        self.owner = _make_user("site-detail-owner@example.com")
        self.project = Project.objects.create(owner=self.owner, name="Detail project")
        self.site = _make_site(owner=self.owner, project=self.project)
        self.archived_site = _make_site(
            owner=self.owner, project=self.project, archived=True
        )

    def _url(self, site_id):
        return f"/referrals/admin/sites/{site_id}/"

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    def test_anonymous_is_unauthorized(self):
        api = APIClient()
        r = api.get(self._url(self.site.id))
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.owner)
        r = api.get(self._url(self.site.id))
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare = _make_user("admin-site-detail-bare@example.com", is_staff=True)
        api = APIClient()
        api.force_authenticate(bare)
        r = api.get(self._url(self.site.id))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    def test_staff_gets_active_site_detail(self):
        api = self._staff_api()
        r = api.get(self._url(self.site.id))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        for key in (
            "id",
            "public_id",
            "owner_email",
            "project_id",
            "project_public_id",
            "project_name",
            "allowed_origins",
            "visits_count",
            "leads_count",
            "orders_count",
            "commissions_count",
        ):
            self.assertIn(key, r.data)
        self.assertEqual(r.data["id"], self.site.id)
        self.assertEqual(r.data["owner_email"], "site-detail-owner@example.com")
        self.assertEqual(r.data["project_name"], "Detail project")
        self.assertEqual(r.data["leads_count"], 0)
        self.assertEqual(r.data["orders_count"], 0)
        self.assertIsNone(r.data["archived_at"])

    def test_archived_site_is_reachable_via_all_objects(self):
        api = self._staff_api()
        r = api.get(self._url(self.archived_site.id))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data["id"], self.archived_site.id)
        self.assertIsNotNone(r.data["archived_at"])

    def test_unknown_id_returns_404(self):
        api = self._staff_api()
        r = api.get(self._url(999999))
        self.assertEqual(r.status_code, 404)
