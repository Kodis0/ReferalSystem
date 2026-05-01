/**
 * Корона для навигации «Рейтинг» (currentColor, без lucide).
 */
export function CrownIcon({ className = "", size = 24, strokeWidth = 2 }) {
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
        d="M5 18h14M5 18l2-8 4 3 1-6 1 6 4-3 2 8"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
