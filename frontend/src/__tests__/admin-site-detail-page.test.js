/**
 * AdminSiteDetailPage: read-only детали Site (включая archived через `Site.all_objects`).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminSiteDetailPage from "../pages/lk/admin/AdminSiteDetailPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

function makeSitePayload(overrides = {}) {
  return {
    id: 11,
    public_id: "11111111-1111-4111-8111-111111111111",
    owner_id: 42,
    owner_email: "site-owner@example.com",
    project_id: 100,
    status: "active",
    platform_preset: "tilda",
    archived_at: null,
    created_at: "2026-01-01T10:00:00Z",
    updated_at: "2026-02-01T10:00:00Z",
    owner_public_id: "owner12",
    project_public_id: "9aa0f256-e453-406d-8258-9fadf1e2545f",
    project_name: "Demo project",
    allowed_origins: ["https://example.test"],
    visits_count: 5,
    leads_count: 4,
    orders_count: 3,
    commissions_count: 2,
    ...overrides,
  };
}

function renderPage(initialSiteId = 11) {
  return render(
    <MemoryRouter initialEntries={[`/admin-console/sites/${initialSiteId}`]}>
      <Routes>
        <Route
          path="/admin-console/sites/:siteId"
          element={<AdminSiteDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminSiteDetailPage", () => {
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
      json: async () => makeSitePayload(),
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

  it("renders fetched site detail for the route :siteId", async () => {
    renderPage(11);

    expect(await screen.findByText("site-owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("Demo project")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Активен")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/referrals/admin/sites/11/");
  });
});
