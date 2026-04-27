"""
Owner-visible activity log for a Site (LK «История»).
"""

from __future__ import annotations

from typing import Any

from .models import Site, SiteOwnerActivityLog


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
    site: Site,
    actor,
    action: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> None:
    SiteOwnerActivityLog.objects.create(
        site=site,
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        action=action,
        message=message,
        details=details or {},
    )


def _site_settings_fragments(validated: dict[str, Any]) -> list[str]:
    parts: list[str] = []
    if "allowed_origins" in validated or "origin" in validated:
        parts.append("разрешённые домены (origins)")
    if "platform_preset" in validated:
        parts.append("платформа / CMS")
    if "display_name" in validated or "site_display_name" in validated:
        parts.append("отображаемое имя сайта")
    if "description" in validated or "site_description" in validated:
        parts.append("описание сайта")
    if "site_avatar_data_url" in validated:
        parts.append("аватар сайта")
    if "avatar_data_url" in validated:
        parts.append("аватар проекта")
    if "referral_builder_workspace" in validated:
        parts.append("черновик конструктора реферального блока")
    return parts


def _widget_settings_fragments(validated: dict[str, Any], *, widget_enabled_value: bool | None) -> list[str]:
    parts: list[str] = []
    if "capture_config" in validated:
        parts.append("поля и селекторы, отправляемые в систему")
    if "config_json" in validated:
        parts.append("конфигурация виджета (JSON)")
    if "widget_enabled" in validated and widget_enabled_value is not None:
        parts.append("виджет включён" if widget_enabled_value else "виджет отключён")
    return parts


def log_integration_patch(
    *,
    site: Site,
    actor,
    validated: dict[str, Any],
    status_reset_to_draft: bool,
) -> None:
    if not validated and not status_reset_to_draft:
        return
    we = validated.get("widget_enabled") if "widget_enabled" in validated else None
    site_fr = _site_settings_fragments(validated)
    widget_fr = _widget_settings_fragments(validated, widget_enabled_value=we)
    if status_reset_to_draft:
        site_fr.append("статус сброшен в черновик (код на сайте не готов)")
    keys = list(validated.keys())
    if site_fr:
        log_site_activity(
            site=site,
            actor=actor,
            action="site_settings",
            message="Изменения настроек сайта: " + "; ".join(site_fr) + ".",
            details={"keys": keys},
        )
    if widget_fr:
        log_site_activity(
            site=site,
            actor=actor,
            action="widget_settings",
            message="Изменения настроек виджета: " + "; ".join(widget_fr) + ".",
            details={"keys": keys},
        )
    if not site_fr and not widget_fr:
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
        message="Сайт проверен: встроенный код найден, статус «Проверен».",
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
        message="Проверка подключения: встроенный код на сайте обнаружен (статус без изменений).",
    )


def log_site_status_refreshed_in_lk(*, site: Site, actor) -> None:
    log_site_activity(
        site=site,
        actor=actor,
        action="status_refresh",
        message="Обновление статуса в кабинете (диагностика и состояние виджета).",
    )


def log_site_member_joined(*, site: Site, actor, joined_via: str) -> None:
    log_site_activity(
        site=site,
        actor=actor,
        action="member_joined",
        message="Новый участник присоединился к программе сайта.",
        details={"joined_via": joined_via},
    )


def serialize_activity_rows(qs) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in qs:
        actor = row.actor
        out.append(
            {
                "id": row.id,
                "at": row.created_at.isoformat(),
                "action": row.action,
                "message": row.message,
                "actor_display": actor_display(actor),
                "details": row.details if isinstance(row.details, dict) else {},
            }
        )
    return out
