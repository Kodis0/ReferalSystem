"""
STAB-002: subprocess coverage for core.settings fail-fast when DJANGO_DEBUG=False
and SECRET_KEY is empty or the insecure default placeholder.

Uses a fresh interpreter so core.settings is evaluated with controlled env vars
(and is not confused with test_settings already loaded in the Django test process).
Unset DJANGO_SECRET_KEY is not asserted here: _load_env(backend/.env) may set it before SECRET_KEY is read.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from django.test import SimpleTestCase

_BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _run_import_core_settings(extra_env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    """Import core.settings in a child process with env based on os.environ + extra_env."""
    code = f"""
import sys
sys.path.insert(0, {repr(str(_BACKEND_ROOT))})
import os
os.chdir({repr(str(_BACKEND_ROOT))})
try:
    import core.settings  # noqa: F401
except Exception as exc:
    sys.stderr.write(type(exc).__name__ + "\\n")
    sys.stderr.write(str(exc) + "\\n")
    sys.exit(2)
sys.stdout.write("IMPORT_OK\\n")
"""
    full_env = os.environ.copy()
    full_env.update(extra_env)
    full_env.pop("DJANGO_SETTINGS_MODULE", None)
    return subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=60,
        env=full_env,
        cwd=str(_BACKEND_ROOT),
        check=False,
    )


def _run_print_core_cache_settings(extra_env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    """Import core.settings in a child process and print the configured default cache."""
    code = f"""
import sys
sys.path.insert(0, {repr(str(_BACKEND_ROOT))})
import os
os.chdir({repr(str(_BACKEND_ROOT))})
try:
    from core import settings
except Exception as exc:
    sys.stderr.write(type(exc).__name__ + "\\n")
    sys.stderr.write(str(exc) + "\\n")
    sys.exit(2)
cache_conf = settings.CACHES["default"]
sys.stdout.write(cache_conf["BACKEND"] + "\\n")
sys.stdout.write(cache_conf.get("LOCATION", "") + "\\n")
"""
    full_env = os.environ.copy()
    full_env.update(extra_env)
    full_env.pop("DJANGO_SETTINGS_MODULE", None)
    return subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=60,
        env=full_env,
        cwd=str(_BACKEND_ROOT),
        check=False,
    )


class SettingsProdSecretGuardTests(SimpleTestCase):
    _prod_env_base = {
        "DJANGO_DEBUG": "False",
        "DB_ENGINE": "django.db.backends.postgresql",
        "DJANGO_CACHE_BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "DJANGO_CACHE_LOCATION": "django_cache",
    }

    def test_debug_false_empty_secret_fails_fast(self) -> None:
        env = {
            **self._prod_env_base,
            "DJANGO_SECRET_KEY": "",
        }
        cp = _run_import_core_settings(env)
        self.assertEqual(cp.returncode, 2, (cp.stdout, cp.stderr))
        err = cp.stdout + cp.stderr
        self.assertIn("ImproperlyConfigured", err)
        self.assertIn("DJANGO_SECRET_KEY", err)

    def test_debug_false_explicit_placeholder_secret_fails_fast(self) -> None:
        """Literal insecure default (same string as getenv fallback when env var is unset)."""
        env = {
            **self._prod_env_base,
            "DJANGO_SECRET_KEY": "django-insecure-change-me-in-env",
        }
        cp = _run_import_core_settings(env)
        self.assertEqual(cp.returncode, 2, (cp.stdout, cp.stderr))
        err = cp.stdout + cp.stderr
        self.assertIn("ImproperlyConfigured", err)

    def test_debug_false_strong_secret_import_ok(self) -> None:
        env = {
            **self._prod_env_base,
            "DJANGO_SECRET_KEY": "x" * 50,
        }
        cp = _run_import_core_settings(env)
        self.assertEqual(cp.returncode, 0, (cp.stdout, cp.stderr))
        self.assertIn("IMPORT_OK", cp.stdout)


class SettingsCacheBackendTests(SimpleTestCase):
    _prod_env_base = {
        "DJANGO_DEBUG": "False",
        "DB_ENGINE": "django.db.backends.postgresql",
        "DJANGO_SECRET_KEY": "x" * 50,
    }

    def test_cache_env_configures_database_cache_for_password_reset_captcha(self) -> None:
        """Password reset captcha uses default cache, so production config must be shared."""
        env = {
            **self._prod_env_base,
            "DJANGO_CACHE_BACKEND": "django.core.cache.backends.db.DatabaseCache",
            "DJANGO_CACHE_LOCATION": "django_cache",
        }
        cp = _run_print_core_cache_settings(env)
        self.assertEqual(cp.returncode, 0, (cp.stdout, cp.stderr))
        self.assertEqual(
            cp.stdout.splitlines(),
            ["django.core.cache.backends.db.DatabaseCache", "django_cache"],
        )

    def test_debug_false_locmem_cache_fails_fast_for_password_reset_captcha(self) -> None:
        env = {
            **self._prod_env_base,
            "DJANGO_CACHE_BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "DJANGO_CACHE_LOCATION": "lumo-referral-local",
        }
        cp = _run_import_core_settings(env)
        self.assertEqual(cp.returncode, 2, (cp.stdout, cp.stderr))
        err = cp.stdout + cp.stderr
        self.assertIn("LocMemCache", err)
        self.assertIn("password reset captcha", err)
        self.assertIn("Gunicorn workers", err)
