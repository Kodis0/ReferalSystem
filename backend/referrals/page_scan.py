from __future__ import annotations

import base64
import ipaddress
import logging
import os
import random
import re
import socket
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from PIL import Image, ImageStat

_REQUEST_HEADERS = {
    "User-Agent": "ReferalSystem-PageScan/1.0",
    "Accept": "text/html,application/xhtml+xml",
}
_MAX_REDIRECTS = 3
_MAX_RESPONSE_BYTES = 1_500_000
_MAX_VISUAL_BLOCKS = 12
_MAX_BLOCK_HTML_CHARS = 120_000
_MAX_TOTAL_CSS_CHARS = 180_000
_MAX_STYLESHEET_BYTES = 180_000
# Визуальный импорт: ждём реальный DOM, затем прогрев скроллом (lazy/footer) перед full-page PNG.
# ``domcontentloaded`` on heavy SPAs can exceed 20s on slow networks; warmup still runs after navigation.
_VISUAL_GOTO_DOMCONTENT_TIMEOUT_MS = int(os.environ.get("REFERRALS_VISUAL_GOTO_MS", "60000"))
_VISUAL_WARMUP_NETWORK_IDLE_MS = 2_500
_VISUAL_WARMUP_AFTER_DOM_MS = 600
_CHROMIUM_VISUAL_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
_VISUAL_VIEWPORT_WIDTH = 1440
_VISUAL_VIEWPORT_HEIGHT = 900
_VISUAL_VIEWPORT_PROFILES: dict[str, dict[str, Any]] = {
    "mobile": {
        "width": 360,
        "height": 740,
        "is_mobile": True,
        "has_touch": True,
        "user_agent": (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        ),
    },
    "tablet": {
        "width": 768,
        "height": 1024,
        "is_mobile": True,
        "has_touch": True,
        "user_agent": (
            "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        ),
    },
    "desktop": {
        "width": _VISUAL_VIEWPORT_WIDTH,
        "height": _VISUAL_VIEWPORT_HEIGHT,
        "is_mobile": False,
        "has_touch": False,
        "user_agent": _CHROMIUM_VISUAL_USER_AGENT,
    },
}
_VISUAL_SCROLL_STEP_VIEWPORT_RATIO = 0.75
_VISUAL_SCROLL_STEP_WAIT_MS_MIN = 260
_VISUAL_SCROLL_STEP_WAIT_MS_MAX = 420
_VISUAL_BOTTOM_SCROLL_WAIT_MS_MIN = 800
_VISUAL_BOTTOM_SCROLL_WAIT_MS_MAX = 1_200
_VISUAL_TOP_RESET_WAIT_MS_MIN = 360
_VISUAL_TOP_RESET_WAIT_MS_MAX = 520
_VISUAL_STEP_IMAGE_WAIT_MS = 650
_VISUAL_FINAL_IMAGE_WAIT_MS = 1_400
_VISUAL_PRELOAD_MAX_URLS_PER_STEP = 220
_VISUAL_PRELOAD_MAX_URLS_BOTTOM = 400
_VISUAL_PRELOAD_PER_URL_TIMEOUT_MS = 2_500
_VISUAL_VIDEO_PRIME_WAIT_MS = 900
_VISUAL_TREE_WALK_CAP = 12_000
_CHROMIUM_AUToplay_ARGS = (
    "--autoplay-policy=no-user-gesture-required",
    "--no-sandbox",
    "--disable-dev-shm-usage",
)
_VISUAL_SLICE_HEIGHT = 900
_MAX_VISUAL_PAGE_HEIGHT = 12_000
_MAX_VISUAL_SECTION_HEIGHT = 1_200
_MIN_VISUAL_SECTION_WIDTH = 600
_MIN_VISUAL_SECTION_HEIGHT = 120
_MAX_VISUAL_BLOCK_IMAGE_BYTES = 1_200_000
_MIN_VISUAL_DOWNSCALE_WIDTH = 720
_MIN_VIDEO_OVERLAY_WIDTH = 80
_MIN_VIDEO_OVERLAY_HEIGHT = 60
_MAX_MEDIA_OVERLAYS_PER_SECTION = 5
_MAX_MEDIA_OVERLAYS_PER_PAGE = 20
_MAX_FOREGROUND_OVERLAYS_PER_SECTION = 30
_PREVIEW_TARGET_WIDTH = 1200
_SNAPSHOT_SCALE = 0.38
_TILDA_ID_RE = re.compile(r"^rec\d+$", re.IGNORECASE)
_FORM_KEYWORDS = ("заяв", "остав", "отправ", "submit", "получ", "связа")
_REVIEWS_KEYWORDS = ("отзыв", "клиент", "review", "testimonial")
_PRODUCTS_KEYWORDS = ("каталог", "товар", "цена", "купить", "product", "price")
_CSS_URL_RE = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.IGNORECASE)
_SRCSET_ITEM_RE = re.compile(r"^(?P<url>\S+)(?P<tail>\s+.+)?$")
_URL_ATTR_NAMES = {"src", "href", "poster", "action", "xlink:href"}
_SKIPPED_URL_PREFIXES = ("data:", "blob:", "#", "mailto:", "tel:")
logger = logging.getLogger(__name__)


def _ensure_playwright_browsers_path() -> str:
    """
    Gunicorn runs as www-data in production, while deploy may install browsers from another user.
    Prefer the shared app-local cache when it exists so runtime does not fall back to /var/www/.cache.
    """
    configured = (os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or "").strip()
    if configured:
        return configured
    shared_cache = Path(__file__).resolve().parents[2] / ".cache" / "ms-playwright"
    if shared_cache.exists():
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(shared_cache)
        return str(shared_cache)
    return ""


_ensure_playwright_browsers_path()


def _visual_import_debug_enabled() -> bool:
    return logger.isEnabledFor(logging.DEBUG) or os.environ.get("REFERRALS_VISUAL_IMPORT_DEBUG") == "1"


def _visual_import_debug_artifacts_enabled() -> bool:
    return os.environ.get("REFERRALS_VISUAL_IMPORT_DEBUG") == "1"


class _VisualImportNetworkDiag:
    """Collect failed requests and sample media/CSS responses when debug is on."""

    def __init__(self) -> None:
        self.failed: list[dict[str, Any]] = []
        self.response_samples: list[dict[str, Any]] = []

    def on_request_failed(self, request: Any) -> None:
        if len(self.failed) >= 200:
            return
        try:
            fail = request.failure
            err = str(getattr(fail, "error_text", None) or fail or "")
        except Exception:
            err = ""
        try:
            self.failed.append({"url": getattr(request, "url", "") or "", "failure": err[:500]})
        except Exception:
            pass

    def on_response(self, response: Any) -> None:
        if len(self.response_samples) >= 120:
            return
        try:
            req = response.request
            rt = getattr(req, "resource_type", None) or ""
            if rt not in {"image", "media", "font", "stylesheet"}:
                return
            self.response_samples.append(
                {
                    "url": (getattr(response, "url", "") or "")[:240],
                    "status": getattr(response, "status", 0),
                    "type": rt,
                }
            )
        except Exception:
            pass


def _attach_visual_import_network_debug(page: Any) -> _VisualImportNetworkDiag | None:
    if not _visual_import_debug_artifacts_enabled():
        return None
    diag = _VisualImportNetworkDiag()
    page.on("requestfailed", diag.on_request_failed)
    page.on("response", diag.on_response)
    return diag


def _log_visual_import_network_debug(
    diag: _VisualImportNetworkDiag | None,
    *,
    asset_probe: dict[str, Any] | None,
) -> None:
    if not _visual_import_debug_artifacts_enabled() or diag is None:
        return
    failed = diag.failed[:20]
    status_counts: dict[int, int] = {}
    for row in diag.response_samples:
        try:
            st = int(row.get("status") or 0)
        except (TypeError, ValueError):
            st = 0
        status_counts[st] = status_counts.get(st, 0) + 1
    logger.info(
        "visual_import network failed_total=%s sample(first20)=%s response_samples_n=%s status_histogram=%s",
        len(diag.failed),
        failed,
        len(diag.response_samples),
        status_counts,
    )
    if asset_probe:
        logger.info(
            "visual_import asset_probe collected=%s uniq_preloaded=%s videos_ready_ge2=%s video_total=%s",
            asset_probe.get("collected"),
            asset_probe.get("uniq"),
            asset_probe.get("videosReady2Plus"),
            asset_probe.get("videoTotal"),
        )


def normalize_visual_screenshot_payload_keys(block: dict[str, Any]) -> dict[str, Any]:
    """Return a shallow copy with canonical ``screenshot_data_url`` from snake_case or camelCase."""
    out = dict(block)
    url = out.get("screenshot_data_url") if out.get("screenshot_data_url") is not None else out.get("screenshotDataUrl")
    if url is not None and str(url).strip():
        out["screenshot_data_url"] = str(url).strip()
    out.pop("screenshotDataUrl", None)
    ff = out.get("font_faces_css")
    if ff is None:
        ff = out.get("fontFacesCss")
    if ff is not None and str(ff).strip():
        out["font_faces_css"] = str(ff).strip()
    out.pop("fontFacesCss", None)
    return out


