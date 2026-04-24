from __future__ import annotations

import base64
import ipaddress
import logging
import re
import socket
from io import BytesIO
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from PIL import Image

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
_VISUAL_GOTO_TIMEOUT_MS = 15_000
_VISUAL_NETWORK_IDLE_TIMEOUT_MS = 5_000
_VISUAL_POST_LOAD_WAIT_MS = 1_500
_VISUAL_VIEWPORT_WIDTH = 1440
_VISUAL_VIEWPORT_HEIGHT = 900
_VISUAL_SCROLL_STEP_PX = 720
_VISUAL_SLICE_HEIGHT = 900
_MAX_VISUAL_PAGE_HEIGHT = 12_000
_MAX_VISUAL_SECTION_HEIGHT = 1_200
_MIN_VISUAL_SECTION_WIDTH = 600
_MIN_VISUAL_SECTION_HEIGHT = 120
_MAX_VISUAL_BLOCK_IMAGE_BYTES = 1_200_000
_MIN_VISUAL_DOWNSCALE_WIDTH = 720
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


class PageScanError(Exception):
    pass


class PageScanUrlValidationError(PageScanError):
    pass


def _normalized_text(value: str) -> str:
    return " ".join((value or "").split()).strip()


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


def _build_screenshot_block_payload(*, block: dict[str, Any], section_image: Image.Image, platform: str) -> dict[str, Any]:
    png_bytes, width, height = _encode_visual_section_image(section_image)
    position = int(block.get("position") or 1)
    return {
        "id": _normalized_text(str(block.get("id") or "")) or f"screenshot-section-{position}",
        "position": position,
        "title": _visual_block_title(title=str(block.get("title") or ""), position=position),
        "kind": "screenshot",
        "selector": None,
        "platform": platform,
        "screenshot_data_url": _png_bytes_to_data_url(png_bytes),
        "width": width,
        "height": height,
    }


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
        blocks.append(
            {
                "id": f"screenshot-section-{position}",
                "position": position,
                "title": f"Секция {position}",
                "top": top,
                "height": max(1, height),
            }
        )
        top += _VISUAL_SLICE_HEIGHT
        position += 1
    return blocks


def _crop_visual_sections(*, screenshot_bytes: bytes, blocks: list[dict[str, Any]], platform: str) -> list[dict[str, Any]]:
    image = Image.open(BytesIO(screenshot_bytes))
    image.load()
    if image.mode not in {"RGB", "RGBA"}:
        image = image.convert("RGBA")

    payload_blocks: list[dict[str, Any]] = []
    for raw_block in blocks[:_MAX_VISUAL_BLOCKS]:
        top = max(0, min(image.height - 1, int(raw_block.get("top") or 0)))
        height = max(1, min(image.height - top, int(raw_block.get("height") or 0)))
        if height <= 0:
            continue
        section_image = image.crop((0, top, image.width, top + height))
        payload_blocks.append(
            _build_screenshot_block_payload(
                block=raw_block,
                section_image=section_image,
                platform=platform,
            )
        )
    return payload_blocks


def _auto_scroll_page(page) -> None:
    page.evaluate(
        """
        async (stepPx) => {
          const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
          const root = document.scrollingElement || document.documentElement || document.body;
          const maxY = Math.max(
            0,
            (root?.scrollHeight || 0) - window.innerHeight,
          );
          let currentY = 0;
          while (currentY < maxY) {
            currentY = Math.min(maxY, currentY + stepPx);
            window.scrollTo({ top: currentY, behavior: 'instant' });
            await wait(160);
          }
        }
        """,
        _VISUAL_SCROLL_STEP_PX,
    )
    page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' });")


