# Production deploy (lumoref.ru)

Документ описывает целевую схему, файлы в репозитории и **ручные шаги на сервере и в GitHub**. Проверки на реальном VPS выполняются после выдачи SSH и публикации репозитория в GitHub.

## 1. Краткий аудит (из среды разработки, без доступа к VPS)

| Проверка | Результат |
|----------|-----------|
| DNS `lumoref.ru` | Сопоставление с публичного резолвера: **A → 95.163.244.138** |
| DNS `www.lumoref.ru` | **A → 95.163.244.138** |
| DNS `api.lumoref.ru` | **Записи нет (NXDOMAIN)** — нужна отдельная **A** (или **CNAME**) |
| SSH / ОС / nginx / Postgres на сервере | **Не проверялось** (нет доступа) |

Если IP, на который вы подключаетесь по SSH, **не 95.163.244.138**, сначала выясните: это другой сервер, NAT, или DNS указывает не туда. Менять DNS и конфиги «вслепую» нельзя.

## 2. Целевая схема

| URL | Назначение |
|-----|------------|
| `https://lumoref.ru` | React (статический `build`) |
| `https://www.lumoref.ru` | **301** на `https://lumoref.ru` |
| `https://api.lumoref.ru` | Django API за **Gunicorn** (127.0.0.1:8001) + **nginx** reverse proxy |

Docker для прод-рантайма не требуется: venv + systemd + nginx.

## 3. DNS: что добавить или изменить

У регистратора (Reg.ru, NS `ns1.reg.ru` / `ns2.reg.ru`):

| Имя | Тип | Значение | Примечание |
|-----|-----|----------|------------|
| `@` | A | `95.163.244.138` | Уже есть — не менять, если это верный сервер |
| `www` | A | `95.163.244.138` | Уже есть |
| `api` | **A** | `95.163.244.138` | **Добавить** (сейчас поддомена нет) |

После распространения DNS проверка: `nslookup api.lumoref.ru` должен вернуть тот же IP, что и основной домен.

## 4. Разовая настройка сервера (Ubuntu/Debian, ориентир)

Выполняется один раз под `root` или через `sudo`. Пути по умолчанию: приложение в `/var/www/lumoref/app`, venv в `/var/www/lumoref/venv`.

1. **Пакеты:** `nginx`, `certbot`, `python3-venv`, `python3-dev`, `postgresql`, `postgresql-contrib`, `build-essential`, `git`.
2. **Каталоги и права:**
   - `mkdir -p /var/www/lumoref`
   - `git clone <ваш-github-репозиторий> /var/www/lumoref/app`
   - `python3 -m venv /var/www/lumoref/venv`
   - `chown -R www-data:www-data /var/www/lumoref` (или отдельный пользователь `deploy` — согласовать с владельцем процессов).
3. **PostgreSQL:** создать БД и пользователя, выдать права на БД. В `backend/.env` на сервере (файл **не** в git):
   - `DB_ENGINE=django.db.backends.postgresql`
   - `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST=localhost`, `DB_PORT=5432`
4. **Django `backend/.env` (секреты только на сервере):**
   - `DJANGO_SECRET_KEY` — длинная случайная строка
   - `DJANGO_DEBUG=False`
   - `DJANGO_ALLOWED_HOSTS=lumoref.ru,www.lumoref.ru,api.lumoref.ru,127.0.0.1`
   - `FRONTEND_URL=https://lumoref.ru`
   - `DJANGO_CORS_ALLOWED_ORIGINS=https://lumoref.ru,https://www.lumoref.ru`
   - `DJANGO_CSRF_TRUSTED_ORIGINS=https://lumoref.ru,https://www.lumoref.ru,https://api.lumoref.ru`
5. **Первый запуск nginx без TLS:** скопировать `deploy/nginx/lumoref.http-bootstrap.conf` в `/etc/nginx/sites-available/lumoref.conf`, включить сайт, `nginx -t`, `systemctl reload nginx`.
6. **TLS:** после того как **A** для `api` уже виден снаружи:  
   `sudo certbot certonly --nginx -d lumoref.ru -d www.lumoref.ru -d api.lumoref.ru`  
   (или `--webroot` — по вашей схеме). Затем заменить конфиг на `deploy/nginx/lumoref.conf`, снова `nginx -t` и `reload`.