def normalize_visual_scan_response(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize visual block keys in a ``scan_page_url`` / page-scan API payload."""
    if not isinstance(payload, dict):
        return payload
    blocks = payload.get("blocks")
    if not isinstance(blocks, list):
        return payload
    out = dict(payload)
    out["blocks"] = [normalize_visual_screenshot_payload_keys(b) if isinstance(b, dict) else b for b in blocks]
    raw_previews = out.get("visual_previews")
    if isinstance(raw_previews, dict):
        out["visual_previews"] = {
            k: normalize_visual_scan_response(v) if isinstance(v, dict) else v for k, v in raw_previews.items()
        }
    return out


def _log_visual_import_payload_debug(payload_blocks: list[dict[str, Any]], *, limit: int = 3) -> None:
    if not _visual_import_debug_enabled():
        return
    for block in payload_blocks[:limit]:
        bid = block.get("id")
        media_n = len(block.get("media_overlays") or [])
        fg = block.get("foreground_overlays") or []
        previews = [str(x.get("text") or "")[:60] for x in fg[:5]]
        logger.debug(
            "visual_import section id=%s media_overlays=%s foreground_overlays=%s preview_texts=%s",
            bid,
            media_n,
            len(fg),
            previews,
        )


def _log_visual_import_section_plan(
    section_blocks: list[dict[str, Any]],
    *,
    doc_page_height: int,
    image_height: int,
    header_found: bool,
    footer_found: bool,
) -> None:
    if not _visual_import_debug_enabled():
        return
    lines = [
        f"visual_import plan doc_h={doc_page_height} image_h={image_height} header_found={header_found} footer_found={footer_found}"
    ]
    for i, raw in enumerate(section_blocks[:_MAX_VISUAL_BLOCKS]):
        if not isinstance(raw, dict):
            continue
        kid = str(raw.get("kind") or "screenshot")
        dbg = raw.get("debug_clip") if isinstance(raw.get("debug_clip"), dict) else {}
        src = dbg.get("source") if isinstance(dbg, dict) else None
        lines.append(
            "  [%s] id=%s kind=%s top=%s height=%s debug_clip.source=%s"
            % (
                i,
                raw.get("id"),
                kid,
                raw.get("top"),
                raw.get("height"),
                src,
            )
        )
    lines.append(
        "visual_import order: "
        + " | ".join(str(b.get("id")) + ":" + str(b.get("kind") or "screenshot") for b in section_blocks[:_MAX_VISUAL_BLOCKS] if isinstance(b, dict))
    )
    logger.debug("\n".join(lines))


def _scale_visual_geometry_to_screenshot(
    *,
    doc_page_height: int,
    image_height: int,
    section_blocks: list[dict[str, Any]],
    raw_videos: list[dict[str, Any]] | None,
    raw_foreground: list[dict[str, Any]] | None,
) -> None:
    """Map document-space Y to full-page PNG pixels: scale = image_height / doc_page_height (crop uses PNG coords)."""
    if doc_page_height <= 0 or image_height <= 0:
        return
    ratio = image_height / float(doc_page_height)
    if abs(ratio - 1.0) < 0.002:
        return

    def scale_y(v: Any) -> int:
        try:
            return int(round(float(v) * ratio))
        except (TypeError, ValueError):
            return 0

    for block in section_blocks:
        if not isinstance(block, dict):
            continue
        block["top"] = scale_y(block.get("top") or 0)
        block["height"] = max(1, scale_y(block.get("height") or 1))
        dbg = block.get("debug_clip")
        if isinstance(dbg, dict):
            dbg["y"] = block["top"]
            dbg["height"] = block["height"]

    for v in raw_videos or []:
        if not isinstance(v, dict):
            continue
        if "docY" in v:
            v["docY"] = scale_y(v.get("docY"))
        if "docH" in v:
            v["docH"] = max(1, scale_y(v.get("docH")))

    for fg in raw_foreground or []:
        if not isinstance(fg, dict):
            continue
        if "docY" in fg:
            fg["docY"] = scale_y(fg.get("docY"))
        if "docH" in fg:
            fg["docH"] = max(1, scale_y(fg.get("docH")))


class PageScanError(Exception):
    pass


class PageScanUrlValidationError(PageScanError):
    pass


def _normalized_text(value: str) -> str:
    return " ".join((value or "").split()).strip()


def _normalize_foreground_overlay_text(value: str) -> str:
    """Preserve intentional line breaks from innerText; collapse spaces per line only."""
    s = (value or "").replace("\r\n", "\n").replace("\r", "\n")
    lines: list[str] = []
    for line in s.split("\n"):
        collapsed = " ".join(line.split()).strip()
        if collapsed:
            lines.append(collapsed)
    out = "\n".join(lines)
    while "\n\n\n" in out:
        out = out.replace("\n\n\n", "\n\n")
    return out.strip()


def _is_forbidden_ip(value: str) -> bool:
    try:
        parsed = ipaddress.ip_address(value)
    except ValueError:
        return False
    return bool(
        parsed.is_private
        or parsed.is_loopback
        or parsed.is_link_local
        or parsed.is_multicast
        or parsed.is_reserved
        or parsed.is_unspecified
    )


def validate_page_scan_url(raw_url: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        raise PageScanUrlValidationError("url_required")
    try:
        parsed = urlparse(url)
    except Exception as exc:  # pragma: no cover - defensive
        raise PageScanUrlValidationError("bad_url") from exc
    scheme = (parsed.scheme or "").lower()
    hostname = (parsed.hostname or "").strip().lower()
    if scheme not in ("http", "https"):
        raise PageScanUrlValidationError("unsupported_scheme")
    if not hostname:
        raise PageScanUrlValidationError("hostname_required")
    if hostname in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        raise PageScanUrlValidationError("forbidden_host")
    if _is_forbidden_ip(hostname):
        raise PageScanUrlValidationError("forbidden_ip")

    try:
        resolved = {
            item[4][0]
            for item in socket.getaddrinfo(
                hostname,
                parsed.port or (443 if scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        }
    except socket.gaierror:
        resolved = set()
    if any(_is_forbidden_ip(address) for address in resolved):
        raise PageScanUrlValidationError("forbidden_ip")
    return parsed.geturl()


def _read_response_text(response: requests.Response, *, max_bytes: int = _MAX_RESPONSE_BYTES) -> str:
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_content(chunk_size=65536):
        if not chunk:
            continue
        total += len(chunk)
        if total > max_bytes:
            raise PageScanError("response_too_large")
        chunks.append(chunk)
    body = b"".join(chunks)
    encoding = response.encoding or response.apparent_encoding or "utf-8"
    return body.decode(encoding, errors="replace")


def _fetch_page_html(url: str) -> tuple[str, str]:
    current_url = url
    for redirect_idx in range(_MAX_REDIRECTS + 1):
        current_url = validate_page_scan_url(current_url)
        response = requests.get(
            current_url,
            headers=_REQUEST_HEADERS,
            timeout=(3.05, 8.0),
            allow_redirects=False,
            stream=True,
        )
        try:
            if response.status_code in {301, 302, 303, 307, 308}:
                location = (response.headers.get("Location") or "").strip()
                if not location:
                    raise PageScanError("redirect_without_location")
                if redirect_idx >= _MAX_REDIRECTS:
                    raise PageScanError("too_many_redirects")
                current_url = urljoin(current_url, location)
                continue
            if response.status_code >= 400:
                raise PageScanError("fetch_failed")
            return current_url, _read_response_text(response)
        finally:
            response.close()
    raise PageScanError("too_many_redirects")


def _block_heading(element) -> str:
    heading = element.find(["h1", "h2", "h3"])
    return _normalized_text(heading.get_text(" ", strip=True) if heading else "")


def _block_preview_text(element, *, fallback: str = "") -> str:
    text = _normalized_text(element.get_text(" ", strip=True))
    if fallback and text.startswith(fallback):
        text = _normalized_text(text[len(fallback) :])
    if len(text) > 140:
        return text[:137].rstrip() + "..."
    return text


def _block_selector(element, *, fallback_prefix: str, position: int) -> tuple[str, str]:
    block_id = _normalized_text(element.get("id", ""))
    if block_id:
        return block_id, f"#{block_id}"
    class_names = [cls for cls in element.get("class", []) if isinstance(cls, str) and cls.strip()]
    if class_names:
        selector = "." + ".".join(class_names[:3])
    else:
        selector = element.name or "div"
    return f"{fallback_prefix}-{position}", selector


def _block_kind(element, *, text: str, title: str, position: int) -> str:
    lowered = f"{title} {text}".lower()
    if element.find("h1") or position == 1:
        return "hero"
    if element.find("form") or element.find("input") or any(k in lowered for k in _FORM_KEYWORDS):
        return "form"
    if any(k in lowered for k in _REVIEWS_KEYWORDS):
        return "reviews"
    if any(k in lowered for k in _PRODUCTS_KEYWORDS):
        return "products"
    return "generic"


def _visual_block_kind(*, text: str, title: str, position: int) -> str:
    lowered = f"{title} {text}".lower()
    if position == 1:
        return "hero"
    if any(k in lowered for k in _FORM_KEYWORDS):
        return "form"
    if any(k in lowered for k in _REVIEWS_KEYWORDS):
        return "reviews"
    if any(k in lowered for k in _PRODUCTS_KEYWORDS):
        return "products"
    return "generic"


def _png_bytes_to_data_url(png_bytes: bytes) -> str:
    return f"data:image/png;base64,{base64.b64encode(png_bytes).decode('ascii')}"


def _save_png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _encode_visual_section_image(image: Image.Image, *, max_bytes: int = _MAX_VISUAL_BLOCK_IMAGE_BYTES) -> tuple[bytes, int, int]:
    current = image
    png_bytes = _save_png_bytes(current)
    while len(png_bytes) > max_bytes and current.width > _MIN_VISUAL_DOWNSCALE_WIDTH:
        scale = max(0.72, min(0.9, (max_bytes / max(len(png_bytes), 1)) ** 0.5))
        next_width = max(_MIN_VISUAL_DOWNSCALE_WIDTH, int(current.width * scale))
        if next_width >= current.width:
            next_width = max(_MIN_VISUAL_DOWNSCALE_WIDTH, current.width - 80)
        if next_width >= current.width:
            break
        next_height = max(1, int(current.height * next_width / max(current.width, 1)))
        current = current.resize((next_width, next_height), Image.Resampling.LANCZOS)
        png_bytes = _save_png_bytes(current)
    return png_bytes, current.width, current.height


def _visual_block_title(*, title: str, position: int) -> str:
    normalized = _normalized_text(title)
    return normalized or f"Секция {position}"


def _overlay_pixel_fields(xp: float, yp: float, wp: float, hp: float, enc_w: int, enc_h: int) -> dict[str, int]:
    ew = max(1, int(enc_w))
    eh = max(1, int(enc_h))
    return {
        "x": int(round(float(xp) / 100.0 * ew)),
        "y": int(round(float(yp) / 100.0 * eh)),
        "width": int(round(float(wp) / 100.0 * ew)),
        "height": int(round(float(hp) / 100.0 * eh)),
    }


def _enrich_rect_overlays_with_pixels(overlays: list[dict[str, Any]], enc_w: int, enc_h: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in overlays or []:
        item = dict(raw)
        px = _overlay_pixel_fields(
            float(item.get("x_percent") or 0),
            float(item.get("y_percent") or 0),
            float(item.get("width_percent") or 0),
            float(item.get("height_percent") or 0),
            enc_w,
            enc_h,
        )
        item.update(px)
        out.append(item)
    return out


def _build_screenshot_block_payload(
    *,
    block: dict[str, Any],
    section_image: Image.Image,
    platform: str,
    media_overlays: list[dict[str, Any]] | None = None,
    foreground_overlays: list[dict[str, Any]] | None = None,
    font_faces_css: str | None = None,
) -> dict[str, Any]:
    png_bytes, width, height = _encode_visual_section_image(section_image)
    position = int(block.get("position") or 1)
    overlays = _enrich_rect_overlays_with_pixels(list(media_overlays or []), width, height)
    foreground = _enrich_rect_overlays_with_pixels(list(foreground_overlays or []), width, height)
    raw_kind = str(block.get("kind") or "").strip().lower()
    block_kind = (
        raw_kind
        if raw_kind in {"header", "footer", "first_screen", "section"}
        else "screenshot"
    )
    payload: dict[str, Any] = {
        "id": _normalized_text(str(block.get("id") or "")) or f"screenshot-section-{position}",
        "position": position,
        "title": _visual_block_title(title=str(block.get("title") or ""), position=position),
        "kind": block_kind,
        "selector": None,
        "platform": platform,
        "screenshot_data_url": _png_bytes_to_data_url(png_bytes),
        "width": width,
        "height": height,
        "media_overlays": overlays,
        "foreground_overlays": foreground,
    }
    ff = (font_faces_css or "").strip()
    if ff:
        payload["font_faces_css"] = ff
    dbg = block.get("debug_clip")
    if isinstance(dbg, dict):
        payload["debug_clip"] = dbg
    gid = _normalized_text(str(block.get("group_id") or block.get("groupId") or ""))
    if gid:
        payload["group_id"] = gid
    ic = block.get("is_continuation")
    if ic is None:
        ic = block.get("isContinuation")
    if ic is not None:
        payload["is_continuation"] = bool(ic)
    aib = block.get("allow_insert_before")
    if aib is None:
        aib = block.get("allowInsertBefore")
    if aib is not None:
        payload["allow_insert_before"] = bool(aib)
    aia = block.get("allow_insert_after")
    if aia is None:
        aia = block.get("allowInsertAfter")
    if aia is not None:
        payload["allow_insert_after"] = bool(aia)
    if block.get("transparent_capture") is not None:
        payload["transparent_capture"] = bool(block.get("transparent_capture"))
    return payload


def _visual_coverage_is_poor(blocks: list[dict[str, Any]], *, page_height: int) -> bool:
    if len(blocks) < 2 or page_height <= 0:
        return True
    covered = 0
    cursor = 0
    for block in sorted(blocks, key=lambda item: int(item.get("top") or 0)):
        top = max(0, min(page_height, int(block.get("top") or 0)))
        bottom = max(top, min(page_height, int(block.get("top") or 0) + int(block.get("height") or 0)))
        if bottom <= cursor:
            continue
        covered += bottom - max(top, cursor)
        cursor = bottom
    return (covered / page_height) < 0.4


def _build_visual_slice_blocks(*, page_height: int) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    capped_height = max(1, min(page_height, _MAX_VISUAL_PAGE_HEIGHT))
    top = 0
    position = 1
    while top < capped_height and len(blocks) < _MAX_VISUAL_BLOCKS:
        height = min(_VISUAL_SLICE_HEIGHT, capped_height - top)
        gid = f"fallback-slice-{position}"
        blocks.append(
            {
                "id": f"screenshot-section-{position}",
                "position": position,
                "title": f"Секция {position}",
                "top": top,
                "height": max(1, height),
                "group_id": gid,
                "is_continuation": False,
                "allow_insert_before": position == 1,
                "allow_insert_after": True,
                "debug_clip": {"y": top, "height": max(1, height), "source": "viewport-slice"},
            }
        )
        top += _VISUAL_SLICE_HEIGHT
        position += 1
    if blocks:
        blocks[-1]["allow_insert_after"] = True
    return blocks


def _is_http_media_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except Exception:
        return False
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _absolute_media_url(raw: str, *, base_url: str) -> str:
    value = (raw or "").strip()
    if not value:
        return ""
    lowered = value.lower()
    if lowered.startswith("blob:") or lowered.startswith("data:"):
        return ""
    if lowered.startswith("javascript:"):
        return ""
    joined = urljoin(base_url, value) if not _is_http_media_url(value) else value
    return joined.strip() if _is_http_media_url(joined) else ""


def _pick_html5_video_src(raw: dict[str, Any], *, page_url: str) -> str:
    for key in ("currentSrc", "srcAttr", "firstSourceSrc"):
        candidate = _absolute_media_url(str(raw.get(key) or ""), base_url=page_url)
        if candidate:
            return candidate
    return ""


def _pick_html5_video_poster(raw: dict[str, Any], *, page_url: str) -> str:
    return _absolute_media_url(str(raw.get("poster") or ""), base_url=page_url)


def _extract_visual_screenshot_bundle(page, section_blocks: list[dict[str, Any]]) -> dict[str, Any]:
    """HTML5 video metadata + foreground overlays.

    Videos are assigned to the slice with largest doc-space overlap (at most one slice per video).
    Foreground items are assigned the same way but emitted only for slices that contain a video overlay.
    """
    trimmed: list[dict[str, Any]] = []
    for raw in section_blocks[:_MAX_VISUAL_BLOCKS]:
        if not isinstance(raw, dict):
            continue
        try:
            top = int(raw.get("top") or 0)
            height = max(1, int(raw.get("height") or 1))
        except (TypeError, ValueError):
            continue
        trimmed.append({"top": top, "height": height})
    return page.evaluate(
        """
        ({ sectionBlocks, maxFgPerSection }) => {
          const minVideoW = 80;
          const minVideoH = 60;
          const scrollX = window.scrollX || window.pageXOffset || 0;
          const scrollY = window.scrollY || window.pageYOffset || 0;
          const viewportW = Math.round(
            Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0, 1),
          );

          function normalizeVisibleText(value) {
            return String(value || '')
              .replace(/\\r\\n/g, '\\n')
              .replace(/\\r/g, '\\n')
              .split('\\n')
              .map((line) => line.replace(/\\s+/g, ' ').trim())
              .filter(Boolean)
              .join('\\n')
              .replace(/\\n{3,}/g, '\\n\\n');
          }

          function collectFontFacesCss() {
            const chunks = [];
            try {
              const sheets = Array.from(document.styleSheets || []);
              for (const sheet of sheets) {
                let rules;
                try {
                  rules = sheet.cssRules;
                } catch (e) {
                  continue;
                }
                if (!rules) continue;
                for (let i = 0; i < rules.length; i += 1) {
                  try {
                    const rule = rules[i];
                    if (rule && rule.type === CSSRule.FONT_FACE_RULE) {
                      chunks.push(rule.cssText);
                    }
                  } catch (e) {
                    /* cross-origin or inaccessible rule */
                  }
                }
              }
            } catch (e) {
              /* ignore */
            }
            return chunks.join('\\n');
          }

          function hasUsableVideoSrc(el) {
            const cur = String(el.currentSrc || '').trim();
            const attr = String(el.getAttribute('src') || '').trim();
            let firstSource = '';
            const srcEl = el.querySelector('source[src]');
            if (srcEl) {
              try {
                firstSource = String(srcEl.src || '').trim();
              } catch (e) {
                firstSource = '';
              }
            }
            for (const c of [cur, attr, firstSource]) {
              if (!c) continue;
              const low = c.toLowerCase();
              if (low.startsWith('blob:') || low.startsWith('data:')) continue;
              if (low.startsWith('javascript:')) continue;
              return true;
            }
            return false;
          }

          function intersectDoc(ax, ay, aw, ah, sx, sy, sw, sh) {
            const left = Math.max(ax, sx);
            const top = Math.max(ay, sy);
            const right = Math.min(ax + aw, sx + sw);
            const bottom = Math.min(ay + ah, sy + sh);
            return right > left && bottom > top;
          }

          function cssPxNumber(v) {
            const m = String(v || '').trim().match(/^(-?\\d+(?:\\.\\d+)?)px$/i);
            return m ? Number(m[1]) : null;
          }

          function collectStyle(st) {
            return {
              color: st.color || '',
              font_family: st.fontFamily || '',
              font_size: st.fontSize || '',
              font_weight: st.fontWeight || '',
              line_height: st.lineHeight || '',
              text_align: st.textAlign || '',
              letter_spacing: st.letterSpacing || '',
              text_transform: st.textTransform || '',
              background_color: st.backgroundColor || '',
              border_radius: st.borderRadius || '',
              padding: st.padding || '',
              border: `${st.borderWidth || ''} ${st.borderStyle || ''} ${st.borderColor || ''}`.trim(),
              font_size_px: cssPxNumber(st.fontSize),
              line_height_px: cssPxNumber(st.lineHeight),
              letter_spacing_px: cssPxNumber(st.letterSpacing),
              border_radius_px: cssPxNumber(st.borderRadius),
            };
          }

          function overlayTypeFor(el, st) {
            const tag = el.tagName;
            if (tag === 'BUTTON' || el.getAttribute('role') === 'button') return 'button';
            if (tag === 'INPUT') {
              const t = String(el.getAttribute('type') || '').toLowerCase();
              if (t === 'button' || t === 'submit' || t === 'reset') return 'button';
            }
            if (tag === 'A') {
              const bg = String(st.backgroundColor || '');
              const hasBg =
                (st.backgroundImage && st.backgroundImage !== 'none') ||
                (!bg.includes('rgba(0, 0, 0, 0)') && !bg.endsWith(', 0)') && bg !== 'transparent');
              const pad = parseFloat(st.paddingTop || '0') + parseFloat(st.paddingBottom || '0');
              if (hasBg || pad > 3) return 'button';
            }
            return 'text';
          }

          function passesVisibility(el, cst) {
            if (el.hidden) return false;
            if (cst.display === 'none' || cst.visibility === 'hidden') return false;
            const op = Number(cst.opacity);
            if (!Number.isFinite(op) || op <= 0.05) return false;
            return true;
          }

          const semanticSelector = 'h1,h2,h3,p,a,button,[role="button"]';

          function hasSemanticDescendant(el) {
            try {
              return Boolean(el.querySelector(semanticSelector));
            } catch (e) {
              return false;
            }
          }

          function inChromeNav(el) {
            try {
              return Boolean(
                el.closest(
                  'header, nav, [role="navigation"], [role="banner"], footer, [role="contentinfo"]',
                ),
              );
            } catch (e) {
              return false;
            }
          }

          function looksLikeButtonToken(el) {
            const cls = String(el.className || '').toLowerCase();
            const id = String(el.id || '').toLowerCase();
            return /button|btn|cta|link|title|heading/i.test(`${cls} ${id}`);
          }

          function domDepth(el) {
            let d = 0;
            let n = el;
            while (n.parentElement) {
              d += 1;
              n = n.parentElement;
            }
            return d;
          }

          function tagRank(tagName) {
            const t = String(tagName || '').toUpperCase();
            const map = { BUTTON: 80, A: 70, H1: 60, H2: 55, H3: 50, P: 40, INPUT: 42 };
            if (map[t] != null) return map[t];
            if (t === 'SPAN') return 20;
            if (t === 'DIV') return 10;
            return 15;
          }

          const videos = [];
          for (const el of document.querySelectorAll('video')) {
            if (!(el instanceof HTMLVideoElement)) continue;
            if (!hasUsableVideoSrc(el)) continue;
            const st = window.getComputedStyle(el);
            if (!passesVisibility(el, st)) continue;
            const rect = el.getBoundingClientRect();
            const rw = Math.round(rect.width);
            const rh = Math.round(rect.height);
            if (rw < minVideoW || rh < minVideoH) continue;
            let firstSourceSrc = '';
            const srcEl0 = el.querySelector('source[src]');
            if (srcEl0) {
              try {
                firstSourceSrc = srcEl0.src || '';
              } catch (e) {
                firstSourceSrc = '';
              }
            }
            const docX = Math.round(rect.left + scrollX);
            const docY = Math.round(rect.top + scrollY);
            videos.push({
              docX,
              docY,
              docW: rw,
              docH: rh,
              currentSrc: el.currentSrc || '',
              srcAttr: el.getAttribute('src') || '',
              firstSourceSrc,
              poster: el.getAttribute('poster') || '',
              muted: !!el.muted,
              loop: !!el.loop,
              autoplay: !!el.autoplay,
              playsInline: !!el.playsInline,
            });
          }

          const sectionHasVideo = new Set();
          sectionBlocks.forEach((sec, bi) => {
            const sy = Number(sec.top) || 0;
            const sh = Math.max(1, Number(sec.height) || 1);
            for (const v of videos) {
              if (intersectDoc(v.docX, v.docY, v.docW, v.docH, 0, sy, viewportW, sh)) {
                sectionHasVideo.add(bi);
                break;
              }
            }
          });

          function sliceIntersectionArea(docLeft, docTop, docW, docH, bi) {
            const sec = sectionBlocks[bi];
            const sy = Number(sec.top) || 0;
            const sh = Math.max(1, Number(sec.height) || 1);
            const sx = 0;
            const sw = viewportW;
            const left = Math.max(docLeft, sx);
            const top = Math.max(docTop, sy);
            const right = Math.min(docLeft + docW, sx + sw);
            const bottom = Math.min(docTop + docH, sy + sh);
            const iw = Math.max(0, right - left);
            const ih = Math.max(0, bottom - top);
            return iw * ih;
          }

          function bestSliceForRect(docLeft, docTop, docW, docH) {
            let best = -1;
            let bestArea = -1;
            sectionBlocks.forEach((sec, bi) => {
              const a = sliceIntersectionArea(docLeft, docTop, docW, docH, bi);
              if (a > bestArea) {
                bestArea = a;
                best = bi;
              }
            });
            return bestArea > 0 ? best : -1;
          }

          const foreground = [];
          const items = [];

          document.querySelectorAll(semanticSelector).forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            if (node.closest('video')) return;
            const cst = window.getComputedStyle(node);
            if (!passesVisibility(node, cst)) return;
            const er = node.getBoundingClientRect();
            const docTop = Math.round(er.top + scrollY);
            const docLeft = Math.round(er.left + scrollX);
            const docW = Math.round(er.width);
            const docH = Math.round(er.height);
            if (docW <= 20 || docH <= 8) return;
            const rawText = String(node.innerText || node.textContent || '');
            const text = normalizeVisibleText(rawText);
            if (!text) return;
            const area = Math.max(1, er.width * er.height);
            items.push({ el: node, area, text, er, semantic: true });
          });

          document.querySelectorAll('div,span').forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            if (node.closest('video')) return;
            const tag = node.tagName;
            if (tag !== 'DIV' && tag !== 'SPAN') return;
            if (hasSemanticDescendant(node)) return;
            const cst = window.getComputedStyle(node);
            if (!passesVisibility(node, cst)) return;
            const er = node.getBoundingClientRect();
            const docTop = Math.round(er.top + scrollY);
            const docLeft = Math.round(er.left + scrollX);
            const docW = Math.round(er.width);
            const docH = Math.round(er.height);
            if (docW <= 20 || docH <= 8) return;
            const rawSpan = String(node.innerText || node.textContent || '');
            const text = normalizeVisibleText(rawSpan);
            if (text.length < 2 || text.length > 80) return;
            if (!looksLikeButtonToken(node)) return;
            const area = Math.max(1, er.width * er.height);
            items.push({ el: node, area, text, er, semantic: false });
          });

          items.sort((a, b) => {
            if (a.semantic !== b.semantic) return a.semantic ? -1 : 1;
            const depthDiff = domDepth(b.el) - domDepth(a.el);
            if (depthDiff !== 0) return depthDiff;
            return a.area - b.area;
          });

          const keptPass1 = [];
          for (const item of items) {
            for (let i = keptPass1.length - 1; i >= 0; i -= 1) {
              const k = keptPass1[i];
              if (k.el.contains(item.el) && normalizeVisibleText(k.text) === normalizeVisibleText(item.text)) {
                keptPass1.splice(i, 1);
              }
            }
            if (
              keptPass1.some(
                (k) => item.el.contains(k.el) && normalizeVisibleText(k.text) === normalizeVisibleText(item.text),
              )
            ) {
              continue;
            }
            keptPass1.push(item);
          }

          const textToBest = new Map();
          for (const item of keptPass1) {
            const key = normalizeVisibleText(item.text);
            if (!key) continue;
            const prev = textToBest.get(key);
            if (!prev || tagRank(item.el.tagName) > tagRank(prev.el.tagName)) {
              textToBest.set(key, item);
            }
          }
          const kept = Array.from(textToBest.values());

          kept.forEach((item) => {
            const node = item.el;
            const er = item.er;
            const docTop = Math.round(er.top + scrollY);
            const docLeft = Math.round(er.left + scrollX);
            const docW = Math.round(er.width);
            const docH = Math.round(er.height);
            const bi = bestSliceForRect(docLeft, docTop, docW, docH);
            if (bi < 0) return;
            if (!sectionHasVideo.has(bi) && !sectionBlocks[bi].transparent_capture) return;
            if (inChromeNav(node) && !sectionBlocks[bi].transparent_capture) return;
            const cst = window.getComputedStyle(node);
            const href =
              node.tagName === 'A' && node instanceof HTMLAnchorElement ? String(node.href || '') : '';
            let hasLineBreaks = false;
            try {
              hasLineBreaks = Boolean(node.querySelector('br')) || String(item.text || '').includes('\\n');
            } catch (e) {
              hasLineBreaks = String(item.text || '').includes('\\n');
            }
            foreground.push({
              section_index: bi,
              docX: docLeft,
              docY: docTop,
              docW,
              docH,
              type: overlayTypeFor(node, cst),
              text: item.text.slice(0, 500),
              href,
              has_line_breaks: hasLineBreaks,
              style: collectStyle(cst),
            });
          });

          foreground.sort((a, b) => {
            if (a.section_index !== b.section_index) return a.section_index - b.section_index;
            return a.docY - b.docY;
          });
          const fgTrimmed = [];
          const perSliceFg = new Map();
          foreground.forEach((row) => {
            const bi = row.section_index;
            const n = perSliceFg.get(bi) || 0;
            if (n >= maxFgPerSection) return;
            perSliceFg.set(bi, n + 1);
            fgTrimmed.push(row);
          });

          return { videos, foreground_overlays: fgTrimmed, font_faces_css: collectFontFacesCss() };
        }
        """,
        {"sectionBlocks": trimmed, "maxFgPerSection": _MAX_FOREGROUND_OVERLAYS_PER_SECTION},
    )


def _clip_video_rect_to_section(
    vx: int,
    vy: int,
    vw: int,
    vh: int,
    sx: int,
    sy: int,
    sw: int,
    sh: int,
) -> tuple[int, int, int, int] | None:
    left = max(vx, sx)
    top = max(vy, sy)
    right = min(vx + vw, sx + sw)
    bottom = min(vy + vh, sy + sh)
    if right <= left or bottom <= top:
        return None
    return left - sx, top - sy, right - left, bottom - top


def _rects_intersect(
    ax: int,
    ay: int,
    aw: int,
    ah: int,
    bx: int,
    by: int,
    bw: int,
    bh: int,
) -> bool:
    return ax < bx + bw and ax + aw > bx and ay < by + bh and ay + ah > by


def _intersection_area_pixels(
    vx: int,
    vy: int,
    vw: int,
    vh: int,
    sx: int,
    sy: int,
    sw: int,
    sh: int,
) -> int:
    clipped = _clip_video_rect_to_section(vx, vy, vw, vh, sx, sy, sw, sh)
    if not clipped:
        return 0
    _, _, cw, ch = clipped
    return max(0, cw) * max(0, ch)


def _prepare_html5_video_overlay_entries(
    raw_videos: list[dict[str, Any]],
    *,
    page_url: str,
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for raw in raw_videos or []:
        if not isinstance(raw, dict):
            continue
        src = _pick_html5_video_src(raw, page_url=page_url)
        if not src:
            continue
        poster = _pick_html5_video_poster(raw, page_url=page_url)
        try:
            doc_x = int(raw.get("docX") or 0)
            doc_y = int(raw.get("docY") or 0)
            doc_w = int(raw.get("docW") or 0)
            doc_h = int(raw.get("docH") or 0)
        except (TypeError, ValueError):
            continue
        if doc_w < _MIN_VIDEO_OVERLAY_WIDTH or doc_h < _MIN_VIDEO_OVERLAY_HEIGHT:
            continue
        entries.append(
            {
                "src": src,
                "poster": poster,
                "doc_x": doc_x,
                "doc_y": doc_y,
                "doc_w": doc_w,
                "doc_h": doc_h,
                "muted": bool(raw.get("muted")),
                "loop": bool(raw.get("loop")),
                "autoplay": bool(raw.get("autoplay")),
                "plays_inline": bool(raw.get("playsInline")),
            }
        )
    return entries


def _section_rects_for_visual_blocks(
    section_blocks: list[dict[str, Any]],
    *,
    section_x: int,
    section_width: int,
) -> list[tuple[int, int, int, int]]:
    rects: list[tuple[int, int, int, int]] = []
    for raw_block in section_blocks:
        try:
            sy = int(raw_block.get("top") or 0)
            sh = max(1, int(raw_block.get("height") or 1))
        except (TypeError, ValueError):
            rects.append((section_x, 0, section_width, 1))
            continue
        rects.append((section_x, sy, section_width, sh))
    return rects


def _best_section_index_for_rect(
    vx: int,
    vy: int,
    vw: int,
    vh: int,
    section_rects: list[tuple[int, int, int, int]],
) -> int:
    best_bi = -1
    best_area = -1
    for bi, (sx, sy, sw, sh) in enumerate(section_rects):
        area = _intersection_area_pixels(vx, vy, vw, vh, sx, sy, sw, sh)
        if area <= 0:
            continue
        if area > best_area or (area == best_area and bi < best_bi):
            best_area = area
            best_bi = bi
    return best_bi


def _percent_rect_in_section(
    rel_x: int,
    rel_y: int,
    rel_w: int,
    rel_h: int,
    sw: int,
    sh: int,
) -> dict[str, float]:
    sw_eff = max(1, sw)
    sh_eff = max(1, sh)
    return {
        "x_percent": round(rel_x / sw_eff * 100, 4),
        "y_percent": round(rel_y / sh_eff * 100, 4),
        "width_percent": round(rel_w / sw_eff * 100, 4),
        "height_percent": round(rel_h / sh_eff * 100, 4),
    }


def _assign_media_overlays_to_sections(
    section_blocks: list[dict[str, Any]],
    video_entries: list[dict[str, Any]],
    *,
    section_x: int,
    section_width: int,
) -> list[list[dict[str, Any]]]:
    """Each DOM video is attached to at most one section (largest overlap), avoiding duplicate players on slice boundaries."""
    trimmed = section_blocks[:_MAX_VISUAL_BLOCKS]
    per_block: list[list[dict[str, Any]]] = [[] for _ in trimmed]
    if not video_entries or not trimmed or section_width <= 0:
        return per_block

    section_rects = _section_rects_for_visual_blocks(trimmed, section_x=section_x, section_width=section_width)

    assignments: list[tuple[int, int, int, dict[str, Any]]] = []
    for entry in video_entries:
        vx = entry["doc_x"]
        vy = entry["doc_y"]
        vw = entry["doc_w"]
        vh = entry["doc_h"]
        best_bi = _best_section_index_for_rect(vx, vy, vw, vh, section_rects)
        if best_bi < 0:
            continue
        sx, sy, sw, sh = section_rects[best_bi]
        clipped = _clip_video_rect_to_section(vx, vy, vw, vh, sx, sy, sw, sh)
        if not clipped:
            continue
        rel_x, rel_y, rel_w, rel_h = clipped
        if rel_w < 1 or rel_h < 1:
            continue
        payload: dict[str, Any] = {
            "type": "video",
            "src": entry["src"],
            "poster": entry.get("poster") or "",
            "muted": bool(entry.get("muted")),
            "autoplay": bool(entry.get("autoplay")),
            "loop": bool(entry.get("loop")),
            "plays_inline": bool(entry.get("plays_inline")),
        }
        payload.update(_percent_rect_in_section(rel_x, rel_y, rel_w, rel_h, sw, sh))
        assignments.append((best_bi, vy, vx, payload))

    assignments.sort(key=lambda item: (item[0], item[1], item[2]))
    global_count = 0
    seen_src_per_block: list[set[str]] = [set() for _ in trimmed]
    for bi, _, _, payload in assignments:
        if global_count >= _MAX_MEDIA_OVERLAYS_PER_PAGE:
            break
        if len(per_block[bi]) >= _MAX_MEDIA_OVERLAYS_PER_SECTION:
            continue
        src_key = str(payload.get("src") or "")
        if src_key in seen_src_per_block[bi]:
            continue
        seen_src_per_block[bi].add(src_key)
        per_block[bi].append(payload)
        global_count += 1
    return per_block


def _assign_foreground_overlays_to_sections(
    section_blocks: list[dict[str, Any]],
    foreground_raw: list[dict[str, Any]],
    *,
    section_x: int,
    section_width: int,
    page_url: str,
) -> list[list[dict[str, Any]]]:
    trimmed = section_blocks[:_MAX_VISUAL_BLOCKS]
    per_block: list[list[dict[str, Any]]] = [[] for _ in trimmed]
    if not foreground_raw or not trimmed or section_width <= 0:
        return per_block

    section_rects = _section_rects_for_visual_blocks(trimmed, section_x=section_x, section_width=section_width)
    pooled: list[tuple[int, int, int, dict[str, Any]]] = []

    for fg in foreground_raw or []:
        if not isinstance(fg, dict):
            continue
        try:
            bi = int(fg.get("section_index", -1))
        except (TypeError, ValueError):
            continue
        if bi < 0 or bi >= len(section_rects):
            continue
        sx, sy, sw, sh = section_rects[bi]
        try:
            ex = int(fg.get("docX") or 0)
            ey = int(fg.get("docY") or 0)
            ew = int(fg.get("docW") or 0)
            eh = int(fg.get("docH") or 0)
        except (TypeError, ValueError):
            continue
        clipped = _clip_video_rect_to_section(ex, ey, ew, eh, sx, sy, sw, sh)
        if not clipped:
            continue
        rel_x, rel_y, rel_w, rel_h = clipped
        if rel_w < 1 or rel_h < 1:
            continue
        fg_type = str(fg.get("type") or "text").strip().lower()
        if fg_type not in {"text", "button"}:
            fg_type = "text"
        href_raw = str(fg.get("href") or "").strip()
        href = _absolute_media_url(href_raw, base_url=page_url) if href_raw else ""
        style = fg.get("style") if isinstance(fg.get("style"), dict) else {}
        raw_txt = str(fg.get("text") or "")
        payload: dict[str, Any] = {
            "type": fg_type,
            "text": _normalize_foreground_overlay_text(raw_txt)[:500],
            "href": href,
        }
        if not payload["text"]:
            continue
        hb = fg.get("has_line_breaks")
        if hb is True or (isinstance(hb, str) and hb.lower() in {"1", "true", "yes"}):
            payload["has_line_breaks"] = True
        payload.update(_percent_rect_in_section(rel_x, rel_y, rel_w, rel_h, sw, sh))
        payload["style"] = style
        pooled.append((bi, ey, ex, payload))

    pooled.sort(key=lambda item: (item[0], item[1], item[2]))
    seen: set[tuple[int, int, str, str]] = set()
    for bi, _, _, payload in pooled:
        if len(per_block[bi]) >= _MAX_FOREGROUND_OVERLAYS_PER_SECTION:
            continue
        key = (
            int(round(float(payload.get("x_percent") or 0) * 100)),
            int(round(float(payload.get("y_percent") or 0) * 100)),
            payload.get("type") or "",
            (payload.get("text") or "")[:80],
        )
        if key in seen:
            continue
        seen.add(key)
        per_block[bi].append(payload)
    return per_block


def _generic_slice_has_apparent_imagery(section_image: Image.Image) -> bool:
    """Heuristic: slice likely contains photos/UI (not only flat placeholder fill)."""
    if section_image.width < 8 or section_image.height < 8:
        return False
    gray = section_image.convert("L")
    stat = ImageStat.Stat(gray)
    std = float(stat.stddev[0])
    if std >= 20.0:
        return True
    w = max(32, min(320, section_image.width // 6))
    h = max(32, min(320, section_image.height // 6))
    small = gray.resize((w, h), Image.Resampling.BILINEAR)
    px = small.getdata()
    n = small.width * small.height
    if n < 64:
        return std >= 14.0
    mean = sum(px) / float(n)
    var = sum((float(p) - mean) ** 2 for p in px) / float(n)
    return (var**0.5) >= 15.0


def _generic_visual_slice_should_drop(
    section_image: Image.Image,
    *,
    has_video: bool,
    has_fg: bool,
    is_first_slice: bool,
    is_last_slice: bool,
) -> bool:
    """Drop generic middle viewport slices that look like empty dark filler (never first/last)."""
    if is_first_slice or is_last_slice:
        return False
    if has_video or has_fg:
        return False
    if _generic_slice_has_apparent_imagery(section_image):
        return False
    if section_image.height < 82:
        return True
    thumb = section_image.copy()
    thumb.thumbnail((240, 240), Image.Resampling.BILINEAR)
    gray = thumb.convert("L")
    stat = ImageStat.Stat(gray)
    mean = float(stat.mean[0])
    std = float(stat.stddev[0])
    return mean < 54.0 and std < 16.0


def _crop_visual_sections(
    *,
    screenshot_bytes: bytes,
    blocks: list[dict[str, Any]],
    platform: str,
    page_url: str = "",
    raw_html5_videos: list[dict[str, Any]] | None = None,
    raw_foreground_overlays: list[dict[str, Any]] | None = None,
    font_faces_css: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    image = Image.open(BytesIO(screenshot_bytes))
    image.load()
    if image.mode not in {"RGB", "RGBA"}:
        image = image.convert("RGBA")

    section_width = max(1, int(image.width))
    video_entries = _prepare_html5_video_overlay_entries(raw_html5_videos or [], page_url=page_url)
    visual_video_count = len(video_entries)
    overlays_per_block = _assign_media_overlays_to_sections(
        blocks,
        video_entries,
        section_x=0,
        section_width=section_width,
    )
    foreground_per_block = _assign_foreground_overlays_to_sections(
        blocks,
        list(raw_foreground_overlays or []),
        section_x=0,
        section_width=section_width,
        page_url=page_url,
    )

    trimmed_blocks = blocks[:_MAX_VISUAL_BLOCKS]
    # ``top`` / ``height`` on blocks must already match this PNG if ``_scale_visual_geometry_to_screenshot`` ran.
    staged: list[tuple[dict[str, Any], Image.Image, int, int]] = []
    for bi, raw_block in enumerate(trimmed_blocks):
        top = max(0, min(image.height - 1, int(raw_block.get("top") or 0)))
        raw_h = int(raw_block.get("height") or 0)
        clip_bottom = min(image.height, top + max(1, raw_h))
        height = max(1, clip_bottom - top)
        if height <= 0:
            continue
        section_image = image.crop((0, top, image.width, top + height))
        staged.append((raw_block, section_image, bi, top))

    payload_blocks: list[dict[str, Any]] = []
    for raw_block, section_image, bi, top in staged:
        block_overlays = overlays_per_block[bi] if bi < len(overlays_per_block) else []
        block_fg = foreground_per_block[bi] if bi < len(foreground_per_block) else []
        has_video = any(str(o.get("type") or "") == "video" for o in block_overlays)
        has_fg = bool(block_fg)
        # First/last are logical slice indices, not geometry: rounding vs PNG height must not drop footer/header.
        is_first_slice = bi == 0
        is_last_slice = bi == len(trimmed_blocks) - 1
        if platform == "generic" and _generic_visual_slice_should_drop(
            section_image,
            has_video=has_video,
            has_fg=has_fg,
            is_first_slice=is_first_slice,
            is_last_slice=is_last_slice,
        ):
            continue
        payload_blocks.append(
            _build_screenshot_block_payload(
                block=raw_block,
                section_image=section_image,
                platform=platform,
                media_overlays=block_overlays,
                foreground_overlays=block_fg,
                font_faces_css=font_faces_css,
            )
        )
    for pos, pb in enumerate(payload_blocks, start=1):
        pb["position"] = pos
    return payload_blocks, visual_video_count


_FORCE_LAZY_MEDIA_JS = r"""
() => {
  document.querySelectorAll("img[loading='lazy']").forEach((img) => { img.loading = "eager"; });
  document.querySelectorAll("img[data-src]").forEach((img) => {
    const v = img.getAttribute("data-src");
    if (v && !(img.getAttribute("src") || "").trim()) img.src = v;
  });
  document.querySelectorAll("img[data-srcset]").forEach((img) => {
    const v = img.getAttribute("data-srcset");
    if (v && !(img.getAttribute("srcset") || "").trim()) img.srcset = v;
  });
  document.querySelectorAll("img[data-lazy-src]").forEach((img) => {
    const v = img.getAttribute("data-lazy-src");
    if (v && !(img.getAttribute("src") || "").trim()) img.src = v;
  });
  document.querySelectorAll("source[data-src]").forEach((el) => {
    const v = el.getAttribute("data-src");
    if (v && !(el.getAttribute("src") || "").trim()) el.src = v;
  });
  document.querySelectorAll("source[data-srcset]").forEach((el) => {
    const v = el.getAttribute("data-srcset");
    if (v && !(el.getAttribute("srcset") || "").trim()) el.srcset = v;
  });
  document.querySelectorAll("[data-bg], [data-background], [data-background-image], [data-bgset]").forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const raw =
      el.getAttribute("data-bg") ||
      el.getAttribute("data-background") ||
      el.getAttribute("data-background-image") ||
      el.getAttribute("data-bgset");
    if (!raw) return;
    const first = raw.split(",")[0].trim().split(/\s+/)[0];
    try {
      const abs = new URL(first, document.baseURI).href;
      if (abs.startsWith("data:") || abs.startsWith("blob:")) return;
      el.style.backgroundImage = "url(" + JSON.stringify(abs) + ")";
    } catch (e) {}
  });
}
"""

_PRIME_VIDEOS_FOR_CAPTURE_JS = r"""
() => {
  document.querySelectorAll("video").forEach((v) => {
    try {
      v.muted = true;
      v.playsInline = true;
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) {}
  });
}
"""

VISUAL_COLLECT_ASSET_URLS_JS = r"""
(viewportOnly) => {
  const vOnly = Boolean(viewportOnly);
  function absUrl(raw) {
    if (raw == null || raw === "") return null;
    const t = String(raw).trim().split(/\s+/)[0];
    if (!t || t.startsWith("data:") || t.startsWith("blob:") || t.toLowerCase() === "none") return null;
    if (/^(linear|radial|conic)-gradient\(/i.test(t)) return null;
    try {
      return new URL(t, document.baseURI).href;
    } catch (e) {
      return null;
    }
  }
  function parseCssUrls(bg) {
    const out = [];
    if (!bg || bg === "none") return out;
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    let m;
    while ((m = re.exec(bg)) !== null) {
      const u = absUrl(m[2]);
      if (u) out.push(u);
    }
    return out;
  }
  function inVp(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  }
  const set = new Set();
  const addOne = (raw) => {
    const u = absUrl(raw);
    if (u) set.add(u);
  };
  const addSrcset = (raw) => {
    if (!raw) return;
    raw.split(",").forEach((part) => addOne(part.trim().split(/\s+/)[0]));
  };

  document.querySelectorAll("img").forEach((img) => {
    if (vOnly && !inVp(img)) return;
    addOne(img.currentSrc || img.src || "");
    addOne(img.getAttribute("src") || "");
  });
  document.querySelectorAll("picture source").forEach((s) => {
    if (vOnly && !inVp(s)) return;
    addSrcset(s.getAttribute("srcset") || "");
    addOne(s.getAttribute("src") || "");
  });
  document.querySelectorAll("video").forEach((v) => {
    if (vOnly && !inVp(v)) return;
    addOne(v.getAttribute("poster") || "");
    addOne(v.currentSrc || v.src || "");
    v.querySelectorAll("source").forEach((ss) => addOne(ss.getAttribute("src") || ""));
  });
  document.querySelectorAll("source").forEach((s) => {
    if (s.closest("video")) return;
    if (vOnly && !inVp(s)) return;
    addSrcset(s.getAttribute("srcset") || "");
    addOne(s.getAttribute("src") || "");
  });
  document
    .querySelectorAll(
      "[data-src],[data-srcset],[data-bg],[data-background],[data-background-image],[data-bgset],[data-lazy-src]"
    )
    .forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (vOnly && !inVp(el)) return;
      [
        "data-src",
        "data-srcset",
        "data-bg",
        "data-background",
        "data-background-image",
        "data-bgset",
        "data-lazy-src",
      ].forEach((attr) => {
        const raw = el.getAttribute(attr);
        if (!raw) return;
        if (attr.endsWith("set")) addSrcset(raw);
        else addOne(raw);
      });
    });

  let walked = 0;
  const cap = 12000;
  const root = document.body || document.documentElement;
  if (root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = tw.nextNode()) && walked < cap) {
      walked += 1;
      if (!(n instanceof HTMLElement)) continue;
      if (vOnly && !inVp(n)) continue;
      let st;
      try {
        st = window.getComputedStyle(n);
      } catch (e) {
        continue;
      }
      parseCssUrls(st.backgroundImage || "").forEach((u) => set.add(u));
      if (n.style && n.style.backgroundImage) parseCssUrls(n.style.backgroundImage).forEach((u) => set.add(u));
    }
  }
  return Array.from(set);
}
"""

_VISUAL_COLLECT_PRELOAD_AND_VIDEO_JS = r"""
async (opts) => {
  const perUrl = Math.max(200, Math.min(9000, Number(opts.perUrlTimeoutMs) || 4500));
  const maxUrls = Math.max(10, Math.min(900, Number(opts.maxUrls) || 200));
  const viewportOnly = Boolean(opts.viewportOnly);
  const treeCap = Math.max(2000, Math.min(20000, Number(opts.treeCap) || 12000));

  function absUrl(raw) {
    if (raw == null || raw === "") return null;
    const t = String(raw).trim().split(/\s+/)[0];
    if (!t || t.startsWith("data:") || t.startsWith("blob:") || t.toLowerCase() === "none") return null;
    if (/^(linear|radial|conic)-gradient\(/i.test(t)) return null;
    try {
      return new URL(t, document.baseURI).href;
    } catch (e) {
      return null;
    }
  }
  function parseCssUrls(bg) {
    const out = [];
    if (!bg || bg === "none") return out;
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    let m;
    while ((m = re.exec(bg)) !== null) {
      const u = absUrl(m[2]);
      if (u) out.push(u);
    }
    return out;
  }
  function inVp(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  }
  const vOnly = viewportOnly;
  const set = new Set();
  const addOne = (raw) => {
    const u = absUrl(raw);
    if (u) set.add(u);
  };
  const addSrcset = (raw) => {
    if (!raw) return;
    raw.split(",").forEach((part) => addOne(part.trim().split(/\s+/)[0]));
  };

  document.querySelectorAll("img").forEach((img) => {
    if (vOnly && !inVp(img)) return;
    addOne(img.currentSrc || img.src || "");
    addOne(img.getAttribute("src") || "");
  });
  document.querySelectorAll("picture source").forEach((s) => {
    if (vOnly && !inVp(s)) return;
    addSrcset(s.getAttribute("srcset") || "");
    addOne(s.getAttribute("src") || "");
  });
  document.querySelectorAll("video").forEach((v) => {
    if (vOnly && !inVp(v)) return;
    addOne(v.getAttribute("poster") || "");
    addOne(v.currentSrc || v.src || "");
    v.querySelectorAll("source").forEach((ss) => addOne(ss.getAttribute("src") || ""));
  });
  document.querySelectorAll("source").forEach((s) => {
    if (s.closest("video")) return;
    if (vOnly && !inVp(s)) return;
    addSrcset(s.getAttribute("srcset") || "");
    addOne(s.getAttribute("src") || "");
  });
  document
    .querySelectorAll(
      "[data-src],[data-srcset],[data-bg],[data-background],[data-background-image],[data-bgset],[data-lazy-src]"
    )
    .forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (vOnly && !inVp(el)) return;
      [
        "data-src",
        "data-srcset",
        "data-bg",
        "data-background",
        "data-background-image",
        "data-bgset",
        "data-lazy-src",
      ].forEach((attr) => {
        const raw = el.getAttribute(attr);
        if (!raw) return;
        if (attr.endsWith("set")) addSrcset(raw);
        else addOne(raw);
      });
    });

  let walked = 0;
  const root = document.body || document.documentElement;
  if (root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = tw.nextNode()) && walked < treeCap) {
      walked += 1;
      if (!(n instanceof HTMLElement)) continue;
      if (vOnly && !inVp(n)) continue;
      let st;
      try {
        st = window.getComputedStyle(n);
      } catch (e) {
        continue;
      }
      parseCssUrls(st.backgroundImage || "").forEach((u) => set.add(u));
      if (n.style && n.style.backgroundImage) parseCssUrls(n.style.backgroundImage).forEach((u) => set.add(u));
    }
  }

  const uniq = Array.from(set).slice(0, maxUrls);
  await Promise.all(
    uniq.map(
      (url) =>
        new Promise((resolve) => {
          const im = new Image();
          const t = window.setTimeout(resolve, perUrl);
          const done = () => {
            window.clearTimeout(t);
            resolve();
          };
          im.onload = done;
          im.onerror = done;
          im.src = url;
        })
    )
  );

  const videos = Array.from(document.querySelectorAll("video")).filter((v) => !vOnly || inVp(v));
  const vTimeout = Math.min(perUrl, 4000);
  await Promise.all(
    videos.map(
      (v) =>
        new Promise((resolve) => {
          if (v.readyState >= 2) return resolve();
          const t = window.setTimeout(resolve, vTimeout);
          const done = () => {
            window.clearTimeout(t);
            resolve();
          };
          v.addEventListener("loadeddata", done, { once: true });
          v.addEventListener("loadedmetadata", done, { once: true });
          v.addEventListener("error", done, { once: true });
        })
    )
  );

  let vidOk = 0;
  document.querySelectorAll("video").forEach((v) => {
    if (v.readyState >= 2) vidOk += 1;
  });
  return {
    collected: set.size,
    uniq: uniq.length,
    videosReady2Plus: vidOk,
    videoTotal: document.querySelectorAll("video").length,
  };
}
"""

_GET_DOCUMENT_SCROLL_HEIGHT_JS = """
() => Math.max(
  document.body ? document.body.scrollHeight : 0,
  document.documentElement ? document.documentElement.scrollHeight : 0
)
"""

_WAIT_ALL_IMAGES_JS = """
async (timeoutMs) => {
  const imgs = Array.from(document.images || []);
  await Promise.all(imgs.map((img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => resolve();
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      setTimeout(done, timeoutMs);
    });
  }));
}
"""

_IMAGE_LOAD_STATS_JS = """
() => {
  const imgs = Array.from(document.images || []);
  let ok = 0;
  for (const i of imgs) {
    if (i.complete && i.naturalWidth > 0) ok += 1;
  }
  return { total: imgs.length, completeNatural: ok };
}
"""

# Public aliases for regression tests (same strings as private constants above).
VISUAL_WARMUP_FORCE_LAZY_MEDIA_JS = _FORCE_LAZY_MEDIA_JS
VISUAL_WARMUP_WAIT_ALL_IMAGES_JS = _WAIT_ALL_IMAGES_JS
VISUAL_WARMUP_IMAGE_STATS_JS = _IMAGE_LOAD_STATS_JS
VISUAL_COLLECT_AND_PRELOAD_JS = _VISUAL_COLLECT_PRELOAD_AND_VIDEO_JS


def _warmup_page_before_visual_screenshot(page) -> dict[str, Any]:
    """Scroll like a user; preload img/CSS-bg/video URLs so full-page PNG is not empty placeholders."""
    page.evaluate(_FORCE_LAZY_MEDIA_JS)
    page.evaluate(_PRIME_VIDEOS_FOR_CAPTURE_JS)
    vp = page.viewport_size or {}
    vh = int(vp.get("height") or _VISUAL_VIEWPORT_HEIGHT)
    step = max(120, int(vh * _VISUAL_SCROLL_STEP_VIEWPORT_RATIO))
    max_iterations = 240
    y = 0
    for _ in range(max_iterations):
        page_height = int(page.evaluate(_GET_DOCUMENT_SCROLL_HEIGHT_JS))
        if page_height <= 0:
            break
        if y >= page_height - 2:
            break
        page.evaluate("(yy) => { window.scrollTo(0, yy); }", int(min(y, max(0, page_height - 1))))
        page.wait_for_timeout(random.randint(_VISUAL_SCROLL_STEP_WAIT_MS_MIN, _VISUAL_SCROLL_STEP_WAIT_MS_MAX))
        page.evaluate(_FORCE_LAZY_MEDIA_JS)
        try:
            page.evaluate(
                _VISUAL_COLLECT_PRELOAD_AND_VIDEO_JS,
                {
                    "perUrlTimeoutMs": _VISUAL_PRELOAD_PER_URL_TIMEOUT_MS,
                    "maxUrls": _VISUAL_PRELOAD_MAX_URLS_PER_STEP,
                    "viewportOnly": True,
                    "treeCap": _VISUAL_TREE_WALK_CAP,
                },
            )
        except Exception:
            pass
        try:
            page.evaluate(_WAIT_ALL_IMAGES_JS, _VISUAL_STEP_IMAGE_WAIT_MS)
        except Exception:
            pass
        try:
            page.evaluate(_PRIME_VIDEOS_FOR_CAPTURE_JS)
        except Exception:
            pass
        y += step
    page.evaluate("() => { window.scrollTo(0, document.documentElement.scrollHeight); }")
    page.wait_for_timeout(random.randint(_VISUAL_BOTTOM_SCROLL_WAIT_MS_MIN, _VISUAL_BOTTOM_SCROLL_WAIT_MS_MAX))
    page.evaluate(_FORCE_LAZY_MEDIA_JS)
    bottom_probe: dict[str, Any] = {}
    try:
        raw_bp = page.evaluate(
            _VISUAL_COLLECT_PRELOAD_AND_VIDEO_JS,
            {
                "perUrlTimeoutMs": _VISUAL_PRELOAD_PER_URL_TIMEOUT_MS,
                "maxUrls": _VISUAL_PRELOAD_MAX_URLS_BOTTOM,
                "viewportOnly": False,
                "treeCap": _VISUAL_TREE_WALK_CAP,
            },
        )
        if isinstance(raw_bp, dict):
            bottom_probe = raw_bp
    except Exception:
        bottom_probe = {}
    try:
        page.evaluate(_WAIT_ALL_IMAGES_JS, _VISUAL_FINAL_IMAGE_WAIT_MS)
    except Exception:
        pass
    try:
        page.evaluate(_PRIME_VIDEOS_FOR_CAPTURE_JS)
    except Exception:
        pass
    page.evaluate("() => { window.scrollTo(0, 0); }")
    page.wait_for_timeout(random.randint(_VISUAL_TOP_RESET_WAIT_MS_MIN, _VISUAL_TOP_RESET_WAIT_MS_MAX))
    return bottom_probe


def normalize_visual_preview_mode(value: str | None) -> str:
    mode = (value or "").strip().lower()
    return mode if mode in _VISUAL_VIEWPORT_PROFILES else "desktop"


def visual_viewport_profile(mode: str | None) -> dict[str, Any]:
    normalized = normalize_visual_preview_mode(mode)
    return dict(_VISUAL_VIEWPORT_PROFILES[normalized], mode=normalized)


def _decode_png_data_url(data_url: str) -> bytes | None:
    prefix = "data:image/png;base64,"
    if not str(data_url).startswith(prefix):
        return None
    try:
        return base64.b64decode(str(data_url)[len(prefix) :].strip())
    except Exception:
        return None


def _write_visual_import_debug_artifacts(
    *,
    screenshot_bytes: bytes,
    payload_blocks: list[dict[str, Any]],
    section_blocks: list[dict[str, Any]],
    page_height_doc: int,
    shot_h: int,
    img_stats: dict[str, Any],
) -> None:
    if not _visual_import_debug_artifacts_enabled():
        return
    tmp = Path(tempfile.gettempdir())
    try:
        (tmp / "referrals-page-scan-full.png").write_bytes(screenshot_bytes)
    except OSError as exc:
        logger.warning("visual_import debug: could not write full screenshot: %s", exc)
        return
    for idx, pb in enumerate(payload_blocks[:2]):
        raw = _decode_png_data_url(str(pb.get("screenshot_data_url") or ""))
        if raw:
            try:
                (tmp / f"referrals-page-scan-slice-first-{idx}.png").write_bytes(raw)
            except OSError:
                pass
    tail = payload_blocks[-2:] if len(payload_blocks) >= 2 else list(payload_blocks)
    for idx, pb in enumerate(tail):
        raw = _decode_png_data_url(str(pb.get("screenshot_data_url") or ""))
        if raw:
            try:
                (tmp / f"referrals-page-scan-slice-last-{idx}.png").write_bytes(raw)
            except OSError:
                pass
    fb = section_blocks[0] if section_blocks else {}
    lb = section_blocks[-1] if section_blocks else {}
    logger.info(
        "visual_import debug capture pageHeight=%s screenshotImageHeight=%s payload_slices=%s "
        "first_slice_y=%s first_slice_h=%s last_slice_y=%s last_slice_h=%s document.images=%s img_complete_natural=%s",
        page_height_doc,
        shot_h,
        len(payload_blocks),
        fb.get("top"),
        fb.get("height"),
        lb.get("top"),
        lb.get("height"),
        img_stats.get("total"),
        img_stats.get("completeNatural"),
    )


def _extract_visual_section_candidates(page) -> dict[str, Any]:
    return page.evaluate(
        """
        ({ maxBlocks, minWidth, minHeight, maxHeight }) => {
          const body = document.body;
          const root = document.documentElement;
          const scrollY = window.scrollY || window.pageYOffset || 0;
          const pageHeight = Math.round(
            Math.min(
              Math.max(
                root?.scrollHeight || 0,
                body?.scrollHeight || 0,
                root?.offsetHeight || 0,
                body?.offsetHeight || 0,
                root?.clientHeight || 0,
              ),
              12000,
            ),
          );
          const pageWidth = Math.round(
            Math.max(
              root?.clientWidth || 0,
              window.innerWidth || 0,
              body?.clientWidth || 0,
            ),
          );
          const vh = Math.round(Math.max(window.innerHeight || 0, root?.clientHeight || 0, 480));
          const sliceH = Math.min(900, vh);

          const visibleEnough = (node) => {
            if (!(node instanceof HTMLElement)) return false;
            const st = window.getComputedStyle(node);
            if (node.hidden || st.display === 'none' || st.visibility === 'hidden') return false;
            const op = Number(st.opacity);
            if (!Number.isFinite(op) || op <= 0.03) return false;
            return true;
          };

          const verticalCover = (a, b) => {
            const a1 = a.top + a.height;
            const b1 = b.top + b.height;
            const ov = Math.max(0, Math.min(a1, b1) - Math.max(a.top, b.top));
            return ov / Math.max(1, Math.min(a.height, b.height));
          };

          const pickChromeBlocks = () => {
            const minW = Math.round(pageWidth * 0.6);
            const isTransparentCssColor = (value) => {
              const s = String(value || '').toLowerCase().replace(/\s/g, '');
              return (
                !s ||
                s === 'transparent' ||
                s === 'rgba(0,0,0,0)' ||
                s.startsWith('rgba(0,0,0,0)') ||
                s.startsWith('rgba(0,0,0,0.0)')
              );
            };
            const isTransparentCaptureElement = (el, st) => {
              if (!el || !st) return false;
              const op = Number(st.opacity);
              if (Number.isFinite(op) && op <= 0.98) return true;
              const bgImage = String(st.backgroundImage || '').trim().toLowerCase();
              if (bgImage && bgImage !== 'none') return false;
              if (!isTransparentCssColor(st.backgroundColor)) return false;
              for (const pseudo of ['::before', '::after']) {
                const pst = window.getComputedStyle(el, pseudo);
                const pImg = String(pst.backgroundImage || '').trim().toLowerCase();
                if (pImg && pImg !== 'none') return false;
                if (!isTransparentCssColor(pst.backgroundColor)) return false;
              }
              return true;
            };
            const headerCandidates = [];
            const pushHeader = (el) => {
              if (!(el instanceof HTMLElement) || !visibleEnough(el)) return;
              const st = window.getComputedStyle(el);
              const pr = el.getBoundingClientRect();
              const w = Math.round(pr.width);
              const h0 = Math.round(pr.height);
              if (w < minW || h0 < 40 || h0 > 320) return;
              const y0 = Math.max(0, Math.round(pr.top + scrollY));
              const pos = st.position;
              const topPx = parseFloat(st.top || '0') || 0;
              const isFixedTop = (pos === 'fixed' || pos === 'sticky') && topPx <= 20;
              const isFlowTop = y0 <= 120;
              if (!isFixedTop && !isFlowTop) return;
              headerCandidates.push({ el, y0, h0, fixed: isFixedTop, w, pos, st });
            };

            document.querySelectorAll('header, [role="banner"], body > nav').forEach(pushHeader);
            document.querySelectorAll('nav').forEach((el) => {
              if (!(el instanceof HTMLElement)) return;
              const y0 = Math.max(0, Math.round(el.getBoundingClientRect().top + scrollY));
              if (y0 <= 140) pushHeader(el);
            });
            document.querySelectorAll('[role="navigation"]').forEach((el) => {
              if (!(el instanceof HTMLElement)) return;
              const y0 = Math.max(0, Math.round(el.getBoundingClientRect().top + scrollY));
              if (y0 <= 140) pushHeader(el);
            });
            document.querySelectorAll('body > div').forEach((el) => {
              if (!(el instanceof HTMLElement)) return;
              const st = window.getComputedStyle(el);
              if (st.position !== 'fixed' && st.position !== 'sticky') return;
              if ((parseFloat(st.top || '0') || 0) > 20) return;
              pushHeader(el);
            });

            headerCandidates.sort((a, b) => a.y0 - b.y0 || a.h0 - b.h0);
            const headerPick = headerCandidates.length ? headerCandidates[0] : null;

            const footerCandidates = [];
            const pushFooter = (el) => {
              if (!(el instanceof HTMLElement) || !visibleEnough(el)) return;
              const pr = el.getBoundingClientRect();
              const w = Math.round(pr.width);
              const h0 = Math.round(pr.height);
              if (w < minW || h0 < 60) return;
              const y0 = Math.max(0, Math.round(pr.top + scrollY));
              const footerSlack = Math.max(120, Math.min(400, Math.round(pageHeight * 0.09)));
              if (y0 + h0 < pageHeight - footerSlack) return;
              footerCandidates.push({ el, y0, h0, bottom: y0 + h0 });
            };
            document.querySelectorAll('footer, [role="contentinfo"], body > footer').forEach(pushFooter);
            footerCandidates.sort((a, b) => b.bottom - a.bottom);
            const footerPick = footerCandidates.length ? footerCandidates[0] : null;

            const blockFromPick = (pick, kind) => {
              if (!pick) return null;
              const el = pick.el;
              const st = pick.st || window.getComputedStyle(el);
              const pr = el.getBoundingClientRect();
              const hRaw = Math.round(pr.height);
              let top;
              let height;
              const stPos = st.position;
              const headerFixed =
                kind === 'header' &&
                pick.fixed &&
                (stPos === 'fixed' || stPos === 'sticky');
              if (kind === 'header' && headerFixed) {
                top = 0;
                height = Math.min(hRaw, 260, pageHeight);
              } else if (kind === 'header') {
                top = Math.max(0, Math.round(pr.top + scrollY));
                height = Math.min(Math.min(hRaw, 260), pageHeight - top);
              } else if (kind === 'footer') {
                top = Math.max(0, Math.round(pr.top + scrollY));
                height = Math.min(hRaw, Math.max(0, pageHeight - top));
              } else {
                top = Math.max(0, Math.round(pr.top + scrollY));
                height = Math.min(hRaw, maxHeight, pageHeight - top);
              }
              if (kind === 'header' && height < 40) return null;
              if (kind === 'footer' && height < 60) return null;
              const bid = el.id && el.id.trim() ? el.id.trim() : `site-${kind}`;
              const clipSrc = kind === 'header' ? 'header' : kind === 'footer' ? 'footer' : kind;
              return {
                id: bid,
                top,
                height,
                width: pageWidth,
                title: kind === 'header' ? 'Шапка сайта' : kind === 'footer' ? 'Подвал сайта' : 'Секция',
                kind,
                source: kind,
                header_layout_fixed: kind === 'header' ? headerFixed : false,
                transparent_capture: isTransparentCaptureElement(el, st),
                debug_clip: { y: top, height, source: clipSrc },
              };
            };

            const hb = blockFromPick(headerPick, 'header');
            const fb = blockFromPick(footerPick, 'footer');
            return {
              header: hb,
              footer: fb,
              headerEl: headerPick ? headerPick.el : null,
              footerEl: footerPick ? footerPick.el : null,
            };
          };

          const tildaDetected = Boolean(document.querySelector('.t-rec, [id^="rec"]'));
          if (!tildaDetected) {
            const minSliceH = 81;
            const capH = pageHeight;
            const mergeGap = 250;
            const maxChunk = Math.max(1100, vh * 1.25);
            const inChromeNavStatic = (el) => {
              try {
                return Boolean(
                  el.closest(
                    'header, nav, [role="navigation"], [role="banner"], footer, [role="contentinfo"]',
                  ),
                );
              } catch (e) {
                return false;
              }
            };
            const rectDoc = (el) => {
              const pr = el.getBoundingClientRect();
              return {
                top: Math.max(0, Math.round(pr.top + scrollY)),
                left: Math.max(0, Math.round(pr.left + scrollX)),
                width: Math.round(pr.width || 0),
                height: Math.round(pr.height || 0),
              };
            };
            const finalizeInsertionFlags = (arr) => {
              for (let i = 0; i < arr.length; i += 1) {
                const cur = arr[i];
                const prev = i > 0 ? arr[i - 1] : null;
                const next = i < arr.length - 1 ? arr[i + 1] : null;
                if (cur.kind === 'header') cur.allow_insert_before = false;
                if (cur.kind === 'footer') cur.allow_insert_after = false;
                if (prev && cur.group_id && prev.group_id && cur.group_id === prev.group_id) {
                  cur.allow_insert_before = false;
                }
                if (next && cur.group_id && next.group_id && cur.group_id === next.group_id) {
                  cur.allow_insert_after = false;
                }
              }
            };
            const mergeCloseYs = (ys) => {
              const outY = [];
              for (const y of ys) {
                if (outY.length && y - outY[outY.length - 1] < mergeGap) continue;
                outY.push(y);
              }
              return outY;
            };
            const chrome = pickChromeBlocks();
            const hdrB = chrome.header;
            const ftrB = chrome.footer;
            const contentTop = hdrB ? hdrB.top + hdrB.height : 0;
            const contentBottom = ftrB ? ftrB.top : capH;
            const largeVideoRects = [];
            document.querySelectorAll('video').forEach((el) => {
              if (!(el instanceof HTMLVideoElement)) return;
              if (!visibleEnough(el)) return;
              const r = rectDoc(el);
              if (r.height < 60 || r.width < 80) return;
              if (r.height >= vh * 0.45) largeVideoRects.push({ ...r, pad: 28 });
            });
            const inLargeVideoInterior = (y) =>
              largeVideoRects.some((vr) => y >= vr.top + vr.pad && y <= vr.top + vr.height - vr.pad);
            let headerNavBottom = 0;
            document
              .querySelectorAll('header, nav, [role="banner"], [role="navigation"]')
              .forEach((el) => {
                if (!(el instanceof HTMLElement) || !visibleEnough(el)) return;
                const r = rectDoc(el);
                if (r.top < 260) headerNavBottom = Math.max(headerNavBottom, r.top + r.height);
              });
            const chromeHeaderBottom = hdrB ? hdrB.top + hdrB.height : 0;
            const navGuard = Math.max(chromeHeaderBottom, headerNavBottom, 0);
            const rawMarks = [];
            const mark = (y, src) => {
              const yy = Math.round(y);
              if (yy < contentTop + minSliceH) return;
              if (yy > contentBottom - minSliceH) return;
              if (yy < navGuard + 12) return;
              if (inLargeVideoInterior(yy)) return;
              rawMarks.push({ y: yy, src });
            };
            const mainEl = document.querySelector('main');
            if (mainEl) {
              Array.from(mainEl.children).forEach((node) => {
                if (!(node instanceof HTMLElement)) return;
                const tn = node.tagName.toUpperCase();
                if (!['SECTION', 'ARTICLE', 'DIV'].includes(tn)) return;
                if (!visibleEnough(node) || inChromeNavStatic(node)) return;
                const r = rectDoc(node);
                if (r.width < minWidth || r.height < minHeight) return;
                mark(r.top, 'dom-boundary');
                if (r.height >= vh * 0.45) mark(r.top + r.height, 'dom-boundary');
              });
            }
            document.querySelectorAll('body > section').forEach((node) => {
              if (!(node instanceof HTMLElement) || !visibleEnough(node) || inChromeNavStatic(node)) return;
              if (mainEl && mainEl.contains(node)) return;
              const r = rectDoc(node);
              if (r.width < minWidth || r.height < minHeight) return;
              mark(r.top, 'dom-boundary');
            });
            document.querySelectorAll('article').forEach((node) => {
              if (!(node instanceof HTMLElement) || !visibleEnough(node) || inChromeNavStatic(node)) return;
              const r = rectDoc(node);
              if (r.width < minWidth || r.height < minHeight) return;
              mark(r.top, 'dom-boundary');
            });
            document.querySelectorAll('video').forEach((el) => {
              if (!(el instanceof HTMLVideoElement) || !visibleEnough(el)) return;
              const r = rectDoc(el);
              if (r.height < 60) return;
              mark(r.top, 'video-ancestor');
              mark(r.top + r.height, 'video-ancestor');
            });
            document.querySelectorAll('section, div, article').forEach((node) => {
              if (!(node instanceof HTMLElement) || !visibleEnough(node) || inChromeNavStatic(node)) return;
              const r = rectDoc(node);
              if (r.width < minWidth * 0.95 || r.height < vh * 0.45) return;
              if (r.top + r.height > contentBottom) return;
              mark(r.top, 'dom-boundary');
            });
            rawMarks.sort((a, b) => a.y - b.y);
            const mergedYs = [];
            for (const row of rawMarks) {
              if (mergedYs.length && row.y - mergedYs[mergedYs.length - 1] < mergeGap) continue;
              mergedYs.push(row.y);
            }
            let starts = [contentTop, ...mergedYs, contentBottom].sort((a, b) => a - b);
            const dedup = [];
            for (const y of starts) {
              if (dedup.length && Math.abs(y - dedup[dedup.length - 1]) < 5) continue;
              dedup.push(y);
            }
            starts = mergeCloseYs(dedup);
            const maxSeg = Math.max(1, maxBlocks - (hdrB ? 1 : 0) - (ftrB ? 1 : 0));
            while (starts.length - 1 > maxSeg) {
              let kill = 1;
              let best = Infinity;
              for (let i = 1; i < starts.length - 1; i += 1) {
                const a0 = starts[i] - starts[i - 1];
                const b0 = starts[i + 1] - starts[i];
                const cost = Math.min(a0, b0);
                if (cost < best) {
                  best = cost;
                  kill = i;
                }
              }
              starts = starts.filter((_, idx) => idx !== kill);
            }
            const splitSegment = (top0, h0, groupId, segIdx, firstSource) => {
              const parts = [];
              let y = top0;
              let rem = h0;
              let ci = 0;
              while (rem > 0) {
                const h = Math.min(maxChunk, rem);
                const cont = ci > 0;
                const last = rem <= h;
                const src = cont ? 'viewport-slice' : firstSource;
                parts.push({
                  id: `${groupId}__p${ci}`,
                  top: y,
                  height: h,
                  width: pageWidth,
                  kind: 'section',
                  title: 'Секция сайта',
                  group_id: groupId,
                  is_continuation: cont,
                  allow_insert_before: !cont,
                  allow_insert_after: last,
                  debug_clip: { y, height: h, source: src, segment_index: segIdx, chunk: ci },
                });
                y += h;
                rem -= h;
                ci += 1;
              }
              return parts;
            };
            const blocks = [];
            if (hdrB) {
              const hb = { ...hdrB };
              hb.group_id = `header-${String(hdrB.id || 'header')}`;
              hb.is_continuation = false;
              hb.allow_insert_before = false;
              hb.allow_insert_after = true;
              if (hb.debug_clip && typeof hb.debug_clip === 'object') hb.debug_clip.source = 'dom-boundary';
              blocks.push(hb);
            }
            const midParts = [];
            for (let si = 0; si < starts.length - 1; si += 1) {
              const a = starts[si];
              const b = starts[si + 1];
              const hSeg = b - a;
              if (hSeg < minSliceH) continue;
              midParts.push({ top: a, h: hSeg });
            }
            if (!midParts.length && contentBottom > contentTop + minSliceH) {
              midParts.push({ top: contentTop, h: contentBottom - contentTop });
            }
            let segI = 0;
            for (const part of midParts) {
              if (blocks.length >= maxBlocks - (ftrB ? 1 : 0)) break;
              segI += 1;
              const gid = `generic-${segI}`;
              const chunks = splitSegment(part.top, part.h, gid, segI, 'dom-boundary');
              for (const ch of chunks) {
                if (blocks.length >= maxBlocks - (ftrB ? 1 : 0)) break;
                blocks.push(ch);
              }
            }
            if (ftrB) {
              while (blocks.length >= maxBlocks) {
                blocks.pop();
              }
              const fb = { ...ftrB };
              fb.group_id = `footer-${String(ftrB.id || 'footer')}`;
              fb.is_continuation = false;
              fb.allow_insert_before = true;
              fb.allow_insert_after = false;
              if (fb.debug_clip && typeof fb.debug_clip === 'object') fb.debug_clip.source = 'dom-boundary';
              blocks.push(fb);
            }
            finalizeInsertionFlags(blocks);
            let pos = 1;
            blocks.forEach((b) => {
              b.position = pos;
              pos += 1;
            });
            const firstSec = blocks.find((b) => b.kind === 'section');
            if (firstSec) {
              firstSec.kind = 'first_screen';
              firstSec.title = 'Первый экран';
            }
            const vc = { header: !!hdrB, footer: !!ftrB };
            return {
              platform: 'generic',
              pageWidth,
              pageHeight: capH,
              blocks: blocks.slice(0, maxBlocks),
              visual_chrome: vc,
              viewportHeight: vh,
              sliceHeight: sliceH,
            };
          }

          const buildTitle = (node, index) => {
            const heading = node.querySelector('h1, h2, h3');
            const title = (heading?.innerText || heading?.textContent || '').replace(/\\s+/g, ' ').trim();
            return title || `Секция ${index + 1}`;
          };

          const attachDebug = (b, source) => {
            b.debug_clip = { y: b.top, height: b.height, source };
          };

          const selectors = ['.t-rec', '[id^="rec"]', 'header', 'main > section', 'main > div', 'main section', 'body > section', 'footer'];
            const seen = new Set();
            const candidates = [];
            const addCandidate = (node) => {
              if (!(node instanceof HTMLElement) || seen.has(node)) return;
              seen.add(node);
              const tagName = node.tagName.toLowerCase();
              if (tagName === 'script' || tagName === 'style') return;
              const style = window.getComputedStyle(node);
              if (
                node.hidden ||
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                style.opacity === '0'
              ) {
                return;
              }
              const rect = node.getBoundingClientRect();
              const width = Math.round(rect.width || node.offsetWidth || 0);
              const rawHeight = Math.round(rect.height || node.offsetHeight || 0);
              if (width < minWidth || rawHeight < minHeight) return;
              const top = Math.max(0, Math.round(rect.top + scrollY));
              const isTRec =
                (node.classList && node.classList.contains('t-rec')) ||
                /^rec\\d+/i.test(String(node.id || ''));
              const height = isTRec
                ? Math.min(rawHeight, Math.max(minHeight, pageHeight - top))
                : Math.min(rawHeight, maxHeight);
              if (top >= pageHeight || height < minHeight) return;
              const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
              if (!text && !node.querySelector('img, picture, video, canvas, svg')) return;
              candidates.push({
                id: node.id ? node.id.trim() : '',
                position: candidates.length + 1,
                title: buildTitle(node, candidates.length),
                top,
                height,
                width,
              });
            };
            for (const selector of selectors) {
              for (const node of document.querySelectorAll(selector)) {
                addCandidate(node);
                if (candidates.length >= maxBlocks * 3) break;
              }
              if (candidates.length >= maxBlocks * 3) break;
            }
            candidates.sort((a, b) => a.top - b.top);
            const filtered = [];
            for (const candidate of candidates) {
              const candidateBottom = candidate.top + candidate.height;
              const hasHeavyOverlap = filtered.some((existing) => {
                const existingBottom = existing.top + existing.height;
                const overlap = Math.max(0, Math.min(candidateBottom, existingBottom) - Math.max(candidate.top, existing.top));
                return (
                  (candidate.top >= existing.top && candidateBottom <= existingBottom) ||
                  overlap / Math.max(1, Math.min(candidate.height, existing.height)) > 0.78
                );
              });
              if (hasHeavyOverlap) continue;
              filtered.push(candidate);
              if (filtered.length >= maxBlocks) break;
            }
            const chrome = pickChromeBlocks();
            const hdrB = chrome.header;
            const ftrB = chrome.footer;
            const maxMid = Math.max(0, maxBlocks - (hdrB ? 1 : 0) - (ftrB ? 1 : 0));
            const middle = [];
            for (const c of filtered) {
              if (hdrB && verticalCover(c, hdrB) > 0.55) continue;
              if (ftrB && verticalCover(c, ftrB) > 0.55) continue;
              middle.push(c);
              if (middle.length >= maxMid * 3) break;
            }
            const middleTrim = middle.slice(0, maxMid);
            middleTrim.forEach((b) => attachDebug(b, 'dom-section'));
            const out = [];
            if (hdrB) out.push({ ...hdrB });
            middleTrim.forEach((b) => {
              out.push({ ...b, kind: 'screenshot' });
            });
            if (ftrB) out.push({ ...ftrB });
            out.forEach((b, i) => {
              b.position = i + 1;
              if (!b.kind) b.kind = 'screenshot';
              delete b.header_layout_fixed;
            });
            const maxChunkT = Math.max(1100, vh * 1.25);
            const finalizeTildaInsertion = (arr) => {
              for (let i = 0; i < arr.length; i += 1) {
                const cur = arr[i];
                const prev = i > 0 ? arr[i - 1] : null;
                const next = i < arr.length - 1 ? arr[i + 1] : null;
                if (cur.kind === 'header') cur.allow_insert_before = false;
                if (cur.kind === 'footer') cur.allow_insert_after = false;
                if (prev && cur.group_id && prev.group_id && cur.group_id === prev.group_id) {
                  cur.allow_insert_before = false;
                }
                if (next && cur.group_id && next.group_id && cur.group_id === next.group_id) {
                  cur.allow_insert_after = false;
                }
              }
            };
            const splitTallTilda = (b) => {
              const baseId = String(b.id || `rec${b.position || 0}`).replace(/\\s+/g, '');
              const gid = `tilda-${baseId}`;
              if (b.height <= maxChunkT) {
                return [
                  {
                    ...b,
                    group_id: gid,
                    is_continuation: false,
                    allow_insert_before: b.kind !== 'header',
                    allow_insert_after: b.kind !== 'footer',
                    debug_clip: {
                      y: b.top,
                      height: b.height,
                      source: b.kind === 'header' ? 'dom-boundary' : b.kind === 'footer' ? 'dom-boundary' : 'tilda',
                    },
                  },
                ];
              }
              const parts = [];
              let y = b.top;
              let rem = b.height;
              let ci = 0;
              while (rem > 0) {
                const h = Math.min(maxChunkT, rem);
                const cont = ci > 0;
                const last = rem <= h;
                parts.push({
                  ...b,
                  id: ci === 0 ? b.id : `${String(b.id)}__p${ci}`,
                  top: y,
                  height: h,
                  group_id: gid,
                  is_continuation: cont,
                  allow_insert_before: !cont && b.kind !== 'header',
                  allow_insert_after: last && b.kind !== 'footer',
                  debug_clip: {
                    y,
                    height: h,
                    source: b.kind === 'header' ? 'dom-boundary' : b.kind === 'footer' ? 'dom-boundary' : 'tilda',
                    chunk: ci,
                  },
                });
                y += h;
                rem -= h;
                ci += 1;
              }
              if (parts.length) {
                parts[0].allow_insert_before = b.kind !== 'header' ? parts[0].allow_insert_before : false;
                parts[parts.length - 1].allow_insert_after = b.kind !== 'footer';
              }
              return parts;
            };
            const flat = [];
            out.forEach((b) => {
              splitTallTilda(b).forEach((row) => flat.push(row));
            });
            flat.forEach((b, i) => {
              b.position = i + 1;
            });
            finalizeTildaInsertion(flat);
            return {
              platform: 'tilda',
              pageWidth,
              pageHeight,
              blocks: flat.slice(0, maxBlocks),
              visual_chrome: { header: !!hdrB, footer: !!ftrB },
            };
        }
        """,
        {
            "maxBlocks": _MAX_VISUAL_BLOCKS,
            "minWidth": _MIN_VISUAL_SECTION_WIDTH,
            "minHeight": _MIN_VISUAL_SECTION_HEIGHT,
            "maxHeight": _MAX_VISUAL_SECTION_HEIGHT,
        },
    )


def _append_block(results: list[dict[str, Any]], *, element, fallback_prefix: str, position: int, platform: str) -> None:
    block_id, selector = _block_selector(element, fallback_prefix=fallback_prefix, position=position)
    title = _block_heading(element) or f"Блок {position}"
    preview_text = _block_preview_text(element, fallback=title)
    results.append(
        {
            "id": block_id,
            "selector": selector,
            "title": title,
            "preview_text": preview_text,
            "kind": _block_kind(element, text=preview_text, title=title, position=position),
            "position": position,
            "platform": platform,
        }
    )


def _extract_tilda_blocks(soup: BeautifulSoup) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    seen: set[int] = set()
    for element in soup.find_all(
        lambda tag: getattr(tag, "name", None)
        and (
            "t-rec" in (tag.get("class") or [])
            or _TILDA_ID_RE.match(_normalized_text(tag.get("id", "")))
        )
    ):
        marker = id(element)
        if marker in seen:
            continue
        seen.add(marker)
        _append_block(blocks, element=element, fallback_prefix="t-rec", position=len(blocks) + 1, platform="tilda")
        if len(blocks) >= 15:
            break
    return blocks


def _is_meaningful_generic_block(element) -> bool:
    text = _normalized_text(element.get_text(" ", strip=True))
    return bool(text and (len(text) >= 60 or element.find(["h1", "h2", "h3", "form", "input", "button"])))


def _extract_generic_blocks(soup: BeautifulSoup) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    seen: set[int] = set()
    body = soup.body or soup

    def add_candidate(element) -> None:
        if element is None:
            return
        marker = id(element)
        if marker in seen or not _is_meaningful_generic_block(element):
            return
        seen.add(marker)
        _append_block(blocks, element=element, fallback_prefix="section", position=len(blocks) + 1, platform="generic")

    add_candidate(body.find("header", recursive=False))

    main = body.find("main", recursive=False) or body.find("main")
    if main is not None:
        direct_children = main.find_all(["section", "div", "article"], recursive=False)
        if direct_children:
            for child in direct_children:
                add_candidate(child)
                if len(blocks) >= 12:
                    return blocks
        else:
            add_candidate(main)
    else:
        for child in body.find_all(["section", "div", "article"], recursive=False):
            add_candidate(child)
            if len(blocks) >= 12:
                return blocks

    for child in body.find_all("section", recursive=False):
        add_candidate(child)
        if len(blocks) >= 12:
            return blocks

    add_candidate(body.find("footer", recursive=False))
    return blocks[:12]


def parse_scanned_page(*, url: str, html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html or "", "html.parser")
    tilda_detected = bool(
        soup.find(class_="t-rec")
        or soup.find(lambda tag: getattr(tag, "name", None) and _TILDA_ID_RE.match(_normalized_text(tag.get("id", ""))))
    )
    platform = "tilda" if tilda_detected else "generic"
    blocks = _extract_tilda_blocks(soup) if tilda_detected else _extract_generic_blocks(soup)
    return {
        "url": url,
        "platform": platform,
        "blocks": [
            {
                "id": block["id"],
                "selector": block["selector"],
                "title": block["title"],
                "preview_text": block["preview_text"],
                "kind": block["kind"],
                "position": block["position"],
                "platform": block["platform"],
            }
            for block in blocks
        ],
    }


def _sanitize_url_value(raw_value: str, *, base_url: str) -> str:
    value = (raw_value or "").strip()
    if not value:
        return ""
    lowered = value.lower()
    if lowered.startswith("javascript:"):
        return ""
    if lowered.startswith(_SKIPPED_URL_PREFIXES):
        return value
    return urljoin(base_url, value)


def _sanitize_srcset(value: str, *, base_url: str) -> str:
    items: list[str] = []
    for raw_item in (value or "").split(","):
        item = raw_item.strip()
        if not item:
            continue
        match = _SRCSET_ITEM_RE.match(item)
        if not match:
            continue
        sanitized_url = _sanitize_url_value(match.group("url"), base_url=base_url)
        if not sanitized_url:
            continue
        items.append(f"{sanitized_url}{match.group('tail') or ''}")
    return ", ".join(items)


def _rewrite_css_urls(css_text: str, *, base_url: str) -> str:
    def repl(match: re.Match[str]) -> str:
        quote = match.group(1) or ""
        raw_url = (match.group(2) or "").strip()
        sanitized_url = _sanitize_url_value(raw_url, base_url=base_url)
        if not sanitized_url:
            return "url()"
        return f"url({quote}{sanitized_url}{quote})"

    return _CSS_URL_RE.sub(repl, css_text or "")


def sanitize_snapshot_block_html(*, page_url: str, block_html: str) -> str:
    soup = BeautifulSoup(block_html or "", "html.parser")
    for tag in soup.find_all(["script", "noscript", "iframe", "base"]):
        tag.decompose()

    for element in soup.find_all(True):
        for attr_name in list(element.attrs.keys()):
            value = element.attrs.get(attr_name)
            lowered = attr_name.lower()
            if lowered.startswith("on"):
                del element.attrs[attr_name]
                continue
            if lowered in _URL_ATTR_NAMES:
                sanitized = _sanitize_url_value(str(value), base_url=page_url)
                if sanitized:
                    element.attrs[attr_name] = sanitized
                else:
                    del element.attrs[attr_name]
                continue
            if lowered == "srcset":
                sanitized = _sanitize_srcset(str(value), base_url=page_url)
                if sanitized:
                    element.attrs[attr_name] = sanitized
                else:
                    del element.attrs[attr_name]
                continue
            if lowered == "style" and isinstance(value, str):
                element.attrs[attr_name] = _rewrite_css_urls(value, base_url=page_url)

    return "".join(str(node) for node in soup.contents)


def _append_css_chunk(css_chunks: list[str], *, chunk: str, base_url: str, total_chars: int) -> int:
    normalized = (chunk or "").strip()
    if not normalized:
        return total_chars
    rewritten = _rewrite_css_urls(normalized, base_url=base_url)
    remaining = _MAX_TOTAL_CSS_CHARS - total_chars
    if remaining <= 0:
        return total_chars
    if len(rewritten) > remaining:
        rewritten = rewritten[:remaining]
    css_chunks.append(rewritten)
    return total_chars + len(rewritten)


def _download_stylesheet_text(stylesheet_url: str) -> str:
    current_url = stylesheet_url
    for redirect_idx in range(_MAX_REDIRECTS + 1):
        safe_url = validate_page_scan_url(current_url)
        response = requests.get(
            safe_url,
            headers=_REQUEST_HEADERS,
            timeout=(3.05, 5.0),
            allow_redirects=False,
            stream=True,
        )
        try:
            if response.status_code in {301, 302, 303, 307, 308}:
                location = (response.headers.get("Location") or "").strip()
                if not location:
                    raise PageScanError("stylesheet_redirect_without_location")
                if redirect_idx >= _MAX_REDIRECTS:
                    raise PageScanError("stylesheet_too_many_redirects")
                current_url = urljoin(safe_url, location)
                continue
            if response.status_code >= 400:
                raise PageScanError("stylesheet_fetch_failed")
            return _read_response_text(response, max_bytes=_MAX_STYLESHEET_BYTES)
        finally:
            response.close()
    raise PageScanError("stylesheet_too_many_redirects")


def _collect_page_css(page, *, page_url: str) -> list[str]:
    css_chunks: list[str] = []
    total_chars = 0
    inline_chunks = page.eval_on_selector_all(
        "style",
        "(nodes) => nodes.map((node) => node.textContent || '').filter(Boolean)",
    )
    for css_text in inline_chunks:
        total_chars = _append_css_chunk(css_chunks, chunk=css_text, base_url=page_url, total_chars=total_chars)

    stylesheet_urls = page.eval_on_selector_all(
        "link[rel='stylesheet'][href]",
        "(nodes) => nodes.map((node) => node.href || '').filter(Boolean)",
    )
    seen_urls: set[str] = set()
    for stylesheet_url in stylesheet_urls:
        absolute_url = urljoin(page_url, stylesheet_url)
        if absolute_url in seen_urls:
            continue
        seen_urls.add(absolute_url)
        try:
            css_text = _download_stylesheet_text(absolute_url)
        except PageScanError:
            continue
        total_chars = _append_css_chunk(css_chunks, chunk=css_text, base_url=absolute_url, total_chars=total_chars)
        if total_chars >= _MAX_TOTAL_CSS_CHARS:
            break
    return css_chunks


def build_snapshot_html(*, page_url: str, block_html: str, css_chunks: list[str], width: int, height: int) -> str:
    sanitized_block_html = sanitize_snapshot_block_html(page_url=page_url, block_html=block_html[:_MAX_BLOCK_HTML_CHARS])
    css_text = "\n\n".join(_rewrite_css_urls(chunk, base_url=page_url) for chunk in css_chunks if (chunk or "").strip())
    css_text = css_text.replace("</style", "<\\/style")
    return (
        "<!doctype html>\n"
        "<html>\n"
        "<head>\n"
        '  <meta charset="utf-8">\n'
        f'  <base href="{page_url}">\n'
        "  <style>\n"
        "    html, body {\n"
        "      margin: 0;\n"
        "      padding: 0;\n"
        "      overflow: hidden;\n"
        "      background: transparent;\n"
        "    }\n"
        f"    body {{ width: {_PREVIEW_TARGET_WIDTH}px; background: transparent; }}\n"
        f"    .lumoref-import-scale {{ width: {_PREVIEW_TARGET_WIDTH}px; transform: scale({_SNAPSHOT_SCALE:.2f}); transform-origin: top left; }}\n"
        f"{css_text}\n"
        "  </style>\n"
        "</head>\n"
        "<body>\n"
        '  <div class="lumoref-import-scale">\n'
        f"{sanitized_block_html}\n"
        "  </div>\n"
        "</body>\n"
        "</html>"
    )


def _build_visual_block_payload(*, page_url: str, block: dict[str, Any], css_chunks: list[str]) -> dict[str, Any]:
    width = max(1, int(block.get("width") or _PREVIEW_TARGET_WIDTH))
    height = max(1, int(block.get("height") or 1))
    title = _normalized_text(str(block.get("title") or "")) or f"Блок {block.get('position') or 1}"
    preview_text = _normalized_text(str(block.get("preview_text") or ""))
    position = int(block.get("position") or 1)
    return {
        "id": _normalized_text(str(block.get("id") or "")) or f"rec-{block.get('position') or 1}",
        "selector": _normalized_text(str(block.get("selector") or "")),
        "position": position,
        "platform": "tilda",
        "kind": _visual_block_kind(text=preview_text, title=title, position=position),
        "title": title,
        "preview_text": preview_text,
        "snapshot_html": build_snapshot_html(
            page_url=page_url,
            block_html=str(block.get("outer_html") or ""),
            css_chunks=css_chunks,
            width=width,
            height=height,
        ),
        "width": width,
        "height": height,
    }


def _extract_visual_tilda_blocks(page) -> list[dict[str, Any]]:
    return page.evaluate(
        """
        (maxBlocks) => {
          const nodes = [];
          const seen = new Set();
          for (const node of document.querySelectorAll('.t-rec, [id^="rec"]')) {
            if (!(node instanceof HTMLElement)) continue;
            if (seen.has(node)) continue;
            seen.add(node);
            nodes.push(node);
            if (nodes.length >= maxBlocks) break;
          }
          return nodes.map((node, index) => {
            const rect = node.getBoundingClientRect();
            const heading = node.querySelector('h1, h2, h3');
            const rawTitle = heading ? (heading.innerText || heading.textContent || '') : '';
            const title = rawTitle.replace(/\\s+/g, ' ').trim() || `Блок ${index + 1}`;
            const rawText = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
            const previewBase = rawText.startsWith(title) ? rawText.slice(title.length).trim() : rawText;
            const preview = previewBase.length > 140 ? `${previewBase.slice(0, 137).trimEnd()}...` : previewBase;
            return {
              id: (node.id || `rec${index + 1}`).trim(),
              selector: node.id ? `#${node.id.trim()}` : '',
              position: index + 1,
              title,
              preview_text: preview,
              outer_html: (node.outerHTML || '').slice(0, maxBlocks > 0 ? 200000 : 200000),
              width: Math.max(1, Math.round(rect.width || node.offsetWidth || 0)),
              height: Math.max(1, Math.round(rect.height || node.offsetHeight || 0)),
            };
          });
        }
        """,
        _MAX_VISUAL_BLOCKS,
    )


def _scan_page_visual_with_browser(
    browser: Any,
    normalized_url: str,
    *,
    preview_mode: str,
    playwright_timeout_error: type[Exception],
) -> dict[str, Any]:
    viewport_profile = visual_viewport_profile(preview_mode)
    context = browser.new_context(
        viewport={"width": int(viewport_profile["width"]), "height": int(viewport_profile["height"])},
        device_scale_factor=1,
        user_agent=str(viewport_profile["user_agent"]),
        locale="en-US",
        is_mobile=bool(viewport_profile["is_mobile"]),
        has_touch=bool(viewport_profile["has_touch"]),
    )
    try:
        page = context.new_page()
        network_diag = _attach_visual_import_network_debug(page)
        page.goto(
            normalized_url,
            wait_until="domcontentloaded",
            timeout=_VISUAL_GOTO_DOMCONTENT_TIMEOUT_MS,
        )
        try:
            page.wait_for_load_state("networkidle", timeout=_VISUAL_WARMUP_NETWORK_IDLE_MS)
        except playwright_timeout_error:
            pass
        page.wait_for_timeout(_VISUAL_WARMUP_AFTER_DOM_MS)
        try:
            page.evaluate(_PRIME_VIDEOS_FOR_CAPTURE_JS)
        except Exception:
            pass
        page.wait_for_timeout(_VISUAL_VIDEO_PRIME_WAIT_MS)
        asset_probe = _warmup_page_before_visual_screenshot(page)
        final_url = validate_page_scan_url(page.url or normalized_url)
        page_metrics = _extract_visual_section_candidates(page)
        platform = "tilda" if page_metrics.get("platform") == "tilda" else "generic"
        page_height = max(1, min(int(page_metrics.get("pageHeight") or 0), _MAX_VISUAL_PAGE_HEIGHT))
        section_blocks = list(page_metrics.get("blocks") or [])
        if not section_blocks:
            section_blocks = _build_visual_slice_blocks(page_height=page_height)

        visual_bundle = _extract_visual_screenshot_bundle(page, section_blocks)
        raw_html5_videos = list(visual_bundle.get("videos") or [])
        raw_foreground_overlays = list(visual_bundle.get("foreground_overlays") or [])
        font_faces_css = str(visual_bundle.get("font_faces_css") or "").strip()
        img_stats: dict[str, Any] = {}
        try:
            raw_stats = page.evaluate(_IMAGE_LOAD_STATS_JS)
            if isinstance(raw_stats, dict):
                img_stats = raw_stats
        except Exception:
            img_stats = {}
        try:
            page.evaluate(_PRIME_VIDEOS_FOR_CAPTURE_JS)
        except Exception:
            pass
        page.wait_for_timeout(random.randint(450, 800))
        _log_visual_import_network_debug(network_diag, asset_probe=asset_probe)
        screenshot_bytes = page.screenshot(full_page=True, type="png")
        chrome_flags = page_metrics.get("visual_chrome") if isinstance(page_metrics.get("visual_chrome"), dict) else {}
        header_found = bool(chrome_flags.get("header"))
        footer_found = bool(chrome_flags.get("footer"))
        probe = Image.open(BytesIO(screenshot_bytes))
        probe.load()
        shot_h = max(1, int(probe.height))
        _scale_visual_geometry_to_screenshot(
            doc_page_height=page_height,
            image_height=shot_h,
            section_blocks=section_blocks,
            raw_videos=raw_html5_videos,
            raw_foreground=raw_foreground_overlays,
        )
        _log_visual_import_section_plan(
            section_blocks,
            doc_page_height=page_height,
            image_height=shot_h,
            header_found=header_found,
            footer_found=footer_found,
        )
        payload_blocks, visual_video_count = _crop_visual_sections(
            screenshot_bytes=screenshot_bytes,
            blocks=section_blocks,
            platform=platform,
            page_url=final_url,
            raw_html5_videos=raw_html5_videos,
            raw_foreground_overlays=raw_foreground_overlays,
            font_faces_css=font_faces_css or None,
        )
        if not payload_blocks:
            section_blocks = _build_visual_slice_blocks(page_height=page_height)
            payload_blocks, visual_video_count = _crop_visual_sections(
                screenshot_bytes=screenshot_bytes,
                blocks=section_blocks,
                platform=platform,
                page_url=final_url,
                raw_html5_videos=raw_html5_videos,
                raw_foreground_overlays=raw_foreground_overlays,
                font_faces_css=font_faces_css or None,
            )
        if not payload_blocks:
            raise PageScanError("visual_scan_failed")
        _write_visual_import_debug_artifacts(
            screenshot_bytes=screenshot_bytes,
            payload_blocks=payload_blocks,
            section_blocks=section_blocks,
            page_height_doc=page_height,
            shot_h=shot_h,
            img_stats=img_stats,
        )
        _log_visual_import_payload_debug(payload_blocks)
        return {
            "url": final_url,
            "platform": platform,
            "visual_preview_mode": viewport_profile["mode"],
            "visual_viewport": {
                "width": int(viewport_profile["width"]),
                "height": int(viewport_profile["height"]),
            },
            "visual_import_available": True,
            "visual_mode": "screenshot",
            "visual_video_count": visual_video_count,
            "blocks": payload_blocks,
        }
    finally:
        context.close()


def _scan_page_visual(raw_url: str, *, preview_mode: str = "desktop") -> dict[str, Any]:
    normalized_url = validate_page_scan_url(raw_url)
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as exc:  # pragma: no cover - dependency/environment specific
        logger.warning("Visual screenshot import is unavailable for %s: Playwright is not installed", normalized_url)
        raise PageScanError("visual_scan_unavailable") from exc

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=list(_CHROMIUM_AUToplay_ARGS))
            try:
                return _scan_page_visual_with_browser(
                    browser,
                    normalized_url,
                    preview_mode=preview_mode,
                    playwright_timeout_error=PlaywrightTimeoutError,
                )
            finally:
                browser.close()
    except PlaywrightError as exc:
        logger.exception("Visual screenshot import failed for %s", normalized_url)
        raise PageScanError("visual_scan_failed") from exc
    except Exception as exc:
        logger.exception("Unexpected visual screenshot import failure for %s", normalized_url)
        raise PageScanError("visual_scan_failed") from exc


def _scan_page_visual_previews(raw_url: str, *, preview_mode: str = "desktop") -> dict[str, Any]:
    normalized_url = validate_page_scan_url(raw_url)
    active_mode = normalize_visual_preview_mode(preview_mode)
    modes = [active_mode, *[mode for mode in ("mobile", "tablet", "desktop") if mode != active_mode]]
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as exc:  # pragma: no cover - dependency/environment specific
        logger.warning("Visual screenshot import is unavailable for %s: Playwright is not installed", normalized_url)
        raise PageScanError("visual_scan_unavailable") from exc

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=list(_CHROMIUM_AUToplay_ARGS))
            try:
                previews: dict[str, dict[str, Any]] = {}
                for mode_name in modes:
                    previews[mode_name] = normalize_visual_scan_response(
                        _scan_page_visual_with_browser(
                            browser,
                            normalized_url,
                            preview_mode=mode_name,
                            playwright_timeout_error=PlaywrightTimeoutError,
                        )
                    )
                active = dict(previews[active_mode])
                active["visual_previews"] = previews
                return active
            finally:
                browser.close()
    except PlaywrightError as exc:
        logger.exception("Visual screenshot preview import failed for %s", normalized_url)
        raise PageScanError("visual_scan_failed") from exc
    except Exception as exc:
        logger.exception("Unexpected visual screenshot preview import failure for %s", normalized_url)
        raise PageScanError("visual_scan_failed") from exc


def scan_page_url(
    raw_url: str,
    *,
    mode: str = "map",
    preview_mode: str = "desktop",
    preload_preview_modes: bool = False,
) -> dict[str, Any]:
    preview_mode = normalize_visual_preview_mode(preview_mode)
    if mode == "visual":
        try:
            if preload_preview_modes:
                return normalize_visual_scan_response(_scan_page_visual_previews(raw_url, preview_mode=preview_mode))
            return normalize_visual_scan_response(_scan_page_visual(raw_url, preview_mode=preview_mode))
        except PageScanError as exc:
            error_code = str(exc)
            if error_code not in {"visual_scan_unavailable", "visual_scan_failed"}:
                raise
            normalized_url = validate_page_scan_url(raw_url)
            final_url, html = _fetch_page_html(normalized_url)
            payload = parse_scanned_page(url=final_url, html=html)
            payload["visual_import_available"] = False
            payload["visual_mode"] = "map"
            payload["visual_preview_mode"] = preview_mode
            payload["detail"] = (
                "Визуальный импорт недоступен на сервере. Сейчас показана карта секций."
                if error_code == "visual_scan_unavailable"
                else "Не удалось импортировать дизайн страницы. Сейчас показана карта секций."
            )
            return payload
    normalized_url = validate_page_scan_url(raw_url)
    final_url, html = _fetch_page_html(normalized_url)
    return parse_scanned_page(url=final_url, html=html)
