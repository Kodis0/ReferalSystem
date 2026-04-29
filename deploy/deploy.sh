#!/usr/bin/env bash
# Idempotent incremental production deploy. Run on the server from repo app root:
#   bash deploy/deploy.sh
#
# Expected layout (adjust paths via env if needed):
#   /var/www/lumoref/app          — git clone (owned by deploy; group www-data for gunicorn reads)
#   /var/www/lumoref/venv         — Python venv (VENV_PATH)
#   backend/.env                  — production secrets (never committed)
#
# Local deploy state (not in git): .deploy-state/
#
# deploy user: SSH + git sync; passwordless sudo only for nginx/systemctl (recommended).
# Gunicorn runs as www-data (see deploy/systemd/lumoref-gunicorn.service).
#
# Env overrides: VENV_PATH, REACT_APP_API_URL, REACT_APP_GOOGLE_CLIENT_ID, NGINX_SITE_NAME, SYSTEMD_UNIT, DEPLOY_MAIN_BRANCH,
# PLAYWRIGHT_INSTALL_ARGS, PLAYWRIGHT_INSTALL_WITH_DEPS, PLAYWRIGHT_BROWSERS_PATH
# FORCE_FULL_DEPLOY, FORCE_FRONTEND_BUILD, FORCE_NPM_CI, FORCE_BACKEND_RESTART, DRY_RUN

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${APP_ROOT}"

DEPLOY_STATE_DIR="${APP_ROOT}/.deploy-state"
VENV_PATH="${VENV_PATH:-/var/www/lumoref/venv}"
REACT_APP_API_URL="${REACT_APP_API_URL:-https://api.lumoref.ru}"
REACT_APP_GOOGLE_CLIENT_ID="${REACT_APP_GOOGLE_CLIENT_ID:-}"
PYTHON="${VENV_PATH}/bin/python"
PIP="${VENV_PATH}/bin/pip"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-lumoref}"
SYSTEMD_UNIT="${SYSTEMD_UNIT:-lumoref-gunicorn.service}"
PLAYWRIGHT_INSTALL_ARGS="${PLAYWRIGHT_INSTALL_ARGS:-chromium}"
PLAYWRIGHT_INSTALL_WITH_DEPS="${PLAYWRIGHT_INSTALL_WITH_DEPS:-0}"
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-${APP_ROOT}/.cache/ms-playwright}"
BACKEND_ENV_FILE="${APP_ROOT}/backend/.env"
MAIN_BRANCH="${DEPLOY_MAIN_BRANCH:-main}"

FORCE_FULL_DEPLOY="${FORCE_FULL_DEPLOY:-0}"
FORCE_FRONTEND_BUILD="${FORCE_FRONTEND_BUILD:-0}"
FORCE_NPM_CI="${FORCE_NPM_CI:-0}"
FORCE_BACKEND_RESTART="${FORCE_BACKEND_RESTART:-0}"
DRY_RUN="${DRY_RUN:-0}"

SUDO_AVAILABLE=0
if sudo -n true 2>/dev/null; then
  SUDO_AVAILABLE=1
fi

sha256_file() {
  if [[ -f "$1" ]]; then
    sha256sum "$1" | awk '{print $1}'
  else
    echo ""
  fi
}

log_section() {
  echo ""
  echo "==> $*"
}

resolve_google_client_id() {
  if [[ -n "${REACT_APP_GOOGLE_CLIENT_ID:-}" ]]; then
    return 0
  fi
  if [[ -f "${BACKEND_ENV_FILE}" ]]; then
    local _gline
    _gline="$(grep -E '^[[:space:]]*GOOGLE_OAUTH_CLIENT_ID=' "${BACKEND_ENV_FILE}" 2>/dev/null | tail -n1 || true)"
    if [[ -n "${_gline}" ]]; then
      REACT_APP_GOOGLE_CLIENT_ID="${_gline#*=}"
      REACT_APP_GOOGLE_CLIENT_ID="${REACT_APP_GOOGLE_CLIENT_ID//$'\r'/}"
      REACT_APP_GOOGLE_CLIENT_ID="${REACT_APP_GOOGLE_CLIENT_ID#\"}"
      REACT_APP_GOOGLE_CLIENT_ID="${REACT_APP_GOOGLE_CLIENT_ID%\"}"
      REACT_APP_GOOGLE_CLIENT_ID="$(printf '%s' "${REACT_APP_GOOGLE_CLIENT_ID}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    fi
  fi
}

