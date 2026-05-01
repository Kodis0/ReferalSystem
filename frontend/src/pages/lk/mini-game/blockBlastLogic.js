/** Block Blast–style grid helpers (pure functions). */

export const GRID_SIZE = 8;

/** Базовые очки за одну убранную строку или столбец в одном снятии. */
export const SCORE_PER_LINE = 10;

/** Доп. очки за каждую пару линий, снятых в одном ходе (чем больше линий сразу — тем выгоднее). */
export const SCORE_MULTILINE_PAIR_BONUS = 5;

/** Очки за каждый поставленный блок фигуры. */
export const SCORE_PER_CELL_PLACED = 2;

/**
 * Mulberry32 PRNG; float stream matches backend ``gamification_game.mulberry32``.
 * @param {number} seed any integer; truncated to uint32
 * @returns {() => number} RNG yielding [0, 1)
 */
export function createMulberry32(seed) {
  let state = seed >>> 0;
  return function mulberry32() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul((t ^ (t >>> 15)) | 0, (t | 1) | 0) >>> 0;
    const u = Math.imul((t ^ (t >>> 7)) | 0, (t | 61) | 0) >>> 0;
    const sm = (t + u) >>> 0;
    t = (t ^ sm) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Очки за постановку фигуры (по числу клеток). */
export function scoreForPlacement(cellCount) {
  const n = Math.max(0, Math.floor(cellCount));
  return n * SCORE_PER_CELL_PLACED;
}

/**
 * Очки за снятие строк/столбцов за один resolveClears.
 * n линий: база n * SCORE_PER_LINE + бонус за «комбо».
 */
export function scoreForLineClears(rowsCleared, colsCleared) {
  const n = rowsCleared + colsCleared;
  if (n <= 0) return 0;
  const pairCount = (n * (n - 1)) / 2;
  return SCORE_PER_LINE * n + SCORE_MULTILINE_PAIR_BONUS * pairCount;
}

/**
 * Normalized polyomino cells as [row, col] offsets from anchor (0,0).
 * Each shape's bounding box starts at (0,0); anchor placement puts (0,0) on the clicked cell.
 */
export const SHAPE_POOL = [
  [[0, 0]],
  [[0, 0], [0, 1]],
  [[0, 0], [1, 0]],
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [1, 0], [1, 1]],
  [[0, 1], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [1, 0]],
  [[0, 0], [0, 1], [0, 2], [0, 3]],
  [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[0, 0], [1, 0], [2, 0], [2, 1]],
  [[0, 1], [1, 1], [2, 0], [2, 1]],
  [[0, 0], [0, 1], [1, 1], [2, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]],
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]],
  [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]],
  [[0, 0], [0, 1], [1, 0], [2, 0], [2, 1]],
  /* Доп. тетрамино: S и Z */
  [[0, 1], [0, 2], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [1, 1], [1, 2]],
  /* Доп. пентамино: U, P, W, X, Y, F, N */
  [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]],
  [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]],
  [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
  [[0, 1], [1, 0], [1, 1], [2, 1], [3, 1]],
  [[0, 1], [0, 2], [1, 0], [1, 1], [2, 1]],
  [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]],
];

export function createEmptyGrid() {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
}

export function cloneGrid(grid) {
  return grid.map((row) => [...row]);
}

/** @param {number[][]} cells shape offsets [dr, dc] */
export function canPlace(grid, cells, anchorRow, anchorCol) {
  for (const [dr, dc] of cells) {
    const r = anchorRow + dr;
    const c = anchorCol + dc;
    if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return false;
    if (grid[r][c]) return false;
  }
  return true;
}

/**
 * @param {number[][]} cells
 * @param {number} fillValue занятое значение > 0 (слот палитры 1…3 на доске)
 */
export function applyPlacement(grid, cells, anchorRow, anchorCol, fillValue = 1) {
  const next = cloneGrid(grid);
  for (const [dr, dc] of cells) {
    next[anchorRow + dr][anchorCol + dc] = fillValue;
  }
  return next;
}

/**
 * Строки и столбцы, которые станут полностью заняты сразу после постановки фигуры (до resolveClears).
 * При невалидной постановке возвращает пустые массивы.
 *
 * @returns {{ fullRows: number[], fullCols: number[] }}
 */
