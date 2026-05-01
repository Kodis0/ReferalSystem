"""Greedy autoplay for daily challenge tests (mirrors ``gamification_game.replay_daily_challenge``)."""

from referrals.gamification_game import (
    apply_placement,
    can_place,
    create_empty_grid,
    is_game_over_for_pieces,
    mulberry32,
    pick_random_shapes,
    pick_tray_color_indices_from_four,
    resolve_clears,
)


def greedy_moves_until_game_over(seed: int, max_steps: int = 10_000) -> list[dict]:
    rng = mulberry32(seed)
    pieces = pick_random_shapes(3, rng)
    tray_colors = pick_tray_color_indices_from_four(rng)
    grid = create_empty_grid()
    moves: list[dict] = []
    t_ms = 0
    steps = 0
    while steps < max_steps:
        steps += 1
        if is_game_over_for_pieces(grid, pieces):
            break
        placed = False
        for slot in (0, 1, 2):
            cells = pieces[slot]
            if not cells:
                continue
            for r in range(8):
                for c in range(8):
                    if can_place(grid, cells, r, c):
                        moves.append(
                            {
                                "piece_slot": slot,
                                "row": r,
                                "col": c,
                                "client_time_ms": t_ms,
                            }
                        )
                        t_ms += 1000
                        fill_val = tray_colors[slot] + 1
                        placed_grid = apply_placement(grid, cells, r, c, fill_val)
                        grid, _ = resolve_clears(placed_grid)
                        pieces[slot] = None
                        if pieces[0] is None and pieces[1] is None and pieces[2] is None:
                            pieces = pick_random_shapes(3, rng)
                            tray_colors = pick_tray_color_indices_from_four(rng)
                        placed = True
                        break
                if placed:
                    break
            if placed:
                break
        if not placed:
            break
    return moves