frontend_env_sig() {
  resolve_google_client_id
  printf '%s\n' "${REACT_APP_API_URL:-}" "${REACT_APP_GOOGLE_CLIENT_ID:-}" | sha256sum | awk '{print $1}'
}

playwright_browser_present() {
  [[ -d "${PLAYWRIGHT_BROWSERS_PATH}" ]] || return 1
  find "${PLAYWRIGHT_BROWSERS_PATH}" -type f \( -name chrome -o -name chromium -o -name headless_shell \) -perm -111 2>/dev/null | head -1 | grep -q .
}

# Avoid flooding CI logs with thousands of "Permission denied" lines from rm(1).
SAFE_RM_LOG="${SAFE_RM_LOG:-/tmp/lumoref-rm-node-modules.log}"

safe_remove_dir() {
  local path="$1"
  [[ -e "${path}" ]] || return 0
  : > "${SAFE_RM_LOG}"
  if rm -rf "${path}" >>"${SAFE_RM_LOG}" 2>&1; then
    return 0
  fi
  if [[ "${SUDO_AVAILABLE}" == "1" ]]; then
    if sudo -n rm -rf "${path}" >>"${SAFE_RM_LOG}" 2>&1; then
      return 0
    fi
  else
    echo "Cannot remove ${path} due to permissions (passwordless sudo unavailable). Fix ownership, then rerun deploy:" >&2
    echo "  sudo chown -R deploy:deploy ${APP_ROOT}/frontend" >&2
    echo "  sudo rm -rf ${APP_ROOT}/frontend/node_modules" >&2
    echo "  sudo rm -rf ${APP_ROOT}/frontend/build" >&2
    echo "(rm details: ${SAFE_RM_LOG})" >&2
    exit 1
  fi
  echo "Cannot remove ${path} due to permissions. Run:" >&2
  echo "  sudo chown -R deploy:deploy ${APP_ROOT}/frontend" >&2
  echo "  sudo rm -rf ${APP_ROOT}/frontend/node_modules" >&2
  echo "  sudo rm -rf ${APP_ROOT}/frontend/build" >&2
  echo "(rm details: ${SAFE_RM_LOG})" >&2
  exit 1
}

SAFE_CHOWN_LOG="${SAFE_CHOWN_LOG:-/tmp/lumoref-chown-deploy.log}"

safe_chown_deploy_tree() {
  local path="$1"
  [[ -e "${path}" ]] || return 0
  : > "${SAFE_CHOWN_LOG}"
  if chown -R "$(id -un):$(id -gn)" "${path}" >>"${SAFE_CHOWN_LOG}" 2>&1; then
    return 0
  fi
  if [[ "${SUDO_AVAILABLE}" == "1" ]]; then
    if sudo -n chown -R "$(id -un):$(id -gn)" "${path}" >>"${SAFE_CHOWN_LOG}" 2>&1; then
      return 0
    fi
    echo "Cannot chown ${path} (sudo failed). See ${SAFE_CHOWN_LOG}" >&2
    exit 1
  fi
  echo "Cannot chown ${path} due to permissions (passwordless sudo unavailable). Run:" >&2
  echo "  sudo chown -R deploy:deploy ${path}" >&2
  echo "(details: ${SAFE_CHOWN_LOG})" >&2
  exit 1
}

mkdir -p "${DEPLOY_STATE_DIR}"

if [[ "${DRY_RUN}" == "1" ]]; then
  log_section "Dry run (no heavy commands, no git reset; fetch + plan only)"
  git fetch origin "${MAIN_BRANCH}"
  ORIGIN_HEAD="$(git rev-parse "origin/${MAIN_BRANCH}")"
  PRE_SYNC_HEAD="$(git rev-parse HEAD)"
  LAST_SUCCESSFUL="$(tr -d '[:space:]' < "${DEPLOY_STATE_DIR}/last_successful_commit" 2>/dev/null || true)"
  DIFF_BASE=""
  if [[ -n "${LAST_SUCCESSFUL}" ]] && git cat-file -e "${LAST_SUCCESSFUL}^{commit}" 2>/dev/null; then
    if git merge-base --is-ancestor "${LAST_SUCCESSFUL}" "${ORIGIN_HEAD}" 2>/dev/null; then
      DIFF_BASE="${LAST_SUCCESSFUL}"
    fi
  fi
  if [[ -z "${DIFF_BASE}" ]]; then
    DIFF_BASE="${PRE_SYNC_HEAD}"
  fi
  CHANGED_FILES="$(git diff --name-only "${DIFF_BASE}" "${ORIGIN_HEAD}" 2>/dev/null || true)"
  echo "Old commit (diff base): ${DIFF_BASE}"
  echo "Origin ${MAIN_BRANCH} (would become HEAD after reset): ${ORIGIN_HEAD}"
  echo "Changed files (preview):"
  echo "${CHANGED_FILES:-<none>}"
  echo "(Dry run finished — no deploy actions executed.)"
  exit 0
