import { useEffect, useLayoutEffect, useRef, useState } from "react";

const FRAME_WIDTH = 10;
const LAP_SECONDS = 8;
const PACMAN_GHOST_DISTANCE = 42;
const PACMAN_DOT_SPACING = 20;
const PACMAN_DOT_RESPAWN_TRAIL_FRACTION = 0.15;
const PACMAN_DOT_RADIUS = 3;
const PACMAN_RADIUS = 16;
const GHOST_SIZE = 17;
const GHOST_HALF = GHOST_SIZE / 2;

function buildFramePath(width, height) {
  const w = Math.max(32, width);
  const h = Math.max(32, height);
  const inset = FRAME_WIDTH / 2;

  return [
    `M ${inset} ${inset}`,
    `L ${w - inset} ${inset}`,
    `L ${w - inset} ${h - inset}`,
    `L ${inset} ${h - inset}`,
    `L ${inset} ${inset}`,
    "Z",
  ].join(" ");
}

function directionFromPoints(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}

function directionAngle(direction) {
  if (direction === "left") return Math.PI;
  if (direction === "down") return Math.PI / 2;
  if (direction === "up") return -Math.PI / 2;
  return 0;
}

function pacmanPathD(cx, cy, direction, open) {
  const angle = directionAngle(direction);
  const mouthHalfAngle = 0.16 + open * 0.48;
  const start = angle + mouthHalfAngle;
  const end = angle - mouthHalfAngle;
  const x1 = cx + PACMAN_RADIUS * Math.cos(start);
  const y1 = cy + PACMAN_RADIUS * Math.sin(start);
  const x2 = cx + PACMAN_RADIUS * Math.cos(end);
  const y2 = cy + PACMAN_RADIUS * Math.sin(end);

  return [
    `M ${cx.toFixed(2)} ${cy.toFixed(2)}`,
    `L ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${PACMAN_RADIUS} ${PACMAN_RADIUS} 0 1 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function eyeOffsetForDirection(direction, wiggle) {
  const axis = 0.55 + wiggle * 0.45;
  if (direction === "left") return { x: -axis, y: 0 };
  if (direction === "down") return { x: 0, y: axis };
  if (direction === "up") return { x: 0, y: -axis };
  return { x: axis, y: 0 };
}

export function PacmanChaseFrameTravelSvg({ variant = "game", "aria-hidden": ariaHidden = true }) {
  const svgRef = useRef(null);
  const pathRef = useRef(null);
  const dotRefs = useRef([]);
  const ghostRef = useRef(null);
  const pacmanRef = useRef(null);
  const pupilLeftRef = useRef(null);
  const pupilRightRef = useRef(null);
  const rafRef = useRef(null);
  const startedRef = useRef(null);
  const [box, setBox] = useState({ height: 100, width: 100 });
  const [dots, setDots] = useState([]);

  const isShop = variant === "shop";
  const svgClass = isShop
    ? "mini-game-progress__shop-item-pacman-chase-travel-svg"
    : "block-blast-game__pacman-chase-travel-svg";
  const pacmanClass = isShop
    ? "mini-game-progress__shop-item-pacman-chase-pacman"
    : "block-blast-game__pacman-chase-pacman";
  const ghostClass = isShop
    ? "mini-game-progress__shop-item-pacman-chase-ghost"
    : "block-blast-game__pacman-chase-ghost";
  const eyeClass = isShop
    ? "mini-game-progress__shop-item-pacman-chase-eye"
    : "block-blast-game__pacman-chase-eye";
  const pupilClass = isShop
    ? "mini-game-progress__shop-item-pacman-chase-pupil"
    : "block-blast-game__pacman-chase-pupil";
  const dotClass = isShop
    ? "mini-game-progress__shop-item-pacman-chase-dot"
    : "block-blast-game__pacman-chase-dot";

  useLayoutEffect(() => {
    const node = svgRef.current;
    if (!node) return undefined;

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
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateBox);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const path = pathRef.current;
    if (!path || typeof path.getTotalLength !== "function") return undefined;
    const rafId = requestAnimationFrame(() => {
      const len = path.getTotalLength();
      if (!(len > 0)) return;
      const count = Math.max(12, Math.floor(len / PACMAN_DOT_SPACING));
      const nextDots = Array.from({ length: count }, (_, i) => {
        const s = (i * len) / count;
        const p = path.getPointAtLength(s);
        return { key: `dot-${i}`, s, x: p.x, y: p.y };
      });
      dotRefs.current = [];
      setDots(nextDots);
    });
    return () => cancelAnimationFrame(rafId);
  }, [box.height, box.width]);

  useEffect(() => {
    let cancelled = false;

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
      const ghostPos = ((elapsed * len) / LAP_SECONDS) % len;
      let pacmanPos = ghostPos - PACMAN_GHOST_DISTANCE;
      pacmanPos %= len;
      if (pacmanPos < 0) pacmanPos += len;

      const ghost = path.getPointAtLength(ghostPos);
      const ghostAhead = path.getPointAtLength((ghostPos + 6) % len);
      const pacman = path.getPointAtLength(pacmanPos);
      const pacmanAhead = path.getPointAtLength((pacmanPos + 6) % len);
      const ghostDirection = directionFromPoints(ghost, ghostAhead);
      const pacmanDirection = directionFromPoints(pacman, pacmanAhead);
      const mouthOpen = Math.abs(Math.sin(elapsed * Math.PI * 4));
      const ghostEyeOffset = eyeOffsetForDirection(ghostDirection, Math.sin(elapsed * Math.PI * 3));

      ghostRef.current?.setAttribute("transform", `translate(${ghost.x - GHOST_HALF} ${ghost.y - GHOST_HALF})`);
      pacmanRef.current?.setAttribute("d", pacmanPathD(pacman.x, pacman.y, pacmanDirection, mouthOpen));
      pupilLeftRef.current?.setAttribute("cx", String(5.15 + ghostEyeOffset.x));
      pupilLeftRef.current?.setAttribute("cy", String(7.15 + ghostEyeOffset.y));
      pupilRightRef.current?.setAttribute("cx", String(11.75 + ghostEyeOffset.x));
      pupilRightRef.current?.setAttribute("cy", String(7.15 + ghostEyeOffset.y));
      const eatenTrail = len * PACMAN_DOT_RESPAWN_TRAIL_FRACTION;
      dots.forEach((dot, i) => {
        const node = dotRefs.current[i];
        if (!node) return;
        const behindPacman = (pacmanPos - dot.s + len) % len;
        node.style.opacity = behindPacman > 0 && behindPacman < eatenTrail ? "0" : "1";
      });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      startedRef.current = null;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [box.height, box.width, dots]);

  const path = buildFramePath(box.width, box.height);

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
      {dots.map((dot, index) => (
        <circle
          key={dot.key}
          ref={(node) => {
            dotRefs.current[index] = node;
          }}
          className={dotClass}
          cx={dot.x}
          cy={dot.y}
          r={PACMAN_DOT_RADIUS}
        />
      ))}
      <g ref={ghostRef} className={ghostClass} transform="translate(0 0)">
        <path d="M0 17 V6.8 C0 3 3.5 0 8.5 0 S17 3 17 6.8 V17 L13.6 14.6 L10.9 17 L8.5 14.6 L6.1 17 L3.4 14.6 Z" />
        <rect className={eyeClass} x="3.4" y="5.1" width="3.5" height="4.1" />
        <rect className={eyeClass} x="10" y="5.1" width="3.5" height="4.1" />
        <circle ref={pupilLeftRef} className={pupilClass} cx="5.15" cy="7.15" r="0.85" />
        <circle ref={pupilRightRef} className={pupilClass} cx="11.75" cy="7.15" r="0.85" />
      </g>
      <g>
        <path ref={pacmanRef} className={pacmanClass} d="" />
      </g>
    </svg>
  );
}
