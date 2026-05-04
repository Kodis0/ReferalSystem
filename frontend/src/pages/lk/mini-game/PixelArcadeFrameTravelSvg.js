import { useEffect, useRef, useState } from "react";

/** Полный круг, секунды (спокойная скорость). */
const LAP_SECONDS = 6;
const APPLE_INTERVAL_SECONDS = 3.9;
const APPLE_DISTANCE_FRACTION = 0.22;
const APPLE_EAT_DISTANCE_FRACTION = 0.018;
const PIXEL_FRAME_WIDTH = 10;
const SNAKE_SQUARE_SIZE = PIXEL_FRAME_WIDTH;
const SNAKE_SEGMENT_COUNT = 25;

function buildPixelArcadeFramePath(width, height) {
  const w = Math.max(32, width);
  const h = Math.max(32, height);
  const inset = PIXEL_FRAME_WIDTH / 2;

  // Классическая Snake должна поворачивать под 90°, а не ехать по дуге скругления.
  return [
    `M ${inset} ${inset}`,
    `L ${w - inset} ${inset}`,
    `L ${w - inset} ${h - inset}`,
    `L ${inset} ${h - inset}`,
    `L ${inset} ${inset}`,
    "Z",
  ].join(" ");
}

/**
 * Pixel Arcade: змейка движется по центру рамки и «съедает» яблоки на периметре.
 * variant: классы BEM в blockBlastGame.css / miniGameProgress.css
 */
