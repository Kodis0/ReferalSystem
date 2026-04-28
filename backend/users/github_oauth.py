"""GitHub OAuth (authorization code): token exchange and primary email resolution."""

from __future__ import annotations

import logging
from typing import Any

import requests

logger = logging.getLogger(__name__)

GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_EMAILS_URL = "https://api.github.com/user/emails"


def exchange_github_oauth_code(
    *,
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict[str, Any]:
    """
    Exchange a one-time OAuth `code` for an access token.
    Raises requests.HTTPError on non-success.
    """
    resp = requests.post(
        GITHUB_TOKEN_URL,
        headers={"Accept": "application/json"},
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        },
        timeout=25,
    )
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict):
        raise ValueError("github_token_not_json")
    if data.get("error"):
        logger.warning("GitHub token endpoint error: %s", data.get("error_description", data.get("error")))
        raise ValueError("github_token_error")
    return data


def github_primary_verified_email(*, github_access_token: str) -> str | None:
    """
    Return the primary verified email for the authenticated GitHub user, if any.
    """
    resp = requests.get(
        GITHUB_USER_EMAILS_URL,
        headers={
            "Authorization": f"Bearer {github_access_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout=25,
    )
    resp.raise_for_status()
    emails = resp.json()
    if not isinstance(emails, list):
        return None

    primary_verified: str | None = None
    any_verified: str | None = None
    for row in emails:
        if not isinstance(row, dict):
            continue
        email = row.get("email")
        if not email or not isinstance(email, str):
            continue
        email = email.strip()
        if not email:
            continue
        if not row.get("verified"):
            continue
        any_verified = any_verified or email
        if row.get("primary"):
            primary_verified = email

    return primary_verified or any_verified
