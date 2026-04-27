import secrets

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
