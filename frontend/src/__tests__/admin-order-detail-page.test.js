/**
 * AdminOrderDetailPage: read-only детали Order в админ-кабинете.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminOrderDetailPage from "../pages/lk/admin/AdminOrderDetailPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

describe("AdminOrderDetailPage", () => {
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
        id: 1,
        external_id: "ORD-123",
        dedupe_key: "tilda:abc",
        source: "tilda",
        partner_id: 7,
        partner_user_email: "alice@example.com",
        site_id: 4,
        site_public_id: "SITE-1",
        amount: "100.00",
        currency: "RUB",
        status: "paid",
        ref_code: "PA01",
        customer_email: "buyer@example.com",
        payload_fingerprint: "abc",
        raw_payload: { ok: true, items: [{ name: "x" }] },
        created_at: "2026-01-01T10:00:00Z",
        updated_at: "2026-02-01T10:00:00Z",
        paid_at: "2026-01-02T10:00:00Z",
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

  it("renders fetched order detail with partner email", async () => {
    render(
      <MemoryRouter initialEntries={["/lk/admin/orders/1"]}>
        <Routes>
          <Route
            path="/lk/admin/orders/:orderId"
            element={<AdminOrderDetailPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("ORD-123").length).toBeGreaterThan(0);

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/referrals/admin/orders/1/");
  });
});
