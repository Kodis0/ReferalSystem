import base64
import hashlib
import hmac
import json
import time
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from rest_framework.test import APIClient

from .models import SupportTicket


User = get_user_model()


def _telegram_login_hash(bot_token: str, payload: dict[str, str]) -> str:
    lines = "\n".join(f"{k}={payload[k]}" for k in sorted(payload.keys()))
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    return hmac.new(secret_key, lines.encode(), hashlib.sha256).hexdigest()


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


@override_settings(
    VK_OAUTH_APP_ID="vk_app_id",
    VK_OAUTH_CLIENT_SECRET="vk_secret",
    FRONTEND_URL="http://test-frontend.example:3000",
)
class VkOAuthFlowTests(TestCase):
    def test_vk_start_redirects_to_authorize(self):
        c = Client()
        r = c.get("/users/token/vk/start/")
        self.assertEqual(r.status_code, 302)
        loc = r["Location"]
        self.assertTrue(loc.startswith("https://id.vk.com/authorize?"), loc)
        self.assertIn("client_id=vk_app_id", loc)
        self.assertIn("scope=email", loc)
        self.assertIn("state=", loc)
        self.assertIn("code_challenge=", loc)
        self.assertIn("code_challenge_method=S256", loc)
        self.assertIn("scheme=dark", loc)
        self.assertTrue(c.session.get("vk_oauth_state"))
        self.assertTrue(c.session.get("vk_code_verifier"))

    @override_settings(VK_OAUTH_APP_ID="")
    def test_vk_start_missing_config_redirects_frontend_error(self):
        c = Client()
        r = c.get("/users/token/vk/start/")
        self.assertEqual(r.status_code, 302)
        self.assertIn("vk_error=vk_oauth_not_configured", r["Location"])

    def test_vk_callback_rejects_bad_state(self):
        c = Client()
        c.get("/users/token/vk/start/")
        r = c.get(
            "/users/token/vk/callback/?code=fake&state=not-the-session-state&device_id=dev1",
        )
        self.assertEqual(r.status_code, 302)
        self.assertIn("vk_error=vk_state_invalid", r["Location"])

    @patch(
        "users.views.exchange_vk_oauth_code",
        return_value={
            "access_token": "vk_token",
            "user_id": 1,
            "email": "vk-match@example.com",
        },
    )
    def test_vk_callback_success_redirects_login_hash_with_jwt(self, _mock_ex):
        User.objects.create_user(
            email="vk-match@example.com",
            username="vkmatch",
            password="secret123",
        )
        c = Client()
        c.get("/users/token/vk/start/")
        state = c.session.get("vk_oauth_state")
        self.assertTrue(state)
        r = c.get(f"/users/token/vk/callback/?code=testcode&state={state}&device_id=dev1")
        self.assertEqual(r.status_code, 302)
        loc = r["Location"]
        self.assertTrue(loc.startswith("http://test-frontend.example:3000/login#"), loc)
        self.assertIn("oauth=vk", loc)
        self.assertIn("access_token=", loc)
        self.assertIn("refresh_token=", loc)

    @patch(
        "users.views.exchange_vk_oauth_code",
        return_value={
            "access_token": "vk_token",
            "user_id": 1,
            "email": "nobody@example.com",
        },
    )
    def test_vk_callback_unknown_email_redirects_error(self, _mock_ex):
        c = Client()
        c.get("/users/token/vk/start/")
        state = c.session["vk_oauth_state"]
        r = c.get(f"/users/token/vk/callback/?code=testcode&state={state}&device_id=dev1")
        self.assertEqual(r.status_code, 302)
        self.assertIn("vk_error=vk_email_not_registered", r["Location"])

    def test_vk_callback_access_denied_redirects(self):
        c = Client()
        r = c.get("/users/token/vk/callback/?error=access_denied")
        self.assertEqual(r.status_code, 302)
        self.assertIn("vk_error=vk_oauth_denied", r["Location"])

    def test_vk_callback_missing_device_id_redirects(self):
        c = Client()
        c.get("/users/token/vk/start/")
        state = c.session["vk_oauth_state"]
        r = c.get(f"/users/token/vk/callback/?code=x&state={state}")
        self.assertEqual(r.status_code, 302)
        self.assertIn("vk_error=vk_missing_device_id", r["Location"])


