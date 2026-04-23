# ReferalSystem Monorepo

Единый репозиторий с фронтендом (React) и бэкендом (Django REST).

## Структура

- `frontend/` — клиентское приложение на Create React App.
- `backend/` — API на Django + DRF + JWT.
- `docs/` — дополнительная документация проекта.
- `.env.example` — общий пример переменных окружения.
- `package.json` — корневые команды для установки и запуска.

## Требования

- Node.js 18+
- Python 3.10+
- npm

## Быстрый старт

1. Установить зависимости:

```bash
npm install
npm run install:all
```

2. Создать env-файлы:
   - скопировать `frontend/.env.example` в `frontend/.env`
   - скопировать `backend/.env.example` в `backend/.env`

3. Подготовить БД (из папки `backend`):

```bash
python manage.py migrate
```

4. Запустить проект:

```bash
npm run dev
```

Повторный запуск `npm run dev` теперь блокируется, если этот же локальный dev уже запущен для текущего репозитория.

После запуска:
- frontend: `http://localhost:3000`
- backend: `http://localhost:8000`

## Отдельный запуск

- Только frontend: `npm run dev:frontend`
- Только backend: `npm run dev:backend`

Повторный запуск `npm run dev:frontend` или `npm run dev:backend` тоже блокируется, чтобы локальные процессы не дублировались.

Во `frontend/` команды `npm test` и `npm run test:watch` тоже запускаются в одном экземпляре, чтобы не накапливать несколько `react-scripts test` одновременно.

## Переменные окружения

### Frontend (`frontend/.env`)

- `REACT_APP_API_URL` — базовый URL API (по умолчанию `http://localhost:8000`)

### Backend (`backend/.env`)

- `DJANGO_SECRET_KEY` — секретный ключ Django
- `DJANGO_DEBUG` — режим отладки (`True/False`)
- `DJANGO_ALLOWED_HOSTS` — разрешенные хосты через запятую
- `FRONTEND_URL` — URL фронтенда для CORS
- `DB_ENGINE`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` — параметры БД

По умолчанию backend может работать на SQLite для быстрого локального старта.

## PostgreSQL через Docker (опционально)

Если нужен Postgres вместо SQLite:

```bash
docker compose up -d db
```

Затем в `backend/.env` укажите `DB_ENGINE=django.db.backends.postgresql` и параметры подключения (см. `backend/.env.example`), после чего снова выполните `python manage.py migrate`.

**Примечание:** после успешной регистрации бэкенд может отдавать `redirect_url` на Django-страницу `/users/login-page/`. Для SPA-режима обычно удобнее открывать маршрут `/login` во фронтенде — это поведение не менялось, только зафиксировано для ясности.