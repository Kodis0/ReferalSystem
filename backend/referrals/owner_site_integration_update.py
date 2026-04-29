"""
Apply validated owner PATCH payload to Site (single implementation for view + serializer.save).
"""
from __future__ import annotations

from referrals.models import Site
from referrals.owner_diagnostics import build_embed_readiness
from referrals.owner_site_activity import log_integration_patch
from referrals.services import (
    REFERRAL_BUILDER_WORKSPACE_KEY,
    SITE_CAPTURE_CONFIG_KEY,
    SITE_COMMISSION_PERCENT_CONFIG_KEY,
    SITE_REFERRAL_LOCK_DAYS_CONFIG_KEY,
    SITE_SHELL_AVATAR_CONFIG_KEY,
    SITE_DISPLAY_NAME_CONFIG_KEY,
    SITE_SHELL_DESCRIPTION_CONFIG_KEY,
    create_project_for_site,
    normalize_site_commission_percent,
    normalize_site_referral_lock_days,
    sanitize_site_capture_config,
)


def site_embed_ready(site: Site) -> bool:
    readiness = build_embed_readiness(site)
    return all(bool(v) for v in readiness.values())


def project_metadata_updates_from_owner_payload(data: dict, cfg: dict) -> dict[str, str]:
    updates: dict[str, str] = {}
    if "display_name" in data:
        updates["name"] = (data.get("display_name") or "").strip()
    elif "config_json" in data and "display_name" in cfg:
        raw = cfg.get("display_name")
        updates["name"] = raw.strip() if isinstance(raw, str) else ""

    if "description" in data:
        updates["description"] = (data.get("description") or "").strip()
    elif "config_json" in data and "description" in cfg:
        raw = cfg.get("description")
        updates["description"] = raw.strip() if isinstance(raw, str) else ""

    if "avatar_data_url" in data:
        updates["avatar_data_url"] = (data.get("avatar_data_url") or "").strip()
    elif "config_json" in data and "avatar_data_url" in cfg:
        raw = cfg.get("avatar_data_url")
        updates["avatar_data_url"] = raw.strip() if isinstance(raw, str) else ""

    return updates


def apply_project_metadata_dual_write(
    cfg: dict, *, project_name: str, project_description: str, avatar_data_url: str
) -> None:
    if project_name:
        cfg["display_name"] = project_name
    else:
        cfg.pop("display_name", None)

    if project_description:
        cfg["description"] = project_description
    else:
        cfg.pop("description", None)

    if avatar_data_url:
        cfg["avatar_data_url"] = avatar_data_url
    else:
        cfg.pop("avatar_data_url", None)