fi

safe_chown_deploy_tree "${DEPLOY_STATE_DIR}"

if [[ ! -x "${PYTHON}" ]]; then
  echo "Python venv not found at ${VENV_PATH}. Create it and install requirements first." >&2
  exit 1
fi

# --- Record HEAD before sync (GitHub Actions may have reset already; diff uses last_successful + this fallback)
PRE_SYNC_HEAD="$(git rev-parse HEAD)"
LAST_SUCCESSFUL="$(tr -d '[:space:]' < "${DEPLOY_STATE_DIR}/last_successful_commit" 2>/dev/null || true)"
FIRST_DEPLOY=0
if [[ -z "${LAST_SUCCESSFUL}" ]] || ! git cat-file -e "${LAST_SUCCESSFUL}^{commit}" 2>/dev/null; then
  FIRST_DEPLOY=1
fi

log_section "Git: sync to origin (discard local edits to tracked files)"
git fetch origin "${MAIN_BRANCH}"
git checkout "${MAIN_BRANCH}"
git reset --hard "origin/${MAIN_BRANCH}"

NEW_COMMIT="$(git rev-parse HEAD)"

echo "Pre-sync HEAD:  ${PRE_SYNC_HEAD}"
echo "New HEAD:       ${NEW_COMMIT}"
echo "Last deployed:  ${LAST_SUCCESSFUL:-<none>}"

if [[ "${FORCE_FULL_DEPLOY}" != "1" ]] && [[ -n "${LAST_SUCCESSFUL}" ]] && [[ "${NEW_COMMIT}" == "${LAST_SUCCESSFUL}" ]]; then
  echo "Already deployed this commit (${NEW_COMMIT}); skipping heavy steps. Use FORCE_FULL_DEPLOY=1 to run everything."
  exit 0
fi

DIFF_BASE=""
if [[ "${FIRST_DEPLOY}" == "1" ]]; then
  DIFF_BASE="${PRE_SYNC_HEAD}"
elif [[ -n "${LAST_SUCCESSFUL}" ]] && git cat-file -e "${LAST_SUCCESSFUL}^{commit}" 2>/dev/null; then
  if git merge-base --is-ancestor "${LAST_SUCCESSFUL}" "${NEW_COMMIT}" 2>/dev/null; then
    DIFF_BASE="${LAST_SUCCESSFUL}"
  else
    echo "    Warning: last_successful_commit is not an ancestor of NEW; using pre-sync HEAD as diff base." >&2
    DIFF_BASE="${PRE_SYNC_HEAD}"
  fi
else
  DIFF_BASE="${PRE_SYNC_HEAD}"
fi

CHANGED_FILES="$(git diff --name-only "${DIFF_BASE}" "${NEW_COMMIT}" 2>/dev/null || true)"
echo ""
echo "--- Deploy diff (${DIFF_BASE} .. ${NEW_COMMIT}) ---"
if [[ -z "${CHANGED_FILES}" ]]; then
  echo "Changed files: <none>"
else
  echo "Changed files:"
  echo "${CHANGED_FILES}"
fi

FRONTEND_CHANGED=false
FRONTEND_DEPS_CHANGED=false
BACKEND_CHANGED=false
BACKEND_DEPS_CHANGED=false
BACKEND_MIGRATIONS_CHANGED=false
DEPLOY_NGINX_CHANGED=false
DEPLOY_SYSTEMD_CHANGED=false
PLAYWRIGHT_RELEVANT_CHANGED=false

if [[ "${FORCE_FULL_DEPLOY}" == "1" ]]; then
  FRONTEND_CHANGED=true
  FRONTEND_DEPS_CHANGED=true
  BACKEND_CHANGED=true
  BACKEND_DEPS_CHANGED=true
  BACKEND_MIGRATIONS_CHANGED=true
  DEPLOY_NGINX_CHANGED=true
  DEPLOY_SYSTEMD_CHANGED=true
  PLAYWRIGHT_RELEVANT_CHANGED=true