7. **systemd:** скопировать `deploy/systemd/lumoref-gunicorn.service` в `/etc/systemd/system/`, при необходимости поправить пути, `systemctl daemon-reload`, `systemctl enable --now lumoref-gunicorn.service`.
8. **Пользователь деплоя:** отдельный Linux-пользователь с SSH-ключом, правами на `git pull` в каталоге приложения и **ограниченным** `sudo` для `nginx -t`, `systemctl restart lumoref-gunicorn`, `systemctl reload nginx` (без полного root).

## 5. Файлы в репозитории

| Файл | Назначение |
|------|------------|
| `deploy/deploy.sh` | Инкрементальный деплой: `git fetch` + `git reset --hard origin/main`, затем план строится по **нескольким** server-only state-файлам в `.deploy-state/` (см. раздел 11), а не только по `last_successful_commit`. Полный цикл: `FORCE_FULL_DEPLOY=1` или первый деплой без state |
| `deploy/nginx/lumoref.conf` | Прод nginx + TLS (после выдачи сертификатов) |
| `deploy/nginx/lumoref.http-bootstrap.conf` | Только HTTP до появления сертификатов |
| `deploy/systemd/lumoref-gunicorn.service` | Unit для Gunicorn |
| `.github/workflows/deploy.yml` | Запуск `deploy/deploy.sh` по SSH при push в `main` |

## 6. Nginx (итог)

- Статика админки Django: `location /static/` → `backend/staticfiles/` (после `collectstatic`).
- Фронт: `root` = `.../frontend/build`, SPA — `try_files ... /index/html`.
- API: `server_name api.lumoref.ru`, `proxy_pass` на `127.0.0.1:8001`.
- `www` на HTTPS: редирект на основной домен (см. `lumoref.conf`).

## 7. Frontend

- В прод-сборке URL API задаётся **на этапе `npm run build`** через `REACT_APP_API_URL`.
- `deploy/deploy.sh` пишет `frontend/.env.production` и выставляет `REACT_APP_API_URL` (по умолчанию `https://api.lumoref.ru`).
- Исходный код: `frontend/src/config/api.js` — `process.env.REACT_APP_API_URL`.

## 8. Backend

- Запуск: **Gunicorn** → `core.wsgi:application`, bind `127.0.0.1:8001`.
- `DEBUG=0`, `ALLOWED_HOSTS`, CORS и CSRF — через переменные окружения (см. `backend/.env.example`).
- `STATIC_ROOT` = `backend/staticfiles`; медиа-файлов в моделях сейчас нет — отдельный `MEDIA` не настраивался.

## 9. PostgreSQL — чек-лист проверки на сервере

После настройки выполните на VPS (подставьте свои имя БД и пользователя):

```bash
sudo systemctl status postgresql
sudo -u postgres psql -c "\l"
sudo -u postgres psql -c "\du"
cd /var/www/lumoref/app/backend && ../venv/bin/python manage.py migrate
../venv/bin/python manage.py shell -c "from django.db import connection; connection.ensure_connection(); print('DB OK')"
```

Убедитесь, что в `backend/.env` **не** SQLite: `DB_ENGINE=django.db.backends.postgresql` и тестовое подключение без ошибок `pg_hba` / прав.

**Итог по Postgres из этой сессии:** подключение на проде **не подтверждено** (нет SSH).

## 10. GitHub Actions: автодеплой

### Секреты репозитория (Settings → Secrets and variables → Actions)

| Secret | Смысл |
|--------|--------|
| `DEPLOY_HOST` | IP или hostname сервера (часто `95.163.244.138`, если совпадает с DNS) |
| `DEPLOY_USER` | SSH-пользователь для деплоя |
| `DEPLOY_SSH_PRIVATE_KEY` | Приватный ключ (полный PEM), **пара к публичному ключу в `~/.ssh/authorized_keys` на сервере** |
| `DEPLOY_PATH` | Абсолютный путь к клону репозитория на сервере, например `/var/www/lumoref/app` |
| `REACT_APP_API_URL` | Опционально: переопределить URL API для сборки фронта (по умолчанию в скрипте `https://api.lumoref.ru`) |
| `REACT_APP_GOOGLE_CLIENT_ID` | Опционально: **Web** OAuth Client ID для сборки фронта. Если секрет пустой, `deploy/deploy.sh` подставит то же значение из **`GOOGLE_OAUTH_CLIENT_ID` в `backend/.env`** на сервере (достаточно одной строки в `.env`). |

