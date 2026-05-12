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

from referrals.models import PartnerProfile, Project
from referrals.services import DEFAULT_OWNER_PROJECT_NAME

from .models import (
    AdminActionAudit,
    AdminMfaChallenge,
    AdminMfaDevice,
    AdminSession,
    AdminTelegramBindToken,
    PasswordResetCode,
    SupportTicket,
    WebAuthnCredential,
)
from .telegram_mfa import TelegramMfaError, verify_bind_token
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


class CurrentUserAdminFlagsTests(TestCase):
    """Фронту нужны `is_staff`/`is_superuser` в `/users/me/`, чтобы условно показывать админ-разделы."""

    def _me(self, user):
        api = APIClient()
        api.force_authenticate(user)
        return api.get("/users/me/")

    def test_regular_user_has_both_flags_false(self):
        user = User.objects.create_user(
            email="regular-flags@example.com",
            username="regularflags",
            password="secret123",
        )
        r = self._me(user)
        self.assertEqual(r.status_code, 200)
        self.assertIn("is_staff", r.data)
        self.assertIn("is_superuser", r.data)
        self.assertEqual(r.data["is_staff"], False)
        self.assertEqual(r.data["is_superuser"], False)

    def test_staff_user_has_is_staff_true_only(self):
        user = User.objects.create_user(
            email="staff-flags@example.com",
            username="staffflags",
            password="secret123",
            is_staff=True,
        )
        r = self._me(user)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["is_staff"], True)
        self.assertEqual(r.data["is_superuser"], False)

    def test_superuser_has_both_flags_true(self):
        user = User.objects.create_superuser(
            email="super-flags@example.com",
            username="superflags",
            password="secret123",
        )
        r = self._me(user)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["is_staff"], True)
        self.assertEqual(r.data["is_superuser"], True)

    def test_flags_are_read_only_via_patch(self):
        user = User.objects.create_user(
            email="ro-flags@example.com",
            username="roflags",
            password="secret123",
        )
        api = APIClient()
        api.force_authenticate(user)
        r = api.patch("/users/me/", {"is_staff": True, "is_superuser": True}, format="json")
        self.assertEqual(r.status_code, 200)
        user.refresh_from_db()
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)


def _elevate_admin(user):
    """Создаёт активную step-up admin-сессию (Шаг 4 MFA gate); возвращает её."""
    return AdminSession.objects.create(
        user=user,
        elevated_until=timezone.now() + timedelta(minutes=30),
        confirmed_with="development",
    )


