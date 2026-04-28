AUTH_USER_MODEL = "users.CustomUser"

import os
from pathlib import Path
from datetime import timedelta

from django.core.exceptions import ImproperlyConfigured

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/

# Lightweight .env loader to avoid extra dependencies.
def _load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env(BASE_DIR / ".env")

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.getenv(
    "DJANGO_SECRET_KEY",
    "django-insecure-change-me-in-env",
)

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.getenv("DJANGO_DEBUG", "True").lower() == "true"

ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost").split(",")
    if host.strip()
]

_cors_raw = os.getenv("DJANGO_CORS_ALLOWED_ORIGINS", "").strip()
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
# Browser widget `data-rs-api` base (public `/public/v1/`). If empty, install API falls back to request host.
PUBLIC_API_BASE = os.getenv("PUBLIC_API_BASE", "").strip().rstrip("/")
if _cors_raw:
    CORS_ALLOWED_ORIGINS = [
        x.strip() for x in _cors_raw.split(",") if x.strip()
    ]
else:
    CORS_ALLOWED_ORIGINS = [FRONTEND_URL]

# Third-party landing pages that POST /referrals/capture/ with credentials (also checked in
# referrals.services.referral_capture_origin_allowed via CORS_ALLOWED_ORIGINS).
REFERRAL_CAPTURE_PUBLIC_ORIGINS = [
    "https://project17993236.tilda.ws",
]
for _o in REFERRAL_CAPTURE_PUBLIC_ORIGINS:
    if _o not in CORS_ALLOWED_ORIGINS:
        CORS_ALLOWED_ORIGINS = list(CORS_ALLOWED_ORIGINS) + [_o]

# Needed so the SPA can send `credentials: 'include'` for referral session capture.
CORS_ALLOW_CREDENTIALS = True

from corsheaders.defaults import default_headers

# Custom headers on owner API (e.g. diagnostics activity refresh); required for browser preflight.
CORS_ALLOW_HEADERS = list(default_headers) + [
    "x-site-owner-activity-refresh",
]

# Browser widgets call `/public/v1/...` from arbitrary landing origins listed on each `Site`.
# Those endpoints set their own `Access-Control-*` headers from `Site.allowed_origins`.
# Exclude them from django-cors-headers so OPTIONS preflight is answered by our views
# (otherwise a new Tilda/custom domain must be duplicated in DJANGO_CORS_ALLOWED_ORIGINS).
CORS_URLS_REGEX = r"^/(?!public/v1/).*$"

_csrf_raw = os.getenv("DJANGO_CSRF_TRUSTED_ORIGINS", "").strip()
if _csrf_raw:
    CSRF_TRUSTED_ORIGINS = [
        x.strip() for x in _csrf_raw.split(",") if x.strip()
    ]

if not DEBUG:
    SESSION_COOKIE_SECURE = True
    # Cross-origin POST with credentials (e.g. Tilda -> api.*) requires SameSite=None; browsers
    # require Secure=True for SameSite=None (set above).
    SESSION_COOKIE_SAMESITE = "None"
    CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    USE_X_FORWARDED_HOST = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"


# Application definition

INSTALLED_APPS = [
    'users',
    'referrals',
    'corsheaders',
    'rest_framework',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'core.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_RENDERER_CLASSES': (
        'rest_framework.renderers.JSONRenderer',
    ),
}

WSGI_APPLICATION = 'core.wsgi.application'


# Database
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases

DB_ENGINE = os.getenv("DB_ENGINE", "django.db.backends.sqlite3")


def _sqlite_db_path() -> Path:
    """Resolve SQLite file path relative to BASE_DIR so cwd (repo root vs backend/) does not split DBs."""
    raw = os.getenv("DB_NAME", "").strip()
    if not raw:
        return BASE_DIR / "db.sqlite3"
    p = Path(raw)
    return p if p.is_absolute() else (BASE_DIR / p)


if DB_ENGINE == "django.db.backends.sqlite3":
    DATABASES = {
        "default": {
            "ENGINE": DB_ENGINE,
            "NAME": _sqlite_db_path(),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": DB_ENGINE,
            "NAME": os.getenv("DB_NAME", "trs_db"),
            "USER": os.getenv("DB_USER", "postgres"),
            "PASSWORD": os.getenv("DB_PASSWORD", "postgres"),
            "HOST": os.getenv("DB_HOST", "localhost"),
            "PORT": os.getenv("DB_PORT", "5432"),
        }
    }

if not DEBUG and DATABASES["default"]["ENGINE"] == "django.db.backends.sqlite3":
    raise ImproperlyConfigured(
        "SQLite must not be used when DJANGO_DEBUG=False. "
        "Set DB_ENGINE=django.db.backends.postgresql and DB_* in backend/.env."
    )