else
  if echo "${CHANGED_FILES}" | grep -qE '^frontend/'; then FRONTEND_CHANGED=true; fi
  if echo "${CHANGED_FILES}" | grep -qE '^frontend/package\.json$|^frontend/package-lock\.json$|^package\.json$|^package-lock\.json$'; then
    FRONTEND_DEPS_CHANGED=true
  fi
  if echo "${CHANGED_FILES}" | grep -qE '^backend/'; then BACKEND_CHANGED=true; fi
  if echo "${CHANGED_FILES}" | grep -qE '^backend/requirements\.txt$'; then
    BACKEND_DEPS_CHANGED=true
    PLAYWRIGHT_RELEVANT_CHANGED=true
  fi
  if echo "${CHANGED_FILES}" | grep -qE '^backend/.*/migrations/'; then BACKEND_MIGRATIONS_CHANGED=true; fi
  if echo "${CHANGED_FILES}" | grep -qE '^deploy/nginx/'; then DEPLOY_NGINX_CHANGED=true; fi
  if echo "${CHANGED_FILES}" | grep -qE '^deploy/systemd/'; then DEPLOY_SYSTEMD_CHANGED=true; fi
  if echo "${CHANGED_FILES}" | grep -qE '^deploy/deploy\.sh$'; then PLAYWRIGHT_RELEVANT_CHANGED=true; fi
fi

REQ_HASH="$(sha256_file "${APP_ROOT}/backend/requirements.txt")"
STORED_REQ_HASH="$(cat "${DEPLOY_STATE_DIR}/backend_requirements_hash" 2>/dev/null | tr -d '[:space:]' || true)"
FRONT_LOCK_HASH="$(sha256_file "${APP_ROOT}/frontend/package-lock.json")"
ROOT_LOCK_HASH="$(sha256_file "${APP_ROOT}/package-lock.json")"
STORED_FRONT_LOCK="$(cat "${DEPLOY_STATE_DIR}/frontend_package_lock_hash" 2>/dev/null | tr -d '[:space:]' || true)"
STORED_ROOT_LOCK="$(cat "${DEPLOY_STATE_DIR}/root_package_lock_hash" 2>/dev/null | tr -d '[:space:]' || true)"

resolve_google_client_id
CURRENT_ENV_SIG="$(frontend_env_sig)"
STORED_ENV_SIG="$(cat "${DEPLOY_STATE_DIR}/frontend_build_env.sig" 2>/dev/null | tr -d '[:space:]' || true)"

BACKEND_ENV_HASH=""
if [[ -f "${BACKEND_ENV_FILE}" ]]; then
  BACKEND_ENV_HASH="$(sha256sum "${BACKEND_ENV_FILE}" | awk '{print $1}')"
fi
STORED_BACKEND_ENV_HASH="$(cat "${DEPLOY_STATE_DIR}/backend_env.sha" 2>/dev/null | tr -d '[:space:]' || true)"

BACKEND_ENV_CHANGED=false
if [[ -n "${BACKEND_ENV_HASH}" ]] && [[ -n "${STORED_BACKEND_ENV_HASH}" ]] && [[ "${BACKEND_ENV_HASH}" != "${STORED_BACKEND_ENV_HASH}" ]]; then
  BACKEND_ENV_CHANGED=true
fi
if [[ -z "${STORED_BACKEND_ENV_HASH}" ]] && [[ -f "${BACKEND_ENV_FILE}" ]]; then
  BACKEND_ENV_CHANGED=true
fi

ENV_SIG_CHANGED=false
if [[ -n "${STORED_ENV_SIG}" ]] && [[ "${CURRENT_ENV_SIG}" != "${STORED_ENV_SIG}" ]]; then
  ENV_SIG_CHANGED=true
fi
if [[ -z "${STORED_ENV_SIG}" ]]; then
  ENV_SIG_CHANGED=true
fi

LOCK_HASH_CHANGED=false
if [[ -n "${STORED_FRONT_LOCK}" ]] && [[ "${FRONT_LOCK_HASH}" != "${STORED_FRONT_LOCK}" ]]; then LOCK_HASH_CHANGED=true; fi
if [[ -n "${STORED_ROOT_LOCK}" ]] && [[ -n "${ROOT_LOCK_HASH}" ]] && [[ "${ROOT_LOCK_HASH}" != "${STORED_ROOT_LOCK}" ]]; then LOCK_HASH_CHANGED=true; fi
if [[ -z "${STORED_FRONT_LOCK}" ]]; then LOCK_HASH_CHANGED=true; fi