export function PixelArcadeFrameTravelSvg({ variant = "game", "aria-hidden": ariaHidden = true }) {
  const svgRef = useRef(null);
  const pathRef = useRef(null);
  const rafRef = useRef(null);
  const startedRef = useRef(null);
  const [box, setBox] = useState({ height: 100, width: 100 });
  const [sprites, setSprites] = useState([]);

  const isShop = variant === "shop";
  const snakeClass = isShop
    ? "mini-game-progress__shop-item-pixel-arcade-snake"
    : "block-blast-game__pixel-arcade-snake";
  const headClass = isShop
    ? "mini-game-progress__shop-item-pixel-arcade-snake-head"
    : "block-blast-game__pixel-arcade-snake-head";
  const eyeClass = isShop
    ? "mini-game-progress__shop-item-pixel-arcade-snake-eye"
    : "block-blast-game__pixel-arcade-snake-eye";
  const tongueClass = isShop
    ? "mini-game-progress__shop-item-pixel-arcade-snake-tongue"
    : "block-blast-game__pixel-arcade-snake-tongue";
  const appleClass = isShop
    ? "mini-game-progress__shop-item-pixel-arcade-apple"
    : "block-blast-game__pixel-arcade-apple";
  const svgClass = isShop
    ? "mini-game-progress__shop-item-pixel-arcade-travel-svg"
    : "block-blast-game__pixel-arcade-travel-svg";

  useEffect(() => {
    const node = svgRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;

    const updateBox = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setBox((prev) =>
          Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5
            ? prev
            : { height: rect.height, width: rect.width },
        );
      }
    };

    updateBox();
    const observer = new ResizeObserver(updateBox);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setSprites([]);
      return undefined;
    }

    let cancelled = false;
    const snakeSegments = Array.from({ length: SNAKE_SEGMENT_COUNT }, (_, i) => i);

    const tick = (now) => {
      if (cancelled) return;
      const path = pathRef.current;
      if (!path || typeof path.getTotalLength !== "function") {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const len = path.getTotalLength();
      if (!(len > 0)) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (startedRef.current == null) startedRef.current = now;
      const elapsed = (now - startedRef.current) / 1000;
      const headPos = ((elapsed * len) / LAP_SECONDS) % len;
      const step = SNAKE_SQUARE_SIZE * 0.92;
      const head = path.getPointAtLength(headPos);
      const ahead = path.getPointAtLength((headPos + Math.min(6, step)) % len);
      const dx = ahead.x - head.x;
      const dy = ahead.y - head.y;
      const direction =
        Math.abs(dx) >= Math.abs(dy)
          ? dx >= 0
            ? "right"
            : "left"
          : dy >= 0
            ? "down"
            : "up";

      const next = [];

      snakeSegments.forEach((_, i) => {
        let seg = headPos - i * step;
        seg %= len;
        if (seg < 0) seg += len;
        const p = path.getPointAtLength(seg);
        next.push({
          kind: i === 0 ? "head" : "body",
          key: i === 0 ? "head" : `body-${i}`,
          cx: p.x,
          cy: p.y,
          direction: i === 0 ? direction : undefined,
          size: SNAKE_SQUARE_SIZE,
        });
      });

      const cycle = elapsed % APPLE_INTERVAL_SECONDS;
      const cycleStartHead = (((elapsed - cycle) * len) / LAP_SECONDS) % len;
      const applePos = (cycleStartHead + len * APPLE_DISTANCE_FRACTION) % len;
      const distanceToApple = (applePos - headPos + len) % len;
      const appleVisible =
        distanceToApple > len * APPLE_EAT_DISTANCE_FRACTION && distanceToApple < len * (APPLE_DISTANCE_FRACTION + 0.03);
      if (appleVisible) {
        const apple = path.getPointAtLength(applePos);
        next.push({
          kind: "apple",
          key: `apple-${Math.floor(elapsed / APPLE_INTERVAL_SECONDS)}`,
          cx: apple.x,
          cy: apple.y,
          size: SNAKE_SQUARE_SIZE,
        });
      }

      setSprites(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      startedRef.current = null;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [box.height, box.width]);

  const path = buildPixelArcadeFramePath(box.width, box.height);

  return (
    <svg
      ref={svgRef}
      className={svgClass}
      viewBox={`0 0 ${box.width} ${box.height}`}
      preserveAspectRatio="none"
      aria-hidden={ariaHidden}
    >
      <defs>
        <path ref={pathRef} fill="none" d={path} />
      </defs>
      {sprites.map((s) => {
        if (s.kind === "apple") {
          const x = s.cx - s.size / 2;
          const y = s.cy - s.size / 2;
          return (
            <g key={s.key} className={appleClass}>
              <rect x={x} y={y} width={s.size} height={s.size} />
              <rect x={s.cx + 0.5} y={s.cy - 3} width="1.2" height="1.2" />
            </g>
          );
        }

        if (s.kind === "head") {
          const x = s.cx - s.size / 2;
          const y = s.cy - s.size / 2;
          const eye =
            s.direction === "right"
              ? { x: x + s.size - 2.4, y: s.cy - 1.4, width: 1.2, height: 1.2 }
              : s.direction === "left"
                ? { x: x + 1.2, y: s.cy - 1.4, width: 1.2, height: 1.2 }
                : s.direction === "down"
                  ? { x: s.cx + 1.0, y: y + s.size - 2.4, width: 1.2, height: 1.2 }
                  : { x: s.cx + 1.0, y: y + 1.2, width: 1.2, height: 1.2 };
          const tongue =
            s.direction === "right"
              ? { x: x + s.size, y: s.cy - 1, width: 4, height: 2 }
              : s.direction === "left"
                ? { x: x - 4, y: s.cy - 1, width: 4, height: 2 }
                : s.direction === "down"
                  ? { x: s.cx - 1, y: y + s.size, width: 2, height: 4 }
                  : { x: s.cx - 1, y: y - 4, width: 2, height: 4 };
          return (
            <g key={s.key}>
              <rect className={headClass} x={x} y={y} width={s.size} height={s.size} />
              <rect className={eyeClass} {...eye} />
              <rect className={tongueClass} {...tongue} />
            </g>
          );
        }

        const x = s.cx - s.size / 2;
        const y = s.cy - s.size / 2;
        return (
          <rect
            key={s.key}
            className={snakeClass}
            x={x}
            y={y}
            width={s.size}
            height={s.size}
          />
        );
      })}
    </svg>
  );
}
