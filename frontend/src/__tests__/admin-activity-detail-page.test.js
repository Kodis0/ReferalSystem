/**
 * AdminActivityDetailPage: read-only детали записи AdminActionAudit.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminActivityDetailPage from "../pages/lk/admin/AdminActivityDetailPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

describe("AdminActivityDetailPage", () => {
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
        actor_id: 5,
        actor_email: "alice@example.com",
        action: "admin.user.deactivated",
        target_type: "user",
        target_id: "42",
        ip_address: "127.0.0.1",
        user_agent: "Mozilla/5.0 ...",
        metadata: {
          reason: "manual",
          previous_is_active: true,
          new_is_active: false,
        },
        created_at: "2026-01-01T10:00:00Z",
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

  it("renders fetched audit detail with action and metadata payload", async () => {
    render(
      <MemoryRouter initialEntries={["/lk/admin/activity/1"]}>
        <Routes>
          <Route
            path="/lk/admin/activity/:auditId"
            element={<AdminActivityDetailPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const matches = await screen.findAllByText(/admin\.user\.deactivated/);
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getByText(/reason/i)).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/users/admin/action-audits/1/");
  });
});