REQ_HASH_CHANGED=false
if [[ -n "${STORED_REQ_HASH}" ]] && [[ "${REQ_HASH}" != "${STORED_REQ_HASH}" ]]; then REQ_HASH_CHANGED=true; fi
if [[ -z "${STORED_REQ_HASH}" ]]; then REQ_HASH_CHANGED=true; fi

PLAYWRIGHT_MARKER_HASH="$(cat "${DEPLOY_STATE_DIR}/playwright_requirements_hash" 2>/dev/null | tr -d '[:space:]' || true)"

echo ""
echo "Frontend changed:           ${FRONTEND_CHANGED}"
echo "Frontend deps changed:      ${FRONTEND_DEPS_CHANGED}"
echo "Backend changed:            ${BACKEND_CHANGED}"
echo "Backend deps changed:      ${BACKEND_DEPS_CHANGED}"
echo "Backend migrations changed: ${BACKEND_MIGRATIONS_CHANGED}"
echo "deploy/nginx changed:       ${DEPLOY_NGINX_CHANGED}"
echo "deploy/systemd changed:     ${DEPLOY_SYSTEMD_CHANGED}"
echo "Playwright-relevant:        ${PLAYWRIGHT_RELEVANT_CHANGED}"
echo "Frontend env sig changed:   ${ENV_SIG_CHANGED}"
echo "Lock hash changed (state):  ${LOCK_HASH_CHANGED}"
echo "Requirements hash changed:  ${REQ_HASH_CHANGED}"
echo "Backend .env changed:       ${BACKEND_ENV_CHANGED}"
echo "First deploy state:         $([[ "${FIRST_DEPLOY}" == "1" ]] && echo yes || echo no)"

# --- Decide steps
RUN_PIP=false
RUN_PLAYWRIGHT_INSTALL=false
RUN_NPM_CI=false
RUN_BUILD=false
RUN_MIGRATE=false
RUN_COLLECTSTATIC=false
RUN_NGINX=false
RUN_SYSTEMD_UPDATE=false
RUN_GUNICORN_RESTART=false
RUN_PLAYWRIGHT_PERSIST=false

if [[ "${FORCE_FULL_DEPLOY}" == "1" ]] || [[ "${FIRST_DEPLOY}" == "1" ]]; then
  RUN_PIP=true
  RUN_PLAYWRIGHT_INSTALL=true
  RUN_NPM_CI=true
  RUN_BUILD=true
  RUN_MIGRATE=true
  RUN_COLLECTSTATIC=true
  RUN_NGINX=true
  RUN_SYSTEMD_UPDATE=true
  RUN_GUNICORN_RESTART=true
  RUN_PLAYWRIGHT_PERSIST=true
else
  if [[ "${BACKEND_DEPS_CHANGED}" == true ]] || [[ "${REQ_HASH_CHANGED}" == true ]]; then RUN_PIP=true; fi
  if [[ "${FORCE_NPM_CI}" == "1" ]] || [[ "${FRONTEND_DEPS_CHANGED}" == true ]] || [[ ! -d "${APP_ROOT}/frontend/node_modules" ]] || [[ "${LOCK_HASH_CHANGED}" == true ]]; then
    RUN_NPM_CI=true
  fi
  if [[ "${FORCE_FRONTEND_BUILD}" == "1" ]] || [[ "${FRONTEND_CHANGED}" == true ]] || [[ "${FRONTEND_DEPS_CHANGED}" == true ]] || [[ "${ENV_SIG_CHANGED}" == true ]]; then
    RUN_BUILD=true
  fi

  # migrate: backend paths only (not frontend-only / docs-only)
  if [[ "${BACKEND_CHANGED}" == true ]] || [[ "${BACKEND_MIGRATIONS_CHANGED}" == true ]]; then
    RUN_MIGRATE=true
  fi

  if [[ "${BACKEND_CHANGED}" == true ]] || [[ "${BACKEND_DEPS_CHANGED}" == true ]]; then
    RUN_COLLECTSTATIC=true
  fi

  if [[ "${DEPLOY_NGINX_CHANGED}" == true ]]; then RUN_NGINX=true; fi
  if [[ "${DEPLOY_SYSTEMD_CHANGED}" == true ]]; then RUN_SYSTEMD_UPDATE=true; fi

  RUN_PLAYWRIGHT_INSTALL=false
  if ! playwright_browser_present; then RUN_PLAYWRIGHT_INSTALL=true; fi
  if [[ -n "${REQ_HASH}" ]] && [[ "${PLAYWRIGHT_MARKER_HASH}" != "${REQ_HASH}" ]]; then RUN_PLAYWRIGHT_INSTALL=true; fi
  if [[ "${BACKEND_DEPS_CHANGED}" == true ]] || [[ "${PLAYWRIGHT_RELEVANT_CHANGED}" == true ]]; then
    RUN_PLAYWRIGHT_INSTALL=true
  fi

  if [[ "${RUN_PLAYWRIGHT_INSTALL}" == true ]]; then
    RUN_PLAYWRIGHT_PERSIST=true
  fi

  if [[ "${FORCE_BACKEND_RESTART}" == "1" ]] || [[ "${BACKEND_CHANGED}" == true ]] || [[ "${BACKEND_DEPS_CHANGED}" == true ]] || [[ "${DEPLOY_SYSTEMD_CHANGED}" == true ]] || [[ "${BACKEND_ENV_CHANGED}" == true ]]; then
    RUN_GUNICORN_RESTART=true
  fi
  if [[ "${RUN_MIGRATE}" == true ]] || [[ "${RUN_COLLECTSTATIC}" == true ]]; then
    RUN_GUNICORN_RESTART=true
  fi
