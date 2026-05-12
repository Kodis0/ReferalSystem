"""Admin-only read views for `/users/admin/...`.

Минимальные read-only эндпоинты для админ-кабинета ЛК. Никаких write-операций здесь нет:
блокировки, смена ролей и т.п. — отдельные эндпоинты, если/когда появятся.

Сюда же вынесены endpoints step-up «admin session» (см. ``AdminSessionView`` ниже),
которые управляют моделью ``AdminSession`` и проверяются permission'ом
``HasFreshAdminSession``.
"""

from datetime import timedelta

from django.conf import settings as dj_settings
from django.contrib.auth import get_user_model
from django.core.paginator import Paginator
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .admin_permissions import HasFreshAdminSession
from .serializers import (
    AdminSupportTicketDetailSerializer,
    AdminSupportTicketListItemSerializer,
    AdminUserDetailSerializer,
    AdminUserListItemSerializer,
)
from .telegram_mfa import (
    BIND_TOKEN_TTL_SECONDS,
    CODE_TTL_SECONDS,
    MAX_ATTEMPTS,
    RATE_LIMIT_WINDOW_SECONDS,
    TelegramMfaError,
    _webhook_secret,
    build_bot_link,
    generate_bind_token,
    generate_code,
    hash_bind_token,
    hash_code,
    send_admin_mfa_code,
    send_telegram_text,
    verify_bind_token,
    verify_code,
)

User = get_user_model()


def _admin_error(code: str, detail: str, status_code: int):
    """Стабильный shape ``{"detail","code"}`` (как у ``AdminMfaRequired``)."""
    return Response({"detail": detail, "code": code}, status=status_code)


# ---------------------------------------------------------------------------
# request-meta / audit helpers
# ---------------------------------------------------------------------------

def _client_ip(request):
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if xff:
        return xff.split(",")[0].strip() or None
    return request.META.get("REMOTE_ADDR") or None


def _user_agent(request):
    return (request.META.get("HTTP_USER_AGENT") or "")[:512]


def _audit(actor, action, **extra):
    """Тонкая обёртка: создаёт запись в ``AdminActionAudit`` (журнал действий админа)."""
    from .models import AdminActionAudit

    AdminActionAudit.objects.create(
        actor=actor,
        action=action,
        target_type=extra.get("target_type", ""),
        target_id=str(extra.get("target_id", "") or ""),
        metadata=extra.get("metadata") or {},
        ip_address=extra.get("ip"),
        user_agent=extra.get("user_agent", ""),
    )


def _parse_tri_bool(raw):
    """Возвращает True/False для допустимых значений, иначе ``None`` (= игнорировать фильтр)."""
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if s in ("true", "1", "yes"):
        return True
    if s in ("false", "0", "no"):
        return False
    return None


class AdminUsersListView(APIView):
    """GET-список пользователей для админ-кабинета.

    Query params:
      * ``q`` — подстрочный поиск по ``email``/``public_id``/``fio``/``phone`` (``icontains``).
      * ``is_staff`` — ``true``/``false``; неподходящие значения игнорируются.
      * ``is_active`` — ``true``/``false``; неподходящие значения игнорируются.
      * ``page`` — 1-based; невалидное → 1.
      * ``page_size`` — 1..100; невалидное → 20, больше 100 → 100.
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request):
        params = request.query_params

        try:
            page = int(params.get("page") or 1)
        except (TypeError, ValueError):
            page = 1
        page = max(1, page)

        try:
            page_size = int(params.get("page_size") or 20)
        except (TypeError, ValueError):
            page_size = 20
        page_size = max(1, min(page_size, 100))

        qs = User.objects.all()

        q_raw = (params.get("q") or "").strip()
        if q_raw:
            qs = qs.filter(
                Q(email__icontains=q_raw)
                | Q(public_id__icontains=q_raw)
                | Q(fio__icontains=q_raw)
                | Q(phone__icontains=q_raw)
            ).distinct()

        is_staff = _parse_tri_bool(params.get("is_staff"))
        if is_staff is not None:
            qs = qs.filter(is_staff=is_staff)

        is_active = _parse_tri_bool(params.get("is_active"))
        if is_active is not None:
            qs = qs.filter(is_active=is_active)

        qs = qs.order_by("-date_joined", "-id")

        paginator = Paginator(qs, page_size)
        page_obj = paginator.get_page(page)
        results = AdminUserListItemSerializer(page_obj.object_list, many=True).data

        return Response(
            {
                "count": paginator.count,
                "page": page_obj.number,
                "page_size": page_size,
                "total_pages": paginator.num_pages,
                "results": results,
            }
        )


class AdminUserDetailView(APIView):
    """GET-детали одного пользователя для админ-кабинета.

    URL kwarg ``user_id`` — целочисленный PK пользователя; неизвестный id → стандартный 404.
    Никаких write-методов: ни блокировок, ни смены ролей.
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request, user_id: int):
        user = get_object_or_404(User, pk=user_id)
        data = AdminUserDetailSerializer(user).data
        return Response(data)


