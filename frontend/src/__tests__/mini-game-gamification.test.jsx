/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API_ENDPOINTS } from "../config/api";
import BlockBlastGame from "../pages/lk/mini-game/BlockBlastGame";
import { postGamificationDailyChallengeFinish } from "../pages/lk/mini-game/gamificationApi";

const BASE_SUMMARY = {
  profile: {
    xp_total: 120,
    streak_days: 3,
    streak_multiplier: "1.2000",
    best_challenge_score: 900,
    level: 2,
    level_progress: {
      level: 2,
      xp_into_level: 20,
      xp_for_current_level_span: 100,
      xp_remaining_for_next_level: 80,
    },
  },
  lives: {
    current: 5,
    max: 5,
    next_life_at: null,
    recovery_seconds: null,
    recovery_interval_hours: 4,
  },
  active_attempt: null,
  daily_challenge_xp_tiers: [],
  streak_multiplier_tiers: [],
};

function mockJsonResponse(data, ok = true) {
  return {
    ok,
    json: async () => data,
    status: ok ? 200 : 400,
  };
}

describe("BlockBlastGame gamification API", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.localStorage.setItem("access_token", "test-access-token");
    global.fetch = jest.fn();
    window.matchMedia =
      window.matchMedia ||
      function matchMediaPolyfill() {
        return {
          matches: false,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {
            return false;
          },
        };
      };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("loads summary on mount and shows values from API", async () => {
    global.fetch.mockResolvedValueOnce(mockJsonResponse(BASE_SUMMARY));

    render(<BlockBlastGame />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        API_ENDPOINTS.gamificationSummary,
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer test-access-token" }),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/120 XP/)).toBeInTheDocument();
      expect(screen.getAllByText(/^900$/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("POST start is called when starting a new game from pre-start overlay", async () => {
    const afterStart = {
      ...BASE_SUMMARY,
      lives: { ...BASE_SUMMARY.lives, current: 4 },
      active_attempt: {
        attempt_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        rng_seed: 12345,
      },
    };

    global.fetch
      .mockResolvedValueOnce(mockJsonResponse(BASE_SUMMARY))
      .mockResolvedValueOnce(mockJsonResponse(afterStart));

    render(<BlockBlastGame />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Начать раунд/i })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: /Начать раунд/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        API_ENDPOINTS.gamificationDailyChallengeStart,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-access-token",
            "Content-Type": "application/json",
          }),
        }),
      );
    });
  });

  it("disables start when no lives left", async () => {
    const noLives = {
      ...BASE_SUMMARY,
      lives: {
        ...BASE_SUMMARY.lives,
        current: 0,
        next_life_at: "2026-05-01T14:00:00.000Z",
        recovery_seconds: 3600,
      },
    };
    global.fetch.mockResolvedValueOnce(mockJsonResponse(noLives));

    render(<BlockBlastGame />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Жизни закончились/i })).toBeDisabled();
    });
  });

  it("postGamificationDailyChallengeFinish sends attempt_id, moves, client_score", async () => {
    global.fetch.mockResolvedValueOnce(
      mockJsonResponse({ summary: BASE_SUMMARY, reward: { score: 10 }, already_completed: false }),
    );
    await postGamificationDailyChallengeFinish("tok", {
      attemptId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      moves: [{ piece_slot: 0, row: 1, col: 2, client_time_ms: 100 }],
      clientScore: 1234,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      API_ENDPOINTS.gamificationDailyChallengeFinish,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          attempt_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          moves: [{ piece_slot: 0, row: 1, col: 2, client_time_ms: 100 }],
          client_score: 1234,
        }),
      }),
    );
  });
});
