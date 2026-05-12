import secrets
import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class CustomUser(AbstractUser):
    email = models.EmailField(unique=True)
    is_verified = models.BooleanField(default=False)
    username = models.CharField(max_length=150, unique=False, blank=True, null=True)
    public_id = models.CharField(max_length=7, unique=True, blank=True, editable=False)
    avatar_data_url = models.TextField(blank=True, default="")
    patronymic = models.CharField("отчество", max_length=150, blank=True, default="")
    birth_date = models.DateField("дата рождения", null=True, blank=True)
    passport_series = models.CharField("серия паспорта", max_length=16, blank=True, default="")
    passport_number = models.CharField("номер паспорта", max_length=32, blank=True, default="")
    passport_issued_by = models.TextField("кем выдан", blank=True, default="")
    passport_issue_date = models.DateField("дата выдачи", null=True, blank=True)
    passport_registration_address = models.TextField("адрес регистрации", blank=True, default="")
    fio = models.CharField("ФИО", max_length=400, blank=True, default="")
    phone = models.CharField("телефон", max_length=32, blank=True, default="")
    account_type = models.CharField(
        "тип аккаунта",
        max_length=24,
        blank=True,
        default="individual",
        db_index=True,
    )
    telegram_id = models.BigIntegerField("Telegram user id", null=True, blank=True, unique=True)
    oauth_google_sub = models.CharField(
        "Google account sub",
        max_length=255,
        blank=True,
        null=True,
        db_index=True,
    )
    oauth_vk_user_id = models.CharField(
        "VK ID user id",
        max_length=64,
        blank=True,
        null=True,
        db_index=True,
    )
    # Дополнительный пользователь, входящий в тот же договор/аккаунт что и владелец (отдельная учётная запись).
    account_owner = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="account_additional_users",
        verbose_name="владелец аккаунта",
    )

    EMAIL_FIELD = "email"
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    @classmethod
    def generate_public_id(cls):
        while True:
            candidate = secrets.token_hex(4)[:7]
            if not cls._default_manager.filter(public_id=candidate).exists():
                return candidate

    def save(self, *args, **kwargs):
        if not self.public_id:
            self.public_id = self.generate_public_id()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        """
        Возвращаем человекопонятное представление пользователя.
        Username может быть пустым, поэтому безопасно подставляем email.
        """
        return self.username or self.email


