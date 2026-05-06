"""
Локальная разработка: проект с несколькими Site для проверки вкладок в owner shell.

Идемпотентно: если у пользователя уже есть сайты с config_json._dev_seed == local_v1,
повторный запуск только печатает ссылки.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from referrals.models import Site
from referrals.services import create_project_for_site, ensure_partner_profile, generate_publishable_key

DEV_SEED_MARKER = "local_v1"
PROJECT_DISPLAY_NAME = "Локальные тесты (dev seed)"

ORIGINS_ROTATION = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://example.com",
    "https://test.local",
)


def _dev_seed_sites_for_user(user):
    out = []
    for site in Site.objects.filter(owner=user).select_related("project").order_by("id"):
        cfg = site.config_json if isinstance(site.config_json, dict) else {}
        if cfg.get("_dev_seed") == DEV_SEED_MARKER:
            out.append(site)
    return out


def _print_instructions(stdout, style, project, sites):
    pid = project.id
    stdout.write(style.SUCCESS("Готово. Войдите в ЛК под этим email и откройте проект."))
    stdout.write(f"  Project id: {pid}")
    stdout.write("  Сайты:")
    for s in sites:
        cfg = s.config_json if isinstance(s.config_json, dict) else {}
        label = cfg.get("site_display_name") or str(s.public_id)
        url = f"/lk/partner/project/{pid}/sites/{s.public_id}/dashboard"
        stdout.write(f"    · {label}")
        stdout.write(f"      {url}")
    stdout.write("")
    stdout.write(f"  Список сайтов проекта: /lk/partner/project/{pid}/sites")


class Command(BaseCommand):
    help = "Создаёт тестовый проект с несколькими сайтами для вкладок ЛК (локальная разработка)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--email",
            dest="email",
            required=True,
            help="Email существующего пользователя-владельца (тот же, что для входа в ЛК).",
        )
        parser.add_argument(
            "--sites",
            type=int,
            default=2,
            help="Сколько сайтов создать в одном проекте (по умолчанию 2, макс. 20).",
        )

    def handle(self, *args, **options):
        email = (options["email"] or "").strip().lower()
        n = int(options["sites"])
        if n < 1 or n > 20:
            raise CommandError("--sites должен быть от 1 до 20")

        User = get_user_model()
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            raise CommandError(
                f'Пользователь с email "{email}" не найден. Создайте учётку '
                "(например: python manage.py createsuperuser) и повторите команду."
            )

        existing = _dev_seed_sites_for_user(user)
        if existing:
            project = existing[0].project
            if project is None:
                raise CommandError("Несогласованные данные: dev-seed сайты без project")
            self.stdout.write(
                self.style.WARNING("Тестовые сайты (local_v1) уже есть — повторное создание пропущено.")
            )
            _print_instructions(self.stdout, self.style, project, existing)
            return

        ensure_partner_profile(user)

        with transaction.atomic():
            first = Site.objects.create(
                owner=user,
                publishable_key=generate_publishable_key(),
                allowed_origins=[ORIGINS_ROTATION[0]],
                platform_preset=Site.PlatformPreset.GENERIC,
                config_json={
                    "display_name": PROJECT_DISPLAY_NAME,
                    "site_display_name": "Тестовый сайт 1",
                    "_dev_seed": DEV_SEED_MARKER,
                },
            )
            project = create_project_for_site(first)
            created = [first]

            for i in range(2, n + 1):
                si = Site.objects.create(
                    owner=user,
                    project=project,
                    publishable_key=generate_publishable_key(),
                    allowed_origins=[ORIGINS_ROTATION[(i - 1) % len(ORIGINS_ROTATION)]],
                    platform_preset=Site.PlatformPreset.GENERIC,
                    config_json={
                        "site_display_name": f"Тестовый сайт {i}",
                        "_dev_seed": DEV_SEED_MARKER,
                    },
                )
                created.append(si)

        _print_instructions(self.stdout, self.style, project, created)
