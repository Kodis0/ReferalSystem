import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import Site, SiteMembership

User = get_user_model()


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
        self.assertEqual(r.data.get("code"), "site_public_id_required")

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
        self.assertEqual(r.data.get("code"), "site_missing")