def _extract_visual_section_candidates(page) -> dict[str, Any]:
    return page.evaluate(
        """
        ({ maxBlocks, minWidth, minHeight, maxHeight }) => {
          const body = document.body;
          const root = document.documentElement;
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
          const tildaDetected = Boolean(document.querySelector('.t-rec, [id^="rec"]'));
          const selectors = [
            ...(tildaDetected ? ['.t-rec', '[id^="rec"]'] : []),
            'header',
            'main > section',
            'main > div',
            'main section',
            'body > section',
            'footer',
          ];
          const seen = new Set();
          const candidates = [];

          const buildTitle = (node, index) => {
            const heading = node.querySelector('h1, h2, h3');
            const title = (heading?.innerText || heading?.textContent || '').replace(/\\s+/g, ' ').trim();
            return title || `Секция ${index + 1}`;
          };

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

            const top = Math.max(0, Math.round(rect.top + window.scrollY));
            const height = Math.min(rawHeight, maxHeight);
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

          return {
            platform: tildaDetected ? 'tilda' : 'generic',
            pageWidth,
            pageHeight,
            blocks: filtered,
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


def _scan_page_visual(raw_url: str) -> dict[str, Any]:
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
            browser = playwright.chromium.launch(headless=True)
            try:
                context = browser.new_context(
                    viewport={"width": _VISUAL_VIEWPORT_WIDTH, "height": _VISUAL_VIEWPORT_HEIGHT},
                    device_scale_factor=1,
                )
                try:
                    page = context.new_page()
                    page.goto(normalized_url, wait_until="domcontentloaded", timeout=_VISUAL_GOTO_TIMEOUT_MS)
                    try:
                        page.wait_for_load_state("networkidle", timeout=_VISUAL_NETWORK_IDLE_TIMEOUT_MS)
                    except PlaywrightTimeoutError:
                        pass
                    page.wait_for_timeout(_VISUAL_POST_LOAD_WAIT_MS)
                    _auto_scroll_page(page)
                    final_url = validate_page_scan_url(page.url or normalized_url)
                    page_metrics = _extract_visual_section_candidates(page)
                    platform = "tilda" if page_metrics.get("platform") == "tilda" else "generic"
                    page_height = max(1, min(int(page_metrics.get("pageHeight") or 0), _MAX_VISUAL_PAGE_HEIGHT))
                    section_blocks = list(page_metrics.get("blocks") or [])
                    if _visual_coverage_is_poor(section_blocks, page_height=page_height):
                        section_blocks = _build_visual_slice_blocks(page_height=page_height)

                    screenshot_bytes = page.screenshot(full_page=True, type="png")
                    payload_blocks = _crop_visual_sections(
                        screenshot_bytes=screenshot_bytes,
                        blocks=section_blocks,
                        platform=platform,
                    )
                    if not payload_blocks:
                        section_blocks = _build_visual_slice_blocks(page_height=page_height)
                        payload_blocks = _crop_visual_sections(
                            screenshot_bytes=screenshot_bytes,
                            blocks=section_blocks,
                            platform=platform,
                        )
                    if not payload_blocks:
                        raise PageScanError("visual_scan_failed")
                    return {
                        "url": final_url,
                        "platform": platform,
                        "visual_import_available": True,
                        "visual_mode": "screenshot",
                        "blocks": payload_blocks,
                    }
                finally:
                    context.close()
            finally:
                browser.close()
    except PlaywrightError as exc:
        logger.exception("Visual screenshot import failed for %s", normalized_url)
        raise PageScanError("visual_scan_failed") from exc
    except Exception as exc:
        logger.exception("Unexpected visual screenshot import failure for %s", normalized_url)
        raise PageScanError("visual_scan_failed") from exc


def scan_page_url(raw_url: str, *, mode: str = "map") -> dict[str, Any]:
    if mode == "visual":
        try:
            return _scan_page_visual(raw_url)
        except PageScanError as exc:
            error_code = str(exc)
            if error_code not in {"visual_scan_unavailable", "visual_scan_failed"}:
                raise
            normalized_url = validate_page_scan_url(raw_url)
            final_url, html = _fetch_page_html(normalized_url)
            payload = parse_scanned_page(url=final_url, html=html)
            payload["visual_import_available"] = False
            payload["visual_mode"] = "map"
            payload["detail"] = (
                "Визуальный импорт недоступен на сервере. Сейчас показана карта секций."
                if error_code == "visual_scan_unavailable"
                else "Не удалось импортировать дизайн страницы. Сейчас показана карта секций."
            )
            return payload
    normalized_url = validate_page_scan_url(raw_url)
    final_url, html = _fetch_page_html(normalized_url)
    return parse_scanned_page(url=final_url, html=html)