def apply_site_owner_integration_update(site: Site, data: dict, *, log_actor=None) -> Site:
    """Mutates and saves ``site`` from integration PATCH ``validated_data``."""
    from referrals.serializers import serialize_owner_project_metadata

    if "allowed_origins" in data:
        site.allowed_origins = data["allowed_origins"]
    elif "origin" in data and data.get("origin"):
        site.allowed_origins = [data["origin"]]
    if "platform_preset" in data:
        site.platform_preset = data["platform_preset"]
    cfg = dict(site.config_json) if isinstance(site.config_json, dict) else {}
    if "config_json" in data:
        incoming = data.get("config_json")
        if isinstance(incoming, dict):
            cfg = {**cfg, **incoming}
    if "site_display_name" in data:
        site_display_name = (data.get("site_display_name") or "").strip()
        if site_display_name:
            cfg[SITE_DISPLAY_NAME_CONFIG_KEY] = site_display_name
        else:
            cfg.pop(SITE_DISPLAY_NAME_CONFIG_KEY, None)
    elif "display_name" in data:
        dn = (data.get("display_name") or "").strip()
        if dn:
            cfg[SITE_DISPLAY_NAME_CONFIG_KEY] = dn
        else:
            cfg.pop(SITE_DISPLAY_NAME_CONFIG_KEY, None)
    if "capture_config" in data:
        cfg[SITE_CAPTURE_CONFIG_KEY] = sanitize_site_capture_config(data.get("capture_config"))
    elif "config_json" in data and SITE_CAPTURE_CONFIG_KEY in cfg:
        cfg[SITE_CAPTURE_CONFIG_KEY] = sanitize_site_capture_config(cfg.get(SITE_CAPTURE_CONFIG_KEY))
    if "site_avatar_data_url" in data:
        site_avatar = (data.get("site_avatar_data_url") or "").strip()
        if site_avatar:
            cfg[SITE_SHELL_AVATAR_CONFIG_KEY] = site_avatar
        else:
            cfg.pop(SITE_SHELL_AVATAR_CONFIG_KEY, None)
    if "site_description" in data:
        site_desc = (data.get("site_description") or "").strip()
        if site_desc:
            cfg[SITE_SHELL_DESCRIPTION_CONFIG_KEY] = site_desc
        else:
            cfg.pop(SITE_SHELL_DESCRIPTION_CONFIG_KEY, None)
    elif "description" in data:
        site_desc = (data.get("description") or "").strip()
        if site_desc:
            cfg[SITE_SHELL_DESCRIPTION_CONFIG_KEY] = site_desc
        else:
            cfg.pop(SITE_SHELL_DESCRIPTION_CONFIG_KEY, None)
    if "commission_percent" in data:
        cfg[SITE_COMMISSION_PERCENT_CONFIG_KEY] = str(normalize_site_commission_percent(data["commission_percent"]))
    if "referral_lock_days" in data:
        cfg[SITE_REFERRAL_LOCK_DAYS_CONFIG_KEY] = normalize_site_referral_lock_days(data["referral_lock_days"])
    if "referral_builder_workspace" in data:
        wb = data.get("referral_builder_workspace")
        if wb is None or wb == {}:
            cfg.pop(REFERRAL_BUILDER_WORKSPACE_KEY, None)
        elif isinstance(wb, dict):
            cfg[REFERRAL_BUILDER_WORKSPACE_KEY] = wb
    data_for_project = {k: v for k, v in data.items() if k not in ("display_name", "description", "site_description")}
    project_updates = project_metadata_updates_from_owner_payload(data_for_project, cfg)
    project = None
    if project_updates or "config_json" in data or "referral_builder_workspace" in data:
        project = create_project_for_site(site)
    if project_updates and project is not None:
        for field, value in project_updates.items():
            setattr(project, field, value)
        project.save(update_fields=[*project_updates.keys()])
    current_project_meta = (
        serialize_owner_project_metadata(site)
        if project is not None or site.project_id
        else {"name": "", "description": "", "avatar_data_url": ""}
    )
    project_name = project_updates.get("name", current_project_meta["name"])
    project_description = project_updates.get("description", current_project_meta["description"])
    project_avatar_data_url = project_updates.get("avatar_data_url", current_project_meta["avatar_data_url"])
    if (
        "config_json" in data
        or "capture_config" in data
        or "site_display_name" in data
        or "display_name" in data
        or "description" in data
        or "site_description" in data
        or "commission_percent" in data
        or "referral_lock_days" in data
        or "referral_builder_workspace" in data
        or project_updates
    ):
        apply_project_metadata_dual_write(
            cfg,
            project_name=project_name,
            project_description=project_description,
            avatar_data_url=project_avatar_data_url,
        )
        site.config_json = cfg
    elif "site_avatar_data_url" in data:
        site.config_json = cfg
    if "widget_enabled" in data:
        site.widget_enabled = data["widget_enabled"]
    if "verification_url" in data:
        raw_v = (data.get("verification_url") or "").strip()[:2048]
        prev_v = (site.verification_url or "").strip()
        site.verification_url = raw_v
        if raw_v != prev_v:
            site.verification_status = Site.VerificationStatus.NOT_STARTED
            site.last_verification_error = ""
    update_fields = [
        "allowed_origins",
        "platform_preset",
        "config_json",
        "widget_enabled",
        "updated_at",
    ]
    if "verification_url" in data:
        update_fields.extend(["verification_url", "verification_status", "last_verification_error"])
    if not site_embed_ready(site) and site.status != Site.Status.DRAFT:
        site.status = Site.Status.DRAFT
        site.verified_at = None
        site.activated_at = None
        update_fields.extend(["status", "verified_at", "activated_at"])
    site.save(update_fields=update_fields)
    if log_actor is not None:
        log_integration_patch(
            site=site,
            actor=log_actor,
            validated=data,
            status_reset_to_draft="status" in update_fields,
        )
    return site
