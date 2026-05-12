"""Step-up MFA permission для admin endpoints.

Применяется ПОСЛЕ ``IsAuthenticated``/``IsAdminUser``: если у staff нет активной
``AdminSession`` (revoked/expired/отсутствует) — отдаём 403 с кодом
``ADMIN_MFA_REQUIRED`` (frontend по этому коду показывает MFA gate).
"""

from django.utils import timezone
from rest_framework import exceptions, status
from rest_framework.permissions import BasePermission


class AdminMfaRequired(exceptions.APIException):
    """Stable shape: ``{"detail": "...", "code": "ADMIN_MFA_REQUIRED"}`` со статусом 403.

    `detail` передаём как dict — DRF сериализует его как тело ответа.
    """

    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "Требуется дополнительное подтверждение администратора"
    default_code = "ADMIN_MFA_REQUIRED"

    def __init__(self, detail=None, code=None):
        super().__init__(
            detail={
                "detail": detail or self.default_detail,
                "code": code or self.default_code,
            }
        )


class HasFreshAdminSession(BasePermission):
    """Допускает запрос только если у staff-пользователя есть активная ``AdminSession``."""

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated or not user.is_staff:
            return False
        from .models import AdminSession

        now = timezone.now()
        exists = AdminSession.objects.filter(
            user=user,
            revoked_at__isnull=True,
            elevated_until__gt=now,
        ).exists()
        if not exists:
            raise AdminMfaRequired()
        return True