Workflow: `.github/workflows/deploy.yml` — при push в ветку `main` или ручной `workflow_dispatch`. Перед `deploy/deploy.sh` на сервере выполняется `git fetch` + `git reset --hard origin/main`, чтобы сбросить случайные правки в отслеживаемых файлах на VPS и не зависеть от устаревшей версии скрипта деплоя.

### Google Sign-In на проде

1. **Google Cloud Console** → OAuth client **Web application** → **Authorized JavaScript origins**: `https://lumoref.ru`, `https://www.lumoref.ru` (и при ручной сборке с машины — при необходимости `http://localhost:3000`).
2. **Client secret** для текущего кода **не используется** (обмен идёт по JWT `credential` и проверке `aud` = Client ID). Хранить секрет в репозитории не нужно.
3. На **VPS** в `backend/.env`: раскомментировать и задать `GOOGLE_OAUTH_CLIENT_ID=<тот же Client ID>`, перезапустить Gunicorn.
4. **Сборка фронта**: `deploy/deploy.sh` подставляет `REACT_APP_GOOGLE_CLIENT_ID` в `frontend/.env.production`, если переменная задана в окружении (в т.ч. из секрета GitHub Actions выше) или перед вызовом скрипта: `export REACT_APP_GOOGLE_CLIENT_ID='…apps.googleusercontent.com'`.
5. **OAuth consent screen**: пока приложение в статусе **Testing**, вход смогут только **Test users**. Для всех пользователей — опубликовать приложение (**In production**) и пройти проверки Google при необходимости.

### Что сделать вручную один раз

1. Создать репозиторий на GitHub и запушить код (сейчас в локальном дереве **может не быть коммитов** — их нужно создать).
2. Добавить секреты выше.
3. Настроить сервер по разделу 4 и убедиться, что **ручной** `bash deploy/deploy.sh` проходит без ошибок.
4. Сделать тестовый push в `main` и проверить вкладку Actions.

Нестандартный SSH-порт: в `appleboy/ssh-action` можно добавить параметр `port` в workflow — при необходимости расширьте workflow локально.

### npm: `EACCES` / `unlink` / `Permission denied` при удалении `frontend/node_modules`

Сообщение вида `permission denied, unlink '.../node_modules/.bin/acorn'` значит, что каталог `node_modules` (или часть файлов) принадлежит **другому пользователю** (часто **root** после ручного `sudo npm install` на сервере). Тогда пользователь деплоя не может удалить дерево перед `npm ci`.

В логе Actions/`deploy.sh` длинный поток строк `rm: … Permission denied` больше не дублируется в stdout: детали попадают в **`/tmp/lumoref-rm-node-modules.log`**, в консоли — короткая инструкция.

**Если деплой падает на правах на `node_modules` или `build`**, один раз на VPS (подставьте пользователя деплоя вместо `deploy`, если он другой):

```bash
sudo chown -R deploy:deploy /var/www/lumoref/app/frontend
sudo rm -rf /var/www/lumoref/app/frontend/node_modules
sudo rm -rf /var/www/lumoref/app/frontend/build
```

Затем снова запустите деплой (`bash deploy/deploy.sh` или push в `main`).

Если доступен passwordless `sudo`, скрипт сам попробует `sudo rm -rf` после неудачного обычного `rm` (без спама в лог GitHub Actions).

## 11. Инкрементальный деплой и флаги

Состояние между деплоями хранится **только на сервере** в каталоге **`.deploy-state/`** (в git не коммитится). **Нельзя** полагаться на один только `last_successful_commit` как на единственный маркер: фронт и бэкенд обновляются независимо; отдельно фиксируется, для какого коммита реально прошла сборка фронта и рестарт Gunicorn.

