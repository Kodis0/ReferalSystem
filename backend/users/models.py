import secrets
import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models


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
