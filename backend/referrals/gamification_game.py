"""
Deterministic Block Blast–style replay for daily challenge validation.
RNG (mulberry32) and game rules mirror ``frontend/.../blockBlastLogic.js``.
"""

from __future__ import annotations

import ctypes
from typing import Any, Callable

GRID_SIZE = 8
SCORE_PER_LINE = 10
SCORE_MULTILINE_PAIR_BONUS = 5
SCORE_PER_CELL_PLACED = 2

_MAX_MOVES = 500

_c_int32 = ctypes.c_int32


def _u32(x: int) -> int:
    return x & 0xFFFFFFFF


def _to_int32(x: int) -> int:
    x = x & 0xFFFFFFFF
    if x >= 2**31:
        x -= 2**32
    return x


def _imul(a: int, b: int) -> int:
    return _c_int32(_c_int32(a).value * _c_int32(b).value).value


def mulberry32(seed: int) -> Callable[[], float]:
    """Same float stream as ``createMulberry32`` in ``blockBlastLogic.js``."""

    state = [seed & 0xFFFFFFFF]

    def rng() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state[0]
        t = _imul(_to_int32(_u32(t) ^ (_u32(t) >> 15)), _to_int32(_u32(t | 1))) & 0xFFFFFFFF
        u = _imul(_to_int32(_u32(t) ^ (_u32(t) >> 7)), _to_int32(_u32(t | 61)))
        sm = t + u
        t = _u32(_to_int32(t) ^ _to_int32(sm))
        return _u32(_u32(t) ^ (_u32(t) >> 14)) / 4294967296.0

    return rng


# Mirror order of SHAPE_POOL in blockBlastLogic.js (polyomino offsets [dr, dc]).
SHAPE_POOL: tuple[tuple[tuple[int, int], ...], ...] = (
    ((0, 0),),
    ((0, 0), (0, 1)),
    ((0, 0), (1, 0)),
    ((0, 0), (0, 1), (0, 2)),
    ((0, 0), (1, 0), (2, 0)),
    ((0, 0), (1, 0), (1, 1)),
    ((0, 0), (0, 1), (0, 2), (0, 3)),
    ((0, 0), (1, 0), (2, 0), (3, 0)),
    ((0, 0), (0, 1), (1, 0), (1, 1)),
    ((0, 0), (0, 1), (0, 2), (1, 1)),
    ((0, 1), (0, 2), (1, 0), (1, 1)),
    ((0, 0), (0, 1), (1, 1), (1, 2)),
    ((0, 0), (1, 0), (2, 0), (2, 1)),
    ((0, 1), (1, 1), (2, 0), (2, 1)),
    (
        (0, 0),
        (0, 1),
        (0, 2),
        (1, 0),
        (1, 1),
        (1, 2),
        (2, 0),
        (2, 1),
        (2, 2),
    ),
    ((0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2)),
    ((0, 0), (0, 2), (1, 0), (1, 1), (1, 2)),
    ((0, 0), (0, 1), (0, 2), (1, 1), (2, 1)),
    ((0, 0), (0, 1), (1, 0), (1, 1), (2, 0)),
)


