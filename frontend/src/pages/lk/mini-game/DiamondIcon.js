/**
 * SVG-алмаз для рейтинга мини-игры (currentColor, без lucide).
 */
export function DiamondIcon({ className = "", size = 18, strokeWidth = 2 }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12 3 L20 10 L12 21 L4 10 Z"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <path
        d="M12 3 L12 10 M4 10 L20 10"
        stroke="currentColor"
        strokeWidth={Math.max(1, strokeWidth * 0.55)}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
    </svg>
  );
}
