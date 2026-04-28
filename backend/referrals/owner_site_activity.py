"""
Owner-visible activity log for a Site (LK «История»).
"""

from __future__ import annotations

from typing import Any

from .models import Site, SiteOwnerActivityLog
from .services_owner_site_shell import site_owner_display_name


def actor_display(user) -> str:
    if user is None:
        return "Система"
    name = (user.get_full_name() or "").strip()
    if name:
        return name
    email = (getattr(user, "email", None) or "").strip()
    if email:
        return email
    return f"Пользователь #{user.pk}"


def log_site_activity(
    *,
    site: Site | None,
    actor,
    action: str,
    message: str,
    details: dict[str, Any] | None = None,
    owner=None,
) -> None:
    """
    Persist an owner-visible log row. Pass ``site`` when the event relates to a site; ``owner`` defaults to ``site.owner``.
    For account-only events (no site), pass ``owner`` explicitly and ``site=None``.
    """
    acct = owner
    if site is not None:
        acct = site.owner
    if acct is None:
        raise ValueError("log_site_activity requires site or owner")
    SiteOwnerActivityLog.objects.create(
        owner=acct,
        site=site,
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        action=action,
        message=message,
        details=details or {},
    )


def log_owner_project_created(*, owner, actor, project_name: str, project_id: int) -> None:
    name = (project_name or "").strip() or "Без названия"
    log_site_activity(
        site=None,
        owner=owner,
        actor=actor,
        action="project_created",
        message=f"Создан проект «{name}».",
        details={"project_id": project_id},
    )


def log_owner_project_updated(*, owner, actor, project_name: str, project_id: int) -> None:
    name = (project_name or "").strip() or "Без названия"
    log_site_activity(
        site=None,
        owner=owner,
        actor=actor,
        action="project_settings",
        message=f"Изменён проект «{name}».",
        details={"project_id": project_id},
    )


def log_owner_project_deleted(*, owner, actor, project_name: str, project_id: int) -> None:
    name = (project_name or "").strip() or "Без названия"
    log_site_activity(
        site=None,
        owner=owner,
        actor=actor,
        action="project_deleted",
        message=f"Проект «{name}» удалён.",
        details={"project_id": project_id},
    )


def log_owner_site_deleted(*, site: Site, actor, via: str) -> None:
    """Call before ``site.delete()`` so the row keeps identifiers in ``details`` after SET_NULL."""
    sid = str(site.public_id)
    log_site_activity(
        site=site,
        actor=actor,
        action="site_deleted",
        message="Сайт удалён.",
        details={"site_public_id": sid, "via": via},
    )


def _site_settings_messages(validated: dict[str, Any], *, status_reset_to_draft: bool) -> list[str]:
    """Короткие формулировки «что за сервис / раздел — что сделали» для ленты владельца."""
    msgs: list[str] = []
    if "allowed_origins" in validated or "origin" in validated:
        msgs.append("Домен: обновлён")
    if "platform_preset" in validated:
        msgs.append("Платформа: изменена")
    if "display_name" in validated or "site_display_name" in validated:
        msgs.append("Имя сайта: изменено")
    if "description" in validated or "site_description" in validated:
        msgs.append("Описание: изменено")
    if "site_avatar_data_url" in validated:
        msgs.append("Аватар сайта: обновлён")
    if "avatar_data_url" in validated:
        msgs.append("Аватар проекта: обновлён")
    if "referral_builder_workspace" in validated:
        msgs.append("Реферальный блок: изменения сохранены")
    if status_reset_to_draft:
        msgs.append("Сайт: сброшен статус публикации")
    return msgs


def _widget_settings_messages(validated: dict[str, Any], *, widget_enabled_value: bool | None) -> list[str]:
    msgs: list[str] = []
    if "capture_config" in validated:
        msgs.append("Форма заявки: изменены поля")
    if "config_json" in validated:
        msgs.append("Виджет: обновлены настройки")
    if "widget_enabled" in validated and widget_enabled_value is not None:
        msgs.append("Виджет: включён" if widget_enabled_value else "Виджет: отключён")
    return msgs


def _join_activity_messages(parts: list[str]) -> str:
    return ". ".join(parts) + "."


def log_integration_patch(
    *,
    site: Site,
    actor,
    validated: dict[str, Any],
    status_reset_to_draft: bool,
) -> None:
    if not validated and not status_reset_to_draft:
        return
    validated = validated or {}
    we = validated.get("widget_enabled") if "widget_enabled" in validated else None
    site_msgs = _site_settings_messages(validated, status_reset_to_draft=status_reset_to_draft)
    widget_msgs = _widget_settings_messages(validated, widget_enabled_value=we)
    keys = list(validated.keys())
    if site_msgs:
        log_site_activity(
            site=site,
            actor=actor,
            action="site_settings",
            message=_join_activity_messages(site_msgs),
            details={"keys": keys},
        )
    if widget_msgs:
        log_site_activity(
            site=site,
            actor=actor,
            action="widget_settings",
            message=_join_activity_messages(widget_msgs),
            details={"keys": keys},
        )
    if not site_msgs and not widget_msgs:
        log_site_activity(
            site=site,
            actor=actor,
            action="integration_patch",
            message="Настройки интеграции обновлены.",
            details={"keys": keys},
        )


