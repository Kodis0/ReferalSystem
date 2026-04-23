"""
Test-only Django settings: faster password hashing for `manage.py test` / pytest.

Import production settings first, then override test-specific values.
"""
from __future__ import annotations

from .settings import *  # noqa: F403

# Default PBKDF2 makes hundreds of `create_user()` calls in TestCase suites very slow.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