fi

echo ""
echo "--- Planned steps ---"
plan_line() {
  local name="$1"
  local var_name="$2"
  local val="${!var_name}"
  if [[ "${val}" == "true" ]]; then
    echo "  RUN: ${name}"
  else
    echo "  SKIP: ${name}"
  fi
}
plan_line "pip install" RUN_PIP
plan_line "playwright install" RUN_PLAYWRIGHT_INSTALL
plan_line "playwright path in backend/.env" RUN_PLAYWRIGHT_PERSIST
plan_line "npm ci" RUN_NPM_CI
plan_line "npm run build" RUN_BUILD
plan_line "django migrate" RUN_MIGRATE
plan_line "django collectstatic" RUN_COLLECTSTATIC
plan_line "nginx template sync + reload" RUN_NGINX
plan_line "systemd unit sync + daemon-reload" RUN_SYSTEMD_UPDATE
plan_line "gunicorn restart" RUN_GUNICORN_RESTART

# --- pip
if [[ "${RUN_PIP}" == true ]]; then
  log_section "Backend: dependencies (pip)"
  "${PIP}" install -r backend/requirements.txt
else
  echo ""
  echo "Skipping pip install"
fi

# --- Playwright cache dir + install
mkdir -p "${PLAYWRIGHT_BROWSERS_PATH}"
chmod 755 "$(dirname "${PLAYWRIGHT_BROWSERS_PATH}")" "${PLAYWRIGHT_BROWSERS_PATH}"

if [[ "${RUN_PLAYWRIGHT_INSTALL}" == true ]]; then
  log_section "Backend: Playwright browsers (${PLAYWRIGHT_INSTALL_ARGS})"
  if [[ "${PLAYWRIGHT_INSTALL_WITH_DEPS}" == "1" ]]; then
    if [[ "${SUDO_AVAILABLE}" == "1" ]]; then
      PLAYWRIGHT_INSTALL_ARGS="--with-deps ${PLAYWRIGHT_INSTALL_ARGS}"
    else
      echo "    PLAYWRIGHT_INSTALL_WITH_DEPS=1 requested, but passwordless sudo is unavailable; installing browser only."
      echo "    To install Linux deps, run manually on the server: sudo ${PYTHON} -m playwright install-deps chromium"
    fi
  fi
  PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH}" "${PYTHON}" -m playwright install ${PLAYWRIGHT_INSTALL_ARGS}
  chmod -R a+rX "${PLAYWRIGHT_BROWSERS_PATH}"
  echo "${REQ_HASH}" > "${DEPLOY_STATE_DIR}/playwright_requirements_hash"
else
  echo "Skipping playwright install"
fi

if [[ "${RUN_PLAYWRIGHT_PERSIST}" == true ]]; then
  log_section "Backend: persist Playwright runtime path"
  if [[ -f "${BACKEND_ENV_FILE}" ]]; then
    BACKEND_ENV_FILE="${BACKEND_ENV_FILE}" PLAYWRIGHT_BROWSERS_PATH_VALUE="${PLAYWRIGHT_BROWSERS_PATH}" "${PYTHON}" - <<'PY'
