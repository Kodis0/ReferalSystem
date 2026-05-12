/**
 * AdminOrdersPage: read-only список Order в админ-кабинете.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminOrdersPage from "../pages/lk/admin/AdminOrdersPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

describe("AdminOrdersPage", () => {
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
            id: 1,
            external_id: "ORD-123",
            partner_id: 7,
            partner_user_email: "alice@example.com",
            site_id: 4,
            site_public_id: "SITE-1",
            amount: "100.00",
            currency: "RUB",
            status: "paid",
            created_at: "2026-01-01T10:00:00Z",
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

  it("renders fetched order row with email and external id", async () => {
    render(
      <MemoryRouter initialEntries={["/lk/admin/orders"]}>
        <Routes>
          <Route path="/lk/admin/orders" element={<AdminOrdersPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("ORD-123")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/referrals/admin/orders/");
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("page_size=20");
  });
});