def log_site_verified(*, site: Site, actor) -> None:
    log_site_activity(
        site=site,
        actor=actor,
        action="site_verified",
        message="Сайт проверен, код на месте, статус «Проверен».",
    )


def log_site_activated(*, site: Site, actor) -> None:
    log_site_activity(
        site=site,
        actor=actor,
        action="site_activated",
        message="Сайт активирован для приёма заявок.",
    )


def log_site_created_in_project(*, site: Site, actor) -> None:
    log_site_activity(
        site=site,
        actor=actor,
        action="site_created",
        message="Сайт добавлен в проект.",
    )


def log_site_connection_rechecked(*, site: Site, actor) -> None:
    """Успешная повторная проверка подключения (код уже был на сайте, статус не менялся)."""
    log_site_activity(
        site=site,
        actor=actor,
        action="connection_recheck",
        message="Повторная проверка, код на месте, статус без изменений.",
    )


def log_site_status_refreshed_in_lk(*, site: Site, actor) -> None:
    log_site_activity(
        site=site,
        actor=actor,
        action="status_refresh",
        message="Статус в ЛК обновлён (диагностика).",
    )


def log_site_member_joined(*, site: Site, actor, joined_via: str) -> None:
    log_site_activity(
        site=site,
        actor=actor,
        action="member_joined",
        message="Новый участник присоединился к программе сайта.",
        details={"joined_via": joined_via},
    )


# Старые тексты «Изменены X, Y.» (до нормализованных формулировок) — для отображения в API.
_LEGACY_CHANGE_PREFIX = "Изменены "

_LEGACY_FRAGMENT_TO_CANONICAL: dict[str, str] = {
    "домен": "Домен: обновлён",
    "платформа": "Платформа: изменена",
    "имя сайта": "Имя сайта: изменено",
    "описание": "Описание: изменено",
    "аватар сайта": "Аватар сайта: обновлён",
    "аватар проекта": "Аватар проекта: обновлён",
    "черновик блока": "Реферальный блок: изменения сохранены",
    "сброс в черновик": "Сайт: сброшен статус публикации",
    "поля формы": "Форма заявки: изменены поля",
    "JSON виджета": "Виджет: обновлены настройки",
    "виджет включён": "Виджет: включён",
    "виджет отключён": "Виджет: отключён",
}


def normalize_legacy_activity_message(
    _action: str,
    message: str,
    _details: dict[str, Any] | None,
) -> str:
    """
    Подмена устаревших подписей в ленте (в БД остаётся исходная строка).
    """
    raw = (message or "").strip()
    if not raw:
        return raw
    low = raw.lower()
    if "изменения настроек сайта" in low and "черновик" in low:
        return "Реферальный блок: изменения сохранены."
    if "черновик конструктора" in low and "реферальн" in low:
        return "Реферальный блок: изменения сохранены."
    if raw.startswith(_LEGACY_CHANGE_PREFIX):
        inner = raw[len(_LEGACY_CHANGE_PREFIX) :].rstrip(".")
        segments = [s.strip() for s in inner.split(",") if s.strip()]
        if not segments:
            return raw
        out: list[str] = []
        for seg in segments:
            mapped = _LEGACY_FRAGMENT_TO_CANONICAL.get(seg)
            if mapped is None:
                return raw
            out.append(mapped)
        return ". ".join(out) + "."
    return raw


def activity_service_label(row: SiteOwnerActivityLog) -> str:
    """Human label for the «Сервис» column (site name, or account-level bucket)."""
    site = getattr(row, "site", None)
    if site is not None:
        name = site_owner_display_name(site)
        if name:
            return name
        return str(site.public_id)
    d = row.details if isinstance(row.details, dict) else {}
    if d.get("site_public_id"):
        return "Сайт удалён"
    return "Аккаунт"


def serialize_activity_rows(qs) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in qs:
        actor = row.actor
        d = row.details if isinstance(row.details, dict) else {}
        site_public_id = d.get("site_public_id")
        site = getattr(row, "site", None) if row.site_id else None
        if site_public_id is None and site is not None:
            site_public_id = str(site.public_id)
        project_id: int | None = None
        if site is not None and getattr(site, "project_id", None) is not None:
            project_id = site.project_id
        if project_id is None and isinstance(d, dict):
            raw_pid = d.get("project_id")
            if raw_pid is not None:
                try:
                    project_id = int(raw_pid)
                except (TypeError, ValueError):
                    project_id = None
        out.append(
            {
                "id": row.id,
                "at": row.created_at.isoformat(),
                "action": row.action,
                "message": normalize_legacy_activity_message(row.action, row.message, d),
                "actor_display": actor_display(actor),
                "details": d,
                "site_public_id": site_public_id,
                "project_id": project_id,
                "service_label": activity_service_label(row),
            }
        )
    return out
