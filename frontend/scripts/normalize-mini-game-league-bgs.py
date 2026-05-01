#!/usr/bin/env python3
"""Resize league card backgrounds to one canvas (cover crop). Run from repo root optional."""
from pathlib import Path

from PIL import Image

# Matches hero league card ~708×228 @2x → ~3.1:1
TARGET_W, TARGET_H = 1416, 456

# Pixels brighter than this count as art (strip opaque letterbox/pillarbox bars).
CONTENT_MAX_RGB_MIN = 14

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "src" / "static" / "images"


def trim_solid_bars(im: Image.Image) -> Image.Image:
    """Crop away baked-in black bands (e.g. Platinum); keeps darker in-frame vignettes."""
    px = im.convert("RGBA").load()
    w, h = im.size
    xs: list[int] = []
    ys: list[int] = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 12:
                continue
            if max(r, g, b) > CONTENT_MAX_RGB_MIN:
                xs.append(x)
                ys.append(y)
    if len(xs) < 64:
        return im
    x0, y0, x1, y1 = min(xs), min(ys), max(xs) + 1, max(ys) + 1
    if x0 <= 2 and y0 <= 2 and x1 >= w - 2 and y1 >= h - 2:
        return im
    return im.crop((x0, y0, x1, y1))


def cover_canvas(im: Image.Image, tw: int, th: int) -> Image.Image:
    sw, sh = im.size
    scale = max(tw / sw, th / sh)
    nw = max(1, int(round(sw * scale)))
    nh = max(1, int(round(sh * scale)))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return resized.crop((left, top, left + tw, top + th))


def main() -> None:
    paths = sorted(IMAGES.glob("mini-game-league-*-bg.png"))
    if not paths:
        raise SystemExit(f"No PNGs in {IMAGES}")
    for path in paths:
        im = Image.open(path).convert("RGBA")
        im = trim_solid_bars(im)
        out = cover_canvas(im, TARGET_W, TARGET_H)
        out.save(path, "PNG", optimize=True)
        print(path.name, out.size)


if __name__ == "__main__":
    main()
