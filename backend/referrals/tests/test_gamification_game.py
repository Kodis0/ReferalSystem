from django.test import TestCase

from referrals.gamification_game import (
    apply_placement,
    create_empty_grid,
    mulberry32,
    pick_random_shapes,
    replay_daily_challenge,
    resolve_clears,
)


class GamificationGameTests(TestCase):
    def test_replay_rejects_overlapping_second_piece(self):
        seed = 777
        rng = mulberry32(seed)
        pieces = pick_random_shapes(3, rng)
        grid = create_empty_grid()
        cells = pieces[0]
        self.assertTrue(cells)
        placed = apply_placement(grid, cells, 0, 0, 1)
        grid, _ = resolve_clears(placed)
        moves = [
            {"piece_slot": 0, "row": 0, "col": 0, "client_time_ms": 0},
            {"piece_slot": 1, "row": 0, "col": 0, "client_time_ms": 1000},
        ]
        score, err = replay_daily_challenge(seed, moves)
        self.assertIsNone(score)
        self.assertEqual(err, "invalid_placement")

    def test_seed_matches_frontend_contract_first_floats(self):
        r = mulberry32(12345)
        self.assertEqual(
            [round(r(), 15) for _ in range(3)],
            [
                round(0.9797282677609473, 15),
                round(0.3067522644996643, 15),
                round(0.484205421525985, 15),
            ],
        )