class AdminUsersListApiTests(TestCase):
    """Read-only список пользователей для админ-кабинета ЛК (`GET /users/admin/users/`)."""

    def setUp(self):
        self.staff = User.objects.create_user(
            email="admin-list-staff@example.com",
            username="adminliststaff",
            password="secret123",
            is_staff=True,
        )
        # Шаг 4: для доступа к admin endpoints staff нужна активная step-up admin-сессия.
        _elevate_admin(self.staff)
        self.alice = User.objects.create_user(
            email="alice@example.com",
            username="alicelist",
            password="secret123",
            fio="Алиса Тестовая",
            phone="+79990001122",
        )
        self.bob = User.objects.create_user(
            email="bob@example.com",
            username="boblist",
            password="secret123",
        )
        # Заблокированный пользователь — для проверки is_active=false.
        self.blocked = User.objects.create_user(
            email="blocked@example.com",
            username="blockedlist",
            password="secret123",
        )
        User.objects.filter(pk=self.blocked.pk).update(is_active=False)

    def test_anonymous_is_unauthorized(self):
        api = APIClient()
        r = api.get("/users/admin/users/")
        # IsAuthenticated по умолчанию отдаёт 401 без креденшлов.
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.alice)
        r = api.get("/users/admin/users/")
        self.assertEqual(r.status_code, 403)

    def test_staff_gets_paginated_list(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        r = api.get("/users/admin/users/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("results", r.data)
        self.assertIn("count", r.data)
        self.assertEqual(r.data["page"], 1)
        self.assertEqual(r.data["page_size"], 20)
        self.assertGreaterEqual(r.data["count"], 4)
        emails = {row["email"] for row in r.data["results"]}
        self.assertIn("alice@example.com", emails)
        first = r.data["results"][0]
        for key in (
            "id",
            "public_id",
            "email",
            "is_active",
            "is_staff",
            "is_superuser",
            "date_joined",
            "last_login",
        ):
            self.assertIn(key, first)

    def test_q_filters_by_email_substring(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        r = api.get("/users/admin/users/?q=alice@")
        self.assertEqual(r.status_code, 200)
        emails = [row["email"] for row in r.data["results"]]
        self.assertEqual(emails, ["alice@example.com"])

    def test_q_does_not_duplicate_rows_on_or_match(self):
        # Подстрока подходит и под email, и под fio — пользователь не должен задвоиться.
        User.objects.filter(pk=self.alice.pk).update(fio="alice@example.com inside fio")
        api = APIClient()
        api.force_authenticate(self.staff)
        r = api.get("/users/admin/users/?q=alice@")
        self.assertEqual(r.status_code, 200)
        ids = [row["id"] for row in r.data["results"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn(self.alice.id, ids)

    def test_is_staff_filter_returns_only_staff(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        r = api.get("/users/admin/users/?is_staff=true")
        self.assertEqual(r.status_code, 200)
        for row in r.data["results"]:
            self.assertTrue(row["is_staff"], row)
        self.assertGreaterEqual(r.data["count"], 1)

    def test_is_active_false_returns_only_blocked(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        r = api.get("/users/admin/users/?is_active=false")
        self.assertEqual(r.status_code, 200)
        for row in r.data["results"]:
            self.assertFalse(row["is_active"], row)
        emails = {row["email"] for row in r.data["results"]}
        self.assertIn("blocked@example.com", emails)

    def test_page_size_is_capped_at_100(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        r = api.get("/users/admin/users/?page_size=500")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["page_size"], 100)


class AdminUserDetailApiTests(TestCase):
    """Read-only детали пользователя для админ-кабинета ЛК (`GET /users/admin/users/<id>/`)."""

    def setUp(self):
        self.staff = User.objects.create_user(
            email="admin-detail-staff@example.com",
            username="admindetailstaff",
            password="secret123",
            is_staff=True,
        )
        # Шаг 4: для доступа к admin endpoints staff нужна активная step-up admin-сессия.
        _elevate_admin(self.staff)
        self.root = User.objects.create_user(
            email="root-detail@example.com",
            username="rootdetail",
            password="secret123",
            fio="Иван Иванов",
            phone="+79990001122",
        )

    def test_anonymous_is_unauthorized(self):
        api = APIClient()
        r = api.get(f"/users/admin/users/{self.root.pk}/")
        # IsAuthenticated по умолчанию отдаёт 401 без креденшлов.
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.root)
        r = api.get(f"/users/admin/users/{self.root.pk}/")
        self.assertEqual(r.status_code, 403)

    def test_staff_gets_existing_user_detail(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        r = api.get(f"/users/admin/users/{self.root.pk}/")
        self.assertEqual(r.status_code, 200)
        for key in (
            "id",
            "email",
            "is_active",
            "is_staff",
            "is_superuser",
            "additional_users_count",
            "owned_projects_count",
            "owned_sites_count",
            "partner_profile",
        ):
            self.assertIn(key, r.data)
        self.assertEqual(r.data["id"], self.root.pk)
        self.assertEqual(r.data["email"], "root-detail@example.com")
        self.assertEqual(r.data["is_staff"], False)
        self.assertEqual(r.data["is_superuser"], False)
        self.assertEqual(r.data["is_active"], True)
        self.assertEqual(r.data["additional_users_count"], 0)
        self.assertEqual(r.data["partner_profile"], None)

    def test_staff_unknown_id_returns_404(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        r = api.get("/users/admin/users/999999/")
        self.assertEqual(r.status_code, 404)

    def test_additional_users_count_reflects_account_children(self):
        child1 = User.objects.create_user(
            email="child1-detail@example.com",
            username="child1detail",
            password="secret123",
        )
        child2 = User.objects.create_user(
            email="child2-detail@example.com",
            username="child2detail",
            password="secret123",
        )
        child1.account_owner = self.root
        child1.save(update_fields=["account_owner"])
        child2.account_owner = self.root
        child2.save(update_fields=["account_owner"])

        api = APIClient()
        api.force_authenticate(self.staff)

        r_root = api.get(f"/users/admin/users/{self.root.pk}/")
        self.assertEqual(r_root.status_code, 200)
        self.assertEqual(r_root.data["additional_users_count"], 2)

        r_child = api.get(f"/users/admin/users/{child1.pk}/")
        self.assertEqual(r_child.status_code, 200)
        self.assertEqual(r_child.data["additional_users_count"], 0)
        self.assertEqual(r_child.data["account_owner_id"], self.root.pk)

    def test_partner_profile_serialized_when_present(self):
        PartnerProfile.objects.create(user=self.root, ref_code="DET01")
        api = APIClient()
        api.force_authenticate(self.staff)
        r = api.get(f"/users/admin/users/{self.root.pk}/")
        self.assertEqual(r.status_code, 200)
        pp = r.data["partner_profile"]
        self.assertIsNotNone(pp)
        self.assertIn("status", pp)
        self.assertIn("balance_available", pp)
        self.assertIn("balance_total", pp)
        self.assertIn("commission_percent", pp)

    def test_owned_projects_count_increments_with_owned_project(self):
        Project.objects.create(owner=self.root, name="t-project")
        api = APIClient()
        api.force_authenticate(self.staff)
        r = api.get(f"/users/admin/users/{self.root.pk}/")
        self.assertEqual(r.status_code, 200)
        self.assertGreaterEqual(r.data["owned_projects_count"], 1)


class AdminUserSetActiveApiTests(TestCase):
    """Шаг 7: блокировка/разблокировка пользователя (`POST /users/admin/users/<id>/active/`)."""

    def setUp(self):
        self.actor = User.objects.create_user(
            email="set-active-actor@example.com",
            username="setactiveactor",
            password="secret123",
            is_staff=True,
        )
        _elevate_admin(self.actor)
        self.target = User.objects.create_user(
            email="set-active-target@example.com",
            username="setactivetarget",
            password="secret123",
        )
        self.superuser_actor = User.objects.create_user(
            email="set-active-super-actor@example.com",
            username="setactivesuperactor",
            password="secret123",
            is_staff=True,
            is_superuser=True,
        )
        self.super_target = User.objects.create_user(
            email="set-active-super-target@example.com",
            username="setactivesupertarget",
            password="secret123",
            is_staff=True,
            is_superuser=True,
        )

    def _url(self, user):
        return f"/users/admin/users/{user.pk}/active/"

    def _actor_api(self):
        api = APIClient()
        api.force_authenticate(self.actor)
        return api

    # ---- access ------------------------------------------------------------

    def test_anonymous_is_unauthorized(self):
        api = APIClient()
        r = api.post(self._url(self.target), {"is_active": False}, format="json")
        # IsAuthenticated по умолчанию отдаёт 401 без креденшлов.
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.target)
        r = api.post(self._url(self.target), {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare_staff = User.objects.create_user(
            email="set-active-bare-staff@example.com",
            username="setactivebarestaff",
            password="secret123",
            is_staff=True,
        )
        api = APIClient()
        api.force_authenticate(bare_staff)
        r = api.post(self._url(self.target), {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    # ---- happy paths -------------------------------------------------------

    def test_deactivate_then_activate_target_with_audit(self):
        api = self._actor_api()

        r = api.post(self._url(self.target), {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data["id"], self.target.pk)
        self.assertEqual(r.data["is_active"], False)
        self.target.refresh_from_db()
        self.assertFalse(self.target.is_active)
        audit = AdminActionAudit.objects.filter(
            actor=self.actor,
            action="admin.user.deactivated",
            target_type="user",
            target_id=str(self.target.pk),
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.metadata.get("target_email"), "set-active-target@example.com")
        self.assertEqual(audit.metadata.get("previous_is_active"), True)
        self.assertEqual(audit.metadata.get("new_is_active"), False)

        r2 = api.post(self._url(self.target), {"is_active": True}, format="json")
        self.assertEqual(r2.status_code, 200, getattr(r2, "data", None))
        self.assertEqual(r2.data["is_active"], True)
        self.target.refresh_from_db()
        self.assertTrue(self.target.is_active)
        self.assertTrue(
            AdminActionAudit.objects.filter(
                actor=self.actor,
                action="admin.user.activated",
                target_type="user",
                target_id=str(self.target.pk),
            ).exists()
        )

    def test_deactivate_does_not_change_other_role_flags(self):
        target_with_staff = User.objects.create_user(
            email="set-active-staff-target@example.com",
            username="setactivestafftarget",
            password="secret123",
            is_staff=True,
        )
        api = self._actor_api()
        r = api.post(self._url(target_with_staff), {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        target_with_staff.refresh_from_db()
        self.assertFalse(target_with_staff.is_active)
        self.assertTrue(target_with_staff.is_staff)
        self.assertFalse(target_with_staff.is_superuser)

    def test_idempotent_no_change_no_audit(self):
        api = self._actor_api()
        before = AdminActionAudit.objects.count()
        r = api.post(self._url(self.target), {"is_active": True}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.target.refresh_from_db()
        self.assertTrue(self.target.is_active)
        self.assertEqual(AdminActionAudit.objects.count(), before)

    # ---- self / superuser guards ------------------------------------------

    def test_actor_cannot_deactivate_self(self):
        api = self._actor_api()
        r = api.post(self._url(self.actor), {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "ADMIN_CANNOT_DEACTIVATE_SELF")
        self.actor.refresh_from_db()
        self.assertTrue(self.actor.is_active)
        self.assertFalse(
            AdminActionAudit.objects.filter(
                actor=self.actor, action__startswith="admin.user."
            ).exists()
        )

    def test_actor_cannot_self_re_activate(self):
        # Любая попытка self-изменения активности запрещена, даже если значение совпадает.
        api = self._actor_api()
        r = api.post(self._url(self.actor), {"is_active": True}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "ADMIN_CANNOT_DEACTIVATE_SELF")

    def test_non_super_staff_cannot_deactivate_superuser(self):
        api = self._actor_api()
        r = api.post(self._url(self.super_target), {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_SUPERUSER_REQUIRED")
        self.super_target.refresh_from_db()
        self.assertTrue(self.super_target.is_active)
        self.assertFalse(
            AdminActionAudit.objects.filter(
                actor=self.actor, action="admin.user.deactivated"
            ).exists()
        )

    def test_superuser_can_deactivate_other_superuser(self):
        _elevate_admin(self.superuser_actor)
        api = APIClient()
        api.force_authenticate(self.superuser_actor)
        r = api.post(self._url(self.super_target), {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.super_target.refresh_from_db()
        self.assertFalse(self.super_target.is_active)
        self.assertTrue(
            AdminActionAudit.objects.filter(
                actor=self.superuser_actor,
                action="admin.user.deactivated",
                target_type="user",
                target_id=str(self.super_target.pk),
            ).exists()
        )

    def test_superuser_cannot_deactivate_self(self):
        _elevate_admin(self.superuser_actor)
        api = APIClient()
        api.force_authenticate(self.superuser_actor)
        r = api.post(self._url(self.superuser_actor), {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "ADMIN_CANNOT_DEACTIVATE_SELF")

    # ---- payload validation -----------------------------------------------

    def test_missing_body_returns_400(self):
        api = self._actor_api()
        r = api.post(self._url(self.target), {}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "ADMIN_USER_ACTIVE_INVALID")

    def test_non_bool_value_returns_400(self):
        api = self._actor_api()
        r = api.post(self._url(self.target), {"is_active": "yes"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "ADMIN_USER_ACTIVE_INVALID")

    def test_unknown_user_returns_404(self):
        api = self._actor_api()
        r = api.post("/users/admin/users/999999/active/", {"is_active": False}, format="json")
        self.assertEqual(r.status_code, 404)


class AdminSupportTicketsApiTests(TestCase):
    """Шаг 9: список/детали/закрытие обращений в поддержку из админ-кабинета.

    Эндпоинты: ``GET /users/admin/support-tickets/``,
    ``GET|PATCH /users/admin/support-tickets/<uuid>/``.
    """

    def setUp(self):
        self.staff = User.objects.create_user(
            email="support-admin-staff@example.com",
            username="supportadminstaff",
            password="secret123",
            is_staff=True,
        )
        _elevate_admin(self.staff)
        self.alice = User.objects.create_user(
            email="alice-support@example.com",
            username="alicesupport",
            password="secret123",
        )
        self.bob = User.objects.create_user(
            email="bob-support@example.com",
            username="bobsupport",
            password="secret123",
        )
        self.open_ticket = SupportTicket.objects.create(
            user=self.alice,
            type_slug="help-question",
            target_key="t-1",
            target_label="Заголовок Алисы",
            body="Тело сообщения Алисы",
            is_closed=False,
        )
        self.closed_ticket = SupportTicket.objects.create(
            user=self.bob,
            type_slug="help-problem",
            target_key="t-2",
            target_label="Заголовок Боба",
            body="Тело сообщения Боба",
            is_closed=True,
            closed_at=timezone.now(),
        )

    def _url_list(self):
        return "/users/admin/support-tickets/"

    def _url_detail(self, ticket):
        return f"/users/admin/support-tickets/{ticket.id}/"

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    # ---- access ------------------------------------------------------------

    def test_anonymous_is_unauthorized_on_list(self):
        api = APIClient()
        r = api.get(self._url_list())
        self.assertEqual(r.status_code, 401)

    def test_anonymous_is_unauthorized_on_detail(self):
        api = APIClient()
        r = api.get(self._url_detail(self.open_ticket))
        self.assertEqual(r.status_code, 401)

    def test_anonymous_is_unauthorized_on_patch(self):
        api = APIClient()
        r = api.patch(self._url_detail(self.open_ticket), {"is_closed": True}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.alice)
        self.assertEqual(api.get(self._url_list()).status_code, 403)
        self.assertEqual(api.get(self._url_detail(self.open_ticket)).status_code, 403)
        self.assertEqual(
            api.patch(self._url_detail(self.open_ticket), {"is_closed": True}, format="json").status_code,
            403,
        )

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare_staff = User.objects.create_user(
            email="support-bare-staff@example.com",
            username="supportbarestaff",
            password="secret123",
            is_staff=True,
        )
        api = APIClient()
        api.force_authenticate(bare_staff)

        r_list = api.get(self._url_list())
        self.assertEqual(r_list.status_code, 403)
        self.assertEqual(r_list.data.get("code"), "ADMIN_MFA_REQUIRED")

        r_detail = api.get(self._url_detail(self.open_ticket))
        self.assertEqual(r_detail.status_code, 403)
        self.assertEqual(r_detail.data.get("code"), "ADMIN_MFA_REQUIRED")

        r_patch = api.patch(
            self._url_detail(self.open_ticket), {"is_closed": True}, format="json"
        )
        self.assertEqual(r_patch.status_code, 403)
        self.assertEqual(r_patch.data.get("code"), "ADMIN_MFA_REQUIRED")

    # ---- list happy paths --------------------------------------------------

    def test_staff_gets_paginated_list(self):
        api = self._staff_api()
        r = api.get(self._url_list())
        self.assertEqual(r.status_code, 200)
        self.assertIn("results", r.data)
        self.assertIn("count", r.data)
        self.assertEqual(r.data["page"], 1)
        self.assertEqual(r.data["page_size"], 20)
        self.assertGreaterEqual(r.data["count"], 2)
        first = r.data["results"][0]
        for key in ("id", "user_id", "user_email", "is_closed", "created_at"):
            self.assertIn(key, first)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(str(self.open_ticket.id), ids)
        self.assertIn(str(self.closed_ticket.id), ids)

    def test_q_filters_by_user_email_substring(self):
        api = self._staff_api()
        r = api.get(self._url_list() + "?q=alice-support@")
        self.assertEqual(r.status_code, 200)
        emails = [row["user_email"] for row in r.data["results"]]
        self.assertEqual(emails, ["alice-support@example.com"])

    def test_status_open_returns_only_open_tickets(self):
        api = self._staff_api()
        r = api.get(self._url_list() + "?status=open")
        self.assertEqual(r.status_code, 200)
        for row in r.data["results"]:
            self.assertFalse(row["is_closed"], row)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(str(self.open_ticket.id), ids)
        self.assertNotIn(str(self.closed_ticket.id), ids)

    def test_status_closed_returns_only_closed_tickets(self):
        api = self._staff_api()
        r = api.get(self._url_list() + "?status=closed")
        self.assertEqual(r.status_code, 200)
        for row in r.data["results"]:
            self.assertTrue(row["is_closed"], row)
        ids = {row["id"] for row in r.data["results"]}
        self.assertNotIn(str(self.open_ticket.id), ids)
        self.assertIn(str(self.closed_ticket.id), ids)

    # ---- detail happy paths -----------------------------------------------

    def test_staff_gets_existing_ticket_detail(self):
        api = self._staff_api()
        r = api.get(self._url_detail(self.open_ticket))
        self.assertEqual(r.status_code, 200)
        for key in ("id", "user_id", "user_email", "body", "is_closed", "created_at", "type_slug"):
            self.assertIn(key, r.data)
        self.assertEqual(r.data["id"], str(self.open_ticket.id))
        self.assertEqual(r.data["body"], "Тело сообщения Алисы")
        self.assertEqual(r.data["user_email"], "alice-support@example.com")

    def test_staff_unknown_id_returns_404(self):
        api = self._staff_api()
        r = api.get("/users/admin/support-tickets/00000000-0000-0000-0000-000000000000/")
        self.assertEqual(r.status_code, 404)

    # ---- PATCH (close/reopen) ---------------------------------------------

    def test_patch_close_then_reopen_with_audit(self):
        api = self._staff_api()

        r = api.patch(
            self._url_detail(self.open_ticket), {"is_closed": True}, format="json"
        )
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data["is_closed"], True)
        self.open_ticket.refresh_from_db()
        self.assertTrue(self.open_ticket.is_closed)
        self.assertIsNotNone(self.open_ticket.closed_at)
        audit_closed = AdminActionAudit.objects.filter(
            actor=self.staff,
            action="admin.support_ticket.closed",
            target_type="support_ticket",
            target_id=str(self.open_ticket.id),
        ).first()
        self.assertIsNotNone(audit_closed)
        self.assertEqual(audit_closed.metadata.get("user_email"), "alice-support@example.com")
        self.assertEqual(audit_closed.metadata.get("previous_is_closed"), False)
        self.assertEqual(audit_closed.metadata.get("new_is_closed"), True)

        r2 = api.patch(
            self._url_detail(self.open_ticket), {"is_closed": False}, format="json"
        )
        self.assertEqual(r2.status_code, 200, getattr(r2, "data", None))
        self.assertEqual(r2.data["is_closed"], False)
        self.open_ticket.refresh_from_db()
        self.assertFalse(self.open_ticket.is_closed)
        self.assertIsNone(self.open_ticket.closed_at)
        self.assertTrue(
            AdminActionAudit.objects.filter(
                actor=self.staff,
                action="admin.support_ticket.reopened",
                target_type="support_ticket",
                target_id=str(self.open_ticket.id),
            ).exists()
        )

    def test_idempotent_patch_no_change_no_audit(self):
        api = self._staff_api()
        before = AdminActionAudit.objects.count()
        r = api.patch(
            self._url_detail(self.closed_ticket), {"is_closed": True}, format="json"
        )
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.closed_ticket.refresh_from_db()
        self.assertTrue(self.closed_ticket.is_closed)
        self.assertEqual(AdminActionAudit.objects.count(), before)

    # ---- payload validation -----------------------------------------------

    def test_missing_body_returns_400(self):
        api = self._staff_api()
        r = api.patch(self._url_detail(self.open_ticket), {}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "ADMIN_TICKET_UPDATE_INVALID")

    def test_non_bool_value_returns_400(self):
        api = self._staff_api()
        r = api.patch(
            self._url_detail(self.open_ticket), {"is_closed": "yes"}, format="json"
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "ADMIN_TICKET_UPDATE_INVALID")


class AdminActionAuditsApiTests(TestCase):
    """Шаг 12: read-only viewer журнала действий админа.

    Эндпоинты: ``GET /users/admin/action-audits/``,
    ``GET /users/admin/action-audits/<id>/``.
    """

    def setUp(self):
        self.staff = User.objects.create_user(
            email="audit-admin-staff@example.com",
            username="auditadminstaff",
            password="secret123",
            is_staff=True,
        )
        _elevate_admin(self.staff)
        self.other_actor = User.objects.create_user(
            email="audit-other-actor@example.com",
            username="auditotheractor",
            password="secret123",
            is_staff=True,
        )
        self.regular = User.objects.create_user(
            email="audit-regular@example.com",
            username="auditregular",
            password="secret123",
        )

        self.audit_user_created = AdminActionAudit.objects.create(
            actor=self.staff,
            action="admin.test.created",
            target_type="user",
            target_id="1",
            metadata={"foo": "bar"},
            user_agent="A" * 200,
            ip_address="10.0.0.1",
        )
        self.audit_other = AdminActionAudit.objects.create(
            actor=self.other_actor,
            action="admin.other.something",
            target_type="support_ticket",
            target_id="abc",
            metadata={},
        )
        self.audit_rich_metadata = AdminActionAudit.objects.create(
            actor=self.staff,
            action="admin.test.rich",
            target_type="user",
            target_id="2",
            metadata={"a": "b", "c": "d", "e": "f", "g": "h", "i": "j", "k": "l"},
        )

    def _url_list(self):
        return "/users/admin/action-audits/"

    def _url_detail(self, audit):
        return f"/users/admin/action-audits/{audit.pk}/"

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    # ---- access ------------------------------------------------------------

    def test_anonymous_is_unauthorized_on_list(self):
        api = APIClient()
        r = api.get(self._url_list())
        self.assertEqual(r.status_code, 401)

    def test_anonymous_is_unauthorized_on_detail(self):
        api = APIClient()
        r = api.get(self._url_detail(self.audit_user_created))
        self.assertEqual(r.status_code, 401)

    def test_authenticated_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.regular)
        self.assertEqual(api.get(self._url_list()).status_code, 403)
        self.assertEqual(
            api.get(self._url_detail(self.audit_user_created)).status_code, 403
        )

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        bare_staff = User.objects.create_user(
            email="audit-bare-staff@example.com",
            username="auditbarestaff",
            password="secret123",
            is_staff=True,
        )
        api = APIClient()
        api.force_authenticate(bare_staff)

        r_list = api.get(self._url_list())
        self.assertEqual(r_list.status_code, 403)
        self.assertEqual(r_list.data.get("code"), "ADMIN_MFA_REQUIRED")

        r_detail = api.get(self._url_detail(self.audit_user_created))
        self.assertEqual(r_detail.status_code, 403)
        self.assertEqual(r_detail.data.get("code"), "ADMIN_MFA_REQUIRED")

    # ---- list happy paths --------------------------------------------------

    def test_staff_gets_paginated_list(self):
        api = self._staff_api()
        r = api.get(self._url_list())
        self.assertEqual(r.status_code, 200)
        self.assertIn("results", r.data)
        self.assertIn("count", r.data)
        self.assertEqual(r.data["page"], 1)
        self.assertEqual(r.data["page_size"], 20)
        self.assertGreaterEqual(r.data["count"], 3)
        first = r.data["results"][0]
        for key in (
            "id",
            "actor_email",
            "action",
            "target_type",
            "target_id",
            "metadata_summary",
            "created_at",
        ):
            self.assertIn(key, first)
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.audit_user_created.pk, ids)

    def test_q_filters_by_action_substring(self):
        api = self._staff_api()
        r = api.get(self._url_list() + "?q=admin.test")
        self.assertEqual(r.status_code, 200)
        actions = {row["action"] for row in r.data["results"]}
        self.assertIn("admin.test.created", actions)
        self.assertIn("admin.test.rich", actions)
        self.assertNotIn("admin.other.something", actions)

    def test_action_exact_filter(self):
        api = self._staff_api()
        r = api.get(self._url_list() + "?action=admin.test.created")
        self.assertEqual(r.status_code, 200)
        actions = [row["action"] for row in r.data["results"]]
        self.assertEqual(actions, ["admin.test.created"])

    def test_target_type_filter(self):
        api = self._staff_api()
        r = api.get(self._url_list() + "?target_type=user")
        self.assertEqual(r.status_code, 200)
        target_types = {row["target_type"] for row in r.data["results"]}
        self.assertEqual(target_types, {"user"})
        ids = {row["id"] for row in r.data["results"]}
        self.assertIn(self.audit_user_created.pk, ids)
        self.assertIn(self.audit_rich_metadata.pk, ids)
        self.assertNotIn(self.audit_other.pk, ids)

    def test_actor_id_filter(self):
        api = self._staff_api()
        r = api.get(self._url_list() + f"?actor_id={self.other_actor.pk}")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.data["results"]}
        self.assertEqual(ids, {self.audit_other.pk})

    def test_list_truncates_long_user_agent(self):
        api = self._staff_api()
        r = api.get(self._url_list() + "?action=admin.test.created")
        self.assertEqual(r.status_code, 200)
        row = r.data["results"][0]
        self.assertLessEqual(len(row["user_agent"]), 80)
        self.assertTrue(row["user_agent"].endswith("..."))

    def test_list_metadata_summary_caps_at_5_keys(self):
        api = self._staff_api()
        r = api.get(self._url_list() + "?action=admin.test.rich")
        self.assertEqual(r.status_code, 200)
        row = r.data["results"][0]
        self.assertLessEqual(len(row["metadata_summary"]), 5)

    def test_page_size_is_capped_at_100(self):
        for i in range(25):
            AdminActionAudit.objects.create(
                actor=self.staff,
                action="admin.bulk.test",
                target_type="user",
                target_id=str(i),
                metadata={},
            )
        api = self._staff_api()
        r = api.get(self._url_list() + "?page_size=500")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["page_size"], 100)

    # ---- detail happy paths -----------------------------------------------

    def test_detail_returns_full_metadata_and_full_user_agent(self):
        api = self._staff_api()
        r = api.get(self._url_detail(self.audit_user_created))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["id"], self.audit_user_created.pk)
        self.assertEqual(r.data["action"], "admin.test.created")
        self.assertEqual(r.data["metadata"], {"foo": "bar"})
        self.assertEqual(r.data["user_agent"], "A" * 200)

        r_rich = api.get(self._url_detail(self.audit_rich_metadata))
        self.assertEqual(r_rich.status_code, 200)
        self.assertEqual(len(r_rich.data["metadata"]), 6)
        self.assertEqual(r_rich.data["metadata"].get("k"), "l")

    def test_detail_unknown_id_returns_404(self):
        api = self._staff_api()
        r = api.get("/users/admin/action-audits/999999/")
        self.assertEqual(r.status_code, 404)


class AdminMfaGateApiTests(TestCase):
    """Step-up MFA-gate для admin endpoints + endpoints управления admin-сессией.

    Шаг 4: гейт ``HasFreshAdminSession`` блокирует staff без активной ``AdminSession``
    с кодом ``ADMIN_MFA_REQUIRED``; dev-confirm создаёт сессию (только при ``DEBUG``).
    """

    def setUp(self):
        self.staff = User.objects.create_user(
            email="mfa-staff@example.com",
            username="mfastaff",
            password="secret123",
            is_staff=True,
        )
        self.regular = User.objects.create_user(
            email="mfa-regular@example.com",
            username="mfaregular",
            password="secret123",
        )

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    # ---- gate (admin/users/) ------------------------------------------------

    def test_staff_without_admin_session_blocked_with_mfa_code(self):
        api = self._staff_api()
        r = api.get("/users/admin/users/")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")
        self.assertIn("detail", r.data)

    def test_staff_with_active_admin_session_allowed(self):
        AdminSession.objects.create(
            user=self.staff,
            elevated_until=timezone.now() + timedelta(minutes=30),
            confirmed_with="development",
        )
        api = self._staff_api()
        r = api.get("/users/admin/users/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("results", r.data)

    def test_expired_admin_session_blocked(self):
        AdminSession.objects.create(
            user=self.staff,
            elevated_until=timezone.now() - timedelta(minutes=1),
            confirmed_with="development",
        )
        api = self._staff_api()
        r = api.get("/users/admin/users/")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    def test_revoked_admin_session_blocked(self):
        now = timezone.now()
        AdminSession.objects.create(
            user=self.staff,
            elevated_until=now + timedelta(minutes=30),
            confirmed_with="development",
            revoked_at=now,
        )
        api = self._staff_api()
        r = api.get("/users/admin/users/")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    # ---- endpoints (session info / dev-confirm / revoke) -------------------

    def test_session_info_for_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.regular)
        r = api.get("/users/admin/session/")
        self.assertEqual(r.status_code, 403)

    def test_dev_confirm_for_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.regular)
        r = api.post("/users/admin/session/dev-confirm/")
        self.assertEqual(r.status_code, 403)

    def test_session_info_staff_without_session_returns_not_elevated(self):
        api = self._staff_api()
        r = api.get("/users/admin/session/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["is_elevated"], False)
        self.assertIsNone(r.data["elevated_until"])
        self.assertIsNone(r.data["confirmed_with"])

    @override_settings(DEBUG=True)
    def test_dev_confirm_creates_session_and_audit_when_debug(self):
        api = self._staff_api()
        r = api.post("/users/admin/session/dev-confirm/")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data["is_elevated"], True)
        self.assertEqual(r.data["confirmed_with"], "development")
        self.assertTrue(
            AdminSession.objects.filter(
                user=self.staff,
                revoked_at__isnull=True,
                elevated_until__gt=timezone.now(),
            ).exists()
        )
        self.assertTrue(
            AdminActionAudit.objects.filter(
                actor=self.staff, action="admin.session.elevated"
            ).exists()
        )
        # Подтверждённая сессия открывает доступ к admin/users/.
        r2 = api.get("/users/admin/users/")
        self.assertEqual(r2.status_code, 200)

    @override_settings(DEBUG=False)
    def test_dev_confirm_disabled_when_not_debug(self):
        api = self._staff_api()
        r = api.post("/users/admin/session/dev-confirm/")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_DEV_DISABLED")
        self.assertFalse(AdminSession.objects.filter(user=self.staff).exists())

    def test_revoke_marks_active_sessions_revoked_and_audits(self):
        active = AdminSession.objects.create(
            user=self.staff,
            elevated_until=timezone.now() + timedelta(minutes=30),
            confirmed_with="development",
        )
        api = self._staff_api()
        r = api.post("/users/admin/session/revoke/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["is_elevated"], False)
        active.refresh_from_db()
        self.assertIsNotNone(active.revoked_at)
        self.assertTrue(
            AdminActionAudit.objects.filter(
                actor=self.staff, action="admin.session.revoked"
            ).exists()
        )
        # После revoke admin/users/ снова под защитой gate.
        r2 = api.get("/users/admin/users/")
        self.assertEqual(r2.status_code, 403)
        self.assertEqual(r2.data.get("code"), "ADMIN_MFA_REQUIRED")


class AdminTelegramMfaTests(TestCase):
    """Шаг 5: Telegram MFA для step-up admin elevation.

    Покрытие: missing/active device, non-staff, hash-only хранение, wrong/correct verify,
    повторное consumption, expiry, rate-limit (challenge), auto-lock на 5 неверных попыток,
    production без ``TELEGRAM_BOT_TOKEN``.
    """

    CHALLENGE_URL = "/users/admin/mfa/telegram/challenge/"
    VERIFY_URL = "/users/admin/mfa/telegram/verify/"

    def setUp(self):
        self.staff = User.objects.create_user(
            email="tg-mfa-staff@example.com",
            username="tgmfastaff",
            password="secret123",
            is_staff=True,
        )
        self.regular = User.objects.create_user(
            email="tg-mfa-regular@example.com",
            username="tgmfaregular",
            password="secret123",
        )

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    def _make_device(self, chat_id="1001", is_active=True):
        return AdminMfaDevice.objects.create(
            user=self.staff,
            type=AdminMfaDevice.TYPE_TELEGRAM,
            telegram_chat_id=chat_id,
            telegram_username="staffadmin",
            is_active=is_active,
            confirmed_at=timezone.now(),
        )

    # ---- challenge endpoint -------------------------------------------------

    def test_non_staff_forbidden_on_challenge(self):
        api = APIClient()
        api.force_authenticate(self.regular)
        r = api.post(self.CHALLENGE_URL)
        self.assertEqual(r.status_code, 403)

    def test_non_staff_forbidden_on_verify(self):
        api = APIClient()
        api.force_authenticate(self.regular)
        r = api.post(self.VERIFY_URL, {"code": "123456"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_challenge_without_device_returns_not_configured(self):
        api = self._staff_api()
        with patch("users.admin_views.send_admin_mfa_code") as send_mock:
            r = api.post(self.CHALLENGE_URL)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "TELEGRAM_MFA_DEVICE_NOT_CONFIGURED")
        send_mock.assert_not_called()
        self.assertFalse(AdminMfaChallenge.objects.filter(user=self.staff).exists())

    def test_challenge_creates_hashed_challenge_and_sends_code(self):
        device = self._make_device(chat_id="555111")
        api = self._staff_api()
        with patch("users.admin_views.send_admin_mfa_code") as send_mock:
            r = api.post(self.CHALLENGE_URL)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data.get("expires_in"), 300)
        send_mock.assert_called_once()
        chat_id_arg, raw_code = send_mock.call_args.args
        self.assertEqual(chat_id_arg, device.telegram_chat_id)
        self.assertEqual(len(raw_code), 6)
        self.assertTrue(raw_code.isdigit())

        ch = AdminMfaChallenge.objects.get(user=self.staff)
        self.assertEqual(ch.channel, AdminMfaChallenge.CHANNEL_TELEGRAM)
        self.assertEqual(ch.device_id, device.pk)
        self.assertIsNone(ch.consumed_at)
        # Raw 6-digit код в БД не хранится — только хэш.
        self.assertNotEqual(ch.code_hash, raw_code)
        self.assertGreater(len(ch.code_hash), 6)

    def test_challenge_rate_limited_within_window(self):
        self._make_device()
        api = self._staff_api()
        with patch("users.admin_views.send_admin_mfa_code"):
            r1 = api.post(self.CHALLENGE_URL)
            r2 = api.post(self.CHALLENGE_URL)
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 429)
        self.assertEqual(r2.data.get("code"), "TELEGRAM_MFA_RATE_LIMITED")

    def test_challenge_returns_503_when_telegram_not_configured(self):
        self._make_device()
        api = self._staff_api()
        with override_settings(DEBUG=False), patch(
            "users.admin_views.send_admin_mfa_code",
            side_effect=TelegramMfaError(
                "TELEGRAM_MFA_NOT_CONFIGURED",
                "Telegram MFA не настроен на сервере",
            ),
        ):
            r = api.post(self.CHALLENGE_URL)
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.data.get("code"), "TELEGRAM_MFA_NOT_CONFIGURED")
        ch = AdminMfaChallenge.objects.get(user=self.staff)
        # При ошибке доставки challenge сразу гасится, чтобы не тратить лимит.
        self.assertIsNotNone(ch.consumed_at)

    # ---- verify endpoint ----------------------------------------------------

    def _issue_challenge(self):
        device = self._make_device()
        captured = {}

        def fake_send(chat_id, code):
            captured["code"] = code

        with patch("users.admin_views.send_admin_mfa_code", side_effect=fake_send):
            r = self._staff_api().post(self.CHALLENGE_URL)
            self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        return device, captured["code"]

    def test_verify_no_active_challenge_returns_not_found(self):
        api = self._staff_api()
        r = api.post(self.VERIFY_URL, {"code": "123456"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "MFA_CHALLENGE_NOT_FOUND")

    def test_verify_wrong_code_increments_attempts(self):
        _device, _good = self._issue_challenge()
        api = self._staff_api()
        r = api.post(self.VERIFY_URL, {"code": "000000"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "MFA_CODE_INVALID")
        ch = AdminMfaChallenge.objects.get(user=self.staff)
        self.assertEqual(ch.attempts_count, 1)
        self.assertIsNone(ch.consumed_at)

    def test_verify_correct_code_creates_admin_session_and_audit(self):
        device, good = self._issue_challenge()
        api = self._staff_api()
        r = api.post(self.VERIFY_URL, {"code": good}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data.get("is_elevated"), True)
        self.assertEqual(r.data.get("confirmed_with"), "telegram")
        ch = AdminMfaChallenge.objects.get(user=self.staff)
        self.assertIsNotNone(ch.consumed_at)
        self.assertTrue(
            AdminSession.objects.filter(
                user=self.staff,
                confirmed_with="telegram",
                revoked_at__isnull=True,
                elevated_until__gt=timezone.now(),
            ).exists()
        )
        self.assertTrue(
            AdminActionAudit.objects.filter(
                actor=self.staff,
                action="admin.session.elevated.telegram",
            ).exists()
        )
        # Step-up open admin/users/ access.
        r2 = api.get("/users/admin/users/")
        self.assertEqual(r2.status_code, 200)

    def test_verify_consumed_challenge_cannot_be_reused(self):
        _device, good = self._issue_challenge()
        api = self._staff_api()
        r1 = api.post(self.VERIFY_URL, {"code": good}, format="json")
        self.assertEqual(r1.status_code, 200)
        r2 = api.post(self.VERIFY_URL, {"code": good}, format="json")
        self.assertEqual(r2.status_code, 400)
        self.assertEqual(r2.data.get("code"), "MFA_CHALLENGE_NOT_FOUND")

    def test_verify_expired_challenge_returns_not_found(self):
        device = self._make_device()
        AdminMfaChallenge.objects.create(
            user=self.staff,
            device=device,
            channel=AdminMfaChallenge.CHANNEL_TELEGRAM,
            code_hash=make_password("123456"),
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        api = self._staff_api()
        r = api.post(self.VERIFY_URL, {"code": "123456"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "MFA_CHALLENGE_NOT_FOUND")

    def test_verify_locks_after_five_wrong_attempts(self):
        _device, good = self._issue_challenge()
        api = self._staff_api()
        for _ in range(5):
            r = api.post(self.VERIFY_URL, {"code": "000000"}, format="json")
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.data.get("code"), "MFA_CODE_INVALID")
        # Шестая попытка — даже корректным кодом — challenge уже locked/consumed.
        r6 = api.post(self.VERIFY_URL, {"code": good}, format="json")
        self.assertEqual(r6.status_code, 400)
        self.assertEqual(r6.data.get("code"), "MFA_CHALLENGE_NOT_FOUND")
        ch = AdminMfaChallenge.objects.get(user=self.staff)
        self.assertIsNotNone(ch.consumed_at)

    def test_verify_empty_code_invalid(self):
        self._issue_challenge()
        api = self._staff_api()
        r = api.post(self.VERIFY_URL, {"code": ""}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "MFA_CODE_INVALID")


class AdminTelegramBindFlowTests(TestCase):
    """Шаг 6: привязка Telegram MFA через one-shot bind-токен и webhook от бота."""

    BIND_URL = "/users/admin/mfa/telegram/bind/start/"
    WEBHOOK_URL = "/users/admin/mfa/telegram/webhook/"
    WEBHOOK_SECRET = "test-webhook-secret"

    def setUp(self):
        self.staff = User.objects.create_user(
            email="bind-staff@example.com",
            username="bindstaff",
            password="secret123",
            is_staff=True,
        )
        self.regular = User.objects.create_user(
            email="bind-regular@example.com",
            username="bindregular",
            password="secret123",
        )

    def _staff_api(self):
        api = APIClient()
        api.force_authenticate(self.staff)
        return api

    # ---- bind/start ---------------------------------------------------------

    def test_bind_start_non_staff_forbidden(self):
        api = APIClient()
        api.force_authenticate(self.regular)
        r = api.post(self.BIND_URL)
        self.assertEqual(r.status_code, 403)

    @override_settings(DEBUG=False, TELEGRAM_BOT_USERNAME="testbot")
    def test_bind_start_staff_without_device_in_prod_requires_bootstrap(self):
        api = self._staff_api()
        r = api.post(self.BIND_URL)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "TELEGRAM_MFA_BOOTSTRAP_REQUIRED")
        self.assertFalse(AdminTelegramBindToken.objects.filter(user=self.staff).exists())

    @override_settings(DEBUG=True, TELEGRAM_BOT_USERNAME="testbot")
    def test_bind_start_in_debug_creates_initial_bind_token(self):
        api = self._staff_api()
        r = api.post(self.BIND_URL)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data.get("purpose"), AdminTelegramBindToken.PURPOSE_INITIAL_BIND)
        self.assertEqual(r.data.get("expires_in"), 600)
        self.assertIn("bot_link", r.data)
        self.assertTrue(r.data["bot_link"].startswith("https://t.me/testbot?start="))
        self.assertTrue(AdminTelegramBindToken.objects.filter(user=self.staff).exists())

    @override_settings(DEBUG=False, TELEGRAM_BOT_USERNAME="testbot")
    def test_bind_start_superuser_can_bootstrap_outside_debug(self):
        super_user = User.objects.create_superuser(
            email="bind-super@example.com",
            username="bindsuper",
            password="secret123",
        )
        api = APIClient()
        api.force_authenticate(super_user)
        r = api.post(self.BIND_URL)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data.get("purpose"), AdminTelegramBindToken.PURPOSE_INITIAL_BIND)

    @override_settings(DEBUG=True, TELEGRAM_BOT_USERNAME="testbot")
    def test_bind_start_with_active_device_no_session_returns_admin_mfa_required(self):
        AdminMfaDevice.objects.create(
            user=self.staff,
            type=AdminMfaDevice.TYPE_TELEGRAM,
            telegram_chat_id="222333",
            is_active=True,
            confirmed_at=timezone.now(),
        )
        api = self._staff_api()
        r = api.post(self.BIND_URL)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data.get("code"), "ADMIN_MFA_REQUIRED")

    @override_settings(DEBUG=True, TELEGRAM_BOT_USERNAME="testbot")
    def test_bind_start_with_active_device_and_fresh_session_marks_old_tokens_consumed(self):
        AdminMfaDevice.objects.create(
            user=self.staff,
            type=AdminMfaDevice.TYPE_TELEGRAM,
            telegram_chat_id="555666",
            is_active=True,
            confirmed_at=timezone.now(),
        )
        _elevate_admin(self.staff)
        old_token = AdminTelegramBindToken.objects.create(
            user=self.staff,
            token_hash="OLD_HASH_PLACEHOLDER",
            purpose=AdminTelegramBindToken.PURPOSE_REBIND,
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        api = self._staff_api()
        r = api.post(self.BIND_URL)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data.get("purpose"), AdminTelegramBindToken.PURPOSE_REBIND)
        old_token.refresh_from_db()
        self.assertIsNotNone(old_token.consumed_at)
        # И новый токен (отличный от old) активен.
        active = AdminTelegramBindToken.objects.filter(
            user=self.staff, consumed_at__isnull=True,
        ).first()
        self.assertIsNotNone(active)
        self.assertNotEqual(active.pk, old_token.pk)

    @override_settings(DEBUG=True, TELEGRAM_BOT_USERNAME="testbot")
    def test_bind_start_does_not_store_raw_token(self):
        api = self._staff_api()
        with patch(
            "users.admin_views.generate_bind_token",
            return_value="TEST_RAW_TOKEN_VALUE",
        ):
            r = api.post(self.BIND_URL)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertIn("TEST_RAW_TOKEN_VALUE", r.data["bot_link"])
        # raw в БД не сохранён, только хэш.
        self.assertFalse(
            AdminTelegramBindToken.objects.filter(token_hash="TEST_RAW_TOKEN_VALUE").exists(),
        )
        obj = AdminTelegramBindToken.objects.get(user=self.staff)
        self.assertGreater(len(obj.token_hash), 40)
        self.assertNotEqual(obj.token_hash, "TEST_RAW_TOKEN_VALUE")
        self.assertTrue(verify_bind_token("TEST_RAW_TOKEN_VALUE", obj.token_hash))

    # ---- webhook ------------------------------------------------------------

    def test_webhook_without_secret_setting_returns_404(self):
        api = APIClient()
        r = api.post(self.WEBHOOK_URL, {}, format="json")
        # TELEGRAM_WEBHOOK_SECRET не задан в settings — endpoint скрыт.
        self.assertEqual(r.status_code, 404)

    @override_settings(TELEGRAM_WEBHOOK_SECRET=WEBHOOK_SECRET)
    def test_webhook_without_header_returns_401(self):
        api = APIClient()
        r = api.post(self.WEBHOOK_URL, {}, format="json")
        self.assertEqual(r.status_code, 401)

    @override_settings(
        DEBUG=True,
        TELEGRAM_BOT_USERNAME="testbot",
        TELEGRAM_WEBHOOK_SECRET=WEBHOOK_SECRET,
    )
    def test_webhook_valid_start_creates_active_device_and_audit(self):
        # Сначала генерируем bind-токен через bind/start (мокаем raw, чтобы знать его).
        with patch(
            "users.admin_views.generate_bind_token",
            return_value="WEBHOOK_RAW_TOKEN",
        ):
            r = self._staff_api().post(self.BIND_URL)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))

        api = APIClient()
        update = {
            "message": {
                "text": "/start WEBHOOK_RAW_TOKEN",
                "chat": {"id": 9001, "username": "tg_user_9001"},
                "from": {"id": 9001, "username": "tg_user_9001"},
            }
        }
        with patch("users.admin_views.send_telegram_text") as send_mock:
            r = api.post(
                self.WEBHOOK_URL, update, format="json",
                HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=self.WEBHOOK_SECRET,
            )
        self.assertEqual(r.status_code, 200)
        send_mock.assert_called_once()

        device = AdminMfaDevice.objects.get(
            user=self.staff, type=AdminMfaDevice.TYPE_TELEGRAM, is_active=True,
        )
        self.assertEqual(device.telegram_chat_id, "9001")
        self.assertEqual(device.telegram_username, "tg_user_9001")
        self.assertIsNotNone(device.confirmed_at)
        token = AdminTelegramBindToken.objects.get(user=self.staff)
        self.assertIsNotNone(token.consumed_at)
        self.assertTrue(
            AdminActionAudit.objects.filter(
                actor=self.staff, action="admin.mfa.telegram.bound",
            ).exists()
        )

    @override_settings(
        DEBUG=True,
        TELEGRAM_BOT_USERNAME="testbot",
        TELEGRAM_WEBHOOK_SECRET=WEBHOOK_SECRET,
    )
    def test_webhook_already_consumed_token_is_no_op(self):
        with patch(
            "users.admin_views.generate_bind_token",
            return_value="CONSUMED_RAW_TOKEN",
        ):
            self._staff_api().post(self.BIND_URL)
        token = AdminTelegramBindToken.objects.get(user=self.staff)
        token.consumed_at = timezone.now()
        token.save(update_fields=["consumed_at"])

        api = APIClient()
        update = {
            "message": {
                "text": "/start CONSUMED_RAW_TOKEN",
                "chat": {"id": 9002},
                "from": {"id": 9002},
            }
        }
        with patch("users.admin_views.send_telegram_text") as send_mock:
            r = api.post(
                self.WEBHOOK_URL, update, format="json",
                HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=self.WEBHOOK_SECRET,
            )
        self.assertEqual(r.status_code, 200)
        send_mock.assert_not_called()
        self.assertFalse(
            AdminMfaDevice.objects.filter(user=self.staff, is_active=True).exists()
        )

    @override_settings(
        DEBUG=True,
        TELEGRAM_BOT_USERNAME="testbot",
        TELEGRAM_WEBHOOK_SECRET=WEBHOOK_SECRET,
    )
    def test_webhook_expired_token_is_no_op(self):
        with patch(
            "users.admin_views.generate_bind_token",
            return_value="EXPIRED_RAW_TOKEN",
        ):
            self._staff_api().post(self.BIND_URL)
        AdminTelegramBindToken.objects.filter(user=self.staff).update(
            expires_at=timezone.now() - timedelta(seconds=1),
        )

        api = APIClient()
        update = {
            "message": {
                "text": "/start EXPIRED_RAW_TOKEN",
                "chat": {"id": 9003},
                "from": {"id": 9003},
            }
        }
        with patch("users.admin_views.send_telegram_text") as send_mock:
            r = api.post(
                self.WEBHOOK_URL, update, format="json",
                HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=self.WEBHOOK_SECRET,
            )
        self.assertEqual(r.status_code, 200)
        send_mock.assert_not_called()
        self.assertFalse(
            AdminMfaDevice.objects.filter(user=self.staff, is_active=True).exists()
        )

    @override_settings(
        DEBUG=True,
        TELEGRAM_BOT_USERNAME="testbot",
        TELEGRAM_WEBHOOK_SECRET=WEBHOOK_SECRET,
    )
    def test_webhook_wrong_token_value_is_no_op(self):
        with patch(
            "users.admin_views.generate_bind_token",
            return_value="GOOD_RAW_TOKEN",
        ):
            self._staff_api().post(self.BIND_URL)

        api = APIClient()
        update = {
            "message": {
                "text": "/start NOT_THE_RIGHT_TOKEN",
                "chat": {"id": 9004},
                "from": {"id": 9004},
            }
        }
        with patch("users.admin_views.send_telegram_text") as send_mock:
            r = api.post(
                self.WEBHOOK_URL, update, format="json",
                HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=self.WEBHOOK_SECRET,
            )
        self.assertEqual(r.status_code, 200)
        send_mock.assert_not_called()
        token = AdminTelegramBindToken.objects.get(user=self.staff)
        self.assertIsNone(token.consumed_at)

    @override_settings(
        DEBUG=True,
        TELEGRAM_BOT_USERNAME="testbot",
        TELEGRAM_WEBHOOK_SECRET=WEBHOOK_SECRET,
    )
    def test_rebind_replaces_chat_id_and_deactivates_previous_device(self):
        # Сначала привязка: первый chat_id.
        with patch(
            "users.admin_views.generate_bind_token",
            return_value="REBIND_TOKEN_1",
        ):
            self._staff_api().post(self.BIND_URL)
        api = APIClient()
        with patch("users.admin_views.send_telegram_text"):
            api.post(
                self.WEBHOOK_URL,
                {
                    "message": {
                        "text": "/start REBIND_TOKEN_1",
                        "chat": {"id": 11111},
                        "from": {"id": 11111},
                    }
                },
                format="json",
                HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=self.WEBHOOK_SECRET,
            )
        first_device = AdminMfaDevice.objects.get(
            user=self.staff, telegram_chat_id="11111", is_active=True,
        )
        self.assertIsNotNone(first_device)

        # Rebind: нужна elevated session.
        _elevate_admin(self.staff)
        with patch(
            "users.admin_views.generate_bind_token",
            return_value="REBIND_TOKEN_2",
        ):
            r = self._staff_api().post(self.BIND_URL)
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data.get("purpose"), AdminTelegramBindToken.PURPOSE_REBIND)

        with patch("users.admin_views.send_telegram_text"):
            r2 = api.post(
                self.WEBHOOK_URL,
                {
                    "message": {
                        "text": "/start REBIND_TOKEN_2",
                        "chat": {"id": 22222},
                        "from": {"id": 22222},
                    }
                },
                format="json",
                HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=self.WEBHOOK_SECRET,
            )
        self.assertEqual(r2.status_code, 200)
        first_device.refresh_from_db()
        self.assertFalse(first_device.is_active)
        new_device = AdminMfaDevice.objects.get(
            user=self.staff, telegram_chat_id="22222", is_active=True,
        )
        self.assertNotEqual(new_device.pk, first_device.pk)


class AdminTelegramApprovalMfaTests(TestCase):
    """Telegram approve/deny MFA (надстройка над code-MFA): POST/GET endpoints + webhook callback_query."""

    CHALLENGE_URL = "/users/admin/mfa/telegram/approval/challenge/"
    STATUS_URL_TPL = "/users/admin/mfa/telegram/approval/challenge/{cid}/"
    WEBHOOK_URL = "/users/admin/mfa/telegram/webhook/"
    WEBHOOK_SECRET = "approval-webhook-secret"

    def setUp(self):
        self.staff = User.objects.create_user(
            email="approval-staff@example.com",
            username="approvalstaff",
            password="secret123",
            is_staff=True,
        )
        self.other_staff = User.objects.create_user(
            email="approval-other@example.com",
            username="approvalother",
            password="secret123",
            is_staff=True,
        )

    def _staff_api(self, user=None):
        api = APIClient()
        api.force_authenticate(user or self.staff)
        return api

    def _make_device(self, user=None, chat_id="777"):
        return AdminMfaDevice.objects.create(
            user=user or self.staff,
            type=AdminMfaDevice.TYPE_TELEGRAM,
            telegram_chat_id=chat_id,
            telegram_username="approvaltgu",
            is_active=True,
            confirmed_at=timezone.now(),
        )

    # ---- challenge endpoint -------------------------------------------------

    def test_challenge_without_device_returns_not_configured(self):
        api = self._staff_api()
        with patch("users.admin_views.send_admin_mfa_approval") as send_mock:
            r = api.post(self.CHALLENGE_URL)
        self.assertEqual(r.status_code, 400, getattr(r, "data", None))
        self.assertEqual(r.data.get("code"), "TELEGRAM_MFA_DEVICE_NOT_CONFIGURED")
        send_mock.assert_not_called()
        self.assertFalse(AdminMfaChallenge.objects.filter(user=self.staff).exists())

    def test_challenge_creates_pending_and_sends_approval(self):
        device = self._make_device(chat_id="555000")
        api = self._staff_api()
        with patch(
            "users.admin_views.send_admin_mfa_approval",
            return_value="42",
        ) as send_mock:
            r = api.post(
                self.CHALLENGE_URL,
                HTTP_USER_AGENT="MyBrowser/1.0",
                HTTP_X_FORWARDED_FOR="203.0.113.7",
            )
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data.get("status"), "pending")
        self.assertEqual(r.data.get("expires_in"), 300)
        self.assertIn("challenge_id", r.data)

        send_mock.assert_called_once()
        args, kwargs = send_mock.call_args
        self.assertEqual(args[0], device.telegram_chat_id)
        self.assertEqual(args[1], r.data["challenge_id"])
        raw_nonce = args[2]
        self.assertTrue(isinstance(raw_nonce, str) and len(raw_nonce) >= 16)
        self.assertEqual(kwargs.get("account_email"), self.staff.email)
        self.assertEqual(kwargs.get("ip"), "203.0.113.7")
        self.assertEqual(kwargs.get("ttl_seconds"), 300)
        self.assertEqual(kwargs.get("user_agent_short"), "MyBrowser/1.0")

        ch = AdminMfaChallenge.objects.get(pk=r.data["challenge_id"])
        self.assertEqual(ch.challenge_type, AdminMfaChallenge.TYPE_TELEGRAM_APPROVAL)
        self.assertEqual(ch.status, AdminMfaChallenge.STATUS_PENDING)
        self.assertEqual(ch.channel, AdminMfaChallenge.CHANNEL_TELEGRAM)
        self.assertEqual(ch.device_id, device.pk)
        self.assertNotEqual(ch.callback_nonce_hash, "")
        self.assertNotEqual(ch.callback_nonce_hash, raw_nonce)
        self.assertEqual(ch.code_hash, "")
        self.assertEqual(ch.telegram_message_id, "42")
        # raw nonce не утекает в response.
        self.assertNotIn(raw_nonce, str(r.data))

        self.assertTrue(
            AdminActionAudit.objects.filter(
                actor=self.staff,
                action="admin.session.approval.requested",
            ).exists()
        )

    def test_challenge_rate_limited_when_pending_exists(self):
        self._make_device()
        api = self._staff_api()
        with patch("users.admin_views.send_admin_mfa_approval", return_value=None):
            r1 = api.post(self.CHALLENGE_URL)
            r2 = api.post(self.CHALLENGE_URL)
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 429)
        self.assertEqual(r2.data.get("code"), "TELEGRAM_MFA_RATE_LIMITED")

    def test_challenge_delivery_failure_removes_challenge(self):
        self._make_device()
        api = self._staff_api()
        with patch(
            "users.admin_views.send_admin_mfa_approval",
            side_effect=TelegramMfaError("TELEGRAM_MFA_NOT_CONFIGURED", "no bot"),
        ):
            r = api.post(self.CHALLENGE_URL)
        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.data.get("code"), "TELEGRAM_MFA_NOT_CONFIGURED")
        self.assertFalse(
            AdminMfaChallenge.objects.filter(
                user=self.staff,
                challenge_type=AdminMfaChallenge.TYPE_TELEGRAM_APPROVAL,
            ).exists()
        )

    # ---- webhook callback_query --------------------------------------------

    def _create_pending(self, *, nonce="NONCE-RAW-VALUE-1", chat_id="777"):
        device = self._make_device(chat_id=chat_id)
        from users.telegram_mfa import hash_callback_nonce
        ch = AdminMfaChallenge.objects.create(
            user=self.staff,
            device=device,
            channel=AdminMfaChallenge.CHANNEL_TELEGRAM,
            challenge_type=AdminMfaChallenge.TYPE_TELEGRAM_APPROVAL,
            status=AdminMfaChallenge.STATUS_PENDING,
            code_hash="",
            callback_nonce_hash=hash_callback_nonce(nonce),
            expires_at=timezone.now() + timedelta(seconds=300),
        )
        return device, ch, nonce

    def _post_callback(self, *, data, from_id, message_id=1, chat_id=None):
        api = APIClient()
        update = {
            "callback_query": {
                "id": "cbq-1",
                "from": {"id": from_id},
                "data": data,
                "message": {
                    "message_id": message_id,
                    "chat": {"id": chat_id if chat_id is not None else from_id},
                },
            }
        }
        return api.post(
            self.WEBHOOK_URL, update, format="json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=self.WEBHOOK_SECRET,
        )

    @override_settings(DEBUG=True, TELEGRAM_WEBHOOK_SECRET=WEBHOOK_SECRET)
    def test_webhook_callback_approve(self):
        device, ch, nonce = self._create_pending()
        with patch("users.admin_views.answer_callback_query") as ack, patch(
            "users.admin_views.edit_message_text"
        ) as edit:
            r = self._post_callback(
                data=f"admin_mfa:approve:{ch.pk}:{nonce}",
                from_id=int(device.telegram_chat_id),
            )
        self.assertEqual(r.status_code, 200)
        ch.refresh_from_db()
        self.assertEqual(ch.status, AdminMfaChallenge.STATUS_APPROVED)
        self.assertIsNotNone(ch.approved_at)
        self.assertIsNotNone(ch.consumed_at)
        ack.assert_called()
        edit.assert_called()
        self.assertTrue(
            AdminActionAudit.objects.filter(
                actor=self.staff, action="admin.session.approval.approved",
            ).exists()
        )
        # webhook сам по себе НЕ выдаёт AdminSession.
        self.assertFalse(
            AdminSession.objects.filter(user=self.staff, revoked_at__isnull=True).exists()
        )

    @override_settings(DEBUG=True, TELEGRAM_WEBHOOK_SECRET=WEBHOOK_SECRET)
    def test_webhook_callback_deny(self):
        device, ch, nonce = self._create_pending()
        with patch("users.admin_views.answer_callback_query"), patch(
            "users.admin_views.edit_message_text"
        ):
            r = self._post_callback(
                data=f"admin_mfa:deny:{ch.pk}:{nonce}",
                from_id=int(device.telegram_chat_id),
            )
        self.assertEqual(r.status_code, 200)
        ch.refresh_from_db()
        self.assertEqual(ch.status, AdminMfaChallenge.STATUS_DENIED)
        self.assertIsNotNone(ch.denied_at)
        self.assertTrue(
            AdminActionAudit.objects.filter(
                actor=self.staff, action="admin.session.approval.denied",
            ).exists()
        )

    @override_settings(DEBUG=True, TELEGRAM_WEBHOOK_SECRET=WEBHOOK_SECRET)
    def test_webhook_callback_wrong_user_rejected(self):
        device, ch, nonce = self._create_pending()
        with patch("users.admin_views.answer_callback_query"), patch(
            "users.admin_views.edit_message_text"
        ):
            r = self._post_callback(
                data=f"admin_mfa:approve:{ch.pk}:{nonce}",
                from_id=999000,  # не совпадает с device.telegram_chat_id
            )
        self.assertEqual(r.status_code, 200)
        ch.refresh_from_db()
        self.assertEqual(ch.status, AdminMfaChallenge.STATUS_PENDING)
        self.assertTrue(
            AdminActionAudit.objects.filter(
                actor=self.staff,
                action="admin.session.approval.rejected_wrong_user",
            ).exists()
        )

    @override_settings(DEBUG=True, TELEGRAM_WEBHOOK_SECRET=WEBHOOK_SECRET)
    def test_webhook_callback_invalid_nonce(self):
        device, ch, _ = self._create_pending()
        with patch("users.admin_views.answer_callback_query"), patch(
            "users.admin_views.edit_message_text"
        ):
            r = self._post_callback(
                data=f"admin_mfa:approve:{ch.pk}:NOT_THE_NONCE",
                from_id=int(device.telegram_chat_id),
            )
        self.assertEqual(r.status_code, 200)
        ch.refresh_from_db()
        self.assertEqual(ch.status, AdminMfaChallenge.STATUS_PENDING)
        self.assertFalse(
            AdminActionAudit.objects.filter(
                actor=self.staff, action="admin.session.approval.approved",
            ).exists()
        )

    @override_settings(DEBUG=True, TELEGRAM_WEBHOOK_SECRET=WEBHOOK_SECRET)
    def test_webhook_callback_on_expired_marks_expired(self):
        device, ch, nonce = self._create_pending()
        AdminMfaChallenge.objects.filter(pk=ch.pk).update(
            expires_at=timezone.now() - timedelta(seconds=1),
        )
        with patch("users.admin_views.answer_callback_query"), patch(
            "users.admin_views.edit_message_text"
        ):
            r = self._post_callback(
                data=f"admin_mfa:approve:{ch.pk}:{nonce}",
                from_id=int(device.telegram_chat_id),
            )
        self.assertEqual(r.status_code, 200)
        ch.refresh_from_db()
        self.assertEqual(ch.status, AdminMfaChallenge.STATUS_EXPIRED)

    # ---- polling status ----------------------------------------------------

    def test_status_pending_returns_pending(self):
        _device, ch, _ = self._create_pending()
        api = self._staff_api()
        r = api.get(self.STATUS_URL_TPL.format(cid=ch.pk))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data.get("status"), "pending")
        self.assertIn("expires_in", r.data)

    def test_status_approved_creates_admin_session_once(self):
        _device, ch, _ = self._create_pending()
        ch.status = AdminMfaChallenge.STATUS_APPROVED
        ch.approved_at = timezone.now()
        ch.consumed_at = timezone.now()
        ch.save(update_fields=["status", "approved_at", "consumed_at"])

        api = self._staff_api()
        r = api.get(self.STATUS_URL_TPL.format(cid=ch.pk))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data.get("status"), "approved")
        self.assertEqual(r.data.get("is_elevated"), True)
        self.assertIn("elevated_until", r.data)

        sessions = AdminSession.objects.filter(
            user=self.staff,
            confirmed_with="telegram_approval",
            revoked_at__isnull=True,
            elevated_until__gt=timezone.now(),
        )
        self.assertEqual(sessions.count(), 1)
        self.assertTrue(
            AdminActionAudit.objects.filter(
                actor=self.staff,
                action="admin.session.elevated",
                metadata__via="telegram_approval",
            ).exists()
        )

        r2 = api.get(self.STATUS_URL_TPL.format(cid=ch.pk))
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(
            AdminSession.objects.filter(
                user=self.staff, confirmed_with="telegram_approval",
                revoked_at__isnull=True,
            ).count(),
            1,
        )

    def test_status_denied_does_not_create_session(self):
        _device, ch, _ = self._create_pending()
        ch.status = AdminMfaChallenge.STATUS_DENIED
        ch.denied_at = timezone.now()
        ch.save(update_fields=["status", "denied_at"])
        api = self._staff_api()
        r = api.get(self.STATUS_URL_TPL.format(cid=ch.pk))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("status"), "denied")
        self.assertFalse(AdminSession.objects.filter(user=self.staff).exists())

    def test_status_expired_when_past_expiry(self):
        _device, ch, _ = self._create_pending()
        AdminMfaChallenge.objects.filter(pk=ch.pk).update(
            expires_at=timezone.now() - timedelta(seconds=1),
        )
        api = self._staff_api()
        r = api.get(self.STATUS_URL_TPL.format(cid=ch.pk))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("status"), "expired")
        ch.refresh_from_db()
        self.assertEqual(ch.status, AdminMfaChallenge.STATUS_EXPIRED)

    def test_status_other_user_returns_404(self):
        _device, ch, _ = self._create_pending()
        api = self._staff_api(user=self.other_staff)
        r = api.get(self.STATUS_URL_TPL.format(cid=ch.pk))
        self.assertEqual(r.status_code, 404)


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
    def test_verify_code_success_does_not_mark_code_used(self):
        User.objects.create_user(email="verify@example.com", username="verify", password="Secret123!")
        c = APIClient()
        self._code_request(c, "verify@example.com")
        good = re.search(r"\b\d{6}\b", mail.outbox[0].body).group(0)
        prc = PasswordResetCode.objects.get()
        r = c.post(
            "/users/api/password-reset/verify-code/",
            {"email": "verify@example.com", "code": good},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data.get("code"), "password_reset_code_verified")
        prc.refresh_from_db()
        self.assertIsNone(prc.used_at)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_verify_wrong_code_increments_attempts(self):
        User.objects.create_user(email="verify-wrong@example.com", username="verifywrong", password="Secret123!")
        c = APIClient()
        self._code_request(c, "verify-wrong@example.com")
        prc = PasswordResetCode.objects.get()
        r = c.post(
            "/users/api/password-reset/verify-code/",
            {"email": "verify-wrong@example.com", "code": "000000"},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data.get("code"), "password_reset_code_invalid")
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
