"""Soft-archive Site: preserve memberships/keys; restore by domain; Order.site scoping for member stats."""

import uuid
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import Order, Project, Site, SiteMembership
from referrals.services import (
    ensure_partner_profile,
    generate_publishable_key,
    member_referrer_money_totals,
    upsert_order_from_tilda_payload,
)

User = get_user_model()


class SiteArchiveRestoreApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username="archive_owner",
            email="archive-owner@example.com",
            password="secret12",
        )
        self.api = APIClient()
        self.api.force_authenticate(self.owner)

    def test_post_same_origin_after_delete_restores_site_preserves_public_id_and_publishable_key(self):
        project = Project.objects.create(owner=self.owner, name="Archivable")
        origin = "https://restore.example"
        site = Site.objects.create(
            owner=self.owner,
            project=project,
            publishable_key="pk_restore_" + uuid.uuid4().hex,
            allowed_origins=[origin],
            platform_preset=Site.PlatformPreset.TILDA,
            config_json={"site_display_name": "Before"},
        )
        pid = site.public_id
        pkey = site.publishable_key

        r_del = self.api.delete(
            f"/referrals/project/{project.id}/site/create/",
            data={"site_public_id": str(site.public_id)},
            format="json",
        )
        self.assertEqual(r_del.status_code, 200)
        archived = Site.all_objects.get(pk=site.pk)
        self.assertIsNotNone(archived.archived_at)

        r_post = self.api.post(
            f"/referrals/project/{project.id}/site/create/",
            data={
                "site_display_name": "After",
                "origin": "restore.example",
                "platform_preset": Site.PlatformPreset.TILDA,
            },
            format="json",
        )
        self.assertEqual(r_post.status_code, 200)
        archived.refresh_from_db()
        self.assertIsNone(archived.archived_at)
        self.assertEqual(archived.public_id, pid)
        self.assertEqual(archived.publishable_key, pkey)
        self.assertEqual((archived.config_json or {}).get("site_display_name"), "After")


class GeneratePublishableKeyTests(TestCase):
    def test_skips_keys_used_by_archived_sites(self):
        owner = User.objects.create_user(
            username="pk_arch_owner",
            email="pk-arch@example.com",
            password="secret12",
        )
        project = Project.objects.create(owner=owner, name="PK project")
        collision_key = "pk_collision_" + uuid.uuid4().hex
        Site.all_objects.create(
            owner=owner,
            project=project,
            publishable_key=collision_key,
            allowed_origins=["https://pk.example"],
            archived_at=timezone.now(),
        )
        with patch(
            "referrals.services.secrets.token_urlsafe",
            side_effect=[collision_key, "fresh_unique_token_subst"],
        ):
            self.assertEqual(generate_publishable_key(), "fresh_unique_token_subst")


class SiteArchiveMembershipTests(TestCase):
    def test_archive_site_does_not_remove_site_membership(self):
        owner = User.objects.create_user(
            username="mem_owner",
            email="mem-owner@example.com",
            password="secret12",
        )
        member = User.objects.create_user(
            username="mem_ref",
            email="mem-ref@example.com",
            password="secret12",
        )
        partner, _ = ensure_partner_profile(member)
        project = Project.objects.create(owner=owner, name="P")
        site = Site.objects.create(
            owner=owner,
            project=project,
            publishable_key="pk_mem_" + uuid.uuid4().hex,
            allowed_origins=["https://mem.example"],
        )
        SiteMembership.objects.create(site=site, user=member, partner=partner, ref_code=partner.ref_code)

        from referrals.site_archive import archive_site

        archive_site(site=site, actor=owner, via="test")
        self.assertEqual(SiteMembership.objects.filter(site_id=site.pk).count(), 1)


class OrderSiteAndMemberStatsTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username="stats_owner",
            email="stats-owner@example.com",
            password="secret12",
        )
        self.partner_user = User.objects.create_user(
            username="stats_partner",
            email="stats-partner@example.com",
            password="secret12",
        )
        self.partner, _ = ensure_partner_profile(self.partner_user)
        self.buyer = User.objects.create_user(
            username="stats_buyer",
            email="stats-buyer@example.com",
            password="secret12",
        )

    def test_order_gets_site_from_payload_site_public_id(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_os_" + uuid.uuid4().hex,
            allowed_origins=["https://os.example"],
        )
        upsert_order_from_tilda_payload(
            {
                "tranid": "t-site-payload",
                "Email": self.buyer.email,
                "sum": "40.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
                "site_public_id": str(site.public_id),
            }
        )
        order = Order.objects.get(dedupe_key="tilda:t-site-payload")
        self.assertEqual(order.site_id, site.pk)

    def test_member_referrer_totals_scope_to_site_two_programs_same_partner(self):
        site_a = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_sa_" + uuid.uuid4().hex,
            allowed_origins=["https://a-stats.example"],
            status=Site.Status.VERIFIED,
            verified_at=timezone.now(),
        )
        site_b = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_sb_" + uuid.uuid4().hex,
            allowed_origins=["https://b-stats.example"],
            status=Site.Status.VERIFIED,
            verified_at=timezone.now(),
        )
        SiteMembership.objects.create(
            site=site_a,
            user=self.partner_user,
            partner=self.partner,
            ref_code=self.partner.ref_code,
        )
        SiteMembership.objects.create(
            site=site_b,
            user=self.partner_user,
            partner=self.partner,
            ref_code=self.partner.ref_code,
        )

        upsert_order_from_tilda_payload(
            {
                "tranid": "t-only-a",
                "Email": self.buyer.email,
                "sum": "100.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
                "site_public_id": str(site_a.public_id),
            }
        )
        upsert_order_from_tilda_payload(
            {
                "tranid": "t-only-b",
                "Email": self.buyer.email,
                "sum": "50.00",
                "ref": self.partner.ref_code,
                "paymentstatus": "paid",
                "site_public_id": str(site_b.public_id),
            }
        )

        totals_a = member_referrer_money_totals(self.partner, site=site_a)
        totals_b = member_referrer_money_totals(self.partner, site=site_b)
        self.assertEqual(totals_a["referrer_sales_total"], "100.00")
        self.assertEqual(totals_b["referrer_sales_total"], "50.00")
        global_totals = member_referrer_money_totals(self.partner)
        self.assertEqual(global_totals["referrer_sales_total"], "150.00")

    def test_legacy_null_attributed_to_first_membership_when_duplicate_ref(self):
        """Same ref on two programs: legacy paid rows without site count once (lowest membership pk)."""
        site_a = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_ld_a_" + uuid.uuid4().hex,
            allowed_origins=["https://ld-a.example"],
            status=Site.Status.VERIFIED,
            verified_at=timezone.now(),
        )
        site_b = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_ld_b_" + uuid.uuid4().hex,
            allowed_origins=["https://ld-b.example"],
            status=Site.Status.VERIFIED,
            verified_at=timezone.now(),
        )
        m_a = SiteMembership.objects.create(
            site=site_a,
            user=self.partner_user,
            partner=self.partner,
            ref_code=self.partner.ref_code,
        )
        m_b = SiteMembership.objects.create(
            site=site_b,
            user=self.partner_user,
            partner=self.partner,
            ref_code=self.partner.ref_code,
        )
        Order.objects.create(
            dedupe_key="tilda:legacy-dup-ref-one",
            external_id="legacy-dup-ref-one",
            payload_fingerprint="b" * 64,
            partner=self.partner,
            ref_code=self.partner.ref_code,
            amount=Decimal("77.00"),
            status=Order.Status.PAID,
            paid_at=timezone.now(),
            site_id=None,
        )

        ta = member_referrer_money_totals(self.partner, site=site_a, membership=m_a)
        tb = member_referrer_money_totals(self.partner, site=site_b, membership=m_b)
        first = m_a if m_a.pk < m_b.pk else m_b
        if first.pk == m_a.pk:
            self.assertEqual(ta["referrer_sales_total"], "77.00")
            self.assertEqual(tb["referrer_sales_total"], "0.00")
        else:
            self.assertEqual(tb["referrer_sales_total"], "77.00")
            self.assertEqual(ta["referrer_sales_total"], "0.00")

    def test_logs_warning_when_partner_but_site_unresolved(self):
        site_a = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_warn_a_" + uuid.uuid4().hex,
            allowed_origins=["https://warn-a.example"],
        )
        site_b = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_warn_b_" + uuid.uuid4().hex,
            allowed_origins=["https://warn-b.example"],
        )
        SiteMembership.objects.create(site=site_a, user=self.partner_user, partner=self.partner, ref_code="")
        SiteMembership.objects.create(site=site_b, user=self.partner_user, partner=self.partner, ref_code="")
        with patch("referrals.services.logger") as log_mock:
            upsert_order_from_tilda_payload(
                {
                    "tranid": "t-no-site",
                    "Email": self.buyer.email,
                    "sum": "10.00",
                    "ref": self.partner.ref_code,
                    "paymentstatus": "paid",
                }
            )
            log_mock.warning.assert_called()
        order = Order.objects.get(dedupe_key__startswith="tilda:t-no-site")
        self.assertIsNone(order.site_id)
