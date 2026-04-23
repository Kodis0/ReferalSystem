import logging

from django.contrib.auth import login
from django.db import transaction
from django.shortcuts import render
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from rest_framework import generics, serializers, status
from rest_framework.permissions import IsAuthenticated
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
