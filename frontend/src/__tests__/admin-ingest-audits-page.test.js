/**
 * AdminIngestAuditsPage: read-only список PublicLeadIngestAudit в админ-кабинете.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminIngestAuditsPage from "../pages/lk/admin/AdminIngestAuditsPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

describe("AdminIngestAuditsPage", () => {
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
            site_id: 4,
            site_public_id: "SITE-1",
            public_code: "INVALID_PAYLOAD",
            internal_reason: "missing_field",
            http_status: 400,
            event_name: "lead_submitted",
            client_ip: "10.0.0.1",
            form_id: "form-1",
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

  it("renders fetched ingest audit row with public code", async () => {
    render(
      <MemoryRouter initialEntries={["/admin-console/ingest-audits"]}>
        <Routes>
          <Route
            path="/admin-console/ingest-audits"
            element={<AdminIngestAuditsPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("INVALID_PAYLOAD")).toBeInTheDocument();
    expect(screen.getByText("SITE-1")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/referrals/admin/ingest-audits/");
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("page_size=20");
  });
});
