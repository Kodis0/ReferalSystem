import { useEffect, useRef, useState } from "react";

const LAP_SECONDS = 7.2;

const NEON_WAVE_SEGMENTS = [
  { offset: 14.4, width: 1.6, opacity: 0.12 },
  { offset: 13.8, width: 1.7, opacity: 0.15 },
  { offset: 13.2, width: 1.8, opacity: 0.19 },
  { offset: 12.6, width: 2.0, opacity: 0.24 },
  { offset: 12.0, width: 2.2, opacity: 0.3 },
  { offset: 11.4, width: 2.5, opacity: 0.38 },
  { offset: 10.8, width: 2.9, opacity: 0.47 },
  { offset: 10.2, width: 3.3, opacity: 0.57 },
  { offset: 9.6, width: 3.8, opacity: 0.68 },
  { offset: 9.0, width: 4.4, opacity: 0.78 },
  { offset: 8.4, width: 5.0, opacity: 0.86 },
  { offset: 7.8, width: 5.6, opacity: 0.92 },
  { offset: 7.2, width: 6.1, opacity: 0.96 },
  { offset: 6.6, width: 6.3, opacity: 0.98 },
  { offset: 6.0, width: 6.0, opacity: 0.94 },
  { offset: 5.4, width: 5.4, opacity: 0.86 },
  { offset: 4.8, width: 4.7, opacity: 0.76 },
  { offset: 4.2, width: 4.0, opacity: 0.64 },
  { offset: 3.6, width: 3.3, opacity: 0.52 },
  { offset: 3.0, width: 2.8, opacity: 0.42 },
  { offset: 2.4, width: 2.4, opacity: 0.33 },
  { offset: 1.8, width: 2.1, opacity: 0.25 },
  { offset: 1.2, width: 1.9, opacity: 0.18 },
  { offset: 0.6, width: 1.7, opacity: 0.13 },
];

function buildNeonFramePath(width, height) {
  const w = Math.max(24, width);
  const h = Math.max(24, height);
  const inset = 1.5;
  const outerRadius = 12;
  const centerRadius = Math.max(0, outerRadius - inset);

  return [
    `M ${outerRadius} ${inset}`,
    `L ${w - outerRadius} ${inset}`,
    `A ${centerRadius} ${centerRadius} 0 0 1 ${w - inset} ${outerRadius}`,
    `L ${w - inset} ${h - outerRadius}`,
    `A ${centerRadius} ${centerRadius} 0 0 1 ${w - outerRadius} ${h - inset}`,
    `L ${outerRadius} ${h - inset}`,
    `A ${centerRadius} ${centerRadius} 0 0 1 ${inset} ${h - outerRadius}`,
    `L ${inset} ${outerRadius}`,
    `A ${centerRadius} ${centerRadius} 0 0 1 ${outerRadius} ${inset}`,
    "Z",
  ].join(" ");
}

export function NeonLineFrameTravelSvg({ variant = "game", "aria-hidden": ariaHidden = true }) {
  const svgRef = useRef(null);
  const [box, setBox] = useState({ height: 100, width: 100 });

  const isShop = variant === "shop";
  const svgClass = isShop
    ? "mini-game-progress__shop-item-neon-travel-svg"
    : "block-blast-game__neon-travel-svg";
  const waveClass = isShop
    ? "mini-game-progress__shop-item-neon-travel-wave"
    : "block-blast-game__neon-travel-wave";

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

  const path = buildNeonFramePath(box.width, box.height);

  return (
    <svg
      ref={svgRef}
      className={svgClass}
      viewBox={`0 0 ${box.width} ${box.height}`}
      preserveAspectRatio="none"
      aria-hidden={ariaHidden}
    >
      {NEON_WAVE_SEGMENTS.map((s) => {
        const dashOffset = s.offset;
        return (
          <path
            key={`${s.offset}-${s.width}`}
            d={path}
          className={waveClass}
          fill="none"
            pathLength="100"
          stroke="rgba(192, 174, 252, 0.98)"
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2.9 97.1"
            strokeDashoffset={dashOffset}
            opacity={s.opacity}
          >
            <animate
              attributeName="stroke-dashoffset"
              values={`${dashOffset};${dashOffset - 100}`}
              dur={`${LAP_SECONDS}s`}
              repeatCount="indefinite"
            />
          </path>
        );
      })}
    </svg>
  );
}
