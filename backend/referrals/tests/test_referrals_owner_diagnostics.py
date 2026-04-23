import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from referrals.models import (
    PublicLeadIngestAudit,
    ReferralLeadEvent,
    Site,
    SiteMembership,
)
from referrals.public_ingest_contract import CODE_CREATED, CODE_RATE_LIMITED

User = get_user_model()


class SiteOwnerDiagnosticsApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username="diag_owner",
            email="diag-owner@example.com",
            password="secret12",
        )
        self.stranger = User.objects.create_user(
            username="diag_stranger",
            email="diag-stranger@example.com",
            password="secret12",
        )
        self.api = APIClient()

    def test_diagnostics_requires_auth(self):
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 401)

    def test_diagnostics_missing_site(self):
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data["detail"], "site_missing")
        self.assertEqual(r.data.get("code"), "site_missing")

    def test_diagnostics_summary_and_leads(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_diag_" + uuid.uuid4().hex,
            allowed_origins=["https://shop.example"],
            platform_preset=Site.PlatformPreset.TILDA,
            widget_enabled=True,
            config_json={
                "observe_success": True,
                "report_observed_outcome": True,
                "amount_selector": ".p",
            },
        )
        ReferralLeadEvent.objects.create(
            site=site,
            event_type=ReferralLeadEvent.EventType.LEAD_SUBMITTED,
            submission_stage=ReferralLeadEvent.SubmissionStage.SUBMIT_ATTEMPT,
            client_observed_outcome=ReferralLeadEvent.ClientObservedOutcome.SUCCESS_OBSERVED,
            ref_code="REF1",
            customer_email="lead@example.com",
            customer_phone="+79990001122",
            page_url="https://shop.example/order",
            form_id="f99",
            amount=Decimal("10.00"),
            currency="RUB",
            product_name="Item",
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["site_public_id"], str(site.public_id))
        self.assertEqual(r.data["integration_status"], "healthy")
        self.assertIn("integration_warnings", r.data)
        self.assertTrue(r.data["has_recent_leads"])
        self.assertEqual(r.data["windows"]["24h"]["submit_attempt_count"], 1)
        self.assertEqual(r.data["windows"]["24h"]["success_observed_count"], 1)
        self.assertEqual(r.data["ingest_quality"]["source"], "public_lead_ingest_audit")
        self.assertIn("total_requests", r.data["ingest_quality"]["24h"])
        row = r.data["recent_leads"][0]
        self.assertEqual(row["submission_stage"], ReferralLeadEvent.SubmissionStage.SUBMIT_ATTEMPT)
        self.assertIn("submission_stage_label", row)
        self.assertEqual(row["client_observed_outcome"], "success_observed")
        self.assertIn("client_outcome_label", row)
        self.assertEqual(row["customer_email_masked"], "l***@example.com")
        self.assertEqual(row["customer_phone_masked"], "***1122")
        self.assertEqual(r.data["site_membership"]["count"], 0)
        self.assertEqual(r.data["site_membership"]["recent_joins"], [])

    def test_diagnostics_not_leaking_other_site(self):
        other = User.objects.create_user(
            username="other_site_owner",
            email="other-so@example.com",
            password="secret12",
        )
        my_site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_mine_" + uuid.uuid4().hex,
            allowed_origins=["https://mine.example"],
        )
        other_site = Site.objects.create(
            owner=other,
            publishable_key="pk_other_" + uuid.uuid4().hex,
            allowed_origins=["https://other.example"],
        )
        ReferralLeadEvent.objects.create(
            site=other_site,
            event_type=ReferralLeadEvent.EventType.LEAD_SUBMITTED,
            submission_stage=ReferralLeadEvent.SubmissionStage.SUBMIT_ATTEMPT,
            ref_code="X",
            customer_email="secret@other.com",
        )
        other_member = User.objects.create_user(
            username="other_site_member",
            email="member-on-other@example.com",
            password="secret12",
        )
        SiteMembership.objects.create(site=other_site, user=other_member)
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["site_public_id"], str(my_site.public_id))
        self.assertEqual(r.data["windows"]["7d"]["submit_attempt_count"], 0)
        self.assertEqual(r.data["recent_leads"], [])
        self.assertEqual(r.data["site_membership"]["count"], 0)
        self.assertEqual(r.data["site_membership"]["recent_joins"], [])

    def test_diagnostics_membership_count_and_recent_joins(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_ms_" + uuid.uuid4().hex,
            allowed_origins=["https://shop.example"],
        )
        u1 = User.objects.create_user(username="m1", email="alice-ms@example.com", password="secret12")
        u2 = User.objects.create_user(username="m2", email="bob-ms@example.org", password="secret12")
        SiteMembership.objects.create(site=site, user=u1)
        SiteMembership.objects.create(site=site, user=u2)
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 200)
        sm = r.data["site_membership"]
        self.assertEqual(sm["count"], 2)
        self.assertEqual(len(sm["recent_joins"]), 2)
        emails = {row["identity_masked"] for row in sm["recent_joins"]}
        self.assertEqual(emails, {"a***@example.com", "b***@example.org"})

    def test_diagnostics_membership_scoped_to_selected_site(self):
        site_a = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_ms_a_" + uuid.uuid4().hex,
        )
        site_b = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_ms_b_" + uuid.uuid4().hex,
        )
        ua = User.objects.create_user(username="ma", email="a-ms@example.com", password="secret12")
        ub = User.objects.create_user(username="mb", email="b-ms@example.com", password="secret12")
        uc = User.objects.create_user(username="mc", email="c-ms@example.com", password="secret12")
        SiteMembership.objects.create(site=site_a, user=ua)
        SiteMembership.objects.create(site=site_a, user=ub)
        SiteMembership.objects.create(site=site_b, user=uc)
        self.api.force_authenticate(self.owner)
        r_a = self.api.get(f"/referrals/site/integration/diagnostics/?site_public_id={site_a.public_id}")
        self.assertEqual(r_a.status_code, 200)
        self.assertEqual(r_a.data["site_membership"]["count"], 2)
        r_b = self.api.get(f"/referrals/site/integration/diagnostics/?site_public_id={site_b.public_id}")
        self.assertEqual(r_b.status_code, 200)
        self.assertEqual(r_b.data["site_membership"]["count"], 1)

    def test_diagnostics_stranger_cannot_read_foreign_site_summary(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_foreign_" + uuid.uuid4().hex,
        )
        member = User.objects.create_user(
            username="foreign_m",
            email="foreign-m@example.com",
            password="secret12",
        )
        SiteMembership.objects.create(site=site, user=member)
        self.api.force_authenticate(self.stranger)
        r = self.api.get(f"/referrals/site/integration/diagnostics/?site_public_id={site.public_id}")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data["detail"], "site_missing")
        self.assertEqual(r.data.get("code"), "site_missing")

    def test_diagnostics_requires_site_selection_when_multiple_sites(self):
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_diag_multi_1_" + uuid.uuid4().hex,
        )
        Site.objects.create(
            owner=self.owner,
            publishable_key="pk_diag_multi_2_" + uuid.uuid4().hex,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data["detail"], "site_selection_required")
        self.assertEqual(r.data.get("code"), "site_selection_required")

    def test_diagnostics_ingest_quality_counts(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_iq_" + uuid.uuid4().hex,
            allowed_origins=["https://metrics.example"],
        )
        PublicLeadIngestAudit.objects.create(
            site=site,
            event_name="lead_submitted",
            public_code=CODE_CREATED,
            http_status=201,
        )
        PublicLeadIngestAudit.objects.create(
            site=site,
            event_name="",
            public_code=CODE_RATE_LIMITED,
            http_status=429,
            throttle_scope="ip",
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/integration/diagnostics/")
        self.assertEqual(r.status_code, 200)
        iq = r.data["ingest_quality"]["7d"]
        self.assertEqual(iq["created_count"], 1)
        self.assertEqual(iq["rate_limited_count"], 1)
        self.assertEqual(iq["total_requests"], 2)
        self.assertEqual(iq["rejected_count"], 0)

