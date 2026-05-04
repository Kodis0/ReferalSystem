/** Круговой индикатор прогресса внутри текущего уровня (0–100%). Стили: miniGameProgress.css */
export function ProgressDonut({ pct }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const safePct = Math.min(100, Math.max(0, Number(pct) || 0));
  /** Явная пара dash+gap стабильнее одного числа в stroke-dasharray у разных движков. */
  const strokeDasharray = `${c} ${c}`;
  const strokeDashoffset = c - (safePct / 100) * c;
  return (
    <svg className="mini-game-progress__donut-svg" viewBox="0 0 120 120" aria-hidden="true">
      <circle className="mini-game-progress__donut-track" cx="60" cy="60" r={r} />
      <circle
        className="mini-game-progress__donut-fill"
        cx="60"
        cy="60"
        r={r}
        strokeDasharray={strokeDasharray}
        strokeDashoffset={strokeDashoffset}
        transform="rotate(-90 60 60)"
      />
    </svg>
  );
}
