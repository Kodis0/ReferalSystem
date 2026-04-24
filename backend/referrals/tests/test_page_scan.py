from __future__ import annotations

from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient
from PIL import Image

from referrals.page_scan import (
    _build_visual_block_payload,
    _build_visual_slice_blocks,
    _crop_visual_sections,
    PageScanError,
    build_snapshot_html,
    parse_scanned_page,
    scan_page_url,
    validate_page_scan_url,
)

User = get_user_model()


class PageScanParserTests(SimpleTestCase):
    def test_parse_tilda_like_html_returns_rec_blocks(self):
        html = """
        <html>
          <body>
            <div id="rec123456789" class="t-rec">
              <h1>Первый экран</h1>
              <p>Короткий текст блока для оффера и перехода на заявку.</p>
            </div>
            <div id="rec987654321" class="t-rec">
              <h2>Отзывы клиентов</h2>
              <p>Отзывы, кейсы и довольные клиенты на одной странице.</p>
            </div>
          </body>
        </html>
        """

        payload = parse_scanned_page(url="https://example.com/page", html=html)

        self.assertEqual(payload["platform"], "tilda")
        self.assertEqual(len(payload["blocks"]), 2)
        self.assertEqual(payload["blocks"][0]["selector"], "#rec123456789")
        self.assertEqual(payload["blocks"][0]["title"], "Первый экран")
        self.assertEqual(payload["blocks"][0]["kind"], "hero")
        self.assertEqual(payload["blocks"][1]["title"], "Отзывы клиентов")
        self.assertEqual(payload["blocks"][1]["kind"], "reviews")

    def test_generic_fallback_returns_section_blocks(self):
        html = """
        <html>
          <body>
            <header><h1>Магазин</h1><p>Главный экран с предложением.</p></header>
            <main>
              <section>
                <h2>Каталог</h2>
                <p>Каталог товаров, цены и предложения для покупателей.</p>
              </section>
              <section>
                <h2>Форма заявки</h2>
                <form><input type="text" /><button>Отправить заявку</button></form>
              </section>
            </main>
          </body>
        </html>
        """

        payload = parse_scanned_page(url="https://example.com/page", html=html)

        self.assertEqual(payload["platform"], "generic")
        self.assertGreaterEqual(len(payload["blocks"]), 2)
        self.assertEqual(payload["blocks"][0]["title"], "Магазин")
        self.assertEqual(payload["blocks"][1]["title"], "Каталог")
        self.assertEqual(payload["blocks"][1]["kind"], "products")

    def test_validate_page_scan_url_rejects_local_targets(self):
        with self.assertRaisesMessage(Exception, "forbidden_host"):
            validate_page_scan_url("http://localhost/test")
        with self.assertRaisesMessage(Exception, "forbidden_ip"):
            validate_page_scan_url("http://192.168.1.10/test")

    def test_build_snapshot_html_sanitizes_scripts_handlers_and_relative_assets(self):
        snapshot_html = build_snapshot_html(
            page_url="https://example.com/landing/page",
            block_html="""
            <div id="rec123456789" class="t-rec" onclick="alert(1)">
              <script>alert("x")</script>
              <img src="/images/hero.png" onerror="alert(2)" />
              <a href="javascript:alert(3)" onclick="alert(4)">Перейти</a>
            </div>
            """,
            css_chunks=[".t-rec{background:url('../img/bg.png')}"],
            width=1200,
            height=640,
        )

        self.assertIn("https://example.com/images/hero.png", snapshot_html)
        self.assertIn("https://example.com/img/bg.png", snapshot_html)
        self.assertNotIn("<script", snapshot_html)
        self.assertNotIn("onclick=", snapshot_html)
        self.assertNotIn("onerror=", snapshot_html)
        self.assertNotIn("javascript:alert(3)", snapshot_html)

    def test_build_visual_block_payload_includes_tilda_snapshot_html(self):
        block = _build_visual_block_payload(
            page_url="https://example.com/page",
            css_chunks=[".t-rec { color: #123456; background: url('/img/bg.png'); }"],
            block={
                "id": "rec123456789",
                "selector": "#rec123456789",
                "position": 1,
                "title": "Блок 1",
                "preview_text": "Герой страницы",
                "outer_html": """
                <div id="rec123456789" class="t-rec">
                  <script>alert("x")</script>
                  <div class="t-container">Контент блока</div>
                </div>
                """,
                "width": 1200,
                "height": 640,
            },
        )

        snapshot_html = block["snapshot_html"]
        self.assertIn("snapshot_html", block)
        self.assertIn('id="rec123456789"', snapshot_html)
        self.assertIn("Контент блока", snapshot_html)
        self.assertIn(".t-rec { color: #123456;", snapshot_html)
        self.assertIn("https://example.com/img/bg.png", snapshot_html)
        self.assertNotIn("<script", snapshot_html)

    def test_visual_slice_fallback_returns_screenshot_blocks_even_without_dom_sections(self):
        image = Image.new("RGB", (1440, 1800), color="#ffffff")
        buffer = BytesIO()
        image.save(buffer, format="PNG")

        blocks = _crop_visual_sections(
            screenshot_bytes=buffer.getvalue(),
            blocks=_build_visual_slice_blocks(page_height=1800),
            platform="generic",
        )

        self.assertEqual(len(blocks), 2)
        self.assertEqual(blocks[0]["kind"], "screenshot")
        self.assertIsNone(blocks[0]["selector"])
        self.assertEqual(blocks[0]["title"], "Секция 1")
        self.assertTrue(blocks[0]["screenshot_data_url"].startswith("data:image/png;base64,"))

    @patch("referrals.page_scan._fetch_page_html", return_value=("https://example.com/page", "<html><body><section><h1>Hero</h1></section></body></html>"))
    @patch("referrals.page_scan._scan_page_visual", side_effect=PageScanError("visual_scan_unavailable"))
    @patch("referrals.page_scan.validate_page_scan_url", return_value="https://example.com/page")
    def test_visual_mode_returns_explicit_unavailable_payload_when_playwright_unavailable(self, _validate, _scan_visual, _fetch_html):
        payload = scan_page_url("https://example.com/page", mode="visual")

        self.assertEqual(payload["url"], "https://example.com/page")
        self.assertEqual(payload["platform"], "generic")
        self.assertFalse(payload["visual_import_available"])
        self.assertEqual(payload["visual_mode"], "map")
        self.assertEqual(payload["detail"], "Визуальный импорт недоступен на сервере. Сейчас показана карта секций.")
        self.assertEqual(payload["blocks"][0]["title"], "Hero")


class PageScanApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username="page-scan-owner",
            email="page-scan@example.com",
            password="secret12",
        )
        self.api = APIClient()

    def test_page_scan_requires_auth(self):
        response = self.api.post("/referrals/site/page-scan/", {"url": "https://example.com"}, format="json")
        self.assertEqual(response.status_code, 401)

    @patch("referrals.page_scan._scan_page_visual")
    def test_owner_page_scan_returns_visual_blocks(self, scan_visual):
        scan_visual.return_value = {
            "url": "https://example.com/page",
            "platform": "generic",
            "visual_import_available": True,
            "visual_mode": "screenshot",
            "blocks": [
                {
                    "id": "screenshot-section-1",
                    "selector": None,
                    "position": 1,
                    "title": "Секция 1",
                    "kind": "screenshot",
                    "screenshot_data_url": "data:image/png;base64,AAAA",
                    "width": 1440,
                    "height": 720,
                }
            ],
        }
        self.api.force_authenticate(self.owner)

        response = self.api.post(
            "/referrals/site/page-scan/",
            {"url": "https://example.com/page", "mode": "visual"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["platform"], "generic")
        self.assertTrue(response.data["visual_import_available"])
        self.assertEqual(response.data["visual_mode"], "screenshot")
        self.assertEqual(len(response.data["blocks"]), 1)
        self.assertIsNone(response.data["blocks"][0]["selector"])
        self.assertEqual(response.data["blocks"][0]["title"], "Секция 1")
        self.assertTrue(response.data["blocks"][0]["screenshot_data_url"].startswith("data:image/png;base64,"))

    def test_owner_page_scan_rejects_forbidden_url(self):
        self.api.force_authenticate(self.owner)

        response = self.api.post("/referrals/site/page-scan/", {"url": "http://localhost/page"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "Не удалось просканировать страницу")
