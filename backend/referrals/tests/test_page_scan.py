from __future__ import annotations

import base64
import os
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient
from PIL import Image, ImageDraw

from referrals.page_scan import (
    _assign_media_overlays_to_sections,
    _build_screenshot_block_payload,
    _build_visual_block_payload,
    _build_visual_slice_blocks,
    _clip_video_rect_to_section,
    _crop_visual_sections,
    _extract_visual_section_candidates,
    _extract_visual_screenshot_bundle,
    _generic_slice_has_apparent_imagery,
    _generic_visual_slice_should_drop,
    _normalize_foreground_overlay_text,
    _prepare_html5_video_overlay_entries,
    _intersection_area_pixels,
    _scale_visual_geometry_to_screenshot,
    _warmup_page_before_visual_screenshot,
    _write_visual_import_debug_artifacts,
    _VISUAL_VIEWPORT_HEIGHT,
    _VISUAL_VIEWPORT_WIDTH,
    PageScanError,
    build_snapshot_html,
    normalize_visual_scan_response,
    normalize_visual_screenshot_payload_keys,
    parse_scanned_page,
    scan_page_url,
    validate_page_scan_url,
    VISUAL_COLLECT_AND_PRELOAD_JS,
    VISUAL_COLLECT_ASSET_URLS_JS,
    VISUAL_WARMUP_FORCE_LAZY_MEDIA_JS,
)

User = get_user_model()


