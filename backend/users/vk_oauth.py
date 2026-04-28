"""VK ID OAuth 2.0 (authorization code): token exchange; email from access_token response."""

from __future__ import annotations

import logging
from typing import Any

import requests

logger = logging.getLogger(__name__)

VK_TOKEN_URL = "https://oauth.vk.com/access_token"


def exchange_vk_oauth_code(
    *,
    code: str,
    app_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict[str, Any]:
    """
    Exchange a one-time OAuth `code` for access_token JSON.
    When `scope` included `email`, the response may contain `email`.
    """
    resp = requests.get(
        VK_TOKEN_URL,
        params={
            "client_id": app_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "code": code,
        },
        timeout=25,
    )
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict):
        raise ValueError("vk_token_not_json")
    if data.get("error"):
        logger.warning(
            "VK token endpoint error: %s",
            data.get("error_description", data.get("error")),
        )
        raise ValueError("vk_token_error")
    return data
