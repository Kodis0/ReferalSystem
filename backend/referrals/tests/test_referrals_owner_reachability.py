import uuid
from http.client import HTTPMessage
from io import BytesIO
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from urllib.error import HTTPError, URLError

from referrals.models import Site
from referrals.services import check_site_http_reachability

User = get_user_model()


class SiteOwnerReachabilityApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username="reach_owner",
            email="reach-owner@example.com",
            password="secret12",
        )
        self.api = APIClient()

    def test_reachability_requires_auth(self):
        r = self.api.get("/referrals/site/reachability/")
        self.assertEqual(r.status_code, 401)

    def test_reachability_requires_site_public_id(self):
        self.api.force_authenticate(self.owner)
        r = self.api.get("/referrals/site/reachability/")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "site_public_id_required")

    def test_reachability_no_origin(self):
        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_reach_" + uuid.uuid4().hex,
            allowed_origins=[],
            platform_preset=Site.PlatformPreset.TILDA,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get(f"/referrals/site/reachability/?site_public_id={site.public_id}")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["reachable"])
        self.assertEqual(r.data["reason"], "no_origin")
        self.assertIsNone(r.data.get("latency_ms"))

    @patch("urllib.request.urlopen")
    def test_reachability_head_ok(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.__enter__ = MagicMock(return_value=mock_resp)
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_resp.getcode.return_value = 200
        mock_urlopen.return_value = mock_resp

        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_reach_" + uuid.uuid4().hex,
            allowed_origins=["https://shop.example"],
            platform_preset=Site.PlatformPreset.TILDA,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get(f"/referrals/site/reachability/?site_public_id={site.public_id}")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["reachable"])
        self.assertEqual(r.data["http_status"], 200)
        self.assertIn("latency_ms", r.data)
        self.assertIsInstance(r.data["latency_ms"], int)
        self.assertGreaterEqual(r.data["latency_ms"], 0)

    @patch("urllib.request.urlopen")
    def test_reachability_http_error_still_reachable(self, mock_urlopen):
        def _raise(*_a, **_k):
            fp = BytesIO(b"")
            hdrs = HTTPMessage()
            raise HTTPError("https://shop.example/", 404, "n", hdrs, fp)

        mock_urlopen.side_effect = _raise

        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_reach_" + uuid.uuid4().hex,
            allowed_origins=["https://shop.example"],
            platform_preset=Site.PlatformPreset.TILDA,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get(f"/referrals/site/reachability/?site_public_id={site.public_id}")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data["reachable"])
        self.assertEqual(r.data["http_status"], 404)
        self.assertIsInstance(r.data.get("latency_ms"), int)
        self.assertGreaterEqual(r.data["latency_ms"], 0)

    @patch("urllib.request.urlopen")
    def test_reachability_network_error(self, mock_urlopen):
        mock_urlopen.side_effect = URLError("connection refused")

        site = Site.objects.create(
            owner=self.owner,
            publishable_key="pk_reach_" + uuid.uuid4().hex,
            allowed_origins=["https://shop.example"],
            platform_preset=Site.PlatformPreset.TILDA,
        )
        self.api.force_authenticate(self.owner)
        r = self.api.get(f"/referrals/site/reachability/?site_public_id={site.public_id}")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["reachable"])
        self.assertEqual(r.data["reason"], "network_error")
        self.assertIsInstance(r.data.get("latency_ms"), int)
        self.assertGreaterEqual(r.data["latency_ms"], 0)


class CheckSiteHttpReachabilityUnitTests(TestCase):
    def test_no_origin(self):
        site = Site.objects.create(
            owner=User.objects.create_user("u1", "u1@e.com", "secret12"),
            publishable_key="pk_u_" + uuid.uuid4().hex,
            allowed_origins=[],
            platform_preset=Site.PlatformPreset.TILDA,
        )
        out = check_site_http_reachability(site)
        self.assertFalse(out["reachable"])
        self.assertEqual(out["reason"], "no_origin")
        self.assertIsNone(out.get("latency_ms"))
