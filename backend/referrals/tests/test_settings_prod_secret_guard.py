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


class SettingsProdSecretGuardTests(SimpleTestCase):
    _prod_env_base = {
        "DJANGO_DEBUG": "False",
        "DB_ENGINE": "django.db.backends.postgresql",
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