| Файл | Смысл |
|------|--------|
| `last_successful_commit` | Обновляется **только** после успешного завершения **всех** запланированных шагов текущего прогона (в т.ч. обязательного рестарта, если он был в плане и доступен `sudo`). |
| `last_frontend_build_commit` | Коммит, для которого успешно выполнен `npm run build` и пройден self-check по `frontend/build/index.html`. |
| `last_backend_restart_commit` | Коммит, после которого успешно выполнен `systemctl restart` юнита Gunicorn (если рестарт был в плане и юнит был активен). |
| `frontend_package_lock_hash` / `root_package_lock_hash` | SHA256 содержимого соответствующих `package-lock.json` на момент успешной сборки фронта или финальной фиксации state. |
| `frontend_build_env.sig` | Сигнатура `REACT_APP_*` (и выведенного из `backend/.env` Client ID), участвующих в прод-сборке SPA. |
| Также | `backend_requirements_hash`, `backend_env.sha`, метки Playwright — как раньше. |

**Обычный деплой:** push в `main` — срабатывает GitHub Actions и на сервере `deploy/deploy.sh`.

**Ручной деплой на сервере:**

```bash
cd /var/www/lumoref/app
export REACT_APP_API_URL=https://api.lumoref.ru   # при необходимости
export REACT_APP_GOOGLE_CLIENT_ID='…'             # опционально
bash deploy/deploy.sh
```

**Принудительно полный деплой** (как раньше — все шаги):

```bash
FORCE_FULL_DEPLOY=1 bash deploy/deploy.sh
```

**Только проверка (fetch без `reset`, без тяжёлых команд):**

```bash
DRY_RUN=1 bash deploy/deploy.sh
```

**Принудительно пересобрать фронт** (например, сменили секреты `REACT_APP_*` в CI и нужна новая сборка при том же коммите):

```bash
FORCE_FRONTEND_BUILD=1 bash deploy/deploy.sh
```

Дополнительно: `FORCE_NPM_CI=1`, `FORCE_BACKEND_RESTART=1`. Эти флаги **не игнорируются**: даже если `HEAD` совпадает с `last_successful_commit`, скрипт не выходит «раньше времени» — сначала вычисляется план (см. лог: `Frontend build required`, `npm ci required`, `Backend restart required`).

**Если подозреваете «старый» фронт после деплоя:** на сервере проверьте, какой бандл указан в сборке и что файл на диске существует:

```bash
grep -oE 'static/js/main[^"]*\.js' /var/www/lumoref/app/frontend/build/index.html
ls -la /var/www/lumoref/app/frontend/build/static/js/main.*.js
```

(Подставьте свой `DEPLOY_PATH` вместо `/var/www/lumoref/app`.)

Повторный деплой **того же коммита** без `FORCE_*` и при актуальном state не выполняет тяжёлых шагов. Принудительный полный прогон: `FORCE_FULL_DEPLOY=1 bash deploy/deploy.sh`.

## 12. Ручные команды на сервере

```bash
# Деплой вручную (см. также раздел 11)
cd /var/www/lumoref/app
export REACT_APP_API_URL=https://api.lumoref.ru
# опционально, тот же ID что в backend/.env → GOOGLE_OAUTH_CLIENT_ID
export REACT_APP_GOOGLE_CLIENT_ID='YOUR_WEB_CLIENT_ID.apps.googleusercontent.com'
bash deploy/deploy.sh

# Backend
sudo systemctl status lumoref-gunicorn
sudo systemctl restart lumoref-gunicorn
sudo journalctl -u lumoref-gunicorn -f

# Nginx
sudo nginx -t
sudo systemctl reload nginx
```

## 13. Проверки после выдачи доступа (не из этого чата)

- `https://lumoref.ru` открывается, нет mixed content.
- `https://www.lumoref.ru` → редирект на основной домен.
- `https://api.lumoref.ru/users/...` (или health) отвечает без 502.
- SSL (срок, цепочка).
- После push в `main` — успешный workflow и обновлённая версия на сайте.

## 14. Что осталось за рамками автоматической проверки здесь

- Состояние ОС, занятые порты, firewall, свободное место на **реальном** сервере.
- Соответствие IP SSH и IP из DNS.
- Работа HTTPS и Certbot «в бою».
- Успешный прогон GitHub Actions до конца.

После передачи SSH можно пройти чек-листы из разделов 4, 9 и 12 последовательно и зафиксировать фактические выводы команд.
