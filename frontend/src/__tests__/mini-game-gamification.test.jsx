/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API_ENDPOINTS } from "../config/api";
import BlockBlastGame from "../pages/lk/mini-game/BlockBlastGame";
import { postGamificationDailyChallengeFinish } from "../pages/lk/mini-game/gamificationApi";

const BASE_SUMMARY = {
  xp_total: 120,
  streak_days: 3,
  streak_multiplier: "1.2000",
  last_activity_date: null,
  best_challenge_score: 900,
  level: 2,
  level_progress: {
    level: 2,
    xp_into_level: 20,
    xp_for_current_level_span: 100,
    xp_remaining_for_next_level: 80,
  },
  today_attempt: null,
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
      today_attempt: {
        challenge_date: "2026-05-01",
        status: "started",
        attempt_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        rng_seed: 12345,
        score: 0,
        base_xp: 0,
        multiplier: "1.0000",
        awarded_xp: 0,
        started_at: "2026-05-01T10:00:00Z",
        completed_at: null,
      },
    };

    global.fetch
      .mockResolvedValueOnce(mockJsonResponse(BASE_SUMMARY))
      .mockResolvedValueOnce(mockJsonResponse(afterStart));

    render(<BlockBlastGame />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Новая игра/i })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: /Новая игра/i }));

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

  it("blocks pre-start when today's challenge is already completed", async () => {
    const completedSummary = {
      ...BASE_SUMMARY,
      today_attempt: {
        challenge_date: "2026-05-01",
        status: "completed",
        attempt_public_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        rng_seed: null,
        score: 750,
        base_xp: 20,
        multiplier: "1.0000",
        awarded_xp: 20,
        started_at: "2026-05-01T09:00:00Z",
        completed_at: "2026-05-01T09:05:00Z",
      },
    };

    global.fetch.mockResolvedValueOnce(mockJsonResponse(completedSummary));

    render(<BlockBlastGame />);

    await waitFor(() => {
      expect(screen.getByText(/Сегодняшний челлендж уже завершён/i)).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /^Новая игра$/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/750/).length).toBeGreaterThanOrEqual(1);
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
