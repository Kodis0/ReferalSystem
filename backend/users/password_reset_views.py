"""Запрос сброса пароля по email с проверкой капчи (без раскрытия наличия аккаунта)."""

from __future__ import annotations

import base64
import io
import logging
import random
import secrets
import string

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from PIL import Image, ImageDraw, ImageFont
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)

User = get_user_model()

CAPTCHA_CACHE_PREFIX = "pwreset:captcha:"
CAPTCHA_TTL = 600
_CAPTCHA_ALPHABET = string.ascii_uppercase.replace("O", "").replace("I", "") + string.digits.replace("0", "").replace("1", "")


def _extract_password_reset_captcha_plain(data) -> str | None:
    """Поле `captcha` (новый контракт) или `captcha_code` (legacy)."""
    v = data.get("captcha")
    if isinstance(v, str) and v.strip():
        return v.strip().lower()
    v = data.get("captcha_code")
    if isinstance(v, str) and v.strip():
        return v.strip().lower()
    return None


def password_reset_captcha_error_response(data) -> Response | None:
    """
    None — капча верна и удалена из cache.
    Иначе Response с ошибкой (invalid/expired/missing).
    """
    captcha_key = data.get("captcha_key")
    if not isinstance(captcha_key, str) or not captcha_key.strip():
        return Response(
            {"detail": "Запросите новое изображение капчи.", "code": "captcha_key_required"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    plain = _extract_password_reset_captcha_plain(data)
    if plain is None:
        return Response(
            {"detail": "Введите код с картинки.", "code": "captcha_code_required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    key = captcha_key.strip()
    stored = cache.get(f"{CAPTCHA_CACHE_PREFIX}{key}")
    cache.delete(f"{CAPTCHA_CACHE_PREFIX}{key}")
    if stored is None:
        return Response(
            {"detail": "Капча устарела. Обновите изображение и введите код снова.", "code": "captcha_expired"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if stored != plain:
        return Response(
            {"detail": "Неверный код с картинки.", "code": "captcha_invalid"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None


def _random_captcha_text(length: int = 6) -> str:
    return "".join(secrets.choice(_CAPTCHA_ALPHABET) for _ in range(length))


def _load_captcha_font(size: int):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _captcha_png_bytes(code: str) -> bytes:
    """PNG с лёгким шумом: читаемо для пользователя, но не совсем plain-text."""
    w, h = 168, 56
    img = Image.new("RGB", (w, h), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    # Фон: немного светлых линий и точек, без сильного перекрытия текста.
    for _ in range(random.randint(12, 18)):
        draw.line(
            [
                (random.randint(0, w), random.randint(0, h)),
                (random.randint(0, w), random.randint(0, h)),
            ],
            fill=(
                random.randint(175, 215),
                random.randint(175, 215),
                random.randint(175, 215),
            ),
            width=1,
        )
    for _ in range(45):
        x = secrets.randbelow(w)
        y = secrets.randbelow(h)
        v = random.randint(180, 225)
        img.putpixel((x, y), (v, v, v))

    font = _load_captcha_font(23)
    reserve_right = 30
    left_margin = 8
    usable = max(12, w - reserve_right - left_margin)
    n = max(len(code), 1)
    slot = usable / n

    _resample = getattr(Image, "Resampling", Image).BICUBIC

    for i, ch in enumerate(code):
        layer = Image.new("RGBA", (44, 42), (255, 255, 255, 0))
        ld = ImageDraw.Draw(layer)
        fill = (
            random.randint(22, 52),
            random.randint(38, 72),
            random.randint(75, 118),
            255,
        )
        ld.text((6, 5), ch, font=font, fill=fill)
        angle = random.randint(-12, 12)
        rot = layer.rotate(angle, expand=True, resample=_resample, fillcolor=(255, 255, 255, 0))
        rw, rh = rot.size
        cx = left_margin + i * slot + (slot - rw) / 2
        cy = (h - rh) / 2 + random.randint(-3, 3)
        px = int(max(1, min(cx, w - rw - reserve_right)))
        py = int(max(1, min(cy, h - rh - 1)))
        img.paste(rot, (px, py), rot)

    draw = ImageDraw.Draw(img)
    # Минимальные линии поверх текста, чтобы не мешать чтению.
    for _ in range(random.randint(2, 4)):
        draw.line(
            [
                (random.randint(0, w), random.randint(0, h)),
                (random.randint(0, w), random.randint(0, h)),
            ],
            fill=(
                random.randint(140, 190),
                random.randint(140, 190),
                random.randint(150, 200),
            ),
            width=random.randint(1, 2),
        )
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class PasswordResetCaptchaView(APIView):
    """GET → `{ captcha_key, image_base64 }` — PNG в виде data URL."""

    permission_classes = [AllowAny]

    def get(self, request):
        code = _random_captcha_text()
        captcha_key = secrets.token_urlsafe(32)
        cache.set(f"{CAPTCHA_CACHE_PREFIX}{captcha_key}", code.lower(), CAPTCHA_TTL)
        png = _captcha_png_bytes(code)
        b64 = base64.standard_b64encode(png).decode("ascii")
        return Response(
            {
                "captcha_key": captcha_key,
                "image_base64": f"data:image/png;base64,{b64}",
            }
        )


class PasswordResetRequestView(APIView):
    """
    POST JSON `{ email, captcha_key, captcha_code }`.

    Ответ всегда одинаковый при валидной капче (не раскрывает наличие email в базе).
    """

    permission_classes = [AllowAny]

    _OK_MESSAGE = "Если указанный адрес зарегистрирован, мы отправили на него письмо с инструкцией."

    def post(self, request):
        raw_email = request.data.get("email")
        if not isinstance(raw_email, str) or not raw_email.strip():
            return Response(
                {"detail": "Укажите email.", "code": "email_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        captcha_err = password_reset_captcha_error_response(request.data)
        if captcha_err is not None:
            return captcha_err

        email = raw_email.strip()
        user = User.objects.filter(email__iexact=email).first()
        if user is None or not user.is_active:
            return Response({"detail": self._OK_MESSAGE, "code": "password_reset_requested"})

        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        base = getattr(settings, "FRONTEND_URL", "http://localhost:3000").rstrip("/")
        reset_url = f"{base}/login?reset_uid={uid}&reset_token={token}"

        subject = "Восстановление пароля"
        body = (
            "Здравствуйте.\n\n"
            f"Чтобы задать новый пароль, перейдите по ссылке:\n{reset_url}\n\n"
            "Если вы не запрашивали восстановление, проигнорируйте это письмо.\n"
        )

        try:
            send_mail(
                subject,
                body,
                None,
                [user.email],
                fail_silently=False,
            )
        except Exception:
            logger.exception("password_reset: send_mail failed for user id=%s", user.pk)
            return Response(
                {
                    "detail": "Не удалось отправить письмо. Попробуйте позже или обратитесь в поддержку.",
                    "code": "password_reset_mail_failed",
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response({"detail": self._OK_MESSAGE, "code": "password_reset_requested"})
