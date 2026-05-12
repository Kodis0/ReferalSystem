from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import AdminActionAudit, CustomUser, SupportTicket

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
    oauth_providers = serializers.SerializerMethodField()

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
            "is_staff",
            "is_superuser",
            "oauth_providers",
        ]
        read_only_fields = ["is_staff", "is_superuser"]

    def get_oauth_providers(self, obj: CustomUser) -> dict:
        vk_id = (getattr(obj, "oauth_vk_user_id", None) or "").strip()
        g_sub = (getattr(obj, "oauth_google_sub", None) or "").strip()
        return {
            "vk": {"linked": bool(vk_id)},
            "telegram": {"linked": obj.telegram_id is not None},
            "google": {"linked": bool(g_sub)},
        }

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not (data.get("fio") or "").strip():
            parts = [data.get("last_name"), data.get("first_name"), data.get("patronymic")]
            data["fio"] = " ".join(p for p in parts if p).strip()
        if not (data.get("account_type") or "").strip():
            data["account_type"] = "individual"
        return data


class AdminUserListItemSerializer(serializers.ModelSerializer):
    """Краткое представление пользователя для админ-списка `/users/admin/users/` (read-only)."""

    account_owner_id = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = CustomUser
        fields = [
            "id",
            "public_id",
            "email",
            "fio",
            "phone",
            "account_type",
            "is_active",
            "is_staff",
            "is_superuser",
            "account_owner_id",
            "date_joined",
            "last_login",
        ]
        read_only_fields = fields


class AdminUserDetailSerializer(serializers.ModelSerializer):
    """Подробное представление пользователя для админ-кабинета `/users/admin/users/<id>/` (read-only).

    Считаемые поля выдают агрегаты по связанным сущностям (доп. пользователи аккаунта,
    проекты, сайты, партнёрский профиль). Импорты `referrals.*` локальные — чтобы избежать
    циклов и не падать при отсутствии модели/менеджера.
    """

    account_owner_id = serializers.PrimaryKeyRelatedField(read_only=True)
    additional_users_count = serializers.SerializerMethodField()
    owned_projects_count = serializers.SerializerMethodField()
    owned_sites_count = serializers.SerializerMethodField()
    partner_profile = serializers.SerializerMethodField()

    class Meta:
        model = CustomUser
        fields = [
            "id",
            "public_id",
            "email",
            "username",
            "fio",
            "phone",
            "account_type",
            "is_active",
            "is_staff",
            "is_superuser",
            "account_owner_id",
            "date_joined",
            "last_login",
            "additional_users_count",
            "owned_projects_count",
            "owned_sites_count",
            "partner_profile",
        ]
        read_only_fields = fields

    def get_additional_users_count(self, obj: CustomUser) -> int:
        return CustomUser.objects.filter(account_owner=obj).count()

    def get_owned_projects_count(self, obj: CustomUser) -> int:
        try:
            from referrals.models import Project
        except Exception:
            return 0
        return Project.objects.filter(owner=obj).count()

    def get_owned_sites_count(self, obj: CustomUser) -> int:
        try:
            from referrals.models import Site
        except Exception:
            return 0
        manager = getattr(Site, "all_objects", None) or Site.objects
        return manager.filter(owner=obj).count()

    def get_partner_profile(self, obj: CustomUser):
        try:
            from referrals.models import PartnerProfile
        except Exception:
            return None
        profile = getattr(obj, "partner_profile", None)
        if profile is None:
            try:
                profile = PartnerProfile.objects.get(user=obj)
            except PartnerProfile.DoesNotExist:
                return None
            except Exception:
                return None
        return {
            "id": profile.pk,
            "status": profile.status,
            "balance_available": str(profile.balance_available),
            "balance_total": str(profile.balance_total),
            "commission_percent": str(profile.commission_percent),
        }


class AdminSupportTicketListItemSerializer(serializers.ModelSerializer):
    """Краткое представление обращения в поддержку для админ-списка `/users/admin/support-tickets/`."""

    user_id = serializers.IntegerField(source="user.id", read_only=True)
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_public_id = serializers.CharField(source="user.public_id", read_only=True)

    class Meta:
        model = SupportTicket
        fields = [
            "id",
            "user_id",
            "user_email",
            "user_public_id",
            "type_slug",
            "target_label",
            "is_closed",
            "closed_at",
            "created_at",
        ]
        read_only_fields = fields


class AdminSupportTicketDetailSerializer(AdminSupportTicketListItemSerializer):
    """Подробное представление обращения для админ-детали `/users/admin/support-tickets/<uuid>/`."""

    class Meta(AdminSupportTicketListItemSerializer.Meta):
        fields = AdminSupportTicketListItemSerializer.Meta.fields + [
            "target_key",
            "body",
            "attachment_names",
        ]
        read_only_fields = fields


class AdminActionAuditListItemSerializer(serializers.ModelSerializer):
    """Краткое представление журнала действий админа для `/users/admin/action-audits/` (read-only).

    `metadata_summary` — первые до 5 ключей `metadata` (компактный вид для таблицы),
    `user_agent` — обрезан до 80 символов. Полные значения — в detail-сериализаторе.
    """

    actor_id = serializers.IntegerField(source="actor.id", read_only=True, default=None)
    actor_email = serializers.EmailField(source="actor.email", read_only=True, default="")
    metadata_summary = serializers.SerializerMethodField()
    user_agent = serializers.SerializerMethodField()

    class Meta:
        model = AdminActionAudit
        fields = [
            "id", "actor_id", "actor_email",
            "action", "target_type", "target_id",
            "metadata_summary", "ip_address", "user_agent", "created_at",
        ]
        read_only_fields = fields

    def get_metadata_summary(self, obj):
        try:
            data = obj.metadata or {}
            keys = list(data.keys())[:5]
            summary = {k: data[k] for k in keys}
            return summary
        except Exception:
            return {}

    def get_user_agent(self, obj):
        ua = obj.user_agent or ""
        if len(ua) <= 80:
            return ua
        return ua[:77] + "..."


class AdminActionAuditDetailSerializer(serializers.ModelSerializer):
    """Подробное представление журнала действий админа для `/users/admin/action-audits/<id>/` (read-only)."""

    actor_id = serializers.IntegerField(source="actor.id", read_only=True, default=None)
    actor_email = serializers.EmailField(source="actor.email", read_only=True, default="")

    class Meta:
        model = AdminActionAudit
        fields = [
            "id", "actor_id", "actor_email",
            "action", "target_type", "target_id",
            "metadata", "ip_address", "user_agent", "created_at",
        ]
        read_only_fields = fields


class AccountAdditionalUserSerializer(serializers.ModelSerializer):
    """Краткое представление дополнительного пользователя аккаунта (без паспортных полей)."""

    class Meta:
        model = CustomUser
        fields = [
            "public_id",
            "email",
            "username",
            "fio",
            "first_name",
            "last_name",
            "patronymic",
            "is_active",
            "date_joined",
        ]


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