from pathlib import Path
import os

path = Path(os.environ["BACKEND_ENV_FILE"])
key = "PLAYWRIGHT_BROWSERS_PATH"
value = os.environ["PLAYWRIGHT_BROWSERS_PATH_VALUE"]
lines = path.read_text(encoding="utf-8").splitlines()
out = []
replaced = False
for line in lines:
    if line.strip().startswith(f"{key}="):
        if not replaced:
            out.append(f"{key}={value}")
            replaced = True
        continue
    out.append(line)
if not replaced:
    if out and out[-1].strip():
        out.append("")
    out.append(f"{key}={value}")
path.write_text("\n".join(out) + "\n", encoding="utf-8")
PY
  else
    echo "    ${BACKEND_ENV_FILE} not found; create it from deploy/lumoref-backend.env.template before production deploy." >&2
    exit 1
  fi
else
  echo "Skipping Playwright path persist"
fi

# SPA env for build
export REACT_APP_API_URL
printf 'REACT_APP_API_URL=%s\n' "${REACT_APP_API_URL}" > frontend/.env.production
resolve_google_client_id
if [[ -n "${REACT_APP_GOOGLE_CLIENT_ID}" ]]; then
  printf 'REACT_APP_GOOGLE_CLIENT_ID=%s\n' "${REACT_APP_GOOGLE_CLIENT_ID}" >> frontend/.env.production
  export REACT_APP_GOOGLE_CLIENT_ID
  echo "    Google Client ID: set for SPA build"
else
  echo "    Google Client ID: not set (SPA built without REACT_APP_GOOGLE_CLIENT_ID; add GOOGLE_OAUTH_CLIENT_ID to backend/.env or export REACT_APP_GOOGLE_CLIENT_ID / GitHub secret)"
fi

# --- Frontend npm / build
if [[ "${RUN_NPM_CI}" == true ]] || [[ "${RUN_BUILD}" == true ]]; then
  (
    cd frontend
    if [[ "${RUN_NPM_CI}" == true ]]; then
      log_section "Frontend: npm ci"
      if [[ -d node_modules ]]; then
        safe_remove_dir "${APP_ROOT}/frontend/node_modules"
      fi
      npm ci
    else
      echo "Skipping npm ci"
    fi
    if [[ "${RUN_BUILD}" == true ]]; then
      log_section "Frontend: npm run build (API URL=${REACT_APP_API_URL})"
      if [[ -e "${APP_ROOT}/frontend/build" ]]; then
        safe_remove_dir "${APP_ROOT}/frontend/build"
      fi
      npm run build
      echo "    Fixing ownership of frontend/build for deploy user + readability"
      safe_chown_deploy_tree "${APP_ROOT}/frontend/build"
    else
      echo "Skipping npm run build"
    fi
  )
else
  echo ""
  echo "Skipping frontend npm ci and build (nothing to update)"
fi

# --- Django
if [[ "${RUN_MIGRATE}" == true ]] || [[ "${RUN_COLLECTSTATIC}" == true ]]; then
  (
    cd backend
    if [[ "${RUN_MIGRATE}" == true ]]; then
      log_section "Django: migrate"
      DJANGO_SETTINGS_MODULE=core.settings "${PYTHON}" manage.py migrate --noinput
    else
      echo "Skipping migrate"
    fi
    if [[ "${RUN_COLLECTSTATIC}" == true ]]; then
      log_section "Django: collectstatic"
      DJANGO_SETTINGS_MODULE=core.settings "${PYTHON}" manage.py collectstatic --noinput
    else
      echo "Skipping collectstatic"
    fi
    DB_ENGINE_OUT="$(DJANGO_SETTINGS_MODULE=core.settings "${PYTHON}" manage.py shell -c "from django.conf import settings; print(settings.DATABASES['default']['ENGINE'])")"
    echo "    Django DB engine: ${DB_ENGINE_OUT}"
    if [[ "${DB_ENGINE_OUT}" == *"sqlite3"* ]]; then
      echo "    ERROR: SQLite is active. Production must use PostgreSQL (see backend/.env on server)." >&2
      exit 1
    fi
  )
else
  echo ""
  echo "Skipping Django migrate/collectstatic"
fi

