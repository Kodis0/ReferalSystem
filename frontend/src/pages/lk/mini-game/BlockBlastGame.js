import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DiamondIcon } from "./DiamondIcon";
import {
  applyPlacement,
  canPlace,
  createEmptyGrid,
  createMulberry32,
  getFullLineIndices,
  GRID_SIZE,
  isGameOverForPieces,
  linesFilledAfterPlacement,
  pickRandomShapes,
  resolveClears,
  scoreForPlacement,
  SHAPE_POOL,
} from "./blockBlastLogic";
import "./blockBlastGame.css";
import "../dashboard/dashboard.css";
import {
  fetchGamificationSummary,
  postGamificationDailyChallengeFinish,
  postGamificationDailyChallengeStart,
} from "./gamificationApi";

/** Демо-таблица лидеров (без бэкенда). */
const BLOCK_BLAST_LEADERBOARD_MOCK = [
  { rank: 1, name: "Участник A", score: 2840 },
  { rank: 2, name: "Участник B", score: 2510 },
  { rank: 3, name: "Участник C", score: 2185 },
  { rank: 4, name: "Участник D", score: 1960 },
  { rank: 5, name: "Участник E", score: 1742 },
];

function ruDaysWord(n) {
  const nAbs = Math.floor(Math.abs(Number(n)));
  const d = nAbs % 10;
  const dd = nAbs % 100;
  if (dd >= 11 && dd <= 14) return "дней";
  if (d === 1) return "день";
  if (d >= 2 && d <= 4) return "дня";
  return "дней";
}

function parseMultiplier(str) {
  const n = Number.parseFloat(String(str ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 1;
}

function formatStreakMultiplier(mult) {
  return `x${mult.toFixed(1)}`;
}

/** Пиксели сердца в сетке 10×6 (viewBox), ортогональный «8-bit» контур. */
const PALETTE_SIZE = 4;

/** Базовая линия лампочек по полосе рамки (%): выше — ближе к игровому полю и к видимой рамке. */
const GARLAND_BULB_TRACK_INSET_PCT = 2.05;
/** Внутренняя «коробка» поля в тех же % — центры лампочек не заходят на клетки. */
const GARLAND_BULB_FIELD_INSET_PCT = 5.35;
/** Лёгкий разброс по двум осям в пределах полосы рамки. */
const GARLAND_BULB_JITTER_PCT = 0.65;
/** Выталкивание из коробки поля в полосу рамки. */
const GARLAND_BULB_EPS_OUT_PCT = 0.35;

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

/** Активные цвета игры: синий, красный, жёлтый, зелёный (palette-1…4). */
const GAME_PALETTE = ["#2563eb", "#dc2626", "#eab308", "#16a34a"];

/** Без повторов: k индексов из 0..n-1. */
function pickRandomKFromN(k, n, rng = Math.random) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr.slice(0, k);
}

function pickGamePaletteColors() {
  return [...GAME_PALETTE];
}

function shuffleShapePool(pool) {
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** Одна случайная постановка фигуры из пула; если некуда — null (сброс сетки у вызывающего). */
function demoIdleTryPlace(prev) {
  const shapes = shuffleShapePool(SHAPE_POOL);
  for (const cells of shapes) {
    const anchors = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (canPlace(prev, cells, r, c)) anchors.push({ r, c });
      }
    }
    if (anchors.length === 0) continue;
    const { r, c } = anchors[Math.floor(Math.random() * anchors.length)];
    const color = Math.floor(Math.random() * 4) + 1;
    return applyPlacement(prev, cells, r, c, color);
  }
  return null;
}

function createStaticDemoGridFull() {
  const g = createEmptyGrid();
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      g[r][c] = ((r * 5 + c * 13 + ((r % 3) + 1) * ((c % 5) + 1)) % 4) + 1;
    }
  }
  return g;
}

/** Три разных цвета из четырёх активных в игре — для слотов трея 0…2. */
function pickTrayColorIndicesFromFour(rng = Math.random) {
  const perm = pickRandomKFromN(4, 4, rng);
  return [perm[0], perm[1], perm[2]];
}

/** Ниже порога — считаем кликом (выбор фигуры), выше — перетаскивание с ghost и превью поля. */
const DRAG_THRESHOLD_PX = 6;

/** Показ анимации линий перед фактической очисткой сетки (совпадает с длительностью CSS). */
const LINE_CLEAR_ANIM_MS = 450;

const CLEAR_PARTICLES_PER_CELL = 7;

/** Уникальные клетки полных строк и столбцов (пересечения не дублируем). */
function collectLineClearCellKeys(rows, cols) {
  const seen = new Set();
  for (const r of rows) {
    for (let c = 0; c < GRID_SIZE; c++) {
      seen.add(`${r},${c}`);
    }
  }
  for (const c of cols) {
    for (let r = 0; r < GRID_SIZE; r++) {
      seen.add(`${r},${c}`);
    }
  }
  return Array.from(seen, (k) => {
    const [rs, cs] = k.split(",");
    return { r: Number.parseInt(rs, 10), c: Number.parseInt(cs, 10) };
  });
}

/** Направление и задержка одной частицы — детерминированно от координат клетки. */
function burstParticleMotion(r, c, i) {
  const seed = r * 97 + c * 41 + i * 23;
  const jitter = ((seed % 360) / 360) * 0.28;
  const angle = (i / CLEAR_PARTICLES_PER_CELL + jitter) * Math.PI * 2;
  const dist = 16 + (seed % 20);
  return {
    dx: Math.cos(angle) * dist,
    dy: Math.sin(angle) * dist,
    delay: (i * 22 + (seed % 55)) % 95,
  };
}

