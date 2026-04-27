"""Verify Google Sign-In JWT (credential / id_token)."""

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token


def verify_google_id_token(credential: str, client_audience: str) -> dict:
    """
    Raises ValueError if the token is invalid, expired, or audience does not match.
    """
    return id_token.verify_oauth2_token(
        credential, google_requests.Request(), client_audience
    )
