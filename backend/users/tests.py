from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient


User = get_user_model()


class CurrentUserApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="public-id@example.com",
            username="publicid",
            password="secret123",
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_me_returns_stable_unique_public_id(self):
        response = self.api.get("/users/me/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("public_id", response.data)
        self.assertEqual(len(response.data["public_id"]), 7)
        self.assertNotEqual(response.data["public_id"], str(self.user.pk))

        second = self.api.get("/users/me/")
        self.assertEqual(second.data["public_id"], response.data["public_id"])

    def test_each_user_gets_own_unique_public_id(self):
        another = User.objects.create_user(
            email="another-public-id@example.com",
            username="anotherpublicid",
            password="secret123",
        )

        self.assertTrue(self.user.public_id)
        self.assertTrue(another.public_id)
        self.assertEqual(len(self.user.public_id), 7)
        self.assertEqual(len(another.public_id), 7)
        self.assertNotEqual(self.user.public_id, another.public_id)

    def test_me_patch_updates_first_and_last_name(self):
        response = self.api.patch(
            "/users/me/",
            {"first_name": "Иван", "last_name": "Петров"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["first_name"], "Иван")
        self.assertEqual(response.data["last_name"], "Петров")
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "Иван")
        self.assertEqual(self.user.last_name, "Петров")

    def test_me_patch_avatar_data_url_roundtrip(self):
        tiny_png = (
            "data:image/png;base64,"
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        )
        r = self.api.patch("/users/me/", {"avatar_data_url": tiny_png}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("avatar_data_url"), tiny_png)
        self.user.refresh_from_db()
        self.assertEqual(self.user.avatar_data_url, tiny_png)

        r2 = self.api.patch("/users/me/", {"avatar_data_url": ""}, format="json")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.data.get("avatar_data_url"), "")
        self.user.refresh_from_db()
        self.assertEqual(self.user.avatar_data_url, "")

    def test_me_patch_personal_and_passport_roundtrip(self):
        r = self.api.patch(
            "/users/me/",
            {
                "first_name": "Иван",
                "last_name": "Иванов",
                "patronymic": "Иванович",
                "birth_date": "1991-05-20",
                "passport_series": "1234",
                "passport_number": "567890",
                "passport_issued_by": "УФМС",
                "passport_issue_date": "2015-01-10",
                "passport_registration_address": "г. Москва, ул. Примерная, д. 1",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("first_name"), "Иван")
        self.assertEqual(r.data.get("last_name"), "Иванов")
        self.assertEqual(r.data.get("patronymic"), "Иванович")
        self.assertEqual(r.data.get("birth_date"), "1991-05-20")
        self.assertEqual(r.data.get("passport_series"), "1234")
        self.assertEqual(r.data.get("passport_number"), "567890")
        self.assertEqual(r.data.get("passport_issued_by"), "УФМС")
        self.assertEqual(r.data.get("passport_issue_date"), "2015-01-10")
        self.assertEqual(r.data.get("passport_registration_address"), "г. Москва, ул. Примерная, д. 1")
        self.user.refresh_from_db()
        self.assertEqual(self.user.patronymic, "Иванович")

    def test_me_patch_fio_splits_into_parts(self):
        r = self.api.patch(
            "/users/me/",
            {"fio": "Иванов Иван Иванович", "account_type": "individual"},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("fio"), "Иванов Иван Иванович")
        self.assertEqual(r.data.get("account_type"), "individual")
        self.user.refresh_from_db()
        self.assertEqual(self.user.last_name, "Иванов")
        self.assertEqual(self.user.first_name, "Иван")
        self.assertEqual(self.user.patronymic, "Иванович")

    def test_me_patch_email_rejects_duplicate(self):
        User.objects.create_user(
            email="taken@example.com",
            username="taken",
            password="secret123",
        )
        r = self.api.patch("/users/me/", {"email": "taken@example.com"}, format="json")
        self.assertEqual(r.status_code, 400)


@override_settings(GOOGLE_OAUTH_CLIENT_ID="test.apps.googleusercontent.com")
class GoogleIdTokenLoginTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="google-match@example.com",
            username="googlematch",
            password="secret123",
        )
        self.client = APIClient()

    @patch("users.google_verify.verify_google_id_token")
    def test_google_login_returns_jwt_when_email_matches(self, mock_verify):
        mock_verify.return_value = {
            "email": "google-match@example.com",
            "email_verified": True,
            "sub": "google-sub-1",
        }
        r = self.client.post(
            "/users/token/google/",
            {"credential": "fake-jwt"},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("access", r.data)
        self.assertIn("refresh", r.data)
        self.assertEqual(r.data["user"]["email"], "google-match@example.com")

    @patch("users.google_verify.verify_google_id_token")
    def test_google_login_case_insensitive_email(self, mock_verify):
        mock_verify.return_value = {
            "email": "Google-Match@Example.com",
            "email_verified": True,
            "sub": "google-sub-2",
        }
        r = self.client.post(
            "/users/token/google/",
            {"id_token": "fake-jwt"},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["user"]["email"], "google-match@example.com")

    @patch("users.google_verify.verify_google_id_token")
    def test_google_login_unknown_email_404(self, mock_verify):
        mock_verify.return_value = {
            "email": "nobody@example.com",
            "email_verified": True,
            "sub": "google-sub-3",
        }
        r = self.client.post(
            "/users/token/google/",
            {"credential": "fake-jwt"},
            format="json",
        )
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data.get("code"), "google_email_not_registered")

    @patch("users.google_verify.verify_google_id_token", side_effect=ValueError("bad"))
    def test_google_login_invalid_token_401(self, _mock_verify):
        r = self.client.post(
            "/users/token/google/",
            {"credential": "bad-jwt"},
            format="json",
        )
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.data.get("code"), "google_token_invalid")

    @patch("users.google_verify.verify_google_id_token")
    def test_google_login_unverified_email_403(self, mock_verify):
        mock_verify.return_value = {
            "email": "google-match@example.com",
            "email_verified": False,
            "sub": "google-sub-4",
        }
        r = self.client.post(
            "/users/token/google/",
            {"credential": "fake-jwt"},
            format="json",
        )
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "google_email_not_verified")

    def test_google_login_missing_body_400(self):
        r = self.client.post("/users/token/google/", {}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "google_credential_missing")

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="")
    def test_google_login_not_configured_503(self):
        r = self.client.post(
            "/users/token/google/",
            {"credential": "x"},
            format="json",
        )
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.data.get("code"), "google_oauth_not_configured")