# --- Nginx
NGINX_SRC="${APP_ROOT}/deploy/nginx/${NGINX_SITE_NAME}.conf"
NGINX_DST="/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf"
if [[ "${RUN_NGINX}" == true ]]; then
  log_section "Nginx: update site if template changed"
  if [[ -f "${NGINX_SRC}" ]]; then
    if ! cmp -s "${NGINX_SRC}" "${NGINX_DST}" 2>/dev/null; then
      if [[ "${SUDO_AVAILABLE}" == "1" ]]; then
        echo "    Copying nginx site (changed or first install)"
        sudo cp "${NGINX_SRC}" "${NGINX_DST}"
        if [[ ! -L "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf" ]] && [[ ! -e "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf" ]]; then
          sudo ln -s "/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf"
        fi
        sudo nginx -t
        sudo systemctl reload nginx
      else
        echo "    Nginx site changed, but passwordless sudo is unavailable; skipping nginx update."
      fi
    else
      echo "    Nginx site template matches installed file, skip reload"
    fi
  else
    echo "    No ${NGINX_SRC}, skip nginx"
  fi
else
  echo "Skipping nginx template sync (deploy/nginx/ unchanged for this deploy)"
fi

# --- Systemd
SYSTEMD_SRC="${APP_ROOT}/deploy/systemd/${SYSTEMD_UNIT}"
SYSTEMD_DST="/etc/systemd/system/${SYSTEMD_UNIT}"
if [[ "${RUN_SYSTEMD_UPDATE}" == true ]]; then
  log_section "Systemd: update unit if template changed"
  if [[ -f "${SYSTEMD_SRC}" ]]; then
    if ! cmp -s "${SYSTEMD_SRC}" "${SYSTEMD_DST}" 2>/dev/null; then
      if [[ "${SUDO_AVAILABLE}" == "1" ]]; then
        echo "    Copying systemd unit (changed or first install)"
        sudo cp "${SYSTEMD_SRC}" "${SYSTEMD_DST}"
        sudo systemctl daemon-reload
      else
        echo "    Systemd unit changed, but passwordless sudo is unavailable; using backend/.env for runtime env and skipping unit update."
      fi
    else
      echo "    Systemd unit matches installed file, skip daemon-reload"
    fi
  else
    echo "    No ${SYSTEMD_SRC}, skip systemd unit update"
  fi
else
  echo "Skipping systemd unit sync (deploy/systemd/ unchanged for this deploy)"
fi

# --- Gunicorn
if [[ "${RUN_GUNICORN_RESTART}" == true ]]; then
  log_section "Gunicorn: restart"
  if systemctl is-active --quiet "${SYSTEMD_UNIT}" 2>/dev/null; then
    if [[ "${SUDO_AVAILABLE}" == "1" ]]; then
      sudo systemctl restart "${SYSTEMD_UNIT}"
    else
      echo "    WARNING: ${SYSTEMD_UNIT} is active, but passwordless sudo is unavailable; backend was not restarted."
      echo "    Run manually on the server: sudo systemctl restart ${SYSTEMD_UNIT}"
    fi
  else
    echo "    Unit ${SYSTEMD_UNIT} not active — start manually after first-time setup"
  fi
else
  echo "Skipping gunicorn restart"
fi

# --- Persist deploy state
echo "${NEW_COMMIT}" > "${DEPLOY_STATE_DIR}/last_successful_commit"
echo "${FRONT_LOCK_HASH}" > "${DEPLOY_STATE_DIR}/frontend_package_lock_hash"
echo "${ROOT_LOCK_HASH}" > "${DEPLOY_STATE_DIR}/root_package_lock_hash"
echo "${REQ_HASH}" > "${DEPLOY_STATE_DIR}/backend_requirements_hash"
if [[ "${RUN_BUILD}" == true ]]; then
  echo "$(frontend_env_sig)" > "${DEPLOY_STATE_DIR}/frontend_build_env.sig"
elif [[ ! -f "${DEPLOY_STATE_DIR}/frontend_build_env.sig" ]]; then
  echo "$(frontend_env_sig)" > "${DEPLOY_STATE_DIR}/frontend_build_env.sig"
  echo "    Note: seeded frontend_build_env.sig (no SPA build this run; avoids repeated env-sig churn)."
fi
if [[ -n "${BACKEND_ENV_HASH}" ]]; then
  echo "${BACKEND_ENV_HASH}" > "${DEPLOY_STATE_DIR}/backend_env.sha"
fi

log_section "Done"
