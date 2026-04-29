"""Owner-facing site shell metadata derived from Site.config_json (no DB writes)."""
from __future__ import annotations

from typing import Mapping
from urllib.parse import urlparse

from .models import Site

SITE_SHELL_AVATAR_CONFIG_KEY = "site_avatar_data_url"
# True: в ЛК не подставлять внешний favicon; placeholder, пока владелец не загрузит своё.
SITE_SHELL_HIDE_EXTERNAL_FAVICON_CONFIG_KEY = "site_shell_hide_external_favicon"
SITE_DISPLAY_NAME_CONFIG_KEY = "site_display_name"
SITE_SHELL_DESCRIPTION_CONFIG_KEY = "site_description"
# Owner-only draft for LK «Блок для сайта» (visual import + inserted builder blocks). Not used by the embed widget.
REFERRAL_BUILDER_WORKSPACE_KEY = "referral_builder_workspace"


def site_shell_avatar_data_url(site: Site) -> str:
    """Owner UI avatar for a Site (stored on Site only; does not change Project.avatar)."""
    cfg = site.config_json if isinstance(site.config_json, Mapping) else {}
    raw = cfg.get(SITE_SHELL_AVATAR_CONFIG_KEY)
    return raw.strip() if isinstance(raw, str) else ""


def site_shell_hide_external_favicon(site: Site) -> bool:
    cfg = site.config_json if isinstance(site.config_json, Mapping) else {}
    return cfg.get(SITE_SHELL_HIDE_EXTERNAL_FAVICON_CONFIG_KEY) is True


def owner_project_metadata_from_site(site: Site) -> dict[str, str]:
    cfg = site.config_json if isinstance(site.config_json, Mapping) else {}
    name = cfg.get("display_name")
    description = cfg.get("description")
    avatar_data_url = cfg.get("avatar_data_url")
    return {
        "name": name.strip() if isinstance(name, str) else "",
        "description": description.strip() if isinstance(description, str) else "",
        "avatar_data_url": avatar_data_url.strip()
        if isinstance(avatar_data_url, str)
        else "",
    }


def site_owner_shell_description(site: Site) -> str:
    cfg = site.config_json if isinstance(site.config_json, Mapping) else {}
    raw = cfg.get(SITE_SHELL_DESCRIPTION_CONFIG_KEY)
    return raw.strip()[:2000] if isinstance(raw, str) and raw.strip() else ""


def site_owner_display_name(site: Site) -> str:
    cfg = site.config_json if isinstance(site.config_json, Mapping) else {}
    raw = cfg.get(SITE_DISPLAY_NAME_CONFIG_KEY)
    if isinstance(raw, str) and raw.strip():
        return raw.strip()[:200]
    project = getattr(site, "project", None)
    if project is not None and isinstance(project.name, str) and project.name.strip():
        return project.name.strip()[:200]
    origins = site.allowed_origins if isinstance(site.allowed_origins, list) else []
    for origin in origins:
        if not isinstance(origin, str) or not origin.strip():
            continue
        try:
            parsed = urlparse(origin.strip() if "://" in origin else f"https://{origin.strip()}")
        except Exception:
            parsed = None
        host = parsed.hostname if parsed is not None else ""
        if host:
            return host[:200]
    return ""