class AdminUserSetActiveView(APIView):
    """``POST /users/admin/users/<id>/active/`` — блокировка/разблокировка пользователя.

    Меняет ТОЛЬКО ``is_active`` (никаких ``is_staff``/``is_superuser``/``email`` и т.п.).
    Запрещает self-deactivation; не-superuser не может трогать superuser'ов.
    На каждое реальное изменение пишет ``AdminActionAudit`` (``admin.user.activated``/
    ``admin.user.deactivated``); идемпотентный запрос (значение совпадает) — без записи.
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def post(self, request, user_id: int):
        new_value = (request.data or {}).get("is_active", None)
        if not isinstance(new_value, bool):
            return _admin_error(
                "ADMIN_USER_ACTIVE_INVALID",
                "Поле is_active обязательно и должно быть булевым",
                status.HTTP_400_BAD_REQUEST,
            )

        target = get_object_or_404(User, pk=user_id)

        if target.id == request.user.id:
            return _admin_error(
                "ADMIN_CANNOT_DEACTIVATE_SELF",
                "Нельзя менять активность собственной учётной записи",
                status.HTTP_400_BAD_REQUEST,
            )

        if target.is_superuser and not getattr(request.user, "is_superuser", False):
            return _admin_error(
                "ADMIN_SUPERUSER_REQUIRED",
                "Это действие доступно только суперадминистратору",
                status.HTTP_403_FORBIDDEN,
            )

        previous = bool(target.is_active)
        if previous != new_value:
            target.is_active = new_value
            target.save(update_fields=["is_active"])
            ip = _client_ip(request)
            ua = _user_agent(request)
            action = "admin.user.activated" if new_value else "admin.user.deactivated"
            _audit(
                request.user,
                action,
                target_type="user",
                target_id=target.id,
                metadata={
                    "target_email": getattr(target, "email", "") or "",
                    "previous_is_active": previous,
                    "new_is_active": new_value,
                },
                ip=ip,
                user_agent=ua,
            )

        serializer = AdminUserDetailSerializer(target, context={"request": request})
        return Response(serializer.data)


# ---------------------------------------------------------------------------
# Support tickets (admin moderation)
# ---------------------------------------------------------------------------

class AdminActionAuditsListView(APIView):
    """``GET /users/admin/action-audits/`` — read-only список журнала действий админа.

    Query params:
      * ``q`` — подстрочный поиск по ``actor.email``/``action``/``target_type``/``target_id``.
      * ``action`` — точное соответствие.
      * ``actor_id`` — целочисленный PK actor'а (нечисловое игнорируется).
      * ``target_type`` — точное соответствие.
      * ``page`` — 1-based; невалидное → 1.
      * ``page_size`` — 1..100; невалидное → 20; >100 → 100.
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request):
        from django.core.paginator import EmptyPage
        from .models import AdminActionAudit
        from .serializers import AdminActionAuditListItemSerializer

        qs = AdminActionAudit.objects.select_related("actor").all()

        q = (request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(actor__email__icontains=q)
                | Q(action__icontains=q)
                | Q(target_type__icontains=q)
                | Q(target_id__icontains=q)
            ).distinct()

        action_param = (request.query_params.get("action") or "").strip()
        if action_param:
            qs = qs.filter(action=action_param)

        actor_id = (request.query_params.get("actor_id") or "").strip()
        if actor_id.isdigit():
            qs = qs.filter(actor_id=int(actor_id))

        target_type_param = (request.query_params.get("target_type") or "").strip()
        if target_type_param:
            qs = qs.filter(target_type=target_type_param)

        qs = qs.order_by("-created_at", "-id")

        try:
            page_size = int(request.query_params.get("page_size") or 20)
        except (TypeError, ValueError):
            page_size = 20
        page_size = max(1, min(page_size, 100))

        try:
            page_num = int(request.query_params.get("page") or 1)
        except (TypeError, ValueError):
            page_num = 1
        page_num = max(1, page_num)

        paginator = Paginator(qs, page_size)
        try:
            page = paginator.page(page_num)
        except EmptyPage:
            page = paginator.page(paginator.num_pages) if paginator.num_pages else None

        results = []
        if page is not None:
            results = AdminActionAuditListItemSerializer(page.object_list, many=True).data

        return Response({
            "count": paginator.count,
            "page": page.number if page else page_num,
            "page_size": page_size,
            "total_pages": paginator.num_pages,
            "results": results,
        })


