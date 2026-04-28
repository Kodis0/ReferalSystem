from django.test import TestCase, override_settings
from rest_framework.test import APIClient


class PlatformServiceStatusApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_default_all_services_ok(self):
        r = self.client.get("/referrals/platform-service-status/")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("services", data)
        self.assertIn("fetched_at", data)
        self.assertEqual(len(data["services"]), 3)
        ids = [s["id"] for s in data["services"]]
        self.assertEqual(
            ids,
            ["lumo-owner", "lumo-widget", "lumo-referral"],
        )
        for s in data["services"]:
            self.assertTrue(s["ok"])
            self.assertEqual(s.get("message") or "", "")

    @override_settings(
        PLATFORM_SERVICE_STATUS_OVERRIDES_JSON='{"lumo-widget": {"ok": false, "message": "Плановые работы"}}'
    )
    def test_override_marks_service_down_with_message(self):
        r = self.client.get("/referrals/platform-service-status/")
        self.assertEqual(r.status_code, 200)
        by_id = {s["id"]: s for s in r.json()["services"]}
        self.assertTrue(by_id["lumo-owner"]["ok"])
        self.assertFalse(by_id["lumo-widget"]["ok"])
        self.assertEqual(by_id["lumo-widget"]["message"], "Плановые работы")
        self.assertTrue(by_id["lumo-referral"]["ok"])

    @override_settings(
        PLATFORM_SERVICE_STATUS_OVERRIDES_JSON='[{"id": "lumo-owner", "ok": false, "message": "Сбой"}]'
    )
    def test_override_list_form(self):
        r = self.client.get("/referrals/platform-service-status/")
        self.assertEqual(r.status_code, 200)
        by_id = {s["id"]: s for s in r.json()["services"]}
        self.assertFalse(by_id["lumo-owner"]["ok"])
        self.assertEqual(by_id["lumo-owner"]["message"], "Сбой")

    @override_settings(PLATFORM_SERVICE_STATUS_OVERRIDES_JSON="not-json")
    def test_invalid_json_yields_all_ok(self):
        r = self.client.get("/referrals/platform-service-status/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(all(s["ok"] for s in r.json()["services"]))
