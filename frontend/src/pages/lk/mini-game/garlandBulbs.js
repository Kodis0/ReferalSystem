/** Базовая линия лампочек по полосе рамки (%): выше — ближе к игровому полю и к видимой рамке. */
export const GARLAND_BULB_TRACK_INSET_PCT = 2.05;
/** Внутренняя «коробка» поля в тех же % — центры лампочек не заходят на клетки. */
export const GARLAND_BULB_FIELD_INSET_PCT = 5.35;
/** Лёгкий разброс по двум осям в пределах полосы рамки. */
export const GARLAND_BULB_JITTER_PCT = 0.65;
/** Выталкивание из коробки поля в полосу рамки. */
export const GARLAND_BULB_EPS_OUT_PCT = 0.35;

/** Детерминированный [0, 1) для стабильных позиций между рендерами. */
function garlandBulbSeeded01(seed, salt) {
  const t = Math.sin(seed * 12.9898 + salt * 78.233 + 19.173) * 43758.5453123;
  return t - Math.floor(t);
}

/** Точка внутри прямоугольника игрового поля (по тем же %, что и гирлянда). */
function garlandBulbInsideField(x, y, innerL, innerT, innerR, innerB) {
  return x > innerL && x < innerR && y > innerT && y < innerB;
}

/** Если попали на поле — сдвиг к ближайшему краю полосы рамки наружу. */
function garlandBulbProjectToFrameStrip(x, y, innerL, innerT, innerR, innerB, epsOut) {
  if (!garlandBulbInsideField(x, y, innerL, innerT, innerR, innerB)) {
    return { x, y };
  }
  const dL = x - innerL;
  const dR = innerR - x;
  const dT = y - innerT;
  const dB = innerB - y;
  const m = Math.min(dL, dR, dT, dB);
  if (m === dL) return { x: innerL - epsOut, y };
  if (m === dR) return { x: innerR + epsOut, y };
  if (m === dT) return { x, y: innerT - epsOut };
  return { x, y: innerB + epsOut };
}

/** Скругление к процентах слоя после джиттера и проекции. */
function garlandBulbClampPct(v) {
  return Math.min(99.75, Math.max(0.25, v));
}

/**
 * Лампочки по периметру рамки с хаотичным сдвигом по двум осям; не заходят на игровое поле.
 * Используется на доске (демо/игра) и в превью рамки в магазине.
 */
export function buildPerimeterGarlandBulbs() {
  const inset = GARLAND_BULB_TRACK_INSET_PCT;
  const span = 100 - 2 * inset;
  const nEdge = 6;
  const innerL = GARLAND_BULB_FIELD_INSET_PCT;
  const innerR = 100 - GARLAND_BULB_FIELD_INSET_PCT;
  const innerT = innerL;
  const innerB = innerR;
  const jit = GARLAND_BULB_JITTER_PCT;
  const eps = GARLAND_BULB_EPS_OUT_PCT;
  const bulbs = [];
  let ord = 0;

  const pushJittered = (baseLeft, baseTop) => {
    const jx = (garlandBulbSeeded01(ord, 1) - 0.5) * 2 * jit;
    const jy = (garlandBulbSeeded01(ord, 2) - 0.5) * 2 * jit;
    let x = baseLeft + jx;
    let y = baseTop + jy;
    const p = garlandBulbProjectToFrameStrip(x, y, innerL, innerT, innerR, innerB, eps);
    bulbs.push({
      key: `garland-${ord}`,
      ord,
      leftPct: garlandBulbClampPct(p.x),
      topPct: garlandBulbClampPct(p.y),
      colorMod: ord % 4,
    });
    ord += 1;
  };

  for (let k = 1; k <= nEdge; k++) {
    const t = k / (nEdge + 1);
    pushJittered(inset + t * span, inset);
  }
  for (let k = 1; k <= nEdge; k++) {
    const t = k / (nEdge + 1);
    pushJittered(100 - inset, inset + t * span);
  }
  for (let k = 1; k <= nEdge; k++) {
    const t = k / (nEdge + 1);
    pushJittered(100 - inset - t * span, 100 - inset);
  }
  for (let k = 1; k <= nEdge; k++) {
    const t = k / (nEdge + 1);
    pushJittered(inset, 100 - inset - t * span);
  }
  return bulbs;
}