class AdminActionAuditDetailView(APIView):
    """``GET /users/admin/action-audits/<id>/`` — read-only детали записи журнала."""

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request, audit_id: int):
        from .models import AdminActionAudit
        from .serializers import AdminActionAuditDetailSerializer

        audit = get_object_or_404(
            AdminActionAudit.objects.select_related("actor"), pk=audit_id
        )
        return Response(
            AdminActionAuditDetailSerializer(audit, context={"request": request}).data
        )


class AdminSupportTicketsListView(APIView):
    """``GET /users/admin/support-tickets/`` — список обращений в поддержку для админ-кабинета.

    Query params:
      * ``q`` — подстрочный поиск по ``user.email``/``user.public_id``/``type_slug``/
        ``target_label``/``body`` (icontains).
      * ``status`` — ``open``/``closed`` (любое другое значение игнорируется).
      * ``page`` — 1-based; невалидное → 1.
      * ``page_size`` — 1..100; невалидное → 20; >100 → 100.
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request):
        from .models import SupportTicket

        params = request.query_params

        qs = SupportTicket.objects.select_related("user").all()

        q_raw = (params.get("q") or "").strip()
        if q_raw:
            qs = qs.filter(
                Q(user__email__icontains=q_raw)
                | Q(user__public_id__icontains=q_raw)
                | Q(type_slug__icontains=q_raw)
                | Q(target_label__icontains=q_raw)
                | Q(body__icontains=q_raw)
            ).distinct()

        status_param = (params.get("status") or "").strip().lower()
        if status_param == "open":
            qs = qs.filter(is_closed=False)
        elif status_param == "closed":
            qs = qs.filter(is_closed=True)

        qs = qs.order_by("-created_at", "-id")

        try:
            page_size = int(params.get("page_size") or 20)
        except (TypeError, ValueError):
            page_size = 20
        page_size = max(1, min(page_size, 100))

        try:
            page_num = int(params.get("page") or 1)
        except (TypeError, ValueError):
            page_num = 1
        page_num = max(1, page_num)

        paginator = Paginator(qs, page_size)
        page_obj = paginator.get_page(page_num)
        results = AdminSupportTicketListItemSerializer(page_obj.object_list, many=True).data

        return Response(
            {
                "count": paginator.count,
                "page": page_obj.number,
                "page_size": page_size,
                "total_pages": paginator.num_pages,
                "results": results,
            }
        )


class AdminSupportTicketDetailView(APIView):
    """``GET /users/admin/support-tickets/<uuid>/`` — детали обращения для админ-кабинета,
    ``PATCH`` — закрыть/открыть обращение (write-action, idempotent, audit).
    """

    permission_classes = [IsAuthenticated, IsAdminUser, HasFreshAdminSession]

    def get(self, request, ticket_id):
        from .models import SupportTicket

        ticket = get_object_or_404(
            SupportTicket.objects.select_related("user"), pk=ticket_id
        )
        return Response(
            AdminSupportTicketDetailSerializer(ticket, context={"request": request}).data
        )

    def patch(self, request, ticket_id):
        from .models import SupportTicket

        new_value = (request.data or {}).get("is_closed", None)
        if not isinstance(new_value, bool):
            return _admin_error(
                "ADMIN_TICKET_UPDATE_INVALID",
                "Поле is_closed обязательно и должно быть булевым",
                status.HTTP_400_BAD_REQUEST,
            )

        ticket = get_object_or_404(
            SupportTicket.objects.select_related("user"), pk=ticket_id
        )
        previous_closed = bool(ticket.is_closed)
        if previous_closed != new_value:
            ticket.is_closed = new_value
            ticket.closed_at = timezone.now() if new_value else None
            ticket.save(update_fields=["is_closed", "closed_at"])

            ip = _client_ip(request)
            ua = _user_agent(request)
            action = (
                "admin.support_ticket.closed"
                if new_value
                else "admin.support_ticket.reopened"
            )
            _audit(
                request.user,
                action,
                target_type="support_ticket",
                target_id=ticket.id,
                metadata={
                    "user_id": getattr(ticket.user, "id", None),
                    "user_email": getattr(ticket.user, "email", "") or "",
                    "previous_is_closed": previous_closed,
                    "new_is_closed": new_value,
                },
                ip=ip,
                user_agent=ua,
            )

        return Response(
            AdminSupportTicketDetailSerializer(ticket, context={"request": request}).data
        )


# ---------------------------------------------------------------------------
# Step-up «admin session» endpoints (MFA foundation, dev-confirm)
# ---------------------------------------------------------------------------

class AdminSessionView(APIView):
    """``GET /users/admin/session/`` — текущее состояние step-up сессии админа."""

    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request):
        from .models import AdminSession

        now = timezone.now()
        session = (
            AdminSession.objects
            .filter(user=request.user, revoked_at__isnull=True, elevated_until__gt=now)
            .order_by("-elevated_until")
            .first()
        )
        if session is None:
            return Response({"is_elevated": False, "elevated_until": None, "confirmed_with": None})
        return Response({
            "is_elevated": True,
            "elevated_until": session.elevated_until,
            "confirmed_with": session.confirmed_with,
        })


class AdminSessionDevConfirmView(APIView):
    """``POST /users/admin/session/dev-confirm/`` — выдаёт elevation на 30 минут (только при ``DEBUG``).

    Это единственный пока работающий «фактор» (foundation для будущих Telegram/WebAuthn/TOTP).
    """

    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request):
        from .models import AdminSession

        if not getattr(dj_settings, "DEBUG", False):
            return Response(
                {"detail": "Dev confirm недоступен", "code": "ADMIN_MFA_DEV_DISABLED"},
                status=status.HTTP_403_FORBIDDEN,
            )
        ip = _client_ip(request)
        ua = _user_agent(request)
        elevated_until = timezone.now() + timedelta(minutes=30)
        AdminSession.objects.create(
            user=request.user,
            elevated_until=elevated_until,
            confirmed_with="development",
            created_ip=ip,
            user_agent=ua,
        )
        _audit(
            request.user,
            "admin.session.elevated",
            metadata={"method": "development"},
            ip=ip,
            user_agent=ua,
        )
        return Response({
            "is_elevated": True,
            "elevated_until": elevated_until,
            "confirmed_with": "development",
        })


class AdminSessionRevokeView(APIView):
    """``POST /users/admin/session/revoke/`` — мгновенно гасит активные elevated сессии."""

    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request):
        from .models import AdminSession

        now = timezone.now()
        AdminSession.objects.filter(
            user=request.user,
            revoked_at__isnull=True,
            elevated_until__gt=now,
        ).update(revoked_at=now)
        _audit(
            request.user,
            "admin.session.revoked",
            ip=_client_ip(request),
            user_agent=_user_agent(request),
        )
        return Response({"is_elevated": False, "elevated_until": None, "confirmed_with": None})


# ---------------------------------------------------------------------------
# Telegram MFA endpoints (выдают/проверяют 6-значный код для step-up elevation)
# ---------------------------------------------------------------------------

class AdminTelegramMfaChallengeView(APIView):
    """``POST /users/admin/mfa/telegram/challenge/`` — отправляет код в Telegram активного device."""

    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request):
        from .models import AdminMfaChallenge, AdminMfaDevice

        device = (
            AdminMfaDevice.objects
            .filter(
                user=request.user,
                type=AdminMfaDevice.TYPE_TELEGRAM,
                is_active=True,
            )
            .exclude(telegram_chat_id="")
            .order_by("-created_at")
            .first()
        )
        if device is None:
            return _admin_error(
                "TELEGRAM_MFA_DEVICE_NOT_CONFIGURED",
                "Telegram MFA не настроен",
                status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        recent = AdminMfaChallenge.objects.filter(
            user=request.user,
            channel=AdminMfaChallenge.CHANNEL_TELEGRAM,
            created_at__gte=now - timedelta(seconds=RATE_LIMIT_WINDOW_SECONDS),
        ).exists()
        if recent:
            return _admin_error(
                "TELEGRAM_MFA_RATE_LIMITED",
                "Слишком часто. Попробуйте через минуту.",
                status.HTTP_429_TOO_MANY_REQUESTS,
            )

        # Гасим прошлые незаконченные challenge'и пользователя в этом канале — оставляем один активный.
        AdminMfaChallenge.objects.filter(
            user=request.user,
            channel=AdminMfaChallenge.CHANNEL_TELEGRAM,
            consumed_at__isnull=True,
        ).update(consumed_at=now)

        code = generate_code()
        challenge = AdminMfaChallenge.objects.create(
            user=request.user,
            device=device,
            channel=AdminMfaChallenge.CHANNEL_TELEGRAM,
            code_hash=hash_code(code),
            expires_at=now + timedelta(seconds=CODE_TTL_SECONDS),
            created_ip=_client_ip(request),
            user_agent=_user_agent(request),
        )
        try:
            send_admin_mfa_code(device.telegram_chat_id, code)
        except TelegramMfaError as exc:
            challenge.consumed_at = timezone.now()
            challenge.save(update_fields=["consumed_at"])
            return _admin_error(exc.code, exc.detail, status.HTTP_503_SERVICE_UNAVAILABLE)

        return Response({"detail": "Код отправлен в Telegram", "expires_in": CODE_TTL_SECONDS})


class AdminTelegramMfaVerifyView(APIView):
    """``POST /users/admin/mfa/telegram/verify/`` — проверяет 6-значный код, при успехе создаёт ``AdminSession``."""

    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request):
        from .models import AdminMfaChallenge, AdminSession

        raw = (request.data or {}).get("code", "")
        if not isinstance(raw, str) or not raw.strip():
            return _admin_error(
                "MFA_CODE_INVALID",
                "Код обязателен",
                status.HTTP_400_BAD_REQUEST,
            )
        raw = raw.strip()

        now = timezone.now()
        challenge = (
            AdminMfaChallenge.objects
            .filter(
                user=request.user,
                channel=AdminMfaChallenge.CHANNEL_TELEGRAM,
                consumed_at__isnull=True,
                expires_at__gt=now,
            )
            .order_by("-created_at")
            .first()
        )
        if challenge is None:
            return _admin_error(
                "MFA_CHALLENGE_NOT_FOUND",
                "Активный код не найден или истёк",
                status.HTTP_400_BAD_REQUEST,
            )
        if challenge.attempts_count >= MAX_ATTEMPTS:
            challenge.consumed_at = now
            challenge.save(update_fields=["consumed_at"])
            return _admin_error(
                "MFA_CHALLENGE_LOCKED",
                "Превышено число попыток",
                status.HTTP_429_TOO_MANY_REQUESTS,
            )

        if not verify_code(raw, challenge.code_hash):
            challenge.attempts_count += 1
            update_fields = ["attempts_count"]
            if challenge.attempts_count >= MAX_ATTEMPTS:
                challenge.consumed_at = now
                update_fields.append("consumed_at")
            challenge.save(update_fields=update_fields)
            return _admin_error(
                "MFA_CODE_INVALID",
                "Неверный код",
                status.HTTP_400_BAD_REQUEST,
            )

        challenge.consumed_at = now
        challenge.save(update_fields=["consumed_at"])
        elevated_until = now + timedelta(minutes=30)
        ip = _client_ip(request)
        ua = _user_agent(request)
        AdminSession.objects.create(
            user=request.user,
            elevated_until=elevated_until,
            confirmed_with="telegram",
            created_ip=ip,
            user_agent=ua,
        )
        _audit(
            request.user,
            "admin.session.elevated.telegram",
            metadata={"channel": "telegram"},
            ip=ip,
            user_agent=ua,
        )
        return Response({
            "is_elevated": True,
            "elevated_until": elevated_until,
            "confirmed_with": "telegram",
        })


# ---------------------------------------------------------------------------
# Telegram MFA bind: запуск привязки + webhook от Telegram-бота
# ---------------------------------------------------------------------------

def _has_fresh_admin_session(user) -> bool:
    """True если у юзера есть активная не-revoked admin-сессия (для условной логики rebind)."""
    from .models import AdminSession

    now = timezone.now()
    return AdminSession.objects.filter(
        user=user, revoked_at__isnull=True, elevated_until__gt=now,
    ).exists()


class AdminTelegramBindStartView(APIView):
    """``POST /users/admin/mfa/telegram/bind/start/`` — выдаёт ссылку ``t.me/<bot>?start=<token>``.

    Логика:
      * Если уже есть активный device → требуется fresh ``AdminSession`` (rebind).
      * Если device нет → bootstrap: разрешён только в ``DEBUG`` или для ``is_superuser``.
      * raw-токен в БД не сохраняется, только ``token_hash`` (см. ``AdminTelegramBindToken``).
    """

    permission_classes = [IsAuthenticated, IsAdminUser]

    def post(self, request):
        from .models import AdminMfaDevice, AdminTelegramBindToken

        user = request.user
        existing_device = (
            AdminMfaDevice.objects
            .filter(user=user, type=AdminMfaDevice.TYPE_TELEGRAM, is_active=True)
            .exclude(telegram_chat_id="")
            .first()
        )

        if existing_device is not None:
            if not _has_fresh_admin_session(user):
                return _admin_error(
                    "ADMIN_MFA_REQUIRED",
                    "Требуется дополнительное подтверждение администратора",
                    status.HTTP_403_FORBIDDEN,
                )
            purpose = AdminTelegramBindToken.PURPOSE_REBIND
        else:
            allow_bootstrap = (
                getattr(dj_settings, "DEBUG", False)
                or bool(getattr(user, "is_superuser", False))
            )
            if not allow_bootstrap:
                return _admin_error(
                    "TELEGRAM_MFA_BOOTSTRAP_REQUIRED",
                    "Первичная привязка Telegram доступна только суперадминистратору",
                    status.HTTP_403_FORBIDDEN,
                )
            purpose = AdminTelegramBindToken.PURPOSE_INITIAL_BIND

        ip = _client_ip(request)
        ua = _user_agent(request)
        now = timezone.now()
        # Гасим прошлые активные токены этого юзера — оставляем один действующий.
        AdminTelegramBindToken.objects.filter(
            user=user, consumed_at__isnull=True, expires_at__gt=now,
        ).update(consumed_at=now)
        raw = generate_bind_token()
        token_obj = AdminTelegramBindToken.objects.create(
            user=user,
            token_hash=hash_bind_token(raw),
            purpose=purpose,
            expires_at=now + timedelta(seconds=BIND_TOKEN_TTL_SECONDS),
            created_ip=ip,
            user_agent=ua,
        )
        bot_link = build_bot_link(raw)
        if bot_link is None:
            token_obj.consumed_at = timezone.now()
            token_obj.save(update_fields=["consumed_at"])
            return _admin_error(
                "TELEGRAM_MFA_NOT_CONFIGURED",
                "Telegram бот не настроен на сервере",
                status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        _audit(
            user, "admin.mfa.telegram.bind_started",
            metadata={"purpose": purpose}, ip=ip, user_agent=ua,
        )
        return Response({
            "bot_link": bot_link,
            "expires_in": BIND_TOKEN_TTL_SECONDS,
            "purpose": purpose,
        })


class AdminTelegramWebhookView(APIView):
    """``POST /users/admin/mfa/telegram/webhook/`` — приём ``/start <token>`` от бота.

    Защита — secret header ``X-Telegram-Bot-Api-Secret-Token`` (Telegram передаёт его, если
    указан в ``setWebhook``). Без ``TELEGRAM_WEBHOOK_SECRET`` endpoint скрыт (404).
    """

    permission_classes = []
    authentication_classes = []

    def post(self, request):
        from .models import AdminMfaDevice, AdminTelegramBindToken

        expected_secret = _webhook_secret()
        if not expected_secret:
            return Response(status=status.HTTP_404_NOT_FOUND)
        provided = request.META.get("HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN", "")
        if provided != expected_secret:
            return Response(status=status.HTTP_401_UNAUTHORIZED)

        update = request.data or {}
        message = update.get("message") or update.get("edited_message") or {}
        text = (message.get("text") or "").strip()
        chat = message.get("chat") or {}
        from_user = message.get("from") or {}
        chat_id = chat.get("id")
        username = (from_user.get("username") or chat.get("username") or "")[:64]
        if not text.startswith("/start") or chat_id is None:
            return Response({"ok": True})

        parts = text.split(maxsplit=1)
        if len(parts) < 2 or not parts[1].strip():
            return Response({"ok": True})
        raw_token = parts[1].strip()

        now = timezone.now()
        candidates = (
            AdminTelegramBindToken.objects
            .filter(consumed_at__isnull=True, expires_at__gt=now)
            .order_by("-created_at")
            .select_related("user")[:50]
        )
        matched = None
        for cand in candidates:
            if verify_bind_token(raw_token, cand.token_hash):
                matched = cand
                break
        if matched is None:
            return Response({"ok": True})

        matched.consumed_at = now
        matched.save(update_fields=["consumed_at"])

        AdminMfaDevice.objects.filter(
            user=matched.user, type=AdminMfaDevice.TYPE_TELEGRAM,
        ).update(is_active=False)
        AdminMfaDevice.objects.update_or_create(
            user=matched.user,
            type=AdminMfaDevice.TYPE_TELEGRAM,
            telegram_chat_id=str(chat_id),
            defaults={
                "telegram_username": username,
                "is_active": True,
                "confirmed_at": now,
            },
        )
        _audit(
            matched.user, "admin.mfa.telegram.bound",
            metadata={"purpose": matched.purpose, "chat_id": str(chat_id), "username": username},
        )

        try:
            send_telegram_text(
                str(chat_id),
                "Telegram привязан. Теперь вы будете получать коды для входа в админ-кабинет.",
            )
        except TelegramMfaError:
            pass
        return Response({"ok": True})