function LineClearParticlesLayer({ particles, className }) {
  if (particles.length === 0) return null;
  return (
    <div
      className={["block-blast-game__line-clear-particles", className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      {particles.map((p) => (
        <span
          key={p.key}
          className={`block-blast-game__clear-particle block-blast-game__clear-particle_palette-${p.palette}`}
          style={{
            left: `${p.leftPct}%`,
            top: `${p.topPct}%`,
            ["--bb-clear-p-dx"]: `${p.dx}px`,
            ["--bb-clear-p-dy"]: `${p.dy}px`,
            ["--bb-clear-p-delay"]: `${p.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}

/** Клетка поля под координатами экрана (для drag-превью по позиции мыши). */
function readBoardCellFromPoint(clientX, clientY) {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    if (!(el instanceof HTMLElement)) continue;
    const row = el.getAttribute("data-bb-row");
    const col = el.getAttribute("data-bb-col");
    if (row != null && col != null) {
      const r = Number.parseInt(row, 10);
      const c = Number.parseInt(col, 10);
      if (Number.isFinite(r) && Number.isFinite(c)) return { r, c };
    }
  }
  return null;
}

/** Только блоки фигуры; paletteIndex 0…3 — индекс в активной палитре игры (4 цвета). */
function PiecePreview({ cells, cellPx = 22, paletteIndex = 0 }) {
  if (!cells?.length) return <span className="block-blast-game__piece-empty">—</span>;

  let maxR = 0;
  let maxC = 0;
  for (const [r, c] of cells) {
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  const rows = maxR + 1;
  const cols = maxC + 1;
  const pi = Math.min(PALETTE_SIZE - 1, Math.max(0, paletteIndex));
  const slotClass = `block-blast-game__pv-palette-${pi + 1}`;
  const style = {
    display: "grid",
    gridTemplateColumns: `repeat(${cols}, ${cellPx}px)`,
    gridTemplateRows: `repeat(${rows}, ${cellPx}px)`,
    gap: 0,
    width: cols * cellPx,
    height: rows * cellPx,
  };
  return (
    <div className="block-blast-game__piece-preview" style={style}>
      {cells.map(([r, c], i) => (
        <span
          key={`${r}-${c}-${i}`}
          className={`block-blast-game__pv-cell block-blast-game__pv-cell_on block-blast-game__pv-cube ${slotClass}`}
          style={{
            gridRow: r + 1,
            gridColumn: c + 1,
            width: cellPx,
            height: cellPx,
            boxSizing: "border-box",
          }}
        />
      ))}
    </div>
  );
}

export default function BlockBlastGame() {
  const [grid, setGrid] = useState(() => createEmptyGrid());
  const [pieces, setPieces] = useState(() => pickRandomShapes(3));
  const [paletteColors, setPaletteColors] = useState(() => pickGamePaletteColors());
  const [trayColorIds, setTrayColorIds] = useState(() => pickTrayColorIndicesFromFour());
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  /** Индекс фигуры, перетаскиваемой указателем (призрак + превью по координатам мыши). */
  const [dragSourceIdx, setDragSourceIdx] = useState(null);
  /** Позиция призрака фигуры в координатах viewport (только после превышения DRAG_THRESHOLD_PX). */
  const [ghostPos, setGhostPos] = useState(null);
  /** true после порога движения — показываем ghost и превью по полю (до порога возможен клик-выбор). */
  const [dragLifted, setDragLifted] = useState(false);
  /** Якорь предпросмотра на поле { r, c } — под курсором при перетаскивании или при выборе фигуры + наведении. */
  const [previewAnchor, setPreviewAnchor] = useState(null);
  /** Анимация снятия линий: клетки с индексами затронутых рядов/столбцов. */
  const [lineClearAnim, setLineClearAnim] = useState(null);
  const [clearAnimating, setClearAnimating] = useState(false);
  /** Всплывающий текст +N за последний ход. */
  const [scoreFloater, setScoreFloater] = useState(null);
  /** До первого «Новая игра» показываем демо-поле с кнопкой старта поверх. */
  const [gameStarted, setGameStarted] = useState(false);
  /** Демо-сетка: случайные фигуры по таймеру, пока игра не начата. */
  const [demoGrid, setDemoGrid] = useState(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return createStaticDemoGridFull();
    }
    return createEmptyGrid();
  });
  /** Анимация снятия линий на демо-поле до старта (как в игре). */
  const [demoLineClearAnim, setDemoLineClearAnim] = useState(null);
  const demoIdleIntervalRef = useRef(null);
  const demoIdleClearTimeoutRef = useRef(null);

  const dragSessionRef = useRef({ active: false, pieceIdx: 0, moved: false, sx: 0, sy: 0 });
  const lineClearAnimTimeoutRef = useRef(null);
  const scoreFloaterTimeoutRef = useRef(null);
  const tryPlacePieceRef = useRef(() => {});
  /** rAF-батч позиции ghost + превью: плавное следование за указателем, не «прилипание» к шагам рендера сетки. */
  const ghostMoveRafRef = useRef(null);
  const ghostPendingRef = useRef(null);

  const [gamificationSummary, setGamificationSummary] = useState(null);
  const [summaryLoadState, setSummaryLoadState] = useState("loading");
  const [summaryError, setSummaryError] = useState(null);
  const [preStartBusy, setPreStartBusy] = useState(false);
  const [startChallengeError, setStartChallengeError] = useState(null);
  const [finishUiState, setFinishUiState] = useState("idle");
  const [finishReward, setFinishReward] = useState(null);
  const [finishAlreadyCompleted, setFinishAlreadyCompleted] = useState(false);
  const [finishErrorMessage, setFinishErrorMessage] = useState(null);

  const challengeSeedRef = useRef(null);
  const challengeAttemptIdRef = useRef(null);
  const challengeRngRef = useRef(null);
  const moveLogRef = useRef([]);
  const gameStartPerfRef = useRef(0);

  const loadGamificationSummary = useCallback(async () => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
    if (!token) {
      setSummaryLoadState("error");
      setSummaryError("no_token");
      return;
    }
    setSummaryLoadState("loading");
    setSummaryError(null);
    try {
      const data = await fetchGamificationSummary(token);
      setGamificationSummary(data);
      setSummaryLoadState("ready");
    } catch (e) {
      setSummaryLoadState("error");
      setSummaryError(e?.message || "fetch_failed");
    }
  }, []);

  useEffect(() => {
    loadGamificationSummary();
  }, [loadGamificationSummary]);

  useEffect(() => {
    if (!gameOver || !gameStarted) return undefined;
    if (!challengeAttemptIdRef.current) {
      setFinishUiState("done");
      setFinishReward(null);
      setFinishAlreadyCompleted(false);
      setFinishErrorMessage(null);
      return undefined;
    }
    const token = typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
    if (!token) {
      setFinishUiState("error");
      setFinishErrorMessage("Не удалось отправить результат.");
      return undefined;
    }
    const ac = new AbortController();
    setFinishUiState("submitting");
    setFinishErrorMessage(null);
    (async () => {
      try {
        const data = await postGamificationDailyChallengeFinish(
          token,
          {
            attemptId: challengeAttemptIdRef.current,
            moves: [...moveLogRef.current],
            clientScore: score,
          },
          { signal: ac.signal },
        );
        if (data.summary) setGamificationSummary(data.summary);
        setFinishReward(data.reward ?? null);
        setFinishAlreadyCompleted(Boolean(data.already_completed));
        setFinishUiState("done");
      } catch (e) {
        if (e?.name === "AbortError") return;
        const status = e?.status;
        const code = e?.body?.code ?? e?.body?.detail;
        if (status === 400 && code) {
          setFinishErrorMessage(
            "Не удалось подтвердить результат. Попробуйте следующий челлендж позже.",
          );
        } else {
          setFinishErrorMessage("Не удалось отправить результат.");
        }
        setFinishUiState("error");
      }
    })();
    return () => ac.abort();
  }, [gameOver, gameStarted, score]);

  const resetBoardState = useCallback(() => {
    setFinishUiState("idle");
    setFinishReward(null);
    setFinishAlreadyCompleted(false);
    setFinishErrorMessage(null);

    setGameStarted(true);
    setGrid(createEmptyGrid());
    if (challengeSeedRef.current != null) {
      challengeRngRef.current = createMulberry32(challengeSeedRef.current);
      moveLogRef.current = [];
      gameStartPerfRef.current =
        typeof performance !== "undefined" ? performance.now() : Date.now();
    }
    const rngPick =
      challengeAttemptIdRef.current && challengeRngRef.current ? challengeRngRef.current : Math.random;
    setPieces(pickRandomShapes(3, rngPick));
    setPaletteColors(pickGamePaletteColors());
    setTrayColorIds(pickTrayColorIndicesFromFour(rngPick));
    setSelectedIdx(null);
    setDragSourceIdx(null);
    setGhostPos(null);
    setDragLifted(false);
    setPreviewAnchor(null);
    setLineClearAnim(null);
    setClearAnimating(false);
    setScoreFloater(null);
    if (lineClearAnimTimeoutRef.current != null) {
      clearTimeout(lineClearAnimTimeoutRef.current);
      lineClearAnimTimeoutRef.current = null;
    }
    if (scoreFloaterTimeoutRef.current != null) {
      clearTimeout(scoreFloaterTimeoutRef.current);
      scoreFloaterTimeoutRef.current = null;
    }
    if (demoIdleIntervalRef.current != null) {
      clearInterval(demoIdleIntervalRef.current);
      demoIdleIntervalRef.current = null;
    }
    if (demoIdleClearTimeoutRef.current != null) {
      clearTimeout(demoIdleClearTimeoutRef.current);
      demoIdleClearTimeoutRef.current = null;
    }
    setDemoLineClearAnim(null);
    setScore(0);
    setGameOver(false);
  }, []);

  const handlePreStartNewGame = useCallback(async () => {
    if (preStartBusy || summaryLoadState !== "ready") return;
    const ta = gamificationSummary?.today_attempt;
    if (ta?.status === "completed") return;
    const token = window.localStorage.getItem("access_token");
    if (!token) return;
    setPreStartBusy(true);
    setStartChallengeError(null);
    try {
      const summary = await postGamificationDailyChallengeStart(token);
      const ta = summary.today_attempt;
      if (ta?.rng_seed != null && ta?.attempt_public_id) {
        challengeSeedRef.current = Number(ta.rng_seed);
        challengeAttemptIdRef.current = ta.attempt_public_id;
        challengeRngRef.current = createMulberry32(challengeSeedRef.current);
        moveLogRef.current = [];
        gameStartPerfRef.current =
          typeof performance !== "undefined" ? performance.now() : Date.now();
      }
      setGamificationSummary(summary);
      resetBoardState();
    } catch {
      setStartChallengeError("Не удалось начать попытку. Попробуйте ещё раз.");
    } finally {
      setPreStartBusy(false);
    }
  }, [gamificationSummary?.today_attempt, preStartBusy, resetBoardState, summaryLoadState]);

  const startNewGame = useCallback(() => {
    resetBoardState();
  }, [resetBoardState]);

  const flashScoreDelta = useCallback((delta) => {
    if (delta <= 0) return;
    if (scoreFloaterTimeoutRef.current != null) {
      clearTimeout(scoreFloaterTimeoutRef.current);
    }
    const id = Date.now();
    setScoreFloater({ id, delta });
    scoreFloaterTimeoutRef.current = window.setTimeout(() => {
      scoreFloaterTimeoutRef.current = null;
      setScoreFloater((prev) => (prev?.id === id ? null : prev));
    }, 1000);
  }, []);

  const tryPlacePieceAt = useCallback(
    (pieceIdx, row, col) => {
      if (clearAnimating || gameOver || pieceIdx == null || pieceIdx < 0 || pieceIdx > 2) return;
      const cells = pieces[pieceIdx];
      if (!cells || !canPlace(grid, cells, row, col)) return;

      const rngPick =
        challengeAttemptIdRef.current && challengeRngRef.current ? challengeRngRef.current : Math.random;

      if (challengeAttemptIdRef.current) {
        const perfBase =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        moveLogRef.current.push({
          piece_slot: pieceIdx,
          row,
          col,
          client_time_ms: Math.round(perfBase - (gameStartPerfRef.current || perfBase)),
        });
      }

      const fillVal = trayColorIds[pieceIdx] + 1;
      const nextGrid = applyPlacement(grid, cells, row, col, fillVal);
      const { rows: clearRows, cols: clearCols } = getFullLineIndices(nextGrid);
      const hasLineClear = clearRows.length > 0 || clearCols.length > 0;

      const placementScore = scoreForPlacement(cells.length);
      const { grid: clearedGrid, scoreDelta: clearDelta } = resolveClears(nextGrid);
      const totalDelta = placementScore + clearDelta;
      const nextScore = score + totalDelta;

      const finishMove = (clearedGrid, refill, nextScoreVal, over) => {
        setGrid(clearedGrid);
        setPieces(refill);
        setSelectedIdx(null);
        setPreviewAnchor(null);
        setScore(nextScoreVal);
        setGameOver(over);
      };

      const nextPiecesBase = [...pieces];
      nextPiecesBase[pieceIdx] = null;
      let refill = nextPiecesBase;
      if (nextPiecesBase.every((p) => p == null)) {
        refill = pickRandomShapes(3, rngPick);
      }

      const over = isGameOverForPieces(clearedGrid, refill);

      if (!hasLineClear) {
        if (nextPiecesBase.every((p) => p == null)) {
          setTrayColorIds(pickTrayColorIndicesFromFour(rngPick));
        }
        flashScoreDelta(totalDelta);
        finishMove(clearedGrid, refill, nextScore, over);
        return;
      }

      if (lineClearAnimTimeoutRef.current != null) {
        clearTimeout(lineClearAnimTimeoutRef.current);
      }

      setClearAnimating(true);
      setGrid(nextGrid);
      setPieces(nextPiecesBase);
      setLineClearAnim({ rows: clearRows, cols: clearCols });

      lineClearAnimTimeoutRef.current = window.setTimeout(() => {
        lineClearAnimTimeoutRef.current = null;
        setLineClearAnim(null);
        setClearAnimating(false);
        if (nextPiecesBase.every((p) => p == null)) {
          setTrayColorIds(pickTrayColorIndicesFromFour(rngPick));
        }
        flashScoreDelta(totalDelta);
        finishMove(clearedGrid, refill, nextScore, over);
      }, LINE_CLEAR_ANIM_MS);
    },
    [clearAnimating, flashScoreDelta, gameOver, grid, pieces, score, trayColorIds],
  );

  useEffect(() => {
    tryPlacePieceRef.current = tryPlacePieceAt;
  }, [tryPlacePieceAt]);

  /** Демо до старта: бесконечно ставим фигуры; полные линии подсвечиваются и снимаются (без «проигрыша»). */
  useEffect(() => {
    if (gameStarted) return undefined;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }

    const stopDemoTick = () => {
      if (demoIdleIntervalRef.current != null) {
        clearInterval(demoIdleIntervalRef.current);
        demoIdleIntervalRef.current = null;
      }
    };

    const startDemoTick = () => {
      stopDemoTick();
      demoIdleIntervalRef.current = window.setInterval(() => {
        setDemoGrid((prev) => {
          const placed = demoIdleTryPlace(prev);
          if (!placed) return createEmptyGrid();
          const { rows, cols } = getFullLineIndices(placed);
          if (rows.length > 0 || cols.length > 0) {
            stopDemoTick();
            setDemoLineClearAnim({ rows, cols });
            if (demoIdleClearTimeoutRef.current != null) {
              clearTimeout(demoIdleClearTimeoutRef.current);
            }
            demoIdleClearTimeoutRef.current = window.setTimeout(() => {
              const cleared = resolveClears(placed).grid;
              setDemoGrid(cleared);
              setDemoLineClearAnim(null);
              demoIdleClearTimeoutRef.current = null;
              startDemoTick();
            }, LINE_CLEAR_ANIM_MS);
            return placed;
          }
          return placed;
        });
      }, 380);
    };

    startDemoTick();
    return () => {
      stopDemoTick();
      if (demoIdleClearTimeoutRef.current != null) {
        clearTimeout(demoIdleClearTimeoutRef.current);
        demoIdleClearTimeoutRef.current = null;
      }
    };
  }, [gameStarted]);

  useEffect(() => {
    if (selectedIdx == null && dragSourceIdx == null) {
      setPreviewAnchor(null);
    }
  }, [selectedIdx, dragSourceIdx]);

  useEffect(() => {
    if (!dragLifted) return undefined;
    document.body.classList.add("block-blast-game--piece-drag");
    return () => document.body.classList.remove("block-blast-game--piece-drag");
  }, [dragLifted]);

  useEffect(
    () => () => {
      if (ghostMoveRafRef.current != null) {
        cancelAnimationFrame(ghostMoveRafRef.current);
        ghostMoveRafRef.current = null;
      }
    },
    [],
  );

  useEffect(
    () => () => {
      if (lineClearAnimTimeoutRef.current != null) {
        clearTimeout(lineClearAnimTimeoutRef.current);
      }
      if (scoreFloaterTimeoutRef.current != null) {
        clearTimeout(scoreFloaterTimeoutRef.current);
      }
    },
    [],
  );

  const placeSelectedAt = useCallback(
    (row, col) => {
      if (selectedIdx == null) return;
      tryPlacePieceAt(selectedIdx, row, col);
    },
    [selectedIdx, tryPlacePieceAt],
  );

  const trayDisabled = gameOver || clearAnimating;

  /** Перетаскивание указателем: призрак следует за курсором, превью якоря по позиции над полем. */
  const handleTrayPointerDown = useCallback(
    (e, i) => {
      if (trayDisabled || pieces[i] == null) return;
      e.preventDefault();
      const captureEl = e.currentTarget;
      const pointerId = e.pointerId;
      if (captureEl instanceof HTMLElement && typeof captureEl.setPointerCapture === "function") {
        try {
          captureEl.setPointerCapture(pointerId);
        } catch {
          /* ignore */
        }
      }
      dragSessionRef.current = {
        active: true,
        pieceIdx: i,
        moved: false,
        sx: e.clientX,
        sy: e.clientY,
        captureEl: captureEl instanceof HTMLElement ? captureEl : null,
        pointerId,
      };
      setDragSourceIdx(i);
      setGhostPos(null);
      setDragLifted(false);
      setPreviewAnchor(null);

      const flushGhostMove = () => {
        ghostMoveRafRef.current = null;
        const p = ghostPendingRef.current;
        if (!p) return;
        ghostPendingRef.current = null;
        setGhostPos({ x: p.x, y: p.y });
        setPreviewAnchor(readBoardCellFromPoint(p.x, p.y));
      };

      const onMove = (ev) => {
        const d = dragSessionRef.current;
        if (!d.active) return;
        const dist = Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy);
        if (dist > DRAG_THRESHOLD_PX) {
          const firstLift = !d.moved;
          d.moved = true;
          setDragLifted(true);
          const x = ev.clientX;
          const y = ev.clientY;
          if (firstLift) {
            if (ghostMoveRafRef.current != null) {
              cancelAnimationFrame(ghostMoveRafRef.current);
              ghostMoveRafRef.current = null;
            }
            ghostPendingRef.current = null;
            setGhostPos({ x, y });
            setPreviewAnchor(readBoardCellFromPoint(x, y));
          } else {
            ghostPendingRef.current = { x, y };
            if (ghostMoveRafRef.current == null) {
              ghostMoveRafRef.current = requestAnimationFrame(flushGhostMove);
            }
          }
        }
      };

      const onUp = (ev) => {
        if (ghostMoveRafRef.current != null) {
          cancelAnimationFrame(ghostMoveRafRef.current);
          ghostMoveRafRef.current = null;
        }
        ghostPendingRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        const d = dragSessionRef.current;
        if (d.captureEl && typeof d.captureEl.releasePointerCapture === "function") {
          try {
            if (d.captureEl.hasPointerCapture?.(d.pointerId)) {
              d.captureEl.releasePointerCapture(d.pointerId);
            }
          } catch {
            /* ignore */
          }
        }
        if (!d.active) return;
        d.active = false;
        const idx = d.pieceIdx;
        const moved = d.moved;
        const anchor = readBoardCellFromPoint(ev.clientX, ev.clientY);

        setDragSourceIdx(null);
        setGhostPos(null);
        setDragLifted(false);
        setPreviewAnchor(null);

        if (moved) {
          if (anchor != null) tryPlacePieceRef.current(idx, anchor.r, anchor.c);
        } else {
          setSelectedIdx((prev) => (prev === idx ? null : idx));
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [trayDisabled, pieces],
  );

  const pieceSlots = useMemo(
    () =>
      pieces.map((cells, i) => {
        const empty = cells == null;
        const selected = selectedIdx === i;
        const dragging = dragLifted && dragSourceIdx === i;
        const cls = [
          "block-blast-game__piece-slot",
          empty ? "block-blast-game__piece-slot_empty" : "",
          !empty && selected ? "block-blast-game__piece-slot_selected" : "",
          dragging ? "block-blast-game__piece-slot_dragging" : "",
          trayDisabled ? "block-blast-game__piece-slot_muted" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={i}
            type="button"
            className={cls}
            disabled={trayDisabled || empty}
            aria-grabbed={!empty && dragLifted && dragSourceIdx === i ? "true" : undefined}
            onPointerDown={(e) => handleTrayPointerDown(e, i)}
            aria-pressed={selected}
          >
            {empty ? null : <PiecePreview cells={cells} paletteIndex={trayColorIds[i]} />}
          </button>
        );
      }),
    [dragLifted, dragSourceIdx, handleTrayPointerDown, pieces, selectedIdx, trayColorIds, trayDisabled],
  );

  const boardCells = useMemo(() => {
    const previewPieceIdx =
      dragSourceIdx != null ? dragSourceIdx : selectedIdx != null ? selectedIdx : null;
    const previewCells =
      previewPieceIdx != null && pieces[previewPieceIdx] ? pieces[previewPieceIdx] : null;

    let footprintGoodKeys = null;
    let footprintBadKeys = null;
    let clearLineRows = null;
    let clearLineCols = null;
    if (
      !gameOver &&
      !clearAnimating &&
      previewCells &&
      previewAnchor &&
      previewPieceIdx != null &&
      pieces[previewPieceIdx]
    ) {
      const { r: ar, c: ac } = previewAnchor;
      if (canPlace(grid, previewCells, ar, ac)) {
        footprintGoodKeys = new Set(
          previewCells.map(([dr, dc]) => `${ar + dr},${ac + dc}`),
        );
        const prevFill = trayColorIds[previewPieceIdx] + 1;
        const { fullRows, fullCols } = linesFilledAfterPlacement(
          grid,
          previewCells,
          ar,
          ac,
          prevFill,
        );
        if (fullRows.length > 0 || fullCols.length > 0) {
          clearLineRows = new Set(fullRows);
          clearLineCols = new Set(fullCols);
        }
      } else {
        footprintBadKeys = new Set();
        for (const [dr, dc] of previewCells) {
          const rr = ar + dr;
          const cc = ac + dc;
          if (rr >= 0 && rr < GRID_SIZE && cc >= 0 && cc < GRID_SIZE) {
            footprintBadKeys.add(`${rr},${cc}`);
          }
        }
      }
    }

    const cells = [];
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const cellVal = grid[r][c];
        const filled = cellVal !== 0;
        const key = `${r},${c}`;
        const onFootprintGood = Boolean(footprintGoodKeys?.has(key));
        const onFootprintBad = Boolean(footprintBadKeys?.has(key));
        const onClearLineHint =
          Boolean(clearLineRows?.has(r)) || Boolean(clearLineCols?.has(c));
        const onLineClearBurst = Boolean(
          lineClearAnim && (lineClearAnim.rows.includes(r) || lineClearAnim.cols.includes(c)),
        );
        const previewPaletteNum =
          previewPieceIdx != null ? trayColorIds[previewPieceIdx] + 1 : 1;
        const previewSlotClass =
          onFootprintGood && previewPieceIdx != null
            ? `block-blast-game__cell_preview-palette-${previewPaletteNum}`
            : "";

        const cls = [
          "block-blast-game__cell",
          filled ? `block-blast-game__cell_filled block-blast-game__cell_palette-${cellVal}` : "",
          onFootprintGood ? `block-blast-game__cell_preview-good ${previewSlotClass}`.trim() : "",
          onFootprintBad ? "block-blast-game__cell_preview-bad" : "",
          onClearLineHint && previewPieceIdx != null
            ? `block-blast-game__cell_clear-line-tint block-blast-game__cell_clear-line-tint_palette-${previewPaletteNum}`
            : "",
          onLineClearBurst ? "block-blast-game__cell_line-clear-burst" : "",
        ]
          .filter(Boolean)
          .join(" ");
        cells.push(
          <button
            key={`${r}-${c}`}
            type="button"
            className={cls}
            disabled={gameOver || filled || clearAnimating}
            data-bb-row={r}
            data-bb-col={c}
            onClick={() => placeSelectedAt(r, c)}
            onMouseEnter={() => {
              if (gameOver || filled || clearAnimating || dragSourceIdx != null) return;
              if (selectedIdx == null) return;
              setPreviewAnchor({ r, c });
            }}
            aria-label={`Клетка ${r + 1}, ${c + 1}`}
          />,
        );
      }
    }
    return cells;
  }, [
    clearAnimating,
    dragSourceIdx,
    grid,
    gameOver,
    lineClearAnim,
    pieces,
    placeSelectedAt,
    previewAnchor,
    selectedIdx,
    trayColorIds,
    tryPlacePieceAt,
  ]);

  const demoBoardCells = useMemo(() => {
    const cells = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const val = demoGrid[r][c];
        const filled = val !== 0;
        const onLineClearBurst = Boolean(
          demoLineClearAnim &&
            (demoLineClearAnim.rows.includes(r) || demoLineClearAnim.cols.includes(c)),
        );
        const cls = [
          "block-blast-game__cell",
          filled ? `block-blast-game__cell_filled block-blast-game__cell_palette-${val}` : "",
          onLineClearBurst ? "block-blast-game__cell_line-clear-burst" : "",
        ]
          .filter(Boolean)
          .join(" ");
        cells.push(<div key={`demo-${r}-${c}`} className={cls} aria-hidden="true" />);
      }
    }
    return cells;
  }, [demoGrid, demoLineClearAnim]);

  /** Лампочки по периметру рамки с хаотичным сдвигом по двум осям; не заходят на игровое поле. */
  const demoGarlandBulbs = useMemo(() => {
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
  }, []);

  const lineClearParticles = useMemo(() => {
    const anim = lineClearAnim ?? (!gameStarted ? demoLineClearAnim : null);
    if (!anim) return [];
    const g = gameStarted ? grid : demoGrid;
    const keys = collectLineClearCellKeys(anim.rows, anim.cols);
    const out = [];
    for (const { r, c } of keys) {
      const val = g[r]?.[c];
      if (!val) continue;
      for (let i = 0; i < CLEAR_PARTICLES_PER_CELL; i++) {
        const { dx, dy, delay } = burstParticleMotion(r, c, i);
        out.push({
          key: `bb-clear-p-${r}-${c}-${i}`,
          leftPct: ((c + 0.5) / GRID_SIZE) * 100,
          topPct: ((r + 0.5) / GRID_SIZE) * 100,
          palette: val,
          dx,
          dy,
          delay,
        });
      }
    }
    return out;
  }, [lineClearAnim, demoLineClearAnim, gameStarted, grid, demoGrid]);

  const paletteStyle = {
    "--bb-palette-0": paletteColors[0],
    "--bb-palette-1": paletteColors[1],
    "--bb-palette-2": paletteColors[2],
    "--bb-palette-3": paletteColors[3],
  };

  const challengeCompletedToday = gamificationSummary?.today_attempt?.status === "completed";
  const todayAttemptScore =
    gamificationSummary?.today_attempt?.status === "completed"
      ? Number(gamificationSummary?.today_attempt?.score)
      : null;
  const xpInto = Number(gamificationSummary?.level_progress?.xp_into_level) || 0;
  const xpSpanRaw = Number(gamificationSummary?.level_progress?.xp_for_current_level_span);
  const xpSpan = Number.isFinite(xpSpanRaw) && xpSpanRaw > 0 ? xpSpanRaw : 1;
  const profileXpPct = Math.min(100, Math.max(0, Math.round((xpInto / xpSpan) * 100)));
  const streakDaysShown = Number(gamificationSummary?.streak_days) || 0;
  const streakMultLabel = formatStreakMultiplier(parseMultiplier(gamificationSummary?.streak_multiplier));
  const apiBestChallenge = Number(gamificationSummary?.best_challenge_score) || 0;
  const displayBestScore = Math.max(apiBestChallenge, score);
  const levelShown = Number(gamificationSummary?.level) || 1;
  const xpTotalShown = Number(gamificationSummary?.xp_total) || 0;
  const xpBarAriaText =
    summaryLoadState === "ready"
      ? `Прогресс уровня: ${xpInto.toLocaleString("ru-RU")} из ${xpSpan.toLocaleString("ru-RU")} XP, всего ${xpTotalShown.toLocaleString("ru-RU")} XP`
      : "";

  const gameOverRestartDisabled = challengeCompletedToday || finishUiState === "submitting";

  return (
    <div className="block-blast-game" style={paletteStyle}>
      <div className="block-blast-game__layout">
        <div className="block-blast-game__main">
          <div
            className={[
              "block-blast-game__board-wrap",
              !gameStarted ? "block-blast-game__board-wrap_pre-start" : "",
              gameStarted ? "block-blast-game__board-wrap_game-active" : "",
              lineClearAnim || (!gameStarted && demoLineClearAnim)
                ? "block-blast-game__board-wrap_line-clearing"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onDragLeave={(e) => {
              if (!gameStarted || dragSourceIdx != null) return;
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setPreviewAnchor(null);
              }
            }}
            onMouseLeave={(e) => {
              if (!gameStarted || dragSourceIdx != null) return;
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setPreviewAnchor(null);
              }
            }}
          >
            {!gameStarted ? (
              <>
                <div className="block-blast-game__board block-blast-game__board_demo" aria-hidden="true">
                  <div className="block-blast-game__board_demo-inner">{demoBoardCells}</div>
                </div>
                <div className="block-blast-game__pre-start-overlay">
                  {summaryLoadState === "loading" ? (
                    <p className="block-blast-game__gamification-status">Загрузка прогресса…</p>
                  ) : null}
                  {summaryLoadState === "error" ? (
                    <>
                      <p className="block-blast-game__gamification-status">
                        {summaryError === "no_token"
                          ? "Войдите в аккаунт, чтобы сохранять прогресс."
                          : "Не удалось загрузить данные. Попробуйте обновить страницу."}
                      </p>
                      <button
                        type="button"
                        className="lk-dashboard__my-programs-catalog-banner-cta"
                        onClick={() => loadGamificationSummary()}
                      >
                        Повторить
                      </button>
                    </>
                  ) : null}
                  {summaryLoadState === "ready" && challengeCompletedToday ? (
                    <>
                      <p className="block-blast-game__gamification-status block-blast-game__gamification-status--done">
                        Сегодняшний челлендж уже завершён
                      </p>
                      {todayAttemptScore != null && Number.isFinite(todayAttemptScore) ? (
                        <p className="block-blast-game__gamification-sub">
                          Результат попытки: {todayAttemptScore.toLocaleString("ru-RU")}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  {summaryLoadState === "ready" && !challengeCompletedToday ? (
                    <>
                      <button
                        type="button"
                        className="lk-dashboard__my-programs-catalog-banner-cta"
                        onClick={handlePreStartNewGame}
                        disabled={preStartBusy}
                      >
                        {preStartBusy ? "Подождите…" : "Новая игра"}
                      </button>
                      {preStartBusy ? (
                        <p className="block-blast-game__gamification-status">Подготовка попытки…</p>
                      ) : null}
                      {startChallengeError ? (
                        <p className="block-blast-game__gamification-status">{startChallengeError}</p>
                      ) : null}
                    </>
                  ) : null}
                </div>
                {lineClearParticles.length > 0 ? (
                  <LineClearParticlesLayer
                    particles={lineClearParticles}
                    className="block-blast-game__line-clear-particles_above-overlay"
                  />
                ) : null}
              </>
            ) : (
              <>
                {scoreFloater ? (
                  <span key={scoreFloater.id} className="block-blast-game__score-floater-board" aria-live="polite">
                    +{scoreFloater.delta}
                  </span>
                ) : null}
                <div className="block-blast-game__board">
                  <div className="block-blast-game__board-grid">{boardCells}</div>
                  <LineClearParticlesLayer particles={lineClearParticles} />
                </div>
              </>
            )}
            {gameStarted && gameOver ? (
              <div
                className="block-blast-game__gameover-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="block-blast-gameover-heading"
              >
                <p id="block-blast-gameover-heading" className="block-blast-game__gameover-title">
                  Игра окончена
                </p>
                <p className="block-blast-game__gameover-score">Счёт: {score.toLocaleString("ru-RU")}</p>
                {finishUiState === "submitting" ? (
                  <p className="block-blast-game__gamification-status">Отправка результата…</p>
                ) : null}
                {finishUiState === "error" ? (
                  <p className="block-blast-game__gamification-status">
                    {finishErrorMessage || "Не удалось отправить результат."}
                  </p>
                ) : null}
                {finishUiState === "done" && finishReward ? (
                  <div className="block-blast-game__finish-reward" aria-live="polite">
                    {finishAlreadyCompleted ? (
                      <p className="block-blast-game__gamification-sub">Челлендж уже был засчитан ранее.</p>
                    ) : (
                      <>
                        <p className="block-blast-game__finish-reward-meta">
                          Засчитано очков: {Number(finishReward.score ?? 0).toLocaleString("ru-RU")}
                        </p>
                        <p className="block-blast-game__finish-reward-line">
                          +{Number(finishReward.awarded_xp).toLocaleString("ru-RU")} XP
                          {finishReward.multiplier != null ? ` · ×${String(finishReward.multiplier)}` : ""}
                        </p>
                        <p className="block-blast-game__finish-reward-meta">
                          База {Number(finishReward.base_xp).toLocaleString("ru-RU")} XP · Уровень{" "}
                          {Number(finishReward.level).toLocaleString("ru-RU")} · Всего{" "}
                          {Number(finishReward.xp_total).toLocaleString("ru-RU")} XP
                        </p>
                      </>
                    )}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="lk-dashboard__my-programs-catalog-banner-cta"
                  onClick={startNewGame}
                  disabled={gameOverRestartDisabled}
                >
                  Начать игру
                </button>
                {challengeCompletedToday && finishUiState === "done" ? (
                  <p className="block-blast-game__no-attempts-hint">
                    Сегодняшний челлендж завершён — новая попытка будет доступна завтра.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="block-blast-game__garland-bulbs" aria-hidden="true">
              {demoGarlandBulbs.map((b) => (
                <span
                  key={b.key}
                  className={`block-blast-game__garland-bulb block-blast-game__garland-bulb--c${b.colorMod}`}
                  style={{
                    left: `${b.leftPct}%`,
                    top: `${b.topPct}%`,
                    transform: "translate(-50%, -50%)",
                    ["--garland-delay"]: `${b.ord * 0.068}s`,
                  }}
                />
              ))}
            </div>
          </div>
          {gameStarted ? (
            <div className="block-blast-game__tray">
              <div className="block-blast-game__pieces">{pieceSlots}</div>
            </div>
          ) : null}
        </div>

        <div className="block-blast-game__panel">
          <div className="block-blast-game__panel-toolbar">
            <div className="block-blast-game__stats block-blast-game__stats--inline">
              <span className="block-blast-game__stat-group">
                <span className="block-blast-game__stat-label">Счёт</span>
                <span className="block-blast-game__stat-value">{score}</span>
              </span>
              <span className="block-blast-game__stats-sep" aria-hidden="true">
                ·
              </span>
              <span className="block-blast-game__stat-group">
                <span className="block-blast-game__stat-label">Лучший</span>
                <span className="block-blast-game__stat-value">{displayBestScore}</span>
              </span>
            </div>
            {gameStarted ? (
              <div className="block-blast-game__actions">
                <button type="button" className="block-blast-game__restart-text" onClick={startNewGame}>
                  Рестарт
                </button>
              </div>
            ) : null}
            <h3
              id="block-blast-leaderboard-heading"
              className="block-blast-game__leaderboard-title block-blast-game__leaderboard-title--toolbar"
            >
              Лидеры
            </h3>
          </div>
          <aside
            className="block-blast-game__leaderboard"
            aria-labelledby="block-blast-leaderboard-heading"
          >
            <div className="lk-header__menu block-blast-game__leaderboard-menu" role="list">
              {BLOCK_BLAST_LEADERBOARD_MOCK.map((row) => (
                <div
                  key={row.rank}
                  className={`lk-header__menu-item block-blast-game__leaderboard-row${
                    row.rank <= 3 ? " block-blast-game__leaderboard-row--top" : ""
                  }`}
                  role="listitem"
                >
                  <span
                    className="block-blast-game__leaderboard-rank"
                    aria-label={`Место ${row.rank}`}
                  >
                    {row.rank <= 3 ? (
                      <DiamondIcon
                        className={`block-blast-game__leaderboard-diamond block-blast-game__leaderboard-diamond--${row.rank}`}
                        size={18}
                        strokeWidth={2}
                      />
                    ) : (
                      row.rank
                    )}
                  </span>
                  <span className="lk-header__menu-item-text">{row.name}</span>
                  <span className="block-blast-game__leaderboard-score">{row.score}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>

      <section className="block-blast-game__profile-cards" aria-label="Прогресс игрока">
        <article className="block-blast-game__profile-card block-blast-game__profile-card_xp">
          <h4 className="block-blast-game__profile-card-label">Опыт</h4>
          {summaryLoadState !== "ready" ? (
            <p className="block-blast-game__profile-card-value block-blast-game__profile-card-value--compact">—</p>
          ) : (
            <>
              <p className="block-blast-game__profile-card-value block-blast-game__profile-card-value--compact">
                {xpTotalShown.toLocaleString("ru-RU")} XP · уровень {levelShown.toLocaleString("ru-RU")}
              </p>
              <p className="block-blast-game__profile-card-caption">
                В уровне: {xpInto.toLocaleString("ru-RU")} / {xpSpan.toLocaleString("ru-RU")}
              </p>
              <div
                className="block-blast-game__xp-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={profileXpPct}
                aria-valuetext={xpBarAriaText}
              >
                <div className="block-blast-game__xp-bar-fill" style={{ width: `${profileXpPct}%` }} />
              </div>
            </>
          )}
        </article>
        <article className="block-blast-game__profile-card">
          <h4 className="block-blast-game__profile-card-label">Уровень</h4>
          <p className="block-blast-game__profile-card-value">
            {summaryLoadState !== "ready" ? "—" : levelShown.toLocaleString("ru-RU")}
          </p>
        </article>
        <article className="block-blast-game__profile-card">
          <h4 className="block-blast-game__profile-card-label">Серия</h4>
          <p
            className="block-blast-game__profile-card-value block-blast-game__profile-card-value--streak"
            aria-label={`Серия ${streakDaysShown} ${ruDaysWord(streakDaysShown)}, множитель ${streakMultLabel}`}
          >
            <span>
              {summaryLoadState !== "ready"
                ? "—"
                : `${streakDaysShown.toLocaleString("ru-RU")} ${ruDaysWord(streakDaysShown)}`}
            </span>
            {summaryLoadState === "ready" ? (
              <span className="block-blast-game__streak-mult">{streakMultLabel}</span>
            ) : null}
          </p>
        </article>
        <article className="block-blast-game__profile-card">
          <h4 className="block-blast-game__profile-card-label">Множитель опыта</h4>
          <p className="block-blast-game__profile-card-value">
            {summaryLoadState !== "ready" ? "—" : streakMultLabel}
          </p>
        </article>
        <article className="block-blast-game__profile-card">
          <h4 className="block-blast-game__profile-card-label">Попытка дня</h4>
          <p className="block-blast-game__profile-card-value block-blast-game__profile-card-value--compact">
            {summaryLoadState !== "ready"
              ? "—"
              : challengeCompletedToday
                ? "Завершена"
                : gamificationSummary?.today_attempt?.status === "started"
                  ? "В процессе"
                  : "Доступна"}
          </p>
          {summaryLoadState === "ready" && challengeCompletedToday && todayAttemptScore != null ? (
            <p className="block-blast-game__profile-card-caption">
              Счёт: {todayAttemptScore.toLocaleString("ru-RU")}
            </p>
          ) : null}
        </article>
        <article className="block-blast-game__profile-card">
          <h4 className="block-blast-game__profile-card-label">Лучший результат</h4>
          <p className="block-blast-game__profile-card-value">
            {summaryLoadState !== "ready" ? "—" : apiBestChallenge.toLocaleString("ru-RU")}
          </p>
        </article>
      </section>

      {dragLifted &&
        ghostPos != null &&
        dragSourceIdx != null &&
        pieces[dragSourceIdx] &&
        createPortal(
          <div
            className="block-blast-game__drag-ghost"
            style={{
              ...paletteStyle,
              transform: `translate3d(${ghostPos.x}px, ${ghostPos.y}px, 0) translate(-50%, calc(-100% - 16px))`,
            }}
          >
            <PiecePreview cells={pieces[dragSourceIdx]} paletteIndex={trayColorIds[dragSourceIdx]} />
          </div>,
          document.body,
        )}
    </div>
  );
}
