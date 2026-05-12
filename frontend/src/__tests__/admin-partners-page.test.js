/**
 * AdminPartnersPage: read-only список партнёрских профилей в админ-кабинете.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminPartnersPage from "../pages/lk/admin/AdminPartnersPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

describe("AdminPartnersPage", () => {
  let fetchSpy;
  const originalLocalStorage = global.localStorage;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: jest.fn(() => "test-token"),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
      configurable: true,
    });

    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        count: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
        results: [
          {
            id: 11,
            user_id: 42,
            user_email: "alice@example.com",
            status: "pending",
            balance_available: "1.25",
            balance_total: "3.50",
            commission_percent: "12.00",
            created_at: "2026-01-01T10:00:00Z",
            updated_at: "2026-02-01T10:00:00Z",
          },
        ],
      }),
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it("renders fetched partner row with email and status", async () => {
    render(
      <MemoryRouter initialEntries={["/admin-console/partners"]}>
        <Routes>
          <Route path="/admin-console/partners" element={<AdminPartnersPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    // "pending" появляется и в фильтре-селекте, и в бейдже статуса в строке.
    expect(screen.getAllByText("pending").length).toBeGreaterThan(0);

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/referrals/admin/partners/");
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("page_size=20");
  });
});
