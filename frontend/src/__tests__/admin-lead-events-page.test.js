/**
 * AdminLeadEventsPage: read-only список ReferralLeadEvent в админ-кабинете.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminLeadEventsPage from "../pages/lk/admin/AdminLeadEventsPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

describe("AdminLeadEventsPage", () => {
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
            partner_id: 7,
            event_type: "lead_submitted",
            submission_stage: "submit_attempt",
            form_id: "form-42",
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

  it("renders fetched lead event row", async () => {
    render(
      <MemoryRouter initialEntries={["/lk/admin/lead-events"]}>
        <Routes>
          <Route path="/lk/admin/lead-events" element={<AdminLeadEventsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("SITE-1")).toBeInTheDocument();
    expect(screen.getByText("lead_submitted")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/referrals/admin/lead-events/");
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("page_size=20");
  });
});
