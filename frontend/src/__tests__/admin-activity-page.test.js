/**
 * AdminActivityPage: read-only список AdminActionAudit в админ-кабинете.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminActivityPage from "../pages/lk/admin/AdminActivityPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

describe("AdminActivityPage", () => {
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
            actor_email: "alice@example.com",
            action: "admin.user.deactivated",
            target_type: "user",
            target_id: "42",
            ip_address: "127.0.0.1",
            created_at: "2026-01-01T10:00:00Z",
            metadata_summary: {},
            user_agent: "",
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

  it("renders fetched audit row with action and actor email", async () => {
    render(
      <MemoryRouter initialEntries={["/lk/admin/activity"]}>
        <Routes>
          <Route path="/lk/admin/activity" element={<AdminActivityPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("admin.user.deactivated")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/users/admin/action-audits/");
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("page_size=20");
  });
});
