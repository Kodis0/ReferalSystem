"""Вход и регистрация по WebAuthn (Passkey)."""

from __future__ import annotations

import json
import logging
import secrets

from django.core.cache import cache
from django.db import transaction
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import options_to_json, parse_authentication_credential_json
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AuthenticatorAttachment,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    UserVerificationRequirement,
)

from referrals.services import link_session_attributions_to_user

from .models import CustomUser, WebAuthnCredential
from .passkey_helpers import (
    request_origin_header,
    user_handle_bytes,
    webauthn_expected_origins,
    webauthn_rp_id,
    webauthn_rp_name,
)
from .serializers import CurrentUserSerializer

logger = logging.getLogger(__name__)

PASSKEY_LOGIN_CACHE = "webauthn:login:"
PASSKEY_REG_CACHE = "webauthn:reg:"
CACHE_TTL = 300


def _issue_tokens(request, user: CustomUser) -> Response:
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


class PasskeyLoginOptionsView(APIView):
    """POST { email } → challenge + PublicKeyCredentialRequestOptions (JSON)."""

    permission_classes = [AllowAny]

    def post(self, request):
        raw_email = request.data.get("email")
        if not raw_email or not isinstance(raw_email, str):
            return Response(
                {"detail": "Нужен email.", "code": "passkey_email_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        email = raw_email.strip()
        if not email:
            return Response(
                {"detail": "Нужен email.", "code": "passkey_email_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            user = CustomUser.objects.get(email__iexact=email)
        except CustomUser.DoesNotExist:
            return Response(
                {
                    "detail": "Нет аккаунта с этим email.",
                    "code": "passkey_email_not_registered",
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        if not user.is_active:
            return Response(
                {"detail": "Аккаунт отключён.", "code": "account_disabled"},
                status=status.HTTP_403_FORBIDDEN,
            )

        creds = list(WebAuthnCredential.objects.filter(user=user))
        if not creds:
            return Response(
                {
                    "detail": "Для этого аккаунта не привязан Passkey. Войдите по паролю и добавьте ключ в настройках.",
                    "code": "passkey_not_registered",
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        rp_id = webauthn_rp_id()
        allow_credentials = [
            PublicKeyCredentialDescriptor(id=c.credential_id) for c in creds
        ]
        opts = generate_authentication_options(
            rp_id=rp_id,
            allow_credentials=allow_credentials,
            user_verification=UserVerificationRequirement.PREFERRED,
        )
        challenge = opts.challenge
        token = secrets.token_urlsafe(32)
        cache.set(
            f"{PASSKEY_LOGIN_CACHE}{token}",
            {"challenge": challenge, "email": user.email},
            CACHE_TTL,
        )
        options_obj = json.loads(options_to_json(opts))
        return Response({"challenge_key": token, "options": options_obj})


class PasskeyLoginVerifyView(APIView):
    """POST { email, challenge_key, credential } → JWT."""

    permission_classes = [AllowAny]

    def post(self, request):
        email_raw = request.data.get("email")
        challenge_key = request.data.get("challenge_key")
        credential = request.data.get("credential")
        if not email_raw or not isinstance(email_raw, str):
            return Response(
                {"detail": "Нужен email.", "code": "passkey_email_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not challenge_key or not isinstance(challenge_key, str):
            return Response(
                {"detail": "Нужен challenge_key.", "code": "passkey_challenge_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not credential or not isinstance(credential, dict):
            return Response(
                {"detail": "Нужен объект credential от браузера.", "code": "passkey_credential_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cache_key = f"{PASSKEY_LOGIN_CACHE}{challenge_key}"
        payload = cache.get(cache_key)
        if not payload or not isinstance(payload, dict):
            return Response(
                {"detail": "Сессия Passkey истекла. Начните вход снова.", "code": "passkey_challenge_expired"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        expected_challenge = payload.get("challenge")
        cached_email = payload.get("email")
        if expected_challenge is None or not isinstance(expected_challenge, (bytes, bytearray)):
            cache.delete(cache_key)
            return Response(
                {"detail": "Некорректное состояние Passkey.", "code": "passkey_challenge_invalid"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email = email_raw.strip()
        if cached_email and email.lower() != str(cached_email).lower():
            return Response(
                {"detail": "Email не совпадает с начатым входом.", "code": "passkey_email_mismatch"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user = CustomUser.objects.get(email__iexact=email)
        except CustomUser.DoesNotExist:
            return Response(
                {"detail": "Нет аккаунта с этим email.", "code": "passkey_email_not_registered"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not user.is_active:
            return Response(
                {"detail": "Аккаунт отключён.", "code": "account_disabled"},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            parsed = parse_authentication_credential_json(credential)
        except Exception:
            logger.warning("Passkey login: invalid credential JSON", exc_info=True)
            return Response(
                {"detail": "Некорректный ответ устройства.", "code": "passkey_credential_invalid"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_id = parsed.raw_id

        origins = webauthn_expected_origins()
        req_origin = request_origin_header(request)
        if req_origin and req_origin not in origins:
            return Response(
                {
                    "detail": "Origin не разрешён для Passkey. Проверьте WEBAUTHN_EXPECTED_ORIGINS / FRONTEND_URL.",
                    "code": "passkey_origin_not_allowed",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not req_origin:
            return Response(
                {"detail": "Запрос без заголовка Origin — войдите из браузера.", "code": "passkey_origin_missing"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        expected_origin = origins[0] if len(origins) == 1 else origins

        if not WebAuthnCredential.objects.filter(credential_id=raw_id, user=user).exists():
            return Response(
                {"detail": "Этот ключ не привязан к аккаунту.", "code": "passkey_unknown_credential"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                stored = WebAuthnCredential.objects.select_for_update().get(
                    credential_id=raw_id,
                    user=user,
                )
                verified = verify_authentication_response(
                    credential=credential,
                    expected_challenge=bytes(expected_challenge),
                    expected_rp_id=webauthn_rp_id(),
                    expected_origin=expected_origin,
                    credential_public_key=bytes(stored.public_key),
                    credential_current_sign_count=stored.sign_count,
                    require_user_verification=False,
                )
                stored.sign_count = verified.new_sign_count
                stored.save(update_fields=["sign_count"])
        except InvalidAuthenticationResponse as e:
            logger.info("Passkey verify failed: %s", e)
            return Response(
                {"detail": "Не удалось подтвердить Passkey.", "code": "passkey_verification_failed"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cache.delete(cache_key)
        return _issue_tokens(request, user)


class PasskeyRegisterOptionsView(APIView):
    """POST — опции регистрации нового Passkey (пользователь уже вошёл по JWT)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        rp_id = webauthn_rp_id()
        exclude = [
            PublicKeyCredentialDescriptor(id=c.credential_id)
            for c in WebAuthnCredential.objects.filter(user=user)
        ]
        attachment_raw = request.data.get("authenticator_attachment")
        authenticator_attachment = None
        if attachment_raw == AuthenticatorAttachment.PLATFORM.value:
            authenticator_attachment = AuthenticatorAttachment.PLATFORM
        elif attachment_raw in (
            AuthenticatorAttachment.CROSS_PLATFORM.value,
            "cross_platform",
        ):
            authenticator_attachment = AuthenticatorAttachment.CROSS_PLATFORM

        selection_kwargs = {
            "user_verification": UserVerificationRequirement.PREFERRED,
        }
        if authenticator_attachment is not None:
            selection_kwargs["authenticator_attachment"] = authenticator_attachment

        opts = generate_registration_options(
            rp_id=rp_id,
            rp_name=webauthn_rp_name(),
            user_name=user.email,
            user_display_name=user.email,
            user_id=user_handle_bytes(user.pk),
            exclude_credentials=exclude or None,
            authenticator_selection=AuthenticatorSelectionCriteria(**selection_kwargs),
        )
        challenge = opts.challenge
        token = secrets.token_urlsafe(32)
        cache.set(
            f"{PASSKEY_REG_CACHE}{token}",
            {"challenge": challenge, "user_id": user.pk},
            CACHE_TTL,
        )
        options_obj = json.loads(options_to_json(opts))
        return Response({"challenge_key": token, "options": options_obj})


class PasskeyRegisterVerifyView(APIView):
    """POST { challenge_key, credential, transports? } — сохранить Passkey."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        challenge_key = request.data.get("challenge_key")
        credential = request.data.get("credential")
        transports = request.data.get("transports")
        if not challenge_key or not isinstance(challenge_key, str):
            return Response(
                {"detail": "Нужен challenge_key.", "code": "passkey_challenge_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not credential or not isinstance(credential, dict):
            return Response(
                {"detail": "Нужен объект credential от браузера.", "code": "passkey_credential_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cache_key = f"{PASSKEY_REG_CACHE}{challenge_key}"
        payload = cache.get(cache_key)
        if not payload or not isinstance(payload, dict):
            return Response(
                {"detail": "Сессия регистрации истекла. Начните снова.", "code": "passkey_challenge_expired"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        expected_challenge = payload.get("challenge")
        uid = payload.get("user_id")
        if expected_challenge is None or uid != request.user.pk:
            cache.delete(cache_key)
            return Response(
                {"detail": "Некорректное состояние регистрации.", "code": "passkey_challenge_invalid"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        origins = webauthn_expected_origins()
        req_origin = request_origin_header(request)
        if req_origin and req_origin not in origins:
            return Response(
                {
                    "detail": "Origin не разрешён для Passkey.",
                    "code": "passkey_origin_not_allowed",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not req_origin:
            return Response(
                {"detail": "Запрос без заголовка Origin.", "code": "passkey_origin_missing"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            verified = verify_registration_response(
                credential=credential,
                expected_challenge=bytes(expected_challenge),
                expected_rp_id=webauthn_rp_id(),
                expected_origin=origins if len(origins) > 1 else origins[0],
                require_user_verification=False,
            )
        except InvalidRegistrationResponse as e:
            logger.info("Passkey registration verify failed: %s", e)
            return Response(
                {"detail": "Не удалось зарегистрировать Passkey.", "code": "passkey_registration_failed"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        transport_list: list[str] = []
        if isinstance(transports, list):
            transport_list = [str(x) for x in transports if isinstance(x, str)]

        try:
            WebAuthnCredential.objects.create(
                user=request.user,
                credential_id=verified.credential_id,
                public_key=verified.credential_public_key,
                sign_count=verified.sign_count,
                transports=transport_list,
            )
        except Exception:
            logger.exception("Passkey credential save failed")
            return Response(
                {"detail": "Не удалось сохранить ключ.", "code": "passkey_store_failed"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        cache.delete(cache_key)
        return Response({"detail": "Passkey добавлен.", "code": "passkey_registered"}, status=status.HTTP_201_CREATED)


class PasskeyListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        rows = WebAuthnCredential.objects.filter(user=request.user).order_by("-created_at")
        out = []
        for c in rows:
            out.append(
                {
                    "id": str(c.id),
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                    "transports": c.transports if isinstance(c.transports, list) else [],
                }
            )
        return Response({"results": out})


class PasskeyDestroyView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, credential_pk):
        deleted, _ = WebAuthnCredential.objects.filter(
            user=request.user,
            pk=credential_pk,
        ).delete()
        if deleted == 0:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)
