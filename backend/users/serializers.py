from django.contrib.auth import get_user_model
from rest_framework import serializers

from referrals.services import ensure_default_owner_project

from .models import CustomUser

User = get_user_model()


def split_fio_string(value: str) -> tuple[str, str, str]:
    """Фамилия, имя, отчество из одной строки «Фамилия Имя Отчество»."""
    s = (value or "").strip()
    if not s:
        return "", "", ""
    parts = s.split()
    if len(parts) == 1:
        return parts[0], "", ""
    if len(parts) == 2:
        return parts[0], parts[1], ""
    return parts[0], parts[1], " ".join(parts[2:])


# ------------------- Регистрация -------------------
class RegisterSerializer(serializers.ModelSerializer):
    # Сделаем username опциональным и уберем валидаторы уникальности на уровне сериализатора
    username = serializers.CharField(required=False, allow_blank=True, validators=[])
    fio = serializers.CharField(required=False, allow_blank=True, max_length=400)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=32)
    site_public_id = serializers.UUIDField(required=False, allow_null=True, write_only=True)
    ref_code = serializers.CharField(required=False, allow_blank=True, write_only=True)
    ref = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta:
        model = CustomUser
        fields = (
            "id",
            "username",
            "email",
            "password",
            "fio",
            "phone",
            "site_public_id",
            "ref_code",
            "ref",
        )
        extra_kwargs = {"password": {"write_only": True}}

    def create(self, validated_data):
        """
        Создание пользователя через стандартную механику Django.
        Это корректно обрабатывает хеширование пароля и будущие расширения модели.
        """
        validated_data.pop("site_public_id", None)
        validated_data.pop("ref_code", None)
        validated_data.pop("ref", None)
        username = validated_data.pop("username", "") or ""
        email = validated_data.pop("email")
        password = validated_data.pop("password")
        fio_raw = (validated_data.pop("fio", None) or "").strip()
        phone_raw = (validated_data.pop("phone", None) or "").strip()

        user = CustomUser(username=username, email=email, **validated_data)
        if fio_raw:
            user.fio = fio_raw
            last_name, first_name, patronymic = split_fio_string(fio_raw)
            user.last_name = last_name
            user.first_name = first_name
            user.patronymic = patronymic
        if phone_raw:
            user.phone = phone_raw
        user.set_password(password)
        user.save()
        ensure_default_owner_project(user)
        return user

# ------------------- Логин -------------------
class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, data):
        email = data.get("email")
        password = data.get("password")

        # Ищем пользователя по email
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            raise serializers.ValidationError("Неверный email или пароль")

        # Проверяем пароль
        if not user.check_password(password):
            raise serializers.ValidationError("Неверный email или пароль")

        data["user"] = user
        return data

# ------------------- Logged-in CTA join (visitor → SiteMembership) -------------------
class SiteCtaJoinSerializer(serializers.Serializer):
    site_public_id = serializers.UUIDField()
    ref_code = serializers.CharField(required=False, allow_blank=True)
    ref = serializers.CharField(required=False, allow_blank=True)


# ------------------- Текущий пользователь -------------------
class CurrentUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = [
            "id",
            "public_id",
            "username",
            "email",
            "phone",
            "account_type",
            "first_name",
            "last_name",
            "patronymic",
            "fio",
            "birth_date",
            "passport_series",
            "passport_number",
            "passport_issued_by",
            "passport_issue_date",
            "passport_registration_address",
            "avatar_data_url",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not (data.get("fio") or "").strip():
            parts = [data.get("last_name"), data.get("first_name"), data.get("patronymic")]
            data["fio"] = " ".join(p for p in parts if p).strip()
        if not (data.get("account_type") or "").strip():
            data["account_type"] = "individual"
        return data


ACCOUNT_TYPE_CHOICES = (
    ("individual", "Физическое лицо"),
    ("sole_proprietor", "Индивидуальный предприниматель"),
    ("legal_entity", "Юридическое лицо"),
)


class CurrentUserProfileUpdateSerializer(serializers.ModelSerializer):
    """Частичное обновление профиля, паспортных данных и фото (data URL)."""

    avatar_data_url = serializers.CharField(required=False, allow_blank=True, max_length=2_500_000)
    email = serializers.EmailField(required=False)
    birth_date = serializers.DateField(required=False, allow_null=True)
    passport_issue_date = serializers.DateField(required=False, allow_null=True)
    fio = serializers.CharField(required=False, allow_blank=True, max_length=400)
    account_type = serializers.ChoiceField(
        choices=ACCOUNT_TYPE_CHOICES,
        required=False,
    )

    class Meta:
        model = CustomUser
        fields = [
            "email",
            "account_type",
            "first_name",
            "last_name",
            "patronymic",
            "fio",
            "birth_date",
            "passport_series",
            "passport_number",
            "passport_issued_by",
            "passport_issue_date",
            "passport_registration_address",
            "avatar_data_url",
        ]

    def update(self, instance, validated_data):
        if "fio" in validated_data:
            raw = validated_data.pop("fio")
            s = raw.strip() if isinstance(raw, str) else ""
            instance.fio = s
            ln, fn, pat = split_fio_string(s)
            instance.last_name = ln
            instance.first_name = fn
            instance.patronymic = pat
        return super().update(instance, validated_data)

    def validate_email(self, value):
        if value is None:
            return value
        s = str(value).strip()
        if not s:
            raise serializers.ValidationError("Укажите корректный email.")
        request = self.context.get("request")
        if request is None:
            return s
        qs = User.objects.filter(email__iexact=s).exclude(pk=request.user.pk)
        if qs.exists():
            raise serializers.ValidationError("Этот email уже занят другим аккаунтом.")
        return s
