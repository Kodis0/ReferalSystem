import secrets

from django.contrib.auth.models import AbstractUser
from django.db import models


class CustomUser(AbstractUser):
    email = models.EmailField(unique=True)
    is_verified = models.BooleanField(default=False)
    username = models.CharField(max_length=150, unique=False, blank=True, null=True)
    public_id = models.CharField(max_length=7, unique=True, blank=True, editable=False)

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
