"""API восстановления пароля шестизначным кодом на email."""

from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .password_reset_code_service import (
    confirm_password_reset_with_code,
    issue_code_for_user,
    normalize_email,
)
from .password_reset_views import password_reset_captcha_error_response

logger = logging.getLogger(__name__)

User = get_user_model()

GENERIC_REQUEST_SUCCESS = {
    "detail": "Если аккаунт существует, мы отправили код восстановления.",
}


class PasswordResetCodeRequestView(APIView):
    """
    POST /users/api/password-reset/request/

    Body: `{ "email", "captcha_key", "captcha" }` — допускается также `captcha_code`
    вместо `captcha` (совместимость с тем же изображением капчи).
    """

    permission_classes = [AllowAny]

    def post(self, request):
        captcha_err = password_reset_captcha_error_response(request.data)
        if captcha_err is not None:
            return captcha_err

        raw_email = request.data.get("email")
        if not isinstance(raw_email, str) or not raw_email.strip():
            return Response(
                {"detail": "Укажите email.", "code": "email_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        norm = normalize_email(raw_email)
        user = User.objects.filter(email__iexact=norm).first()
        if user is not None and user.is_active:
            try:
                issue_code_for_user(user, norm, request)
            except Exception:
                logger.exception("password_reset_code: issue/send failed user_id=%s", user.pk)

        return Response(GENERIC_REQUEST_SUCCESS)


class PasswordResetCodeConfirmView(APIView):
    """
    POST /users/api/password-reset/confirm/

    Body: `{ "email", "code", "new_password", "new_password_confirm" }`.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        raw_email = request.data.get("email")
        code = request.data.get("code")
        new_password = request.data.get("new_password")
        new_password_confirm = request.data.get("new_password_confirm")

        if not isinstance(raw_email, str) or not raw_email.strip():
            return Response(
                {"detail": "Укажите email.", "code": "email_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(code, str) or not code.strip():
            return Response(
                {"detail": "Укажите код из письма.", "code": "code_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(new_password, str) or not new_password:
            return Response(
                {"detail": "Укажите новый пароль.", "code": "new_password_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(new_password_confirm, str):
            return Response(
                {"detail": "Подтвердите новый пароль.", "code": "new_password_confirm_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        norm = normalize_email(raw_email)
        payload, http_status = confirm_password_reset_with_code(
            normalized_email=norm,
            code_plain=code,
            new_password=new_password,
            new_password_confirm=new_password_confirm,
        )
        return Response(payload, status=http_status)