def normalize_shape_offsets(cells: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not cells:
        return cells
    min_r = min(r for r, _ in cells)
    min_c = min(c for _, c in cells)
    return [(r - min_r, c - min_c) for r, c in cells]


def mirror_shape_horizontal(cells: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not cells:
        return cells
    max_c = max(c for _, c in cells)
    mirrored = [(r, max_c - c) for r, c in cells]
    return normalize_shape_offsets(mirrored)


def mirror_shape_vertical(cells: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not cells:
        return cells
    max_r = max(r for r, _ in cells)
    mirrored = [(max_r - r, c) for r, c in cells]
    return normalize_shape_offsets(mirrored)


def vary_shape_orientation(cells: tuple[tuple[int, int], ...], rng: Callable[[], float]) -> list[tuple[int, int]]:
    shape = [(r, c) for r, c in cells]
    if rng() < 0.5:
        shape = mirror_shape_horizontal(shape)
    if rng() < 0.5:
        shape = mirror_shape_vertical(shape)
    return shape


def pick_random_k_from_n(k: int, n: int, rng: Callable[[], float]) -> list[int]:
    arr = list(range(n))
    i = n - 1
    while i > 0:
        j = int(rng() * (i + 1))
        arr[i], arr[j] = arr[j], arr[i]
        i -= 1
    return arr[:k]


def pick_random_shapes(count: int, rng: Callable[[], float]) -> list[list[tuple[int, int]]]:
    n = len(SHAPE_POOL)
    take = min(count, n)
    order = pick_random_k_from_n(n, n, rng)
    out: list[list[tuple[int, int]]] = []
    for k in range(take):
        out.append(vary_shape_orientation(SHAPE_POOL[order[k]], rng))
    return out


def pick_tray_color_indices_from_four(rng: Callable[[], float]) -> list[int]:
    perm = pick_random_k_from_n(4, 4, rng)
    return [perm[0], perm[1], perm[2]]


def generate_piece_sequence(seed: int, count: int = 3) -> list[list[tuple[int, int]]]:
    """First ``count`` tray shapes from ``seed`` (matches replay initial tray)."""
    return pick_random_shapes(count, mulberry32(seed))


def create_empty_grid() -> list[list[int]]:
    return [[0] * GRID_SIZE for _ in range(GRID_SIZE)]


def clone_grid(grid: list[list[int]]) -> list[list[int]]:
    return [row[:] for row in grid]


def can_place(grid: list[list[int]], cells: list[tuple[int, int]], anchor_row: int, anchor_col: int) -> bool:
    for dr, dc in cells:
        r = anchor_row + dr
        c = anchor_col + dc
        if r < 0 or r >= GRID_SIZE or c < 0 or c >= GRID_SIZE:
            return False
        if grid[r][c]:
            return False
    return True


def apply_placement(
    grid: list[list[int]],
    cells: list[tuple[int, int]],
    anchor_row: int,
    anchor_col: int,
    fill_value: int = 1,
) -> list[list[int]]:
    nxt = clone_grid(grid)
    for dr, dc in cells:
        nxt[anchor_row + dr][anchor_col + dc] = fill_value
    return nxt


def score_for_placement(cell_count: int) -> int:
    n = max(0, int(cell_count))
    return n * SCORE_PER_CELL_PLACED


def score_for_line_clears(rows_cleared: int, cols_cleared: int) -> int:
    n = rows_cleared + cols_cleared
    if n <= 0:
        return 0
    pair_count = (n * (n - 1)) // 2
    return SCORE_PER_LINE * n + SCORE_MULTILINE_PAIR_BONUS * pair_count


def get_full_line_indices(grid: list[list[int]]) -> tuple[list[int], list[int]]:
    rows: list[int] = []
    cols: list[int] = []
    for r in range(GRID_SIZE):
        if all(grid[r][c] != 0 for c in range(GRID_SIZE)):
            rows.append(r)
    for c in range(GRID_SIZE):
        if all(grid[r][c] != 0 for r in range(GRID_SIZE)):
            cols.append(c)
    return rows, cols


def resolve_clears(grid: list[list[int]]) -> tuple[list[list[int]], int]:
    rows, cols = get_full_line_indices(grid)
    rows_full = set(rows)
    cols_full = set(cols)
    nxt = clone_grid(grid)
    for r in range(GRID_SIZE):
        for c in range(GRID_SIZE):
            if r in rows_full or c in cols_full:
                nxt[r][c] = 0
    score_delta = score_for_line_clears(len(rows_full), len(cols_full))
    return nxt, score_delta


def can_place_anywhere(grid: list[list[int]], cells: list[tuple[int, int]]) -> bool:
    for r in range(GRID_SIZE):
        for c in range(GRID_SIZE):
            if can_place(grid, cells, r, c):
                return True
    return False


def is_game_over_for_pieces(grid: list[list[int]], pieces: list[list[tuple[int, int]] | None]) -> bool:
    remaining = [p for p in pieces if p]
    if not remaining:
        return False
    return all(not can_place_anywhere(grid, cells) for cells in remaining)


def replay_daily_challenge(seed: int, moves: list[dict[str, Any]]) -> tuple[int | None, str]:
    """
    Replay moves and return (server_score, "") or (None, error_code).
    """
    if not isinstance(moves, list):
        return None, "invalid_moves"
    if len(moves) > _MAX_MOVES:
        return None, "moves_too_long"

    rng = mulberry32(seed)
    pieces: list[list[tuple[int, int]] | None] = pick_random_shapes(3, rng)
    tray_colors = pick_tray_color_indices_from_four(rng)
    grid = create_empty_grid()
    total_score = 0

    for idx, mv in enumerate(moves):
        if not isinstance(mv, dict):
            return None, "invalid_move"
        try:
            slot = int(mv["piece_slot"])
            row = int(mv["row"])
            col = int(mv["col"])
        except (KeyError, TypeError, ValueError):
            return None, "invalid_move"
        if slot not in (0, 1, 2):
            return None, "invalid_move"
        if row < 0 or row >= GRID_SIZE or col < 0 or col >= GRID_SIZE:
            return None, "invalid_move"

        cells = pieces[slot]
        if cells is None:
            return None, "invalid_move"
        if not can_place(grid, cells, row, col):
            return None, "invalid_placement"

        fill_val = tray_colors[slot] + 1
        placed = apply_placement(grid, cells, row, col, fill_val)
        placement_pts = score_for_placement(len(cells))
        cleared, clear_pts = resolve_clears(placed)
        delta = placement_pts + clear_pts
        total_score += delta

        grid = cleared
        pieces[slot] = None
        if pieces[0] is None and pieces[1] is None and pieces[2] is None:
            pieces = pick_random_shapes(3, rng)
            tray_colors = pick_tray_color_indices_from_four(rng)

        if is_game_over_for_pieces(grid, pieces):
            if idx < len(moves) - 1:
                return None, "moves_after_game_over"
            return total_score, ""

    if not is_game_over_for_pieces(grid, pieces):
        return None, "game_not_finished"

    return total_score, ""


def validate_finish_timing(
    moves: list[dict[str, Any]],
    server_score: int,
    min_seconds_high_score: int = 3,
    high_score_threshold: int = 500,
) -> str | None:
    """Return error code or None if OK."""
    if server_score <= high_score_threshold:
        return None
    times: list[int] = []
    for mv in moves:
        ct = mv.get("client_time_ms")
        if ct is None:
            continue
        try:
            times.append(int(ct))
        except (TypeError, ValueError):
            continue
    if len(times) < 2:
        return None
    span_ms = max(times) - min(times)
    if span_ms < min_seconds_high_score * 1000:
        return "finish_timing_suspicious"
    return None