if not DEBUG:
    _secret_key_stripped = (SECRET_KEY or "").strip()
    if not _secret_key_stripped or _secret_key_stripped == "django-insecure-change-me-in-env":
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY must be set to a strong secret when DJANGO_DEBUG=False "
            "(not empty and not the default insecure placeholder). Set it in backend/.env."
        )


# Password validation
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/5.2/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=1000),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
}

# Referral program (MVP)
REFERRAL_ATTRIBUTION_TTL_DAYS = int(os.getenv("REFERRAL_ATTRIBUTION_TTL_DAYS", "30"))
REFERRAL_DEFAULT_COMMISSION_PERCENT = os.getenv("REFERRAL_DEFAULT_COMMISSION_PERCENT", "10.00")
# Tilda webhook: if True, treat orders with amount > 0 as paid for commission when payment
# fields are absent or non-definitive (never overrides explicit unpaid primary status).
REFERRAL_MVP_ASSUME_PAID_IF_AMOUNT_PRESENT = (
    os.getenv("REFERRAL_MVP_ASSUME_PAID_IF_AMOUNT_PRESENT", "False").lower() == "true"
)

# Public widget POST /public/v1/events/leads: suppress duplicate submit attempts within this window.
LEAD_INGEST_DEDUP_WINDOW_SECONDS = int(os.getenv("LEAD_INGEST_DEDUP_WINDOW_SECONDS", "120"))
# Anonymous rate limits for public lead ingest (DRF SimpleRateThrottle format, e.g. "120/minute").
LEAD_INGEST_THROTTLE_IP = os.getenv("LEAD_INGEST_THROTTLE_IP", "120/minute")
LEAD_INGEST_THROTTLE_SITE = os.getenv("LEAD_INGEST_THROTTLE_SITE", "600/minute")
# Extra structured logs (payload key names only via debug branch). Off by default.
LEAD_INGEST_DEBUG_LOGGING = (
    os.getenv("LEAD_INGEST_DEBUG_LOGGING", "False").lower() == "true"
)
# Test-only: increment in-memory counters for ingest outcomes (never enable in production).
LEAD_INGEST_EXPOSE_COUNTERS = (
    os.getenv("LEAD_INGEST_EXPOSE_COUNTERS", "False").lower() == "true"
)

# LK «Статус сервисов»: optional JSON merged into GET /referrals/platform-service-status/.
# Object keyed by service id: {"lumo-widget": {"ok": false, "message": "…"}}.
# Allowed ids: lumo-owner, lumo-widget, lumo-referral.
PLATFORM_SERVICE_STATUS_OVERRIDES_JSON = os.getenv(
    "PLATFORM_SERVICE_STATUS_OVERRIDES_JSON", ""
).strip()

# Tilda / payment POST webhook at /users/api/orders/
# When non-empty: require X-Order-Webhook-Secret or Authorization: Bearer <same value>.
# When empty: allowed only while DJANGO_DEBUG=True (local/tests); production must set this.
ORDER_WEBHOOK_SHARED_SECRET = os.getenv("ORDER_WEBHOOK_SHARED_SECRET", "").strip()
# Extra ingestion logs (payload key names only, no values). Off by default to avoid noise.
ORDER_WEBHOOK_DEBUG_LOGGING = (
    os.getenv("ORDER_WEBHOOK_DEBUG_LOGGING", "False").lower() == "true"
)

# Google Sign-In (GIS): Web client ID (same value as REACT_APP_GOOGLE_CLIENT_ID on the SPA).
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()

# VK ID (vk.com): App ID = client_id, «Защищённый ключ» = client_secret.
# Callback URL in VK app settings must match .../users/token/vk/callback/
VK_OAUTH_APP_ID = os.getenv("VK_OAUTH_APP_ID", "").strip()
VK_OAUTH_CLIENT_SECRET = os.getenv("VK_OAUTH_CLIENT_SECRET", "").strip()
VK_OAUTH_REDIRECT_URI = os.getenv("VK_OAUTH_REDIRECT_URI", "").strip()
# Права в authorize (пробел в строке). По доке VK ID для почты: email; при необходимости: "email phone"
VK_OAUTH_SCOPE = os.getenv("VK_OAUTH_SCOPE", "email").strip() or "email"
# Тема окна согласия VK ID: light | dark (док. VK ID, параметр scheme)
VK_OAUTH_SCHEME = os.getenv("VK_OAUTH_SCHEME", "dark").strip() or "dark"

# Telegram Login Widget / oauth.telegram.org (тот же токен, что у бота; bot_id = число до «:» в токене).
# В BotFather для бота задайте домен сайта (/setdomain), совпадающий с FRONTEND_URL.
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_LOGIN_REDIRECT_URI = os.getenv("TELEGRAM_LOGIN_REDIRECT_URI", "").strip()
