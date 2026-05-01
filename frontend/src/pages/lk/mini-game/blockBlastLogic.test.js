import {
  GRID_SIZE,
  SCORE_MULTILINE_PAIR_BONUS,
  SCORE_PER_LINE,
  SHAPE_POOL,
  applyPlacement,
  canPlace,
  canPlaceAnywhere,
  createEmptyGrid,
  createMulberry32,
  getFullLineIndices,
  isGameOverForPieces,
  linesFilledAfterPlacement,
  mirrorShapeHorizontal,
  normalizeShapeOffsets,
  pickRandomShapes,
  resolveClears,
  scoreForLineClears,
  varyShapeOrientation,
} from "./blockBlastLogic";

describe("blockBlastLogic", () => {
  it("createMulberry32 matches backend float stream for seed 12345", () => {
    const r = createMulberry32(12345);
    expect(r()).toBeCloseTo(0.9797282677609473, 15);
    expect(r()).toBeCloseTo(0.3067522644996643, 15);
    expect(r()).toBeCloseTo(0.484205421525985, 15);
  });

  it("canPlace rejects overlap", () => {
    const g = createEmptyGrid();
    g[1][1] = 1;
    expect(canPlace(g, [[0, 0]], 1, 1)).toBe(false);
    expect(canPlace(g, [[0, 0]], 0, 0)).toBe(true);
  });

  it("canPlace rejects out of bounds", () => {
    const g = createEmptyGrid();
    expect(canPlace(g, [[0, 0]], 0, 0)).toBe(true);
    expect(canPlace(g, [[0, 1]], 0, GRID_SIZE - 1)).toBe(false);
    expect(canPlace(g, [[1, 0]], GRID_SIZE - 1, 0)).toBe(false);
  });

  it("getFullLineIndices matches resolveClears detection", () => {
    const g = createEmptyGrid();
    for (let c = 0; c < GRID_SIZE; c++) g[2][c] = 1;
    for (let r = 0; r < GRID_SIZE; r++) g[r][4] = 1;
    const { rows, cols } = getFullLineIndices(g);
    expect(rows).toEqual([2]);
    expect(cols).toEqual([4]);
  });

  it("scoreForLineClears grows with combo lines", () => {
    expect(scoreForLineClears(1, 0)).toBe(SCORE_PER_LINE);
    expect(scoreForLineClears(2, 0)).toBe(SCORE_PER_LINE * 2 + SCORE_MULTILINE_PAIR_BONUS);
    expect(scoreForLineClears(1, 1)).toBe(SCORE_PER_LINE * 2 + SCORE_MULTILINE_PAIR_BONUS);
  });

  it("resolveClears clears full row and column and scores lines", () => {
    const g = createEmptyGrid();
    for (let c = 0; c < GRID_SIZE; c++) g[2][c] = 1;
    for (let r = 0; r < GRID_SIZE; r++) g[r][4] = 1;
    const { grid, rowsCleared, colsCleared, scoreDelta } = resolveClears(g);
    expect(rowsCleared).toBe(1);
    expect(colsCleared).toBe(1);
    expect(scoreDelta).toBe(scoreForLineClears(rowsCleared, colsCleared));
    for (let c = 0; c < GRID_SIZE; c++) expect(grid[2][c]).toBe(0);
    for (let r = 0; r < GRID_SIZE; r++) expect(grid[r][4]).toBe(0);
  });

  it("canPlaceAnywhere finds a spot on empty grid for domino", () => {
    const g = createEmptyGrid();
    expect(canPlaceAnywhere(g, [[0, 0], [0, 1]])).toBe(true);
  });

  it("isGameOverForPieces is false when no pieces left", () => {
    expect(isGameOverForPieces(createEmptyGrid(), [null, null, null])).toBe(false);
  });

  it("isGameOverForPieces when single cell cannot fit", () => {
    const g = createEmptyGrid();
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) g[r][c] = 1;
    }
    expect(isGameOverForPieces(g, [[[0, 0]], null, null])).toBe(true);
  });

  it("linesFilledAfterPlacement detects row that completes after placement", () => {
    const g = createEmptyGrid();
    for (let c = 0; c < GRID_SIZE - 2; c++) g[3][c] = 1;
    const dominoH = [
      [0, 0],
      [0, 1],
    ];
    expect(canPlace(g, dominoH, 3, GRID_SIZE - 2)).toBe(true);
    const { fullRows, fullCols } = linesFilledAfterPlacement(g, dominoH, 3, GRID_SIZE - 2, 1);
    expect(fullRows).toContain(3);
    expect(fullCols.length).toBe(0);
  });

  it("linesFilledAfterPlacement is empty when placement invalid", () => {
    const g = createEmptyGrid();
    g[0][0] = 1;
    const r = linesFilledAfterPlacement(g, [[0, 0]], 0, 0, 1);
    expect(r.fullRows).toEqual([]);
    expect(r.fullCols).toEqual([]);
  });

  it("mirrorShapeHorizontal reflects L-tromino to distinct offsets", () => {
    const cells = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    const m = mirrorShapeHorizontal(cells);
    expect(m).toEqual([
      [0, 1],
      [1, 1],
      [1, 0],
    ]);
    expect(normalizeShapeOffsets(m)).toEqual(m);
  });

  it("varyShapeOrientation applies mirrors when rng below 0.5", () => {
    const rng = () => 0.1;
    const base = [
      [0, 0],
      [0, 1],
    ];
    const v = varyShapeOrientation(base, rng);
    expect(v.length).toBe(2);
    expect(canPlace(createEmptyGrid(), v, 0, 0)).toBe(true);
  });

  it("pickRandomShapes returns distinct shapes (no duplicates in one tray)", () => {
    for (let trial = 0; trial < 40; trial++) {
      const shapes = pickRandomShapes(3, Math.random);
      expect(shapes.length).toBe(3);
      expect(new Set(shapes).size).toBe(3);
    }
  });

  it("applyPlacement fills cells", () => {
    const g = createEmptyGrid();
    const next = applyPlacement(g, [[0, 0], [1, 0]], 3, 3);
    expect(next[3][3]).toBe(1);
    expect(next[4][3]).toBe(1);
    expect(next[3][4]).toBe(0);
  });

  it("applyPlacement stores palette slot id", () => {
    const g = createEmptyGrid();
    const next = applyPlacement(g, [[0, 0]], 0, 0, 3);
    expect(next[0][0]).toBe(3);
  });
});
