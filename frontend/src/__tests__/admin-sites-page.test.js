/**
 * AdminSitesPage: read-only список Site (включая archived через `Site.all_objects`).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminSitesPage from "../pages/lk/admin/AdminSitesPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

describe("AdminSitesPage", () => {
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
        count: 2,
        page: 1,
        page_size: 20,
        total_pages: 1,
        results: [
          {
            id: 11,
            public_id: "11111111-1111-4111-8111-111111111111",
            owner_id: 42,
            owner_email: "active-owner@example.com",
            project_id: 100,
            status: "active",
            archived_at: null,
            created_at: "2026-01-01T10:00:00Z",
            updated_at: "2026-02-01T10:00:00Z",
          },
          {
            id: 12,
            public_id: "22222222-2222-4222-8222-222222222222",
            owner_id: 43,
            owner_email: "archived-owner@example.com",
            project_id: 101,
            status: "draft",
            archived_at: "2026-03-01T10:00:00Z",
            created_at: "2026-01-15T10:00:00Z",
            updated_at: "2026-03-01T10:00:00Z",
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

  it("renders both active and archived rows; archived row shows 'Архив' badge", async () => {
    render(
      <MemoryRouter initialEntries={["/lk/admin/sites"]}>
        <Routes>
          <Route path="/lk/admin/sites" element={<AdminSitesPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("active-owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("archived-owner@example.com")).toBeInTheDocument();
    // "Архив" встречается и в заголовке столбца, и в бейдже строки — берём бейдж по классу.
    const archivedBadge = screen
      .getAllByText("Архив")
      .find((node) => Array.from(node.classList || []).some((c) => c.startsWith("lk-admin-users__badge")));
    expect(archivedBadge).toBeTruthy();
    expect(screen.getByText("Активен")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/referrals/admin/sites/");
    expect(calledUrl).toContain("archived=all");
  });
});
