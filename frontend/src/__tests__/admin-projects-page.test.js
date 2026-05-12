/**
 * AdminProjectsPage: read-only список Project в админ-кабинете.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminProjectsPage from "../pages/lk/admin/AdminProjectsPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

describe("AdminProjectsPage", () => {
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
            id: 7,
            owner_id: 42,
            owner_email: "alice-proj@example.com",
            name: "Alpha launch",
            sites_count: 3,
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

  it("renders fetched project row with name and owner email", async () => {
    render(
      <MemoryRouter initialEntries={["/lk/admin/projects"]}>
        <Routes>
          <Route path="/lk/admin/projects" element={<AdminProjectsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Alpha launch")).toBeInTheDocument();
    expect(screen.getByText("alice-proj@example.com")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/referrals/admin/projects/");
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("page_size=20");
  });
});
