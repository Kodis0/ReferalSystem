/**
 * AdminProjectDetailPage: read-only детали Project в админ-кабинете.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminProjectDetailPage from "../pages/lk/admin/AdminProjectDetailPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

function makeProjectPayload(overrides = {}) {
  return {
    id: 7,
    owner_id: 42,
    owner_email: "alice-proj@example.com",
    name: "Alpha launch",
    description: "Demo description",
    sites_count: 3,
    active_sites_count: 2,
    archived_sites_count: 1,
    created_at: "2026-01-01T10:00:00Z",
    updated_at: "2026-02-01T10:00:00Z",
    owner_public_id: "abc1234",
    owner_fio: "Алиса Тестовая",
    owner_phone: "+79990001122",
    ...overrides,
  };
}

function renderPage(initialProjectId = 7) {
  return render(
    <MemoryRouter initialEntries={[`/admin-console/projects/${initialProjectId}`]}>
      <Routes>
        <Route
          path="/admin-console/projects/:projectId"
          element={<AdminProjectDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminProjectDetailPage", () => {
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
      json: async () => makeProjectPayload(),
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
    jest.restoreAllMocks();
  });

  it("renders fetched project detail for the route :projectId", async () => {
    renderPage(7);

    expect(await screen.findByText("alice-proj@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("Alpha launch").length).toBeGreaterThan(0);
    expect(screen.getByText("Алиса Тестовая")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/referrals/admin/projects/7/");
  });
});
