/**
 * AdminSupportTicketsPage: read-only список обращений в поддержку.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminSupportTicketsPage from "../pages/lk/admin/AdminSupportTicketsPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

describe("AdminSupportTicketsPage", () => {
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
            id: "11111111-1111-1111-1111-111111111111",
            user_id: 42,
            user_email: "alice@example.com",
            user_public_id: "abc1234",
            type_slug: "help-question",
            target_label: "Hello",
            is_closed: false,
            closed_at: null,
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

  it("renders fetched ticket row with user_email and target_label", async () => {
    render(
      <MemoryRouter initialEntries={["/lk/admin/support"]}>
        <Routes>
          <Route path="/lk/admin/support" element={<AdminSupportTicketsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Открыто")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/users/admin/support-tickets/");
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("page_size=20");
  });
});
