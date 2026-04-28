"""
Headless browser check for widget install: opens partner URL and relies on
``record_site_widget_seen`` from real widget traffic (no backend spoofing).
"""
from __future__ import annotations

import logging
from datetime import datetime
from urllib.parse import urlparse, urlunparse

from django.utils import timezone

from .models import Site
from .page_scan import (
    PageScanUrlValidationError,
    _CHROMIUM_AUToplay_ARGS,
    _CHROMIUM_VISUAL_USER_AGENT,
    validate_page_scan_url,
)

logger = logging.getLogger(__name__)

MSG_HTML_NO_WIDGET = (
    "Мы открыли страницу, но виджет не запросил конфиг. Проверьте, что код вставлен именно на эту страницу, "
    "страница опубликована, домен добавлен в allowed origins и скрипт не заблокирован."
)
MSG_PAGE_FAILED = "Страница не открылась. Проверьте URL."
MSG_PRIVATE_URL = "URL ведёт во внутреннюю/private сеть и не может быть проверена."
MSG_PLAYWRIGHT_MISSING = "Автоматическая проверка на сервере недоступна (не установлен Playwright)."
MSG_SNIPPET_MISSING = (
    "На странице не найден фрагмент кода виджета. Проверьте URL, публикацию и что код вставлен на эту страницу."
)


def build_default_verify_page_url(site: Site) -> str:
    """
    Homepage URL for headless verify when ``verification_url`` is empty:
    primary allowed origin with path stripped to ``/``.
    """
    from .services import owner_site_list_origin_display

    primary, _ = owner_site_list_origin_display(site)
    raw = (primary or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        parsed = urlparse(raw)
    except Exception:
        return ""
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https"):
        return ""
    netloc = (parsed.netloc or "").strip()
    if not netloc:
        return ""
    return urlunparse((scheme, netloc, "/", "", "", ""))


def human_message_for_page_scan_url_error(exc: PageScanUrlValidationError) -> str:
    token = exc.args[0] if exc.args else ""
    if token in ("forbidden_host", "forbidden_ip", "unsupported_scheme"):
        return MSG_PRIVATE_URL
    return MSG_PAGE_FAILED


def widget_snippet_markers_present(html: str, *, public_id: str, publishable_key: str) -> bool:
    if not (html or "").strip():
        return False
    if public_id and public_id in html and "data-rs-site" in html:
        return True
    if publishable_key and publishable_key in html and "data-rs-key" in html:
        return True
    if publishable_key and publishable_key in html and "referral-widget" in html.lower():
        return True
    return False


def _persist_verification(*, site_pk: int, status: str, error: str) -> None:
    Site.objects.filter(pk=site_pk).update(
        verification_status=status,
        last_verification_error=(error or "")[:4000],
        last_verification_at=timezone.now(),
        updated_at=timezone.now(),
    )


def run_widget_install_headless_check(
    *,
    site_pk: int,
    normalized_url: str,
    check_started_at: datetime,
    widget_public_id: str,
    publishable_key: str,
) -> None:
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.warning("Playwright import failed; widget headless verify unavailable")
        _persist_verification(
            site_pk=site_pk,
            status=Site.VerificationStatus.FAILED,
            error=MSG_PLAYWRIGHT_MISSING,
        )
        return

    html = ""
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=list(_CHROMIUM_AUToplay_ARGS))
            try:
                context = browser.new_context(user_agent=_CHROMIUM_VISUAL_USER_AGENT)
                page = context.new_page()
                page.goto(normalized_url, wait_until="domcontentloaded", timeout=22_000)
                page.wait_for_timeout(2800)
                try:
                    validate_page_scan_url(page.url)
                except PageScanUrlValidationError as exc:
                    _persist_verification(
                        site_pk=site_pk,
                        status=Site.VerificationStatus.FAILED,
                        error=human_message_for_page_scan_url_error(exc),
                    )
                    return
                html = page.content()
            finally:
                browser.close()
    except PlaywrightTimeoutError:
        _persist_verification(site_pk=site_pk, status=Site.VerificationStatus.FAILED, error=MSG_PAGE_FAILED)
        return
    except PageScanUrlValidationError as exc:
        _persist_verification(
            site_pk=site_pk,
            status=Site.VerificationStatus.FAILED,
            error=human_message_for_page_scan_url_error(exc),
        )
        return
    except PlaywrightError as exc:
        logger.info("Playwright error during widget verify: %s", exc)
        _persist_verification(site_pk=site_pk, status=Site.VerificationStatus.FAILED, error=MSG_PAGE_FAILED)
        return
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("Unexpected error during widget headless verify")
        _persist_verification(
            site_pk=site_pk,
            status=Site.VerificationStatus.FAILED,
            error=MSG_PAGE_FAILED,
        )
        return

    site = Site.objects.filter(pk=site_pk).first()
    if site is None:
        return

    seen_at = site.last_widget_seen_at
    if seen_at and seen_at > check_started_at:
        _persist_verification(site_pk=site_pk, status=Site.VerificationStatus.WIDGET_SEEN, error="")
        return

    if widget_snippet_markers_present(html, public_id=widget_public_id, publishable_key=publishable_key):
        _persist_verification(
            site_pk=site_pk,
            status=Site.VerificationStatus.HTML_FOUND,
            error=MSG_HTML_NO_WIDGET,
        )
        return

    err = MSG_SNIPPET_MISSING if (html or "").strip() else MSG_PAGE_FAILED
    _persist_verification(site_pk=site_pk, status=Site.VerificationStatus.FAILED, error=err)
