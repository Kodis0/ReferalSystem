/**
 * AdminDashboardPage: 3 KPI карточки (заработок, пользователи, партнёры).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import AdminDashboardPage from "../pages/lk/admin/AdminDashboardPage";

function setupLocalStorage(initial = {}) {
  const store = { ...initial };
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: jest.fn((k) => (k in store ? store[k] : null)),
      setItem: jest.fn((k, v) => {
        store[k] = String(v);
      }),
      removeItem: jest.fn((k) => {
        delete store[k];
      }),
    },
    configurable: true,
  });
  return store;
}

describe("AdminDashboardPage", () => {
  const originalLocalStorage = global.localStorage;
  let fetchSpy;

  beforeEach(() => {
    setupLocalStorage({ admin_access_token: "test-token" });
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it("renders loading state on mount", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(
      () => new Promise(() => {}),
    );

    render(<AdminDashboardPage />);

    expect(screen.getByTestId("admin-dashboard-loading")).toBeInTheDocument();
  });

  it("renders 3 KPI cards with formatted numbers when fetch succeeds", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        users_count: 3,
        partners_count: 2,
        platform_revenue_amount: "270.00",
        platform_revenue_currency: "RUB",
        orders_total_amount: "300.00",
        partners_payout_amount: "30.00",
      }),
    });

    render(<AdminDashboardPage />);

    const revenueCard = await screen.findByTestId("admin-dashboard-card-revenue");
    expect(revenueCard).toHaveTextContent("270,00");
    expect(revenueCard).toHaveTextContent("RUB");
    expect(revenueCard).toHaveTextContent("300,00");
    expect(revenueCard).toHaveTextContent("30,00");

    const usersCard = screen.getByTestId("admin-dashboard-card-users");
    expect(usersCard).toHaveTextContent("3");

    const partnersCard = screen.getByTestId("admin-dashboard-card-partners");
    expect(partnersCard).toHaveTextContent("2");

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/referrals/admin/dashboard/stats/");
  });

  it("renders zeros for empty database without crashing", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        users_count: 0,
        partners_count: 0,
        platform_revenue_amount: "0.00",
        platform_revenue_currency: "RUB",
        orders_total_amount: "0.00",
        partners_payout_amount: "0.00",
      }),
    });

    render(<AdminDashboardPage />);

    const usersCard = await screen.findByTestId("admin-dashboard-card-users");
    expect(usersCard).toHaveTextContent("0");
    const partnersCard = screen.getByTestId("admin-dashboard-card-partners");
    expect(partnersCard).toHaveTextContent("0");
    const revenueCard = screen.getByTestId("admin-dashboard-card-revenue");
    expect(revenueCard).toHaveTextContent("0,00");
  });

  it("shows error state with retry button when backend returns 500", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    render(<AdminDashboardPage />);

    expect(
      await screen.findByText("Не удалось загрузить статистику"),
    ).toBeInTheDocument();
    const retry = screen.getByTestId("admin-dashboard-retry");
    expect(retry).toBeInTheDocument();

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        users_count: 1,
        partners_count: 0,
        platform_revenue_amount: "10.00",
        platform_revenue_currency: "RUB",
        orders_total_amount: "10.00",
        partners_payout_amount: "0.00",
      }),
    });

    fireEvent.click(retry);

    await waitFor(() => {
      expect(screen.getByTestId("admin-dashboard-card-revenue")).toHaveTextContent(
        "10,00",
      );
    });
  });
});