class WebAuthnCredential(models.Model):
    """Сохранённый WebAuthn / Passkey для входа без пароля."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="webauthn_credentials",
    )
    credential_id = models.BinaryField(unique=True)
    public_key = models.BinaryField()
    sign_count = models.PositiveBigIntegerField(default=0)
    transports = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"WebAuthnCredential({self.id}) user={self.user_id}"


class SupportTicket(models.Model):
    """Обращение пользователя в поддержку из ЛК (список в хабе поддержки)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="support_tickets",
    )
    type_slug = models.CharField(max_length=64)
    target_key = models.CharField(max_length=512, blank=True, default="")
    target_label = models.CharField(max_length=512, blank=True, default="")
    body = models.TextField()
    attachment_names = models.TextField(blank=True, default="")
    is_closed = models.BooleanField(default=False, db_index=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"SupportTicket({self.id}) user={self.user_id}"


class PasswordResetCode(models.Model):
    """Одноразовый цифровой код восстановления пароля (hash в БД, plaintext только в письме)."""

    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="password_reset_codes",
    )
    email = models.EmailField(db_index=True)
    code_hash = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    request_ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["email", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"PasswordResetCode({self.pk}) user={self.user_id}"


class AdminSession(models.Model):
    """Step-up («elevated») сессия админа: пока активна — admin endpoints доступны."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="admin_sessions",
    )
    created_at = models.DateTimeField(default=timezone.now)
    elevated_until = models.DateTimeField()
    confirmed_with = models.CharField(
        max_length=32,
        choices=(
            ("development", "development"),
            ("telegram", "telegram"),
            ("telegram_approval", "telegram_approval"),
            ("webauthn", "webauthn"),
            ("totp", "totp"),
        ),
    )
    created_ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True, default="")
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["user", "revoked_at", "elevated_until"])]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"AdminSession({self.pk}) user={self.user_id}"


class AdminMfaDevice(models.Model):
    """Привязанное к админу устройство второго фактора (пока — Telegram chat).

    Активность одного Telegram-устройства на пользователя enforce'ится в коде:
    при подтверждении нового device ранее активные деактивируются (см. будущий bind flow).
    """

    TYPE_TELEGRAM = "telegram"
    TYPE_CHOICES = ((TYPE_TELEGRAM, "telegram"),)

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="admin_mfa_devices",
    )
    type = models.CharField(max_length=16, choices=TYPE_CHOICES)
    telegram_chat_id = models.CharField(max_length=64, blank=True, default="")
    telegram_username = models.CharField(max_length=64, blank=True, default="")
    is_active = models.BooleanField(default=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["user", "type", "is_active"])]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"AdminMfaDevice({self.pk}) user={self.user_id} type={self.type}"


class AdminMfaChallenge(models.Model):
    """Одноразовый MFA-код для step-up admin elevation.

    В БД храним только хэш кода (``make_password``), raw-код уходит в канал доставки
    (Telegram) и больше нигде не сохраняется.
    """

    CHANNEL_TELEGRAM = "telegram"
    CHANNEL_CHOICES = ((CHANNEL_TELEGRAM, "telegram"),)

    TYPE_TELEGRAM_CODE = "telegram_code"
    TYPE_TELEGRAM_APPROVAL = "telegram_approval"
    TYPE_CHOICES = (
        (TYPE_TELEGRAM_CODE, "telegram_code"),
        (TYPE_TELEGRAM_APPROVAL, "telegram_approval"),
    )

    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_DENIED = "denied"
    STATUS_EXPIRED = "expired"
    STATUS_CHOICES = (
        (STATUS_PENDING, "pending"),
        (STATUS_APPROVED, "approved"),
        (STATUS_DENIED, "denied"),
        (STATUS_EXPIRED, "expired"),
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="admin_mfa_challenges",
    )
    device = models.ForeignKey(
        AdminMfaDevice,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="challenges",
    )
    channel = models.CharField(max_length=16, choices=CHANNEL_CHOICES)
    challenge_type = models.CharField(
        max_length=32,
        choices=TYPE_CHOICES,
        default=TYPE_TELEGRAM_CODE,
        db_index=True,
    )
    status = models.CharField(
        max_length=16,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
        db_index=True,
    )
    code_hash = models.CharField(max_length=256, blank=True, default="")
    callback_nonce_hash = models.CharField(max_length=256, blank=True, default="")
    telegram_message_id = models.CharField(max_length=64, blank=True, default="")
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    denied_at = models.DateTimeField(null=True, blank=True)
    attempts_count = models.PositiveIntegerField(default=0)
    created_ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "channel", "consumed_at", "-created_at"]),
            models.Index(fields=["expires_at"]),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"AdminMfaChallenge({self.pk}) user={self.user_id} channel={self.channel}"


class AdminTelegramBindToken(models.Model):
    """Одноразовый токен привязки Telegram-аккаунта к админу.

    raw-токен уходит в `t.me/<bot>?start=<token>`-ссылку и нигде не сохраняется,
    в БД лежит только хэш (``make_password``). Webhook сравнивает входящий
    `/start <raw>` через ``check_password``, помечает строку ``consumed_at``
    и активирует ``AdminMfaDevice`` с пришедшим ``chat_id``.
    """

    PURPOSE_INITIAL_BIND = "initial_bind"
    PURPOSE_REBIND = "rebind"
    PURPOSE_CHOICES = (
        (PURPOSE_INITIAL_BIND, "initial_bind"),
        (PURPOSE_REBIND, "rebind"),
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="admin_telegram_bind_tokens",
    )
    token_hash = models.CharField(max_length=256)
    purpose = models.CharField(max_length=16, choices=PURPOSE_CHOICES)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "consumed_at", "-created_at"]),
            models.Index(fields=["token_hash"]),
            models.Index(fields=["expires_at"]),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"AdminTelegramBindToken({self.pk}) user={self.user_id} purpose={self.purpose}"


class AdminActionAudit(models.Model):
    """Журнал чувствительных действий админа (включая elevation/revoke)."""

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="admin_actions",
    )
    action = models.CharField(max_length=128)
    target_type = models.CharField(max_length=64, blank=True, default="")
    target_id = models.CharField(max_length=64, blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = [
            models.Index(fields=["actor", "-created_at"]),
            models.Index(fields=["action", "-created_at"]),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"AdminActionAudit({self.pk}) {self.action}"