@override_settings(
    TELEGRAM_BOT_TOKEN="123456:ABC-DEF",
    FRONTEND_URL="http://test-frontend.example:3000",
)
class TelegramLoginFlowTests(TestCase):
    def test_telegram_start_redirects_to_oauth(self):
        c = Client()
        r = c.get("/users/token/telegram/start/")
        self.assertEqual(r.status_code, 302)
        loc = r["Location"]
        self.assertTrue(loc.startswith("https://oauth.telegram.org/auth?"), loc)
        self.assertIn("bot_id=123456", loc)
        self.assertIn("return_to=", loc)
        self.assertIn("origin=", loc)

    @override_settings(TELEGRAM_BOT_TOKEN="")
    def test_telegram_start_missing_config_redirects(self):
        c = Client()
        r = c.get("/users/token/telegram/start/")
        self.assertEqual(r.status_code, 302)
        self.assertIn("tg_error=tg_oauth_not_configured", r["Location"])

    def test_telegram_callback_invalid_hash(self):
        c = Client()
        r = c.get("/users/token/telegram/callback/?id=1&auth_date=1&first_name=X&hash=bad")
        self.assertEqual(r.status_code, 302)
        self.assertIn("tg_error=tg_auth_invalid", r["Location"])

    def test_telegram_callback_success_redirects_with_jwt(self):
        bot_token = "123456:ABC-DEF"
        auth_date = str(int(time.time()))
        base = {"id": "42", "first_name": "Ann", "auth_date": auth_date}
        digest = _telegram_login_hash(bot_token, base)
        c = Client()
        r = c.get(
            f"/users/token/telegram/callback/?id=42&first_name=Ann&auth_date={auth_date}&hash={digest}"
        )
        self.assertEqual(r.status_code, 302)
        loc = r["Location"]
        self.assertTrue(loc.startswith("http://test-frontend.example:3000/login#"), loc)
        self.assertIn("oauth=tg", loc)
        self.assertIn("access_token=", loc)
        self.assertIn("refresh_token=", loc)
        u = User.objects.get(telegram_id=42)
        self.assertEqual(u.email, "tg42@telegram.noreply")

    def test_telegram_callback_account_disabled(self):
        bot_token = "123456:ABC-DEF"
        auth_date = str(int(time.time()))
        User.objects.create_user(
            email="tg7@telegram.noreply",
            username="tg7",
            password="secret123",
            telegram_id=7,
        )
        User.objects.filter(pk=User.objects.get(telegram_id=7).pk).update(is_active=False)

        base = {"id": "7", "first_name": "X", "auth_date": auth_date}
        digest = _telegram_login_hash(bot_token, base)
        c = Client()
        r = c.get(
            f"/users/token/telegram/callback/?id=7&first_name=X&auth_date={auth_date}&hash={digest}"
        )
        self.assertEqual(r.status_code, 302)
        self.assertIn("tg_error=account_disabled", r["Location"])

    def test_telegram_widget_post_returns_tokens_json(self):
        bot_token = "123456:ABC-DEF"
        auth_date = int(time.time())
        obj = {"id": 101, "first_name": "Widget", "auth_date": auth_date}
        sign_payload = {k: str(v) for k, v in obj.items()}
        digest = _telegram_login_hash(bot_token, sign_payload)
        obj["hash"] = digest
        raw_json = json.dumps(obj)
        b64 = base64.urlsafe_b64encode(raw_json.encode("utf-8")).decode("ascii").rstrip("=")

        c = Client()
        r = c.post(
            "/users/token/telegram/widget/",
            data=json.dumps({"tgAuthResult": b64}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        payload = json.loads(r.content.decode())
        self.assertIn("access", payload)
        self.assertIn("refresh", payload)
        self.assertEqual(User.objects.get(telegram_id=101).email, "tg101@telegram.noreply")


class SupportTicketApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="support-api@example.com",
            username="supportapi",
            password="secret123",
        )
        self.other = User.objects.create_user(
            email="support-other@example.com",
            username="supportother",
            password="secret123",
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_support_tickets_list_empty(self):
        r = self.api.get("/users/me/support-tickets/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["tickets"], [])

    def test_support_ticket_create_and_list(self):
        r = self.api.post(
            "/users/me/support-tickets/",
            {
                "type_slug": "help-question",
                "target_key": "x",
                "target_label": "Кабинет владельца",
                "body": "Первое сообщение\nВторая строка",
                "attachment_names": "a.txt",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        tid = r.data["id"]
        self.assertEqual(r.data["body"], "Первое сообщение\nВторая строка")
        self.assertEqual(r.data["type_title"], "По общему вопросу")
        self.assertEqual(r.data["is_closed"], False)

        lst = self.api.get("/users/me/support-tickets/")
        self.assertEqual(lst.status_code, 200)
        self.assertEqual(len(lst.data["tickets"]), 1)
        self.assertEqual(lst.data["tickets"][0]["id"], tid)
        self.assertEqual(lst.data["tickets"][0]["preview"], "Первое сообщение")
        self.assertEqual(lst.data["tickets"][0]["is_closed"], False)
        self.assertTrue(SupportTicket.objects.filter(id=tid, user=self.user).exists())

    def test_support_ticket_patch_close(self):
        r = self.api.post(
            "/users/me/support-tickets/",
            {"type_slug": "help-question", "target_label": "X", "body": "Текст"},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        tid = r.data["id"]
        p = self.api.patch(f"/users/me/support-tickets/{tid}/", {"is_closed": True}, format="json")
        self.assertEqual(p.status_code, 200)
        self.assertEqual(p.data["is_closed"], True)
        t = SupportTicket.objects.get(id=tid)
        self.assertTrue(t.is_closed)

    def test_support_ticket_detail(self):
        r = self.api.post(
            "/users/me/support-tickets/",
            {
                "type_slug": "help-problem",
                "target_label": "Тест",
                "body": "Тело",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        tid = r.data["id"]
        d = self.api.get(f"/users/me/support-tickets/{tid}/")
        self.assertEqual(d.status_code, 200)
        self.assertEqual(d.data["body"], "Тело")

        other_api = APIClient()
        other_api.force_authenticate(self.other)
        denied = other_api.get(f"/users/me/support-tickets/{tid}/")
        self.assertEqual(denied.status_code, 404)

    def test_support_ticket_invalid_slug(self):
        r = self.api.post(
            "/users/me/support-tickets/",
            {"type_slug": "unknown", "body": "x"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "invalid_type_slug")
