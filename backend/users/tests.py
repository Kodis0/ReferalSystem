import base64
import hashlib
import hmac
import json
import re
import time
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.hashers import make_password
from django.core import mail
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.models import Project
from referrals.services import DEFAULT_OWNER_PROJECT_NAME

from .models import PasswordResetCode, SupportTicket, WebAuthnCredential
from .password_reset_views import CAPTCHA_CACHE_PREFIX
from .support_attachments import attachment_disk_path


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


class ChangePasswordApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="pwd-change@example.com",
            username="pwdchange",
            password="Secret_old_1",
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_change_password_success(self):
        r = self.api.post(
            "/users/me/password/",
            {"old_password": "Secret_old_1", "new_password": "Secret_new_456"},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("detail"), "Пароль изменён.")
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("Secret_new_456"))

    def test_change_password_wrong_old(self):
        r = self.api.post(
            "/users/me/password/",
            {"old_password": "wrong", "new_password": "Secret_new_456"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "wrong_old_password")
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("Secret_old_1"))

    def test_change_password_requires_old_when_set(self):
        r = self.api.post(
            "/users/me/password/",
            {"old_password": "", "new_password": "Secret_new_456"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "old_password_required")

    def test_change_password_validation_weak_new(self):
        r = self.api.post(
            "/users/me/password/",
            {"old_password": "Secret_old_1", "new_password": "short"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "password_validation_failed")
        self.assertIn("new_password", r.data)

    def test_change_password_unusable_password_allows_set_without_old(self):
        self.user.set_unusable_password()
        self.user.save(update_fields=["password"])
        r = self.api.post(
            "/users/me/password/",
            {"old_password": "", "new_password": "Fresh_secret_99"},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("Fresh_secret_99"))


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

    def test_vk_start_scheme_light_query(self):
        c = Client()
        r = c.get("/users/token/vk/start/?scheme=light")
        self.assertEqual(r.status_code, 302)
        self.assertIn("scheme=light", r["Location"])

    def test_vk_start_stores_next_settings_in_session(self):
        c = Client()
        r = c.get("/users/token/vk/start/?next=/lk/settings")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(c.session.get("vk_oauth_next"), "/lk/settings")

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
            "email": "vk-set@example.com",
        },
    )
    def test_vk_callback_success_redirects_settings_when_next_in_session(self, _mock_ex):
        User.objects.create_user(
            email="vk-set@example.com",
            username="vkset",
            password="secret123",
        )
        c = Client()
        c.get("/users/token/vk/start/?next=/lk/settings")
        state = c.session.get("vk_oauth_state")
        self.assertTrue(state)
        r = c.get(f"/users/token/vk/callback/?code=testcode&state={state}&device_id=dev1")
        self.assertEqual(r.status_code, 302)
        loc = r["Location"]
        self.assertTrue(loc.startswith("http://test-frontend.example:3000/lk/settings#"), loc)
        self.assertIn("oauth=vk", loc)

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
        p = Project.objects.get(owner=u, is_default=True)
        self.assertEqual(p.name, DEFAULT_OWNER_PROJECT_NAME)

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
        u = User.objects.get(telegram_id=101)
        self.assertEqual(u.email, "tg101@telegram.noreply")
        p = Project.objects.get(owner=u, is_default=True)
        self.assertEqual(p.name, DEFAULT_OWNER_PROJECT_NAME)


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
        self.assertEqual(lst.data["tickets"][0]["last_message_preview"], "Первое сообщение\nВторая строка")
        self.assertEqual(lst.data["tickets"][0]["is_closed"], False)
        self.assertTrue(SupportTicket.objects.filter(id=tid, user=self.user).exists())

    def test_support_ticket_post_multipart_create_saves_attachment_file(self):
        """Создание тикета с голосом: файлы должны сохраняться при POST (ЛК раньше слал только JSON)."""
        from django.core.files.uploadedfile import SimpleUploadedFile

        from users.support_attachments import attachment_disk_path

        blob = b"\x1acreate_post_webm"
        audio = SimpleUploadedFile("voice-create.webm", blob, content_type="audio/webm")
        r = self.api.post(
            "/users/me/support-tickets/",
            {
                "type_slug": "help-question",
                "target_label": "X",
                "body": "Текст\n\nВложения (имена файлов): voice-create.webm",
                "attachment_names": "voice-create.webm",
                "files": audio,
            },
            format="multipart",
        )
        self.assertEqual(r.status_code, 201, getattr(r, "data", None))
        tid = r.data["id"]
        path = attachment_disk_path(tid, "voice-create.webm")
        self.assertTrue(path.is_file())
        self.assertEqual(path.read_bytes(), blob)
        g = self.api.get(f"/users/me/support-tickets/{tid}/attachments/voice-create.webm/")
        self.assertEqual(g.status_code, 200)
        self.assertEqual(b"".join(g.streaming_content), blob)

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
        self.assertIsNotNone(p.data.get("closed_at"))
        t = SupportTicket.objects.get(id=tid)
        self.assertTrue(t.is_closed)
        self.assertIsNotNone(t.closed_at)
        reopen = self.api.patch(f"/users/me/support-tickets/{tid}/", {"is_closed": False}, format="json")
        self.assertEqual(reopen.status_code, 200)
        self.assertEqual(reopen.data["is_closed"], False)
        self.assertIsNone(reopen.data.get("closed_at"))
        t2 = SupportTicket.objects.get(id=tid)
        self.assertFalse(t2.is_closed)
        self.assertIsNone(t2.closed_at)

    def test_support_ticket_patch_append_body(self):
        r = self.api.post(
            "/users/me/support-tickets/",
            {"type_slug": "help-question", "target_label": "X", "body": "Первая часть"},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        tid = r.data["id"]
        p = self.api.patch(
            f"/users/me/support-tickets/{tid}/",
            {"append_body": "Вторая часть", "attachment_names": "a.txt"},
            format="json",
        )
        self.assertEqual(p.status_code, 200)
        self.assertIn("Вторая часть", p.data["body"])
        self.assertIn("Первая часть", p.data["body"])
        self.assertEqual(p.data["attachment_names"], "a.txt")
        lst = self.api.get("/users/me/support-tickets/")
        self.assertEqual(lst.status_code, 200)
        self.assertEqual(lst.data["tickets"][0]["last_message_preview"], "Первая часть\n\nВторая часть")

    def test_support_ticket_patch_append_rejected_when_closed(self):
        r = self.api.post(
            "/users/me/support-tickets/",
            {"type_slug": "help-question", "target_label": "X", "body": "Текст"},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        tid = r.data["id"]
        self.api.patch(f"/users/me/support-tickets/{tid}/", {"is_closed": True}, format="json")
        p = self.api.patch(f"/users/me/support-tickets/{tid}/", {"append_body": "Ещё"}, format="json")
        self.assertEqual(p.status_code, 400)
        self.assertEqual(p.data.get("code"), "ticket_closed")

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

    def test_support_ticket_multipart_saves_attachment_and_get_returns_bytes(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        r = self.api.post(
            "/users/me/support-tickets/",
            {"type_slug": "help-question", "target_label": "X", "body": "Первая часть"},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        tid = r.data["id"]
        blob = b"\x1atest_webm_bytes"
        audio = SimpleUploadedFile("voice-note.webm", blob, content_type="audio/webm")
        body_line = "Ответ\n\nВложения (имена файлов): voice-note.webm"
        p = self.api.patch(
            f"/users/me/support-tickets/{tid}/",
            {
                "append_body": body_line,
                "attachment_names": "voice-note.webm",
                "files": audio,
            },
            format="multipart",
        )
        self.assertEqual(p.status_code, 200, p.data)
        self.assertEqual(p.data["attachment_names"], "voice-note.webm")
        g = self.api.get(f"/users/me/support-tickets/{tid}/attachments/voice-note.webm/")
        self.assertEqual(g.status_code, 200)
        self.assertEqual(b"".join(g.streaming_content), blob)

    def test_support_ticket_delete_attachment_removes_file_and_updates_ticket(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        r = self.api.post(
            "/users/me/support-tickets/",
            {"type_slug": "help-question", "target_label": "X", "body": "Первая часть"},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        tid = r.data["id"]
        blob = b"\x1atest_webm_bytes"
        audio = SimpleUploadedFile("voice-note.webm", blob, content_type="audio/webm")
        p = self.api.patch(
            f"/users/me/support-tickets/{tid}/",
            {
                "append_body": "a\n\nВложения (имена файлов): voice-note.webm",
                "attachment_names": "voice-note.webm",
                "files": audio,
            },
            format="multipart",
        )
        self.assertEqual(p.status_code, 200, p.data)
        disk_path = attachment_disk_path(tid, "voice-note.webm")
        self.assertTrue(disk_path.is_file())
        d = self.api.delete(f"/users/me/support-tickets/{tid}/attachments/voice-note.webm/")
        self.assertEqual(d.status_code, 200, getattr(d, "data", None))
        self.assertEqual(d.data.get("attachment_names"), "")
        self.assertFalse(disk_path.is_file())
        g = self.api.get(f"/users/me/support-tickets/{tid}/attachments/voice-note.webm/")
        self.assertEqual(g.status_code, 404)


class AccountAdditionalUsersApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            email="owner-acc@example.com",
            username="owneracc",
            password="secret123",
        )
        self.additional = User.objects.create_user(
            email="extra-acc@example.com",
            username="extraacc",
            password="secret123",
        )
        self.additional.account_owner = self.owner
        self.additional.save(update_fields=["account_owner"])

    def test_owner_lists_additional_users(self):
        api = APIClient()
        api.force_authenticate(self.owner)
        r = api.get("/users/me/account-users/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data["results"]), 1)
        row = r.data["results"][0]
        self.assertEqual(row["email"], "extra-acc@example.com")
        self.assertEqual(row["public_id"], self.additional.public_id)

    def test_additional_user_gets_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.additional)
        r = api.get("/users/me/account-users/")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "not_primary_account")

    def test_owner_empty_list(self):
        lone = User.objects.create_user(
            email="lone@example.com",
            username="loneuser",
            password="secret123",
        )
        api = APIClient()
        api.force_authenticate(lone)
        r = api.get("/users/me/account-users/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["results"], [])


class PasskeyApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="passkey-user@example.com",
            username="passkeyuser",
            password="secret123",
        )

    def test_login_options_unknown_email_404(self):
        c = APIClient()
        r = c.post("/users/token/passkey/login/options/", {"email": "nope@example.com"}, format="json")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data.get("code"), "passkey_email_not_registered")

    def test_login_options_no_credentials_404(self):
        c = APIClient()
        r = c.post(
            "/users/token/passkey/login/options/",
            {"email": self.user.email},
            format="json",
        )
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data.get("code"), "passkey_not_registered")

    def test_login_options_returns_options_when_credential_exists(self):
        WebAuthnCredential.objects.create(
            user=self.user,
            credential_id=b"cid-test-unique",
            public_key=b"k" * 64,
            sign_count=0,
        )
        c = APIClient()
        r = c.post(
            "/users/token/passkey/login/options/",
            {"email": self.user.email},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("challenge_key", r.data)
        self.assertIn("options", r.data)
        self.assertIn("challenge", r.data["options"])

    def test_login_options_discoverable_without_email_returns_challenge(self):
        """Discoverable: без email — пустой allowCredentials, чтобы ОС показала выбор ключа."""
        c = APIClient()
        r = c.post("/users/token/passkey/login/options/", {}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("challenge_key", r.data)
        opts = r.data.get("options") or {}
        self.assertEqual(opts.get("allowCredentials"), [])

    def test_register_options_requires_auth(self):
        c = APIClient()
        r = c.post("/users/me/passkeys/register/options/", {}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_register_options_accepts_authenticator_attachment(self):
        api = APIClient()
        api.force_authenticate(self.user)
        r_platform = api.post(
            "/users/me/passkeys/register/options/",
            {"authenticator_attachment": "platform"},
            format="json",
        )
        self.assertEqual(r_platform.status_code, 200)
        sel = r_platform.data["options"].get("authenticatorSelection") or {}
        self.assertEqual(sel.get("authenticatorAttachment"), "platform")

        r_cross = api.post(
            "/users/me/passkeys/register/options/",
            {"authenticator_attachment": "cross-platform"},
            format="json",
        )
        self.assertEqual(r_cross.status_code, 200)
        sel_c = r_cross.data["options"].get("authenticatorSelection") or {}
        self.assertEqual(sel_c.get("authenticatorAttachment"), "cross-platform")

    def test_passkeys_list_empty(self):
        api = APIClient()
        api.force_authenticate(self.user)
        r = api.get("/users/me/passkeys/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("results"), [])


class OAuthProvidersApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="oauth-me@example.com",
            username="oauthme",
            password="secret123",
        )

    def test_me_includes_oauth_providers_flags(self):
        api = APIClient()
        api.force_authenticate(self.user)
        r = api.get("/users/me/")
        self.assertEqual(r.status_code, 200)
        op = r.data.get("oauth_providers")
        self.assertIsInstance(op, dict)
        self.assertEqual(op["vk"]["linked"], False)
        self.assertEqual(op["telegram"]["linked"], False)
        self.assertEqual(op["google"]["linked"], False)

    def test_oauth_unlink_telegram_clears_telegram_id(self):
        self.user.telegram_id = 424242
        self.user.save(update_fields=["telegram_id"])
        api = APIClient()
        api.force_authenticate(self.user)
        r = api.post("/users/me/oauth/unlink/", {"provider": "telegram"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.user.refresh_from_db()
        self.assertIsNone(self.user.telegram_id)
        self.assertEqual(r.data["user"]["oauth_providers"]["telegram"]["linked"], False)

    def test_oauth_unlink_google_clears_sub(self):
        self.user.oauth_google_sub = "google-sub-x"
        self.user.save(update_fields=["oauth_google_sub"])
        api = APIClient()
        api.force_authenticate(self.user)
        r = api.post("/users/me/oauth/unlink/", {"provider": "google"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.user.refresh_from_db()
        self.assertIsNone(self.user.oauth_google_sub)


class PasswordResetApiTests(TestCase):
    def test_captcha_get_returns_png_data_url(self):
        c = APIClient()
        r = c.get("/users/password-reset/captcha/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("captcha_key", r.data)
        self.assertIn("image_base64", r.data)
        self.assertTrue(str(r.data["image_base64"]).startswith("data:image/png;base64,"))

    def test_reset_request_invalid_captcha(self):
        c = APIClient()
        cap = c.get("/users/password-reset/captcha/")
        r = c.post(
            "/users/password-reset/request/",
            {"email": "x@example.com", "captcha_key": cap.data["captcha_key"], "captcha_code": "wrong"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "captcha_invalid")

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_reset_request_sends_mail_when_user_exists(self):
        User.objects.create_user(email="reset-me@example.com", username="resetme", password="secret123")
        c = APIClient()
        cap = c.get("/users/password-reset/captcha/")
        key = cap.data["captcha_key"]
        code = cache.get(f"{CAPTCHA_CACHE_PREFIX}{key}")
        self.assertIsNotNone(code)
        r = c.post(
            "/users/password-reset/request/",
            {"email": "reset-me@example.com", "captcha_key": key, "captcha_code": code},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("code"), "password_reset_requested")
        self.assertEqual(len(mail.outbox), 1)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_reset_request_unknown_email_same_response_no_mail(self):
        c = APIClient()
        cap = c.get("/users/password-reset/captcha/")
        key = cap.data["captcha_key"]
        code = cache.get(f"{CAPTCHA_CACHE_PREFIX}{key}")
        r = c.post(
            "/users/password-reset/request/",
            {"email": "nobody@example.com", "captcha_key": key, "captcha_code": code},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("code"), "password_reset_requested")
        self.assertEqual(len(mail.outbox), 0)


class PasswordResetCodeApiTests(TestCase):
    GENERIC_DETAIL = "Если аккаунт существует, мы отправили код восстановления."

    def _fresh_captcha(self, client):
        cap = client.get("/users/password-reset/captcha/")
        key = cap.data["captcha_key"]
        code = cache.get(f"{CAPTCHA_CACHE_PREFIX}{key}")
        self.assertIsNotNone(code)
        return key, code

    def _code_request(self, client, email):
        key, cap_code = self._fresh_captcha(client)
        return client.post(
            "/users/api/password-reset/request/",
            {"email": email, "captcha_key": key, "captcha": cap_code},
            format="json",
        )

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_mail_failure_still_returns_generic_200(self):
        User.objects.create_user(email="smtp-fail@example.com", username="smtpfail", password="Secret123!")
        c = APIClient()
        with (
            patch(
                "users.password_reset_code_views.issue_code_for_user",
                side_effect=RuntimeError("smtp"),
            ),
            patch("users.password_reset_code_views.logger.exception") as log_exc,
        ):
            r = self._code_request(c, "smtp-fail@example.com")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("detail"), self.GENERIC_DETAIL)
        log_exc.assert_called_once()

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_code_request_existing_returns_generic_success(self):
        User.objects.create_user(email="code-u@example.com", username="codeu", password="OldSecret123!")
        c = APIClient()
        r = self._code_request(c, "code-u@example.com")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("detail"), self.GENERIC_DETAIL)
        self.assertEqual(PasswordResetCode.objects.count(), 1)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_code_request_unknown_returns_generic_success_no_row(self):
        c = APIClient()
        r = self._code_request(c, "missing@example.com")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("detail"), self.GENERIC_DETAIL)
        self.assertEqual(PasswordResetCode.objects.count(), 0)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_code_row_only_when_user_exists(self):
        User.objects.create_user(email="only-exists@example.com", username="only", password="Secret123!")
        c = APIClient()
        self._code_request(c, "only-exists@example.com")
        self.assertEqual(PasswordResetCode.objects.count(), 1)
        self._code_request(c, "ghost@example.com")
        self.assertEqual(PasswordResetCode.objects.count(), 1)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_mail_contains_six_digit_code(self):
        User.objects.create_user(email="mailcode@example.com", username="mailcode", password="Secret123!")
        c = APIClient()
        self._code_request(c, "mailcode@example.com")
        self.assertEqual(len(mail.outbox), 1)
        body = mail.outbox[0].body
        m = re.search(r"\b\d{6}\b", body)
        self.assertIsNotNone(m)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_wrong_code_increments_attempts(self):
        User.objects.create_user(email="attempts@example.com", username="attempts", password="Secret123!")
        c = APIClient()
        self._code_request(c, "attempts@example.com")
        prc = PasswordResetCode.objects.get()
        self.assertEqual(prc.attempts, 0)
        c.post(
            "/users/api/password-reset/confirm/",
            {
                "email": "attempts@example.com",
                "code": "000000",
                "new_password": "NewSecret123!",
                "new_password_confirm": "NewSecret123!",
            },
            format="json",
        )
        prc.refresh_from_db()
        self.assertEqual(prc.attempts, 1)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_five_wrong_attempts_blocks_even_correct_code(self):
        User.objects.create_user(email="five@example.com", username="five", password="Secret123!")
        c = APIClient()
        self._code_request(c, "five@example.com")
        body = mail.outbox[0].body
        good = re.search(r"\b\d{6}\b", body).group(0)
        for _ in range(5):
            r = c.post(
                "/users/api/password-reset/confirm/",
                {
                    "email": "five@example.com",
                    "code": "111111",
                    "new_password": "NewSecret123!",
                    "new_password_confirm": "NewSecret123!",
                },
                format="json",
            )
            self.assertEqual(r.status_code, 400)
        r6 = c.post(
            "/users/api/password-reset/confirm/",
            {
                "email": "five@example.com",
                "code": good,
                "new_password": "NewSecret123!",
                "new_password_confirm": "NewSecret123!",
            },
            format="json",
        )
        self.assertEqual(r6.status_code, 400)
        self.assertEqual(r6.data.get("code"), "password_reset_max_attempts")

    def test_expired_code_rejected(self):
        User.objects.create_user(email="exp@example.com", username="exp", password="Secret123!")
        prc = PasswordResetCode.objects.create(
            user=User.objects.get(email="exp@example.com"),
            email="exp@example.com",
            code_hash=make_password("654321"),
            expires_at=timezone.now() + timedelta(minutes=15),
        )
        PasswordResetCode.objects.filter(pk=prc.pk).update(
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        c = APIClient()
        r = c.post(
            "/users/api/password-reset/confirm/",
            {
                "email": "exp@example.com",
                "code": "654321",
                "new_password": "NewSecret123!",
                "new_password_confirm": "NewSecret123!",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "password_reset_code_invalid")

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_successful_confirm_invalidates_code_repeat_fails(self):
        User.objects.create_user(email="reuse@example.com", username="reuse", password="Secret123!")
        c = APIClient()
        self._code_request(c, "reuse@example.com")
        good = re.search(r"\b\d{6}\b", mail.outbox[0].body).group(0)
        r1 = c.post(
            "/users/api/password-reset/confirm/",
            {
                "email": "reuse@example.com",
                "code": good,
                "new_password": "NewSecret123!",
                "new_password_confirm": "NewSecret123!",
            },
            format="json",
        )
        self.assertEqual(r1.status_code, 200)
        r2 = c.post(
            "/users/api/password-reset/confirm/",
            {
                "email": "reuse@example.com",
                "code": good,
                "new_password": "OtherSecret123!",
                "new_password_confirm": "OtherSecret123!",
            },
            format="json",
        )
        self.assertEqual(r2.status_code, 400)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_confirm_changes_password(self):
        User.objects.create_user(email="chg@example.com", username="chg", password="Secret123!")
        c = APIClient()
        self._code_request(c, "chg@example.com")
        good = re.search(r"\b\d{6}\b", mail.outbox[0].body).group(0)
        r = c.post(
            "/users/api/password-reset/confirm/",
            {
                "email": "chg@example.com",
                "code": good,
                "new_password": "NewSecret123!",
                "new_password_confirm": "NewSecret123!",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        user = User.objects.get(email="chg@example.com")
        self.assertTrue(user.check_password("NewSecret123!"))
        self.assertIsNotNone(
            authenticate(username="chg@example.com", password="NewSecret123!")
        )

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_confirm_marks_code_used_at(self):
        User.objects.create_user(email="used@example.com", username="used", password="Secret123!")
        c = APIClient()
        self._code_request(c, "used@example.com")
        good = re.search(r"\b\d{6}\b", mail.outbox[0].body).group(0)
        prc = PasswordResetCode.objects.get()
        self.assertIsNone(prc.used_at)
        c.post(
            "/users/api/password-reset/confirm/",
            {
                "email": "used@example.com",
                "code": good,
                "new_password": "NewSecret123!",
                "new_password_confirm": "NewSecret123!",
            },
            format="json",
        )
        prc.refresh_from_db()
        self.assertIsNotNone(prc.used_at)

    def test_confirm_password_mismatch(self):
        User.objects.create_user(email="mm@example.com", username="mm", password="Secret123!")
        c = APIClient()
        r = c.post(
            "/users/api/password-reset/confirm/",
            {
                "email": "mm@example.com",
                "code": "123456",
                "new_password": "NewSecret123!",
                "new_password_confirm": "NewSecret124!",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "password_mismatch")

    def test_confirm_password_validators(self):
        User.objects.create_user(email="weak@example.com", username="weak", password="Secret123!")
        PasswordResetCode.objects.create(
            user=User.objects.get(email="weak@example.com"),
            email="weak@example.com",
            code_hash=make_password("123456"),
            expires_at=timezone.now() + timedelta(minutes=15),
        )
        c = APIClient()
        r = c.post(
            "/users/api/password-reset/confirm/",
            {
                "email": "weak@example.com",
                "code": "123456",
                "new_password": "123",
                "new_password_confirm": "123",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "password_validation_failed")

    def test_invalid_captcha_blocks_code_request(self):
        User.objects.create_user(email="cap@example.com", username="cap", password="Secret123!")
        c = APIClient()
        cap = c.get("/users/password-reset/captcha/")
        r = c.post(
            "/users/api/password-reset/request/",
            {
                "email": "cap@example.com",
                "captcha_key": cap.data["captcha_key"],
                "captcha": "wrongwrong",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "captcha_invalid")
        self.assertEqual(PasswordResetCode.objects.count(), 0)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_resend_cooldown_second_request_no_extra_row(self):
        User.objects.create_user(email="cool@example.com", username="cool", password="Secret123!")
        c = APIClient()
        r1 = self._code_request(c, "cool@example.com")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(PasswordResetCode.objects.count(), 1)
        r2 = self._code_request(c, "cool@example.com")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.data.get("detail"), self.GENERIC_DETAIL)
        self.assertEqual(PasswordResetCode.objects.count(), 1)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_max_codes_per_hour_blocks_extra_row(self):
        user = User.objects.create_user(email="hour@example.com", username="hour", password="Secret123!")
        norm = "hour@example.com"
        now = timezone.now()
        for _ in range(5):
            PasswordResetCode.objects.create(
                user=user,
                email=norm,
                code_hash=make_password("111111"),
                expires_at=now + timedelta(minutes=15),
            )
        c = APIClient()
        r = self._code_request(c, "hour@example.com")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(PasswordResetCode.objects.count(), 5)