export function linesFilledAfterPlacement(grid, cells, anchorRow, anchorCol, fillValue = 1) {
  if (!canPlace(grid, cells, anchorRow, anchorCol)) {
    return { fullRows: [], fullCols: [] };
  }
  const next = applyPlacement(grid, cells, anchorRow, anchorCol, fillValue);
  const fullRows = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    if (next[r].every((v) => v !== 0)) fullRows.push(r);
  }
  const fullCols = [];
  for (let c = 0; c < GRID_SIZE; c++) {
    let full = true;
    for (let r = 0; r < GRID_SIZE; r++) {
      if (!next[r][c]) {
        full = false;
        break;
      }
    }
    if (full) fullCols.push(c);
  }
  return { fullRows, fullCols };
}

/**
 * Индексы полностью заполненных строк и столбцов (до очистки).
 * @returns {{ rows: number[], cols: number[] }}
 */
export function getFullLineIndices(grid) {
  const rows = [];
  const cols = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    if (grid[r].every((v) => v !== 0)) rows.push(r);
  }
  for (let c = 0; c < GRID_SIZE; c++) {
    let full = true;
    for (let r = 0; r < GRID_SIZE; r++) {
      if (!grid[r][c]) {
        full = false;
        break;
      }
    }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

/**
 * Clears any cell that lies on a fully filled row or fully filled column.
 * @returns {{ grid: number[][], rowsCleared: number, colsCleared: number, scoreDelta: number }}
 */
export function resolveClears(grid) {
  const { rows, cols } = getFullLineIndices(grid);
  const rowsFull = new Set(rows);
  const colsFull = new Set(cols);
  const next = cloneGrid(grid);
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (rowsFull.has(r) || colsFull.has(c)) next[r][c] = 0;
    }
  }
  const rowsCleared = rowsFull.size;
  const colsCleared = colsFull.size;
  const scoreDelta = scoreForLineClears(rowsCleared, colsCleared);
  return { grid: next, rowsCleared, colsCleared, scoreDelta };
}

/** @param {number[][]} cells */
export function canPlaceAnywhere(grid, cells) {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (canPlace(grid, cells, r, c)) return true;
    }
  }
  return false;
}

/**
 * True when every non-null shape cannot be placed anywhere.
 * Empty remaining list is treated as not game-over (caller refills pieces).
 */
export function isGameOverForPieces(grid, pieces) {
  const remaining = pieces.filter(Boolean);
  if (remaining.length === 0) return false;
  return remaining.every((cells) => !canPlaceAnywhere(grid, cells));
}

/** Минимальные смещения строки/столбца приводятся к 0 (якорь полимино). */
export function normalizeShapeOffsets(cells) {
  if (!cells?.length) return cells;
  let minR = Infinity;
  let minC = Infinity;
  for (const [r, c] of cells) {
    if (r < minR) minR = r;
    if (c < minC) minC = c;
  }
  return cells.map(([r, c]) => [r - minR, c - minC]);
}

/** Отражение слева направо внутри текущего bounding box. */
export function mirrorShapeHorizontal(cells) {
  if (!cells?.length) return cells;
  let maxC = 0;
  for (const [, c] of cells) {
    if (c > maxC) maxC = c;
  }
  const mirrored = cells.map(([r, c]) => [r, maxC - c]);
  return normalizeShapeOffsets(mirrored);
}

/** Отражение сверху вниз внутри текущего bounding box. */
export function mirrorShapeVertical(cells) {
  if (!cells?.length) return cells;
  let maxR = 0;
  for (const [r] of cells) {
    if (r > maxR) maxR = r;
  }
  const mirrored = cells.map(([r, c]) => [maxR - r, c]);
  return normalizeShapeOffsets(mirrored);
}

/** Копия базовой фигуры со случайными отражениями по осям. */
export function varyShapeOrientation(cells, rng = Math.random) {
  let shape = cells.map(([r, c]) => [r, c]);
  if (rng() < 0.5) shape = mirrorShapeHorizontal(shape);
  if (rng() < 0.5) shape = mirrorShapeVertical(shape);
  return shape;
}

/** @param {() => number} rng returns [0, 1) */
export function pickRandomShapes(count = 3, rng = Math.random) {
  const n = SHAPE_POOL.length;
  const take = Math.min(count, n);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  const out = [];
  for (let k = 0; k < take; k++) {
    out.push(varyShapeOrientation(SHAPE_POOL[order[k]], rng));
  }
  return out;
}
