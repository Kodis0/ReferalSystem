/**
 * Partner LK: onboard payload drives stats and recent leads table.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import PartnerDashboard from "../pages/lk/partner/partner";

describe("PartnerDashboard", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  function mockOnboardPayload(overrides = {}) {
    return {
      ref_code: "REF1",
      referral_link: "http://localhost:3000/?ref=REF1",
      commission_percent: "10.00",
      status: "active",
      balance_available: "0.00",
      balance_total: "0.00",
      visit_count: 0,
      attributed_orders_count: 0,
      paid_orders_count: 0,
      attributed_orders_amount_total: "0.00",
      commissions_total: "0.00",
      commission_history: [],
      total_leads_count: 0,
      recent_leads: [],
      recent_orders: [],
      ...overrides,
    };
  }

  it("renders recent leads from onboard payload (privacy-minimal)", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () =>
        mockOnboardPayload({
          total_leads_count: 1,
          recent_leads: [
            {
              created_at: "2026-01-15T12:00:00+00:00",
              customer_email_masked: "a***@example.com",
              page_path: "/p/1",
              amount: "99.50",
              currency: "RUB",
            },
          ],
        }),
    });

    render(<PartnerDashboard />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("a***@example.com")).toBeInTheDocument();
    });
    expect(screen.getByText("/p/1")).toBeInTheDocument();
    expect(screen.queryByText("ann@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("+79990001122")).not.toBeInTheDocument();
    expect(screen.queryByText("Ann Tester")).not.toBeInTheDocument();
    expect(screen.getByText("99.50")).toBeInTheDocument();
    expect(screen.getByText("RUB")).toBeInTheDocument();
    const leadsStat = screen.getByText("Лиды").closest(".lk-partner__stat");
    expect(within(leadsStat).getByText("1")).toBeInTheDocument();
  });

  it("shows em dash for masked email when lead has no email", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () =>
        mockOnboardPayload({
          total_leads_count: 1,
          recent_leads: [
            {
              created_at: "2026-01-15T12:00:00+00:00",
              customer_email_masked: null,
              page_path: "/checkout",
              amount: "10.00",
              currency: "USD",
            },
          ],
        }),
    });

    render(<PartnerDashboard />);

    await waitFor(() => {
      expect(screen.getByText("/checkout")).toBeInTheDocument();
    });
    const leadTable = screen.getByRole("table");
    expect(within(leadTable).getByText("—")).toBeInTheDocument();
    expect(leadTable.textContent).not.toMatch(/@/);
  });

  it("shows empty state when there are no leads", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockOnboardPayload(),
    });

    render(<PartnerDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Пока нет лидов с виджета")).toBeInTheDocument();
    });
  });
});
