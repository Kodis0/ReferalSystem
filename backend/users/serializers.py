from rest_framework import serializers
from .models import CustomUser
from django.contrib.auth import get_user_model

User = get_user_model()

# ------------------- Регистрация -------------------
class RegisterSerializer(serializers.ModelSerializer):
    # Сделаем username опциональным и уберем валидаторы уникальности на уровне сериализатора
    username = serializers.CharField(required=False, allow_blank=True, validators=[])
    site_public_id = serializers.UUIDField(required=False, allow_null=True, write_only=True)
    ref_code = serializers.CharField(required=False, allow_blank=True, write_only=True)
    ref = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta:
        model = CustomUser
        fields = ('id', 'username', 'email', 'password', 'site_public_id', 'ref_code', 'ref')
        extra_kwargs = {'password': {'write_only': True}}

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

        user = CustomUser(username=username, email=email, **validated_data)
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
    class Meta:
        model = CustomUser
        fields = ['id', 'username', 'email', 'first_name', 'last_name']  # любые поля для фронта
