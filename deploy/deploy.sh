#!/usr/bin/env bash
# Idempotent production deploy. Run on the server from repo app root:
#   bash deploy/deploy.sh
#
# Expected layout (adjust paths via env if needed):
#   /var/www/lumoref/app          — git clone (owned by deploy; group www-data for gunicorn reads)
#   /var/www/lumoref/venv         — Python venv (VENV_PATH)
#   backend/.env                  — production secrets (never committed)
#
# deploy user: SSH + git pull; passwordless sudo only for nginx/systemctl (recommended).
# Gunicorn runs as www-data (see deploy/systemd/lumoref-gunicorn.service).
#
# Env overrides: VENV_PATH, REACT_APP_API_URL, REACT_APP_GOOGLE_CLIENT_ID, NGINX_SITE_NAME, SYSTEMD_UNIT, DEPLOY_MAIN_BRANCH

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${APP_ROOT}"

VENV_PATH="${VENV_PATH:-/var/www/lumoref/venv}"
REACT_APP_API_URL="${REACT_APP_API_URL:-https://api.lumoref.ru}"
# Optional; must match GOOGLE_OAUTH_CLIENT_ID in backend/.env (same Web client ID as in Google Console).
REACT_APP_GOOGLE_CLIENT_ID="${REACT_APP_GOOGLE_CLIENT_ID:-}"
PYTHON="${VENV_PATH}/bin/python"
PIP="${VENV_PATH}/bin/pip"
GUNICORN="${VENV_PATH}/bin/gunicorn"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-lumoref}"
SYSTEMD_UNIT="${SYSTEMD_UNIT:-lumoref-gunicorn.service}"
PLAYWRIGHT_INSTALL_ARGS="${PLAYWRIGHT_INSTALL_ARGS:-chromium}"

if [[ ! -x "${PYTHON}" ]]; then
  echo "Python venv not found at ${VENV_PATH}. Create it and install requirements first." >&2
  exit 1
fi

echo "==> Git: sync to origin (discard local edits to tracked files)"
MAIN_BRANCH="${DEPLOY_MAIN_BRANCH:-main}"
git fetch origin "${MAIN_BRANCH}"
git checkout "${MAIN_BRANCH}"
# Avoid "would be overwritten by merge" when someone edited e.g. deploy.sh on the VPS.
git reset --hard "origin/${MAIN_BRANCH}"

echo "==> Backend: dependencies"
"${PIP}" install -r backend/requirements.txt

echo "==> Backend: Playwright browsers (${PLAYWRIGHT_INSTALL_ARGS})"
"${PYTHON}" -m playwright install ${PLAYWRIGHT_INSTALL_ARGS}

echo "==> Frontend: build (API URL=${REACT_APP_API_URL})"
export REACT_APP_API_URL
printf 'REACT_APP_API_URL=%s\n' "${REACT_APP_API_URL}" > frontend/.env.production
if [[ -n "${REACT_APP_GOOGLE_CLIENT_ID}" ]]; then
  printf 'REACT_APP_GOOGLE_CLIENT_ID=%s\n' "${REACT_APP_GOOGLE_CLIENT_ID}" >> frontend/.env.production
  export REACT_APP_GOOGLE_CLIENT_ID
  echo "    Google Client ID: set for SPA build"
else
  echo "    Google Client ID: not set (SPA built without REACT_APP_GOOGLE_CLIENT_ID)"
fi
(
  cd frontend
  npm ci
  npm run build
)

echo "==> Django: migrate & static"
(
  cd backend
  DJANGO_SETTINGS_MODULE=core.settings "${PYTHON}" manage.py migrate --noinput
  DJANGO_SETTINGS_MODULE=core.settings "${PYTHON}" manage.py collectstatic --noinput
  DB_ENGINE_OUT="$(DJANGO_SETTINGS_MODULE=core.settings "${PYTHON}" manage.py shell -c "from django.conf import settings; print(settings.DATABASES['default']['ENGINE'])")"
  echo "    Django DB engine: ${DB_ENGINE_OUT}"
  if [[ "${DB_ENGINE_OUT}" == *"sqlite3"* ]]; then
    echo "    ERROR: SQLite is active. Production must use PostgreSQL (see backend/.env on server)." >&2
    exit 1
  fi
)

echo "==> Nginx: update site if template changed"
NGINX_SRC="${APP_ROOT}/deploy/nginx/${NGINX_SITE_NAME}.conf"
NGINX_DST="/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf"
if [[ -f "${NGINX_SRC}" ]]; then
  if ! cmp -s "${NGINX_SRC}" "${NGINX_DST}" 2>/dev/null; then
    echo "    Copying nginx site (changed or first install)"
    sudo cp "${NGINX_SRC}" "${NGINX_DST}"
    if [[ ! -L "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf" ]] && [[ ! -e "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf" ]]; then
      sudo ln -s "/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf"
    fi
    sudo nginx -t
    sudo systemctl reload nginx
  else
    echo "    Nginx site unchanged, skip reload"
  fi
else
  echo "    No ${NGINX_SRC}, skip nginx"
fi

echo "==> Gunicorn: restart"
if systemctl is-active --quiet "${SYSTEMD_UNIT}" 2>/dev/null; then
  sudo systemctl restart "${SYSTEMD_UNIT}"
else
  echo "    Unit ${SYSTEMD_UNIT} not active — start manually after first-time setup"
fi

echo "==> Done"
