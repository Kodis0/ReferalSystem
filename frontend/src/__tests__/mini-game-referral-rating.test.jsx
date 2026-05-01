/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import MiniGameRatingPage from "../pages/lk/mini-game/miniGameRating";
import { fetchGamificationReferralLeaderboard } from "../pages/lk/mini-game/gamificationApi";

jest.mock("../pages/lk/mini-game/gamificationApi", () => ({
  fetchGamificationReferralLeaderboard: jest.fn(),
}));

describe("MiniGameRatingPage referral leaderboard API", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.localStorage.setItem("access_token", "test-access-token");
    fetchGamificationReferralLeaderboard.mockReset();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("loads rows from fetchGamificationReferralLeaderboard", async () => {
    fetchGamificationReferralLeaderboard.mockResolvedValue({
      period: "month",
      leaderboard_empty: false,
      entries: [
        {
          rank: 1,
          user_id: 101,
          display_name: "Тест Имя",
          is_current_user: false,
          league: "gold",
          sales_amount: 520000,
          paid_orders_count: 54,
          xp_total: 2840,
          streak_days: 14,
        },
      ],
      current_user: {
        rank: 7,
        sales_amount: 74000,
        paid_orders_count: 9,
        xp_total: 1742,
        streak_days: 3,
        league: "bronze",
        gap_to_top_5: 12300,
      },
    });

    render(<MiniGameRatingPage />);

    await waitFor(() => {
      expect(fetchGamificationReferralLeaderboard).toHaveBeenCalledWith("test-access-token", "month");
    });

    await waitFor(() => {
      expect(screen.getByText("Тест Имя")).toBeInTheDocument();
      expect(screen.getByText("7 мест")).toBeInTheDocument();
      expect(screen.getByText(/До топ-5 осталось/)).toBeInTheDocument();
    });
  });

  it("shows empty message when leaderboard_empty", async () => {
    fetchGamificationReferralLeaderboard.mockResolvedValue({
      period: "month",
      leaderboard_empty: true,
      entries: [],
      current_user: {
        rank: 1,
        sales_amount: 0,
        paid_orders_count: 0,
        xp_total: 0,
        streak_days: 0,
        league: "start",
        gap_to_top_5: 0,
      },
    });

    render(<MiniGameRatingPage />);

    await waitFor(() => {
      expect(screen.getByText(/Пока нет подтверждённых продаж/)).toBeInTheDocument();
    });
  });
});