class PageScanParserTests(SimpleTestCase):
    def test_normalize_foreground_overlay_text_preserves_line_breaks(self):
        self.assertEqual(_normalize_foreground_overlay_text("  a  \r\n  b  "), "a\nb")
        self.assertEqual(_normalize_foreground_overlay_text("x\n\n\ny"), "x\ny")

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

    def test_normalize_visual_screenshot_payload_keys_prefers_snake_case(self):
        block = {"id": "a", "screenshotDataUrl": "data:image/png;base64,QUJD"}
        out = normalize_visual_screenshot_payload_keys(block)
        self.assertEqual(out["screenshot_data_url"], "data:image/png;base64,QUJD")
        self.assertNotIn("screenshotDataUrl", out)
        self.assertEqual(block.get("screenshotDataUrl"), "data:image/png;base64,QUJD")

    def test_normalize_visual_screenshot_payload_keys_keeps_existing_snake(self):
        block = {"screenshot_data_url": "data:image/png;base64,WFhY"}
        out = normalize_visual_screenshot_payload_keys(block)
        self.assertEqual(out["screenshot_data_url"], "data:image/png;base64,WFhY")

    def test_scale_visual_geometry_scales_crop_y_to_match_full_page_png(self):
        blocks = [{"top": 1000, "height": 500, "position": 1}]
        _scale_visual_geometry_to_screenshot(
            doc_page_height=2000,
            image_height=1000,
            section_blocks=blocks,
            raw_videos=None,
            raw_foreground=None,
        )
        self.assertEqual(blocks[0]["top"], 500)
        self.assertEqual(blocks[0]["height"], 250)
        image = Image.new("RGB", (1440, 1000), color="#888888")
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        out, _ = _crop_visual_sections(
            screenshot_bytes=buffer.getvalue(),
            blocks=blocks,
            platform="generic",
        )
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["height"], 250)

    def test_screenshot_payload_logical_chunk_metadata(self):
        """Same logical group split into two crops: continuation + insert flags."""
        h = 500
        img = Image.new("RGB", (1440, h * 2), color="#1e293b")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        blocks = [
            {
                "top": 0,
                "height": h,
                "position": 1,
                "id": "g1-p0",
                "title": "A",
                "group_id": "generic-1",
                "is_continuation": False,
                "allow_insert_before": True,
                "allow_insert_after": False,
                "debug_clip": {"source": "dom-boundary", "chunk": 0},
            },
            {
                "top": h,
                "height": h,
                "position": 2,
                "id": "g1-p1",
                "title": "B",
                "group_id": "generic-1",
                "is_continuation": True,
                "allow_insert_before": False,
                "allow_insert_after": True,
                "debug_clip": {"source": "viewport-slice", "chunk": 1},
            },
        ]
        out, _ = _crop_visual_sections(screenshot_bytes=buffer.getvalue(), blocks=blocks, platform="generic")
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0].get("group_id"), "generic-1")
        self.assertEqual(out[1].get("group_id"), "generic-1")
        self.assertFalse(out[0].get("is_continuation"))
        self.assertTrue(out[1].get("is_continuation"))
        self.assertFalse(out[0].get("allow_insert_after"))
        self.assertTrue(out[1].get("allow_insert_after"))
        self.assertEqual(out[0].get("debug_clip", {}).get("source"), "dom-boundary")

    def test_generic_visual_drops_only_middle_dark_filler_first_last_kept(self):
        """Regression: first and last dark slices are never dropped; middle dark filler may be."""
        h = 900
        img = Image.new("RGB", (1440, h * 3), "#242F3D")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        blocks = [
            {"top": 0, "height": h, "position": 1, "id": "a", "title": "A"},
            {"top": h, "height": h, "position": 2, "id": "b", "title": "B"},
            {"top": 2 * h, "height": h, "position": 3, "id": "c", "title": "C"},
        ]
        out, _ = _crop_visual_sections(screenshot_bytes=buffer.getvalue(), blocks=blocks, platform="generic")
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["title"], "A")
        self.assertEqual(out[1]["title"], "C")

    def test_visual_slice_fallback_returns_screenshot_blocks_even_without_dom_sections(self):
        image = Image.new("RGB", (1440, 1800), color="#ffffff")
        buffer = BytesIO()
        image.save(buffer, format="PNG")

        blocks, video_count = _crop_visual_sections(
            screenshot_bytes=buffer.getvalue(),
            blocks=_build_visual_slice_blocks(page_height=1800),
            platform="generic",
        )

        self.assertEqual(len(blocks), 2)
        self.assertEqual(blocks[0]["kind"], "screenshot")
        self.assertIsNone(blocks[0]["selector"])
        self.assertEqual(blocks[0]["title"], "Секция 1")
        self.assertTrue(blocks[0]["screenshot_data_url"].startswith("data:image/png;base64,"))
        self.assertEqual(blocks[0]["media_overlays"], [])
        self.assertEqual(blocks[0]["foreground_overlays"], [])
        self.assertEqual(video_count, 0)

    def test_prepare_html5_video_resolves_relative_src_and_poster(self):
        raw = [
            {
                "docX": 0,
                "docY": 200,
                "docW": 320,
                "docH": 180,
                "currentSrc": "",
                "srcAttr": "/media/clip.mp4",
                "firstSourceSrc": "",
                "poster": "/posters/frame.jpg",
                "muted": True,
                "loop": True,
                "autoplay": False,
                "playsInline": True,
            }
        ]
        entries = _prepare_html5_video_overlay_entries(raw, page_url="https://cdn.example.com/site/page.html")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["src"], "https://cdn.example.com/media/clip.mp4")
        self.assertEqual(entries[0]["poster"], "https://cdn.example.com/posters/frame.jpg")

    def test_prepare_html5_video_skips_blob_current_src(self):
        raw = [
            {
                "docX": 0,
                "docY": 0,
                "docW": 100,
                "docH": 100,
                "currentSrc": "blob:https://example.com/abc-123",
                "srcAttr": "",
                "firstSourceSrc": "",
                "poster": "",
                "muted": True,
                "loop": True,
                "autoplay": True,
                "playsInline": True,
            }
        ]
        entries = _prepare_html5_video_overlay_entries(raw, page_url="https://example.com/")
        self.assertEqual(entries, [])

    def test_build_screenshot_block_payload_sets_header_footer_kind(self):
        image = Image.new("RGB", (120, 48), color="#cccccc")
        for kind, title in (("header", "Шапка"), ("footer", "Подвал")):
            payload = _build_screenshot_block_payload(
                block={
                    "position": 1,
                    "title": title,
                    "kind": kind,
                    "debug_clip": {"y": 0, "height": 48, "source": kind},
                },
                section_image=image,
                platform="generic",
            )
            self.assertEqual(payload["kind"], kind)
            self.assertEqual(payload["debug_clip"]["source"], kind)

    def test_clip_video_rect_to_section_clips_partial_overlap(self):
        clipped = _clip_video_rect_to_section(50, 150, 200, 200, 0, 100, 800, 300)
        self.assertEqual(clipped, (50, 50, 200, 200))

    def test_crop_visual_sections_attaches_media_overlays_to_matching_section(self):
        image = Image.new("RGB", (800, 500), color="#ffffff")
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        blocks = [{"top": 0, "height": 500, "position": 1, "id": "s1", "title": "A"}]
        raw = [
            {
                "docX": 100,
                "docY": 50,
                "docW": 200,
                "docH": 120,
                "currentSrc": "https://cdn.example.com/loop.mp4",
                "srcAttr": "",
                "firstSourceSrc": "",
                "poster": "",
                "muted": True,
                "loop": True,
                "autoplay": True,
                "playsInline": True,
            }
        ]
        blocks_out, video_count = _crop_visual_sections(
            screenshot_bytes=buffer.getvalue(),
            blocks=blocks,
            platform="generic",
            page_url="https://page.example/",
            raw_html5_videos=raw,
        )
        self.assertEqual(video_count, 1)
        self.assertEqual(len(blocks_out[0]["media_overlays"]), 1)
        ov = blocks_out[0]["media_overlays"][0]
        self.assertEqual(ov["type"], "video")
        self.assertEqual(ov["src"], "https://cdn.example.com/loop.mp4")
        self.assertIn("x", ov)
        self.assertIn("y", ov)
        self.assertIn("width", ov)
        self.assertIn("height", ov)
        self.assertEqual(blocks_out[0]["foreground_overlays"], [])

    def test_video_on_section_boundary_assigned_only_to_max_overlap_section(self):
        blocks = [
            {"top": 0, "height": 300, "position": 1},
            {"top": 300, "height": 300, "position": 2},
        ]
        entries = _prepare_html5_video_overlay_entries(
            [
                {
                    "docX": 0,
                    "docY": 250,
                    "docW": 800,
                    "docH": 200,
                    "currentSrc": "https://example.com/edge.mp4",
                    "srcAttr": "",
                    "firstSourceSrc": "",
                    "poster": "",
                    "muted": True,
                    "loop": True,
                    "autoplay": True,
                    "playsInline": True,
                }
            ],
            page_url="https://example.com/",
        )
        self.assertGreater(
            _intersection_area_pixels(0, 250, 800, 200, 0, 300, 800, 300),
            _intersection_area_pixels(0, 250, 800, 200, 0, 0, 800, 300),
        )
        overlays = _assign_media_overlays_to_sections(
            blocks,
            entries,
            section_x=0,
            section_width=800,
        )
        self.assertEqual(len(overlays[0]), 0)
        self.assertEqual(len(overlays[1]), 1)
        self.assertEqual(overlays[1][0]["src"], "https://example.com/edge.mp4")

    def test_equal_overlap_prefers_earlier_section(self):
        blocks = [
            {"top": 0, "height": 300, "position": 1},
            {"top": 300, "height": 300, "position": 2},
        ]
        entries = _prepare_html5_video_overlay_entries(
            [
                {
                    "docX": 0,
                    "docY": 270,
                    "docW": 800,
                    "docH": 60,
                    "currentSrc": "https://example.com/split.mp4",
                    "srcAttr": "",
                    "firstSourceSrc": "",
                    "poster": "",
                    "muted": True,
                    "loop": True,
                    "autoplay": True,
                    "playsInline": True,
                }
            ],
            page_url="https://example.com/",
        )
        overlays = _assign_media_overlays_to_sections(
            blocks,
            entries,
            section_x=0,
            section_width=800,
        )
        a0 = _intersection_area_pixels(0, 270, 800, 60, 0, 0, 800, 300)
        a1 = _intersection_area_pixels(0, 270, 800, 60, 0, 300, 800, 300)
        self.assertEqual(a0, a1)
        self.assertEqual(len(overlays[0]), 1)
        self.assertEqual(len(overlays[1]), 0)

    def test_media_overlay_percent_relative_to_section_clip(self):
        blocks = [{"top": 100, "height": 200, "position": 1}]
        entries = _prepare_html5_video_overlay_entries(
            [
                {
                    "docX": 0,
                    "docY": 150,
                    "docW": 400,
                    "docH": 100,
                    "currentSrc": "https://videos.example.com/bg.mp4",
                    "srcAttr": "",
                    "firstSourceSrc": "",
                    "poster": "",
                    "muted": True,
                    "loop": True,
                    "autoplay": True,
                    "playsInline": True,
                }
            ],
            page_url="https://example.com/",
        )
        overlays = _assign_media_overlays_to_sections(
            blocks,
            entries,
            section_x=0,
            section_width=800,
        )
        self.assertEqual(len(overlays[0]), 1)
        o = overlays[0][0]
        self.assertEqual(o["type"], "video")
        self.assertEqual(o["src"], "https://videos.example.com/bg.mp4")
        self.assertAlmostEqual(o["x_percent"], 0.0)
        self.assertAlmostEqual(o["y_percent"], 25.0)
        self.assertAlmostEqual(o["width_percent"], 50.0)
        self.assertAlmostEqual(o["height_percent"], 50.0)

    def test_crop_visual_sections_attaches_foreground_overlays_above_video(self):
        image = Image.new("RGB", (800, 500), color="#ffffff")
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        blocks = [{"top": 0, "height": 500, "position": 1, "id": "s1", "title": "A"}]
        raw = [
            {
                "docX": 100,
                "docY": 50,
                "docW": 200,
                "docH": 120,
                "currentSrc": "https://cdn.example.com/loop.mp4",
                "srcAttr": "",
                "firstSourceSrc": "",
                "poster": "",
                "muted": True,
                "loop": True,
                "autoplay": True,
                "playsInline": True,
            }
        ]
        fg = [
            {
                "section_index": 0,
                "docX": 110,
                "docY": 60,
                "docW": 120,
                "docH": 28,
                "type": "text",
                "text": "RECENT LAUNCH",
                "href": "",
                "style": {"color": "rgb(255, 255, 255)", "font_size": "14px"},
            },
            {
                "section_index": 0,
                "docX": 110,
                "docY": 100,
                "docW": 96,
                "docH": 32,
                "type": "button",
                "text": "REWATCH",
                "href": "https://example.com/watch",
                "style": {"background_color": "rgb(0, 0, 0)", "border_radius": "4px"},
            },
        ]
        blocks_out, video_count = _crop_visual_sections(
            screenshot_bytes=buffer.getvalue(),
            blocks=blocks,
            platform="generic",
            page_url="https://page.example/",
            raw_html5_videos=raw,
            raw_foreground_overlays=fg,
        )
        self.assertEqual(video_count, 1)
        fgs = blocks_out[0]["foreground_overlays"]
        self.assertEqual(len(fgs), 2)
        self.assertEqual(fgs[0]["type"], "text")
        self.assertEqual(fgs[0]["text"], "RECENT LAUNCH")
        self.assertAlmostEqual(fgs[0]["x_percent"], 13.75)
        self.assertAlmostEqual(fgs[0]["y_percent"], 12.0)
        self.assertEqual(fgs[1]["type"], "button")
        self.assertEqual(fgs[1]["text"], "REWATCH")
        self.assertEqual(fgs[1]["href"], "https://example.com/watch")

    def test_foreground_overlay_uses_section_index_without_intersecting_video_rect(self):
        """Text at top of section is kept even when it does not intersect the video document rect."""
        image = Image.new("RGB", (800, 900), color="#ffffff")
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        blocks = [{"top": 0, "height": 900, "position": 1, "id": "hero", "title": "Hero"}]
        raw = [
            {
                "docX": 100,
                "docY": 620,
                "docW": 600,
                "docH": 200,
                "currentSrc": "https://cdn.example.com/bg.mp4",
                "srcAttr": "",
                "firstSourceSrc": "",
                "poster": "",
                "muted": True,
                "loop": True,
                "autoplay": True,
                "playsInline": True,
            }
        ]
        fg = [
            {
                "section_index": 0,
                "docX": 40,
                "docY": 40,
                "docW": 280,
                "docH": 36,
                "type": "text",
                "text": "MISSION",
                "href": "",
                "style": {"color": "rgb(255,255,255)"},
            }
        ]
        blocks_out, video_count = _crop_visual_sections(
            screenshot_bytes=buffer.getvalue(),
            blocks=blocks,
            platform="generic",
            page_url="https://page.example/",
            raw_html5_videos=raw,
            raw_foreground_overlays=fg,
        )
        self.assertEqual(video_count, 1)
        self.assertEqual(len(blocks_out[0]["foreground_overlays"]), 1)
        self.assertEqual(blocks_out[0]["foreground_overlays"][0]["text"], "MISSION")

    def test_debug_clip_passes_into_screenshot_payload(self):
        image = Image.new("RGB", (400, 300), color="#000000")
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        blocks = [
            {
                "top": 0,
                "height": 300,
                "position": 1,
                "id": "s1",
                "title": "A",
                "debug_clip": {"y": 0, "height": 300, "source": "video-ancestor"},
            }
        ]
        blocks_out, _ = _crop_visual_sections(
            screenshot_bytes=buffer.getvalue(),
            blocks=blocks,
            platform="generic",
        )
        self.assertEqual(blocks_out[0].get("debug_clip", {}).get("source"), "video-ancestor")

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

    def test_extract_visual_bundle_skips_nav_and_keeps_hero_semantics(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.skipTest("playwright not installed")
        html = """<!DOCTYPE html><html><head><style>
          body { margin: 0; font-family: sans-serif; }
          nav { height: 40px; background: #333; color: #fff; padding: 8px; }
          #hero { height: 480px; position: relative; }
          video { display: block; width: 100%; height: 200px; }
        </style></head><body>
          <nav><span>NavOnlyBrand</span></nav>
          <section id="hero">
            <video src="https://example.com/assets/clip.mp4" muted playsinline></video>
            <h1 style="margin:16px">HeroTitleUnique</h1>
            <p style="margin:16px">SubParaUnique</p>
          </section>
        </body></html>"""
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page(viewport={"width": 900, "height": 700})
                page.set_content(html, wait_until="load")
                out = _extract_visual_screenshot_bundle(page, [{"top": 0, "height": 700}])
                browser.close()
        except Exception as exc:
            self.skipTest(f"playwright browser unavailable: {exc}")

        fg = out.get("foreground_overlays") or []
        texts = [str(x.get("text") or "") for x in fg]
        joined = " ".join(texts)
        self.assertIn("HeroTitleUnique", joined)
        self.assertIn("SubParaUnique", joined)
        self.assertNotIn("NavOnlyBrand", joined)

    def test_extract_visual_section_candidates_generic_uses_viewport_slices(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.skipTest("playwright not installed")
        html = """<!DOCTYPE html><html><head><style>
          html, body { margin: 0; width: 1200px; }
          header { display: block; height: 72px; background: #e5e7eb; width: 100%; }
          section.block { display: block; width: 100%; min-height: 520px; padding: 24px; box-sizing: border-box; }
          footer { display: block; height: 100px; background: #d1d5db; width: 100%; }
        </style></head><body>
          <header><span>HdrBrand</span></header>
          <section class="block"><p>First column unique alpha content block.</p></section>
          <section class="block"><p>Second column unique beta content block.</p></section>
          <footer><span>FooterUnique</span></footer>
        </body></html>"""
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(headless=True)
            except Exception as exc:
                self.skipTest(f"playwright browser unavailable: {exc}")
            try:
                page = browser.new_page(viewport={"width": 1200, "height": 800})
                page.set_content(html, wait_until="load")
                metrics = _extract_visual_section_candidates(page)
                self.assertEqual(metrics.get("platform"), "generic")
                blocks = metrics.get("blocks") or []
                self.assertGreaterEqual(len(blocks), 2, blocks)
                self.assertEqual(blocks[0].get("kind"), "header")
                self.assertEqual(blocks[-1].get("kind"), "footer")
                first_main = next((b for b in blocks if b.get("kind") in {"first_screen", "section"}), None)
                self.assertIsNotNone(first_main)
                self.assertEqual(first_main.get("debug_clip", {}).get("source"), "dom-boundary")
                self.assertTrue(all(str(b.get("group_id") or "") for b in blocks))

                section_blocks = [
                    {"top": int(b.get("top") or 0), "height": max(1, int(b.get("height") or 1))} for b in blocks
                ]
                bundle = _extract_visual_screenshot_bundle(page, section_blocks)
                fg = bundle.get("foreground_overlays") or []
                texts = " ".join(str(x.get("text") or "") for x in fg)
                self.assertNotIn("HdrBrand", texts)
                self.assertNotIn("FooterUnique", texts)
            finally:
                browser.close()


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
            "visual_video_count": 2,
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
                    "media_overlays": [],
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
        self.assertEqual(response.data["visual_video_count"], 2)
        self.assertEqual(len(response.data["blocks"]), 1)
        self.assertIsNone(response.data["blocks"][0]["selector"])
        self.assertEqual(response.data["blocks"][0]["title"], "Секция 1")
        self.assertTrue(response.data["blocks"][0]["screenshot_data_url"].startswith("data:image/png;base64,"))
        self.assertEqual(response.data["blocks"][0]["media_overlays"], [])
        scan_visual.assert_called_once_with("https://example.com/page", preview_mode="desktop")

    @patch("referrals.page_scan._scan_page_visual")
    def test_owner_page_scan_passes_preview_mode_to_visual_scan(self, scan_visual):
        scan_visual.return_value = {
            "url": "https://example.com/page",
            "platform": "generic",
            "visual_import_available": True,
            "visual_mode": "screenshot",
            "visual_preview_mode": "mobile",
            "visual_video_count": 0,
            "blocks": [],
        }
        self.api.force_authenticate(self.owner)

        response = self.api.post(
            "/referrals/site/page-scan/",
            {"url": "https://example.com/page", "mode": "visual", "preview_mode": "mobile"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["visual_preview_mode"], "mobile")
        scan_visual.assert_called_once_with("https://example.com/page", preview_mode="mobile")

    def test_owner_page_scan_rejects_forbidden_url(self):
        self.api.force_authenticate(self.owner)

        response = self.api.post("/referrals/site/page-scan/", {"url": "http://localhost/page"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "Не удалось просканировать страницу")

    @patch("referrals.page_scan._scan_page_visual")
    def test_owner_page_scan_visual_response_has_canonical_screenshot_data_url(self, scan_visual):
        scan_visual.return_value = {
            "url": "https://example.com/page",
            "platform": "generic",
            "visual_import_available": True,
            "visual_mode": "screenshot",
            "visual_video_count": 0,
            "blocks": [
                {
                    "id": "x1",
                    "selector": None,
                    "position": 1,
                    "title": "A",
                    "kind": "screenshot",
                    "screenshotDataUrl": "data:image/png;base64,AAAA",
                    "width": 10,
                    "height": 10,
                    "media_overlays": [],
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
        row = response.data["blocks"][0]
        self.assertIn("screenshot_data_url", row)
        self.assertTrue(str(row["screenshot_data_url"]).startswith("data:image/png;base64,"))
        self.assertNotIn("screenshotDataUrl", row)


class PageScanVisualRegressionTests(SimpleTestCase):
    def test_footer_crop_respects_dom_to_png_scale_two(self):
        doc_h = 3000
        shot_h = 6000
        blocks = [{"top": 2700, "height": 300, "position": 99, "id": "foot", "title": "Подвал"}]
        _scale_visual_geometry_to_screenshot(
            doc_page_height=doc_h,
            image_height=shot_h,
            section_blocks=blocks,
            raw_videos=None,
            raw_foreground=None,
        )
        self.assertEqual(blocks[0]["top"], 5400)
        self.assertEqual(blocks[0]["height"], 600)
        png = Image.new("RGB", (1440, shot_h), color="#888888")
        buf = BytesIO()
        png.save(buf, format="PNG")
        out, _ = _crop_visual_sections(
            screenshot_bytes=buf.getvalue(),
            blocks=blocks,
            platform="generic",
        )
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["height"], 600)
        import base64

        url = out[0]["screenshot_data_url"]
        b64 = url.split(",", 1)[1]
        cropped = Image.open(BytesIO(base64.b64decode(b64)))
        self.assertEqual(cropped.size, (1440, 600))

    def test_dark_slice_with_local_contrast_not_dropped_as_empty_middle(self):
        img = Image.new("RGB", (900, 900), "#242F3D")
        ImageDraw.Draw(img).rectangle([200, 200, 700, 700], outline="#ffffff", width=6)
        self.assertTrue(_generic_slice_has_apparent_imagery(img))
        self.assertFalse(
            _generic_visual_slice_should_drop(
                img,
                has_video=False,
                has_fg=False,
                is_first_slice=False,
                is_last_slice=False,
            )
        )

    def test_scan_page_url_visual_response_normalizes_screenshot_key(self):
        raw = {
            "url": "https://example.com/",
            "platform": "generic",
            "visual_import_available": True,
            "visual_mode": "screenshot",
            "visual_video_count": 0,
            "blocks": [
                {
                    "id": "b1",
                    "position": 1,
                    "title": "A",
                    "kind": "screenshot",
                    "screenshotDataUrl": "data:image/png;base64,AAAA",
                    "media_overlays": [],
                }
            ],
        }
        with patch("referrals.page_scan._scan_page_visual", return_value=raw):
            out = scan_page_url("https://example.com/z", mode="visual")
        b0 = out["blocks"][0]
        self.assertIn("screenshot_data_url", b0)
        self.assertTrue(str(b0["screenshot_data_url"]).startswith("data:image/png;base64,"))
        self.assertNotIn("screenshotDataUrl", b0)

    def test_normalize_visual_scan_response_handles_mixed_blocks(self):
        payload = normalize_visual_scan_response(
            {
                "visual_import_available": True,
                "blocks": [{"screenshotDataUrl": "data:image/png;base64,QQ=="}],
            }
        )
        self.assertEqual(payload["blocks"][0]["screenshot_data_url"], "data:image/png;base64,QQ==")

    def test_normalize_visual_scan_response_normalizes_visual_previews_nested_blocks(self):
        payload = normalize_visual_scan_response(
            {
                "blocks": [{"id": "root", "screenshotDataUrl": "data:image/png;base64,QQ=="}],
                "visual_previews": {
                    "mobile": {"blocks": [{"id": "m", "screenshotDataUrl": "data:image/png;base64,AA=="}]},
                },
            }
        )
        self.assertEqual(payload["blocks"][0]["screenshot_data_url"], "data:image/png;base64,QQ==")
        self.assertEqual(
            payload["visual_previews"]["mobile"]["blocks"][0]["screenshot_data_url"],
            "data:image/png;base64,AA==",
        )


class PageScanVisualPlaywrightRegressionTests(SimpleTestCase):
    _TINY_PNG_DATA_URL = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )

    @staticmethod
    def _spacex_like_html(data_url: str) -> str:
        long_lines = "<br/>LINE<br/>" * 80
        return f"""<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
          html, body {{ margin: 0; background: #0b0b10; }}
          header {{
            position: fixed; top: 0; left: 0; right: 0; height: 48px;
            background: #111; color: #fafafa; z-index: 5;
            display: flex; align-items: center; padding: 0 20px;
            font-family: system-ui, sans-serif;
          }}
          .hero {{
            margin-top: 48px; height: 560px; background: #242F3D; color: #e2e8f0;
            display: flex; align-items: center; justify-content: center;
            font-size: 26px; font-family: system-ui, sans-serif;
          }}
          .mid {{
            min-height: 1200px; padding: 32px 24px; color: #cbd5e1;
            font-family: system-ui, sans-serif;
          }}
          .lazyblk {{
            min-height: 320px; padding: 24px; background: #111827; color: #fff;
            font-family: system-ui, sans-serif;
          }}
          img.mark {{ display: block; width: 120px; height: 120px; background: #1e293b; }}
          footer {{
            min-height: 120px; padding: 36px 24px; background: #0f172a; color: #94a3b8;
            font-family: system-ui, sans-serif;
          }}
        </style></head><body>
          <header>REGWARM_HEADER_BRAND</header>
          <div class="hero">REGWARM_HERO_DARK_AREA</div>
          <div class="mid">REGWARM_SPACER_LONG_CONTENT{long_lines}</div>
          <div class="lazyblk">
            <p>Below-fold lazy</p>
            <img id="regwarmLazy" class="mark" loading="lazy" data-src="{data_url}" alt="" />
          </div>
          <footer>REGWARM_FOOTER_TAIL_MARKER</footer>
        </body></html>"""

    @patch("referrals.page_scan.random.randint", return_value=400)
    def test_warmup_forces_lazy_data_src_and_finishes_at_top_after_scroll(self, _mock_randint):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.skipTest("playwright not installed")
        html = self._spacex_like_html(self._TINY_PNG_DATA_URL)
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(headless=True)
            except Exception as exc:
                self.skipTest(f"playwright browser unavailable: {exc}")
            try:
                page = browser.new_page(
                    viewport={"width": _VISUAL_VIEWPORT_WIDTH, "height": _VISUAL_VIEWPORT_HEIGHT},
                )
                page.set_content(html, wait_until="load")
                page.evaluate(VISUAL_WARMUP_FORCE_LAZY_MEDIA_JS)
                src = page.evaluate(
                    """() => {
                      const i = document.querySelector('#regwarmLazy');
                      return (i && i.src) ? i.src : '';
                    }"""
                )
                self.assertIn("data:image/png", src)
                _warmup_page_before_visual_screenshot(page)
                sy = page.evaluate("() => window.scrollY || window.pageYOffset || 0")
                self.assertLessEqual(sy, 2, msg="expected scroll reset to top after warmup")
                scrolled_deep = page.evaluate(
                    """() => ({
                      sh: document.documentElement.scrollHeight,
                      ih: window.innerHeight,
                    })"""
                )
                self.assertGreater(scrolled_deep["sh"], scrolled_deep["ih"] + 200)
                nw = page.evaluate(
                    """() => {
                      const i = document.querySelector('#regwarmLazy');
                      return i ? i.naturalWidth : 0;
                    }"""
                )
                self.assertGreater(nw, 0, msg="lazy image should decode after warmup")
            finally:
                browser.close()

    @patch("referrals.page_scan.random.randint", return_value=400)
    def test_generic_spacex_like_full_slice_pipeline_first_screen_and_footer_png(self, _mock_randint):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.skipTest("playwright not installed")
        html = self._spacex_like_html(self._TINY_PNG_DATA_URL)
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(headless=True)
            except Exception as exc:
                self.skipTest(f"playwright browser unavailable: {exc}")
            try:
                page = browser.new_page(
                    viewport={"width": _VISUAL_VIEWPORT_WIDTH, "height": _VISUAL_VIEWPORT_HEIGHT},
                )
                page.set_content(html, wait_until="load")
                _warmup_page_before_visual_screenshot(page)
                metrics = _extract_visual_section_candidates(page)
                self.assertEqual(metrics.get("platform"), "generic")
                blocks = [dict(b) for b in (metrics.get("blocks") or [])]
                self.assertGreaterEqual(len(blocks), 2, blocks)
                self.assertEqual(blocks[0].get("kind"), "header")
                self.assertEqual(blocks[-1].get("kind"), "footer")
                self.assertTrue(any(b.get("kind") == "first_screen" for b in blocks), blocks)
                allowed_sources = (
                    "viewport-slice",
                    "dom-boundary",
                    "header",
                    "footer",
                    "video-ancestor",
                )
                for b in blocks:
                    dbg = b.get("debug_clip") if isinstance(b.get("debug_clip"), dict) else {}
                    self.assertIn(dbg.get("source"), allowed_sources, b.get("id"))
                section_rects = [{"top": int(b.get("top") or 0), "height": max(1, int(b.get("height") or 1))} for b in blocks]
                raw_bundle = _extract_visual_screenshot_bundle(page, section_rects)
                section_blocks = [dict(b) for b in blocks]
                screenshot_bytes = page.screenshot(full_page=True, type="png")
                probe = Image.open(BytesIO(screenshot_bytes))
                shot_h = probe.height
                page_h = int(metrics.get("pageHeight") or 0)
                self.assertGreater(page_h, 0)
                _scale_visual_geometry_to_screenshot(
                    doc_page_height=max(1, min(page_h, 12000)),
                    image_height=max(1, shot_h),
                    section_blocks=section_blocks,
                    raw_videos=list(raw_bundle.get("videos") or []),
                    raw_foreground=list(raw_bundle.get("foreground_overlays") or []),
                )
                payload, _ = _crop_visual_sections(
                    screenshot_bytes=screenshot_bytes,
                    blocks=section_blocks,
                    platform="generic",
                    page_url="https://example.com/regwarm/",
                    raw_html5_videos=list(raw_bundle.get("videos") or []),
                    raw_foreground_overlays=list(raw_bundle.get("foreground_overlays") or []),
                )
                self.assertGreaterEqual(len(payload), 2)
                self.assertGreater(len(payload[0].get("screenshot_data_url") or ""), 200)
                self.assertGreater(len(payload[-1].get("screenshot_data_url") or ""), 200)
            finally:
                browser.close()


class PageScanVisualAssetCollectTests(SimpleTestCase):
    _BASE = "https://warmup-asset.test"

    @staticmethod
    def _jpeg_body() -> bytes:
        buf = BytesIO()
        Image.new("RGB", (2, 2), (180, 90, 40)).save(buf, format="JPEG", quality=92)
        return buf.getvalue()

    def test_warmup_collects_css_background_images(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.skipTest("playwright not installed")
        html = f"""<!DOCTYPE html><html><head><base href="{self._BASE}/" /></head><body>
          <div id="box" style="height:120px;background-image:url(/hero.jpg)"></div>
        </body></html>"""
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(headless=True)
            except Exception as exc:
                self.skipTest(f"playwright browser unavailable: {exc}")
            try:
                page = browser.new_page()

                def _fulfill(route):
                    route.fulfill(body=self._jpeg_body(), content_type="image/jpeg", status=200)

                page.route(f"{self._BASE}/hero.jpg", _fulfill)
                page.set_content(html, wait_until="load")
                urls = page.evaluate(VISUAL_COLLECT_ASSET_URLS_JS, False)
                self.assertIsInstance(urls, list)
                flat = " ".join(urls)
                self.assertIn(f"{self._BASE}/hero.jpg", flat)
            finally:
                browser.close()

    def test_warmup_collects_data_background_after_force_lazy(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.skipTest("playwright not installed")
        html = f"""<!DOCTYPE html><html><head><base href="{self._BASE}/" /></head><body>
          <div id="lazybox" data-bg="/lazy-hero.jpg" style="min-height:80px"></div>
        </body></html>"""
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(headless=True)
            except Exception as exc:
                self.skipTest(f"playwright browser unavailable: {exc}")
            try:
                page = browser.new_page()

                def _fulfill(route):
                    route.fulfill(body=self._jpeg_body(), content_type="image/jpeg", status=200)

                page.route(f"{self._BASE}/lazy-hero.jpg", _fulfill)
                page.set_content(html, wait_until="load")
                page.evaluate(VISUAL_WARMUP_FORCE_LAZY_MEDIA_JS)
                style = page.evaluate("() => document.getElementById('lazybox').style.backgroundImage || ''")
                urls = page.evaluate(VISUAL_COLLECT_ASSET_URLS_JS, False)
                flat = " ".join(urls) + " " + style
                self.assertIn("lazy-hero.jpg", flat)
            finally:
                browser.close()

    def test_warmup_collects_picture_source_srcset(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.skipTest("playwright not installed")
        html = f"""<!DOCTYPE html><html><head><base href="{self._BASE}/" /></head><body>
          <picture>
            <source srcset="/a.webp 1x, /a@2x.webp 2x" type="image/webp" />
            <img src="/fallback.jpg" alt="" />
          </picture>
        </body></html>"""
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(headless=True)
            except Exception as exc:
                self.skipTest(f"playwright browser unavailable: {exc}")
            try:
                page = browser.new_page()

                def _img(route):
                    route.fulfill(body=self._jpeg_body(), content_type="image/jpeg", status=200)

                for path in ("/a.webp", "/a@2x.webp", "/fallback.jpg"):
                    page.route(f"{self._BASE}{path}", _img)
                page.set_content(html, wait_until="load")
                urls = page.evaluate(VISUAL_COLLECT_ASSET_URLS_JS, False)
                flat = " ".join(urls)
                self.assertIn(f"{self._BASE}/a.webp", flat)
                self.assertIn(f"{self._BASE}/fallback.jpg", flat)
            finally:
                browser.close()

    def test_warmup_collects_video_poster_and_preload_does_not_throw(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.skipTest("playwright not installed")
        html = f"""<!DOCTYPE html><html><head><base href="{self._BASE}/" /></head><body>
          <video poster="/poster.jpg" muted playsinline width="120" height="80">
            <source src="/clip.mp4" type="video/mp4" />
          </video>
        </body></html>"""
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(headless=True)
            except Exception as exc:
                self.skipTest(f"playwright browser unavailable: {exc}")
            try:
                page = browser.new_page()

                def _img(route):
                    route.fulfill(body=self._jpeg_body(), content_type="image/jpeg", status=200)

                def _vid(route):
                    route.fulfill(body=b"\x00\x00\x00\x20ftypmp42\x00\x00\x00\x00mp42isom", content_type="video/mp4", status=200)

                page.route(f"{self._BASE}/poster.jpg", _img)
                page.route(f"{self._BASE}/clip.mp4", _vid)
                page.set_content(html, wait_until="load")
                urls = page.evaluate(VISUAL_COLLECT_ASSET_URLS_JS, False)
                flat = " ".join(urls)
                self.assertIn("poster.jpg", flat)
                self.assertIn("clip.mp4", flat)
                out = page.evaluate(
                    VISUAL_COLLECT_AND_PRELOAD_JS,
                    {
                        "perUrlTimeoutMs": 2000,
                        "maxUrls": 30,
                        "viewportOnly": False,
                        "treeCap": 4000,
                    },
                )
                self.assertIsInstance(out, dict)
            finally:
                browser.close()

    @patch.dict(os.environ, {"REFERRALS_VISUAL_IMPORT_DEBUG": "1"}, clear=False)
    def test_debug_full_screenshot_written_when_env_enabled(self):
        import tempfile

        pb = BytesIO()
        Image.new("RGB", (2, 2), (10, 20, 30)).save(pb, format="PNG")
        tiny_png_b64 = base64.b64encode(pb.getvalue()).decode("ascii")
        payload = {
            "screenshot_data_url": f"data:image/png;base64,{tiny_png_b64}",
            "id": "x",
            "position": 1,
            "title": "t",
            "kind": "screenshot",
            "media_overlays": [],
        }
        img = Image.new("RGB", (8, 8), "#445566")
        buf = BytesIO()
        img.save(buf, format="PNG")
        _write_visual_import_debug_artifacts(
            screenshot_bytes=buf.getvalue(),
            payload_blocks=[payload],
            section_blocks=[{"top": 0, "height": 8}],
            page_height_doc=100,
            shot_h=100,
            img_stats={"total": 0, "completeNatural": 0},
        )
        full_path = Path(tempfile.gettempdir()) / "referrals-page-scan-full.png"
        self.assertTrue(full_path.is_file(), msg=f"missing {full_path}")
        self.assertGreater(full_path.stat().st_size, 20)
