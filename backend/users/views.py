import logging
import secrets
import urllib.parse

import requests
from django.contrib.auth import login
from django.db import transaction
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.urls import reverse
from django.views import View
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from rest_framework import generics, serializers, status
from django.conf import settings as django_settings
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from referrals.models import SiteMembership
from referrals.services import (
    create_site_membership_from_signup,
    get_site_by_public_id,
    join_site_membership_cta_logged_in,
    link_session_attributions_to_user,
    site_allows_cta_signup_membership,
    site_cta_display_label,
)

from .models import CustomUser
from .serializers import (
    CurrentUserProfileUpdateSerializer,
    CurrentUserSerializer,
    LoginSerializer,
    RegisterSerializer,
    SiteCtaJoinSerializer,
)
from .telegram_auth import TELEGRAM_OAUTH_AUTH_URL, parse_bot_id, verify_telegram_login
from .vk_oauth import (
    VK_ID_AUTHORIZE_URL,
    exchange_vk_oauth_code,
    generate_pkce_pair,
    parse_vk_id_callback_query,
    resolve_vk_login_email,
)

logger = logging.getLogger(__name__)


@method_decorator(csrf_exempt, name="dispatch")
class RegisterView(generics.CreateAPIView):
    """
    Простая регистрация пользователя.
    Для фронтенда возвращаем `redirect_url`, чтобы после успеха можно было
    перенаправить пользователя на страницу входа.
    """

    queryset = CustomUser.objects.all()
    serializer_class = RegisterSerializer

    def create(self, request, *args, **kwargs):
        # Логируем при 400, чтобы понять, что пришло и почему не прошло валидацию
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            logger.warning(
                "Register validation failed: body=%s errors=%s",
                request.data,
                serializer.errors,
            )
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        site_public_id = serializer.validated_data.get("site_public_id")
        requested_ref_code = (
            serializer.validated_data.get("ref_code")
            or serializer.validated_data.get("ref")
            or ""
        )
        if site_public_id:
            site = get_site_by_public_id(site_public_id)
            if site is None:
                return Response(
                    {"site_public_id": ["Invalid site_public_id."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not site_allows_cta_signup_membership(site):
                return Response(
                    {
                        "detail": "site_not_joinable",
                        "site_status": site.status,
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        pre_auth_session_key = self.request.session.session_key
        cta_join = None
        with transaction.atomic():
            self.perform_create(serializer)
            user = serializer.instance
            link_session_attributions_to_user(session_key=pre_auth_session_key, user=user)
            if site_public_id:
                membership, created = create_site_membership_from_signup(
                    site_public_id=site_public_id,
                    user=user,
                    session_key=pre_auth_session_key,
                    ref_code=requested_ref_code,
                )
                cta_join = {
                    "status": "joined" if created else "already_joined",
                    "site_public_id": str(membership.site.public_id),
                    "site_display_label": site_cta_display_label(membership.site),
                }
        refresh = RefreshToken.for_user(user)
        body = {
            **serializer.data,
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": CurrentUserSerializer(user).data,
            # Маршрут SPA (React), не Django template /users/login-page/
            "redirect_url": "/lk/dashboard",
        }
        if cta_join is not None:
            body["cta_join"] = cta_join
        return Response(body, status=status.HTTP_201_CREATED)


class SiteCtaJoinView(APIView):
    """
    Authenticated user landing on a CTA link: join SiteMembership without registration.

    JWT-only (same as /users/me/). Idempotent: existing membership → status already_joined.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = SiteCtaJoinSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        site_pid = ser.validated_data["site_public_id"]
        requested_ref = (
            (ser.validated_data.get("ref_code") or ser.validated_data.get("ref") or "")
            or ""
        ).strip()
        try:
            membership, outcome = join_site_membership_cta_logged_in(
                site_public_id=site_pid,
                user=request.user,
                session_key=request.session.session_key,
                ref_code=requested_ref,
            )
        except ValueError as exc:
            err = str(exc)
            if err == "invalid_site_public_id":
                return Response(
                    {"site_public_id": ["Invalid site_public_id."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if err == "site_not_joinable":
                site = get_site_by_public_id(site_pid)
                return Response(
                    {
                        "detail": "site_not_joinable",
                        "site_status": site.status if site else None,
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )
            raise
        return Response(
            {
                "status": outcome,
                "site_public_id": str(membership.site.public_id),
                "site_display_label": site_cta_display_label(membership.site),
            },
            status=status.HTTP_200_OK,
        )


class LoginView(APIView):
    """
    Session-based логин через email и пароль.
    """

    @method_decorator(csrf_exempt)
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user = serializer.validated_data["user"]
        pre_auth_session_key = request.session.session_key
        login(request, user)
        link_session_attributions_to_user(session_key=pre_auth_session_key, user=user)
        return Response(
            {
                "message": "Успешный вход",
                "redirect_url": "/users/dashboard/",
                "user": CurrentUserSerializer(user).data,
            }
        )


class LoginPageView(View):
    def get(self, request):
        return render(request, "login.html")


class DashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"message": f"Добро пожаловать, {request.user.email}!"})


class CurrentUserView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        serializer = CurrentUserSerializer(request.user)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def patch(self, request):
        serializer = CurrentUserProfileUpdateSerializer(
            request.user,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        request.user.refresh_from_db()
        return Response(CurrentUserSerializer(request.user).data, status=status.HTTP_200_OK)


class MyProgramsView(APIView):
    """
    Member-facing list of SiteMembership for the current user (referral participations).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = request.user.site_memberships.select_related("site").order_by(
            "-created_at"
        )
        programs = []
        for m in qs:
            site = m.site
            programs.append(
                {
                    "site_public_id": str(site.public_id),
                    "site_display_label": site_cta_display_label(site),
                    "joined_at": m.created_at.isoformat() if m.created_at else None,
                    "site_status": site.status,
                }
            )
        return Response({"programs": programs}, status=status.HTTP_200_OK)


class MyProgramDetailView(APIView):
    """
    Member-facing detail for one SiteMembership of the current user (by site public_id).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, site_public_id):
        site = get_site_by_public_id(site_public_id)
        if site is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        membership = (
            SiteMembership.objects.filter(site=site, user=request.user)
            .select_related("site")
            .first()
        )
        if membership is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        site = membership.site
        payload = {
            "site_public_id": str(site.public_id),
            "site_display_label": site_cta_display_label(site),
            "joined_at": membership.created_at.isoformat() if membership.created_at else None,
            "site_status": site.status,
        }
        return Response({"program": payload}, status=status.HTTP_200_OK)


class MyTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    JWT-авторизация по email вместо стандартного username.
    """

    username_field = "email"

    def validate(self, attrs):
        email = attrs.get("email")
        password = attrs.get("password")

        from django.contrib.auth import get_user_model

        User = get_user_model()

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            raise serializers.ValidationError("Неверный email или пароль")

        if not user.check_password(password):
            raise serializers.ValidationError("Неверный email или пароль")

        request = self.context.get("request")
        if request is not None:
            link_session_attributions_to_user(
                session_key=request.session.session_key,
                user=user,
            )

        refresh = self.get_token(user)
        return {
            "refresh": str(refresh),
            "access": str(refresh.access_token),
            "user": CurrentUserSerializer(user).data,
        }


class MyTokenObtainPairView(TokenObtainPairView):
    serializer_class = MyTokenObtainPairSerializer


class GoogleIdTokenLoginView(APIView):
    """
    Обмен JWT Google Sign-In (поле credential) на наши access/refresh JWT.
    Пользователь уже должен существовать с тем же подтверждённым email, что в токене Google.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        client_id = (getattr(django_settings, "GOOGLE_OAUTH_CLIENT_ID", None) or "").strip()
        if not client_id:
            return Response(
                {
                    "detail": "Вход через Google не настроен на сервере.",
                    "code": "google_oauth_not_configured",
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        credential = request.data.get("credential") or request.data.get("id_token")
        if not credential or not isinstance(credential, str):
            return Response(
                {
                    "detail": "Нужен JWT от Google (поле credential).",
                    "code": "google_credential_missing",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .google_verify import verify_google_id_token

        try:
            idinfo = verify_google_id_token(credential.strip(), client_id)
        except ValueError:
            logger.warning("Google id_token verification failed")
            return Response(
                {
                    "detail": "Не удалось проверить токен Google.",
                    "code": "google_token_invalid",
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )

        email_raw = idinfo.get("email")
        if not email_raw or not isinstance(email_raw, str):
            return Response(
                {
                    "detail": "В токене Google нет адреса email.",
                    "code": "google_email_missing",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not idinfo.get("email_verified", False):
            return Response(
                {
                    "detail": "Email в Google не подтверждён.",
                    "code": "google_email_not_verified",
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        email = email_raw.strip()
        try:
            user = CustomUser.objects.get(email__iexact=email)
        except CustomUser.DoesNotExist:
            return Response(
                {
                    "detail": "Нет аккаунта с этим email. Сначала зарегистрируйтесь или войдите по паролю.",
                    "code": "google_email_not_registered",
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        if not user.is_active:
            return Response(
                {
                    "detail": "Аккаунт отключён.",
                    "code": "account_disabled",
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        link_session_attributions_to_user(
            session_key=request.session.session_key,
            user=user,
        )

        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "refresh": str(refresh),
                "access": str(refresh.access_token),
                "user": CurrentUserSerializer(user).data,
            },
            status=status.HTTP_200_OK,
        )


def _frontend_login_base():
    return (getattr(django_settings, "FRONTEND_URL", None) or "http://localhost:3000").strip().rstrip("/")


def _vk_oauth_redirect_uri(request):
    fixed = (getattr(django_settings, "VK_OAUTH_REDIRECT_URI", None) or "").strip()
    if fixed:
        return fixed
    return request.build_absolute_uri(reverse("vk_oauth_callback"))


class VkOAuthStartView(View):
    """Начало VK ID: редирект на id.vk.com (PKCE), state и code_verifier в сессии."""

    def get(self, request):
        fe = _frontend_login_base()
        app_id = (getattr(django_settings, "VK_OAUTH_APP_ID", None) or "").strip()
        if not app_id:
            return HttpResponseRedirect(f"{fe}/login?vk_error=vk_oauth_not_configured")

        redirect_uri = _vk_oauth_redirect_uri(request)
        state = secrets.token_urlsafe(32)

        code_verifier, code_challenge = generate_pkce_pair()
        request.session["vk_oauth_state"] = state
        request.session["vk_code_verifier"] = code_verifier
        request.session.modified = True

        vk_scope = (getattr(django_settings, "VK_OAUTH_SCOPE", None) or "email").strip()
        vk_scheme = (getattr(django_settings, "VK_OAUTH_SCHEME", None) or "dark").strip() or "dark"
        q = urllib.parse.urlencode(
            {
                "response_type": "code",
                "client_id": app_id,
                "scope": vk_scope,
                "redirect_uri": redirect_uri,
                "state": state,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "scheme": vk_scheme,
            }
        )
        return HttpResponseRedirect(f"{VK_ID_AUTHORIZE_URL}?{q}")


class VkOAuthCallbackView(View):
    """Callback VK ID: code + PKCE + device_id → токены → email → JWT → /login#..."""

    def get(self, request):
        fe = _frontend_login_base()

        parsed = parse_vk_id_callback_query(request)
        if parsed.get("error") == "access_denied":
            return HttpResponseRedirect(f"{fe}/login?vk_error=vk_oauth_denied")

        code = parsed.get("code")
        state = parsed.get("state")
        device_id = parsed.get("device_id")
        if not code or not state or not isinstance(code, str) or not isinstance(state, str):
            return HttpResponseRedirect(f"{fe}/login?vk_error=vk_oauth_invalid_callback")

        if not device_id:
            return HttpResponseRedirect(f"{fe}/login?vk_error=vk_missing_device_id")

        expected = request.session.get("vk_oauth_state")
        if not expected or state != expected:
            return HttpResponseRedirect(f"{fe}/login?vk_error=vk_state_invalid")

        code_verifier = request.session.get("vk_code_verifier")
        if not code_verifier or not isinstance(code_verifier, str):
            return HttpResponseRedirect(f"{fe}/login?vk_error=vk_state_invalid")

        try:
            del request.session["vk_oauth_state"]
            del request.session["vk_code_verifier"]
            request.session.modified = True
        except KeyError:
            pass

        app_id = (getattr(django_settings, "VK_OAUTH_APP_ID", None) or "").strip()
        client_secret = (getattr(django_settings, "VK_OAUTH_CLIENT_SECRET", None) or "").strip()
        if not app_id:
            return HttpResponseRedirect(f"{fe}/login?vk_error=vk_oauth_not_configured")

        redirect_uri = _vk_oauth_redirect_uri(request)

        try:
            token_payload = exchange_vk_oauth_code(
                code=code.strip(),
                app_id=app_id,
                client_secret=client_secret,
                redirect_uri=redirect_uri,
                code_verifier=code_verifier.strip(),
                device_id=device_id.strip(),
                state=state.strip(),
            )
        except (requests.RequestException, ValueError):
            logger.exception("VK ID token exchange failed")
            return HttpResponseRedirect(f"{fe}/login?vk_error=vk_token_exchange_failed")

        vk_access = token_payload.get("access_token")
        if not vk_access or not isinstance(vk_access, str):
            return HttpResponseRedirect(f"{fe}/login?vk_error=vk_token_exchange_failed")

        try:
            email_raw = resolve_vk_login_email(
                token_payload=token_payload,
                access_token=vk_access.strip(),
                client_id=app_id,
            )
        except requests.RequestException:
            logger.exception("VK ID resolve email failed")
            return HttpResponseRedirect(f"{fe}/login?vk_error=vk_email_fetch_failed")

        if not email_raw or not isinstance(email_raw, str):
            logger.warning(
                "VK ID: no unmasked email after resolve; scope=%r",
                token_payload.get("scope"),
            )
            return HttpResponseRedirect(f"{fe}/login?vk_error=vk_email_missing")

        email = email_raw.strip()
        try:
            user = CustomUser.objects.get(email__iexact=email)
        except CustomUser.DoesNotExist:
            return HttpResponseRedirect(f"{fe}/login?vk_error=vk_email_not_registered")

        if not user.is_active:
            return HttpResponseRedirect(f"{fe}/login?vk_error=account_disabled")

        link_session_attributions_to_user(
            session_key=request.session.session_key,
            user=user,
        )

        refresh = RefreshToken.for_user(user)
        access_jwt = str(refresh.access_token)
        refresh_jwt = str(refresh)

        frag = urllib.parse.urlencode(
            {
                "oauth": "vk",
                "access_token": access_jwt,
                "refresh_token": refresh_jwt,
            }
        )
        return HttpResponseRedirect(f"{fe}/login#{frag}")


class TelegramLoginStartView(View):
    """Редирект на oauth.telegram.org (вход через Telegram)."""

    def get(self, request):
        fe = _frontend_login_base()
        token = (getattr(django_settings, "TELEGRAM_BOT_TOKEN", None) or "").strip()
        bot_id = parse_bot_id(token) if token else None
        if not token or not bot_id:
            return HttpResponseRedirect(f"{fe}/login?tg_error=tg_oauth_not_configured")

        fixed_return = (getattr(django_settings, "TELEGRAM_LOGIN_REDIRECT_URI", None) or "").strip()
        return_to = fixed_return or request.build_absolute_uri(reverse("telegram_login_callback"))
        origin = fe

        q = urllib.parse.urlencode(
            {
                "bot_id": bot_id,
                "origin": origin,
                "return_to": return_to,
                "request_access": "write",
            }
        )
        return HttpResponseRedirect(f"{TELEGRAM_OAUTH_AUTH_URL}?{q}")


class TelegramLoginCallbackView(View):
    """Callback Telegram Login: проверка hash → JWT в fragment (как VK)."""

    def get(self, request):
        fe = _frontend_login_base()
        token = (getattr(django_settings, "TELEGRAM_BOT_TOKEN", None) or "").strip()
        if not token:
            return HttpResponseRedirect(f"{fe}/login?tg_error=tg_oauth_not_configured")

        data = request.GET.dict()
        if not verify_telegram_login(data, token):
            logger.warning("Telegram login callback: invalid signature")
            return HttpResponseRedirect(f"{fe}/login?tg_error=tg_auth_invalid")

        raw_id = (data.get("id") or "").strip()
        try:
            telegram_id = int(raw_id)
        except (TypeError, ValueError):
            return HttpResponseRedirect(f"{fe}/login?tg_error=tg_auth_invalid")
        if telegram_id <= 0:
            return HttpResponseRedirect(f"{fe}/login?tg_error=tg_auth_invalid")

        first_name = ((data.get("first_name") or "").strip())[:150]
        last_name = ((data.get("last_name") or "").strip())[:150]
        username_raw = (data.get("username") or "").strip()
        username = username_raw[:150] if username_raw else ""

        user, created = CustomUser.objects.get_or_create(
            telegram_id=telegram_id,
            defaults={
                "email": f"tg{telegram_id}@telegram.noreply",
                "first_name": first_name,
                "last_name": last_name,
                "username": username,
            },
        )
        if created:
            user.set_unusable_password()
            user.save()

        if not user.is_active:
            return HttpResponseRedirect(f"{fe}/login?tg_error=account_disabled")

        link_session_attributions_to_user(
            session_key=request.session.session_key,
            user=user,
        )

        refresh = RefreshToken.for_user(user)
        access_jwt = str(refresh.access_token)
        refresh_jwt = str(refresh)

        frag = urllib.parse.urlencode(
            {
                "oauth": "tg",
                "access_token": access_jwt,
                "refresh_token": refresh_jwt,
            }
        )
        return HttpResponseRedirect(f"{fe}/login#{frag}")
