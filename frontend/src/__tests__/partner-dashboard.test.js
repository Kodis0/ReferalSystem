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
      commissions_total: "0.00",
      commission_history: [],
      total_leads_count: 0,
      recent_leads: [],
      ...overrides,
    };
  }

  it("renders recent leads from onboard payload", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () =>
        mockOnboardPayload({
          total_leads_count: 1,
          recent_leads: [
            {
              created_at: "2026-01-15T12:00:00+00:00",
              customer_name: "Ann Tester",
              customer_email: "ann@example.com",
              customer_phone: "+79990001122",
              page_url: "https://shop.example/p/1",
              form_id: "lead-form-1",
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
      expect(screen.getByText("Ann Tester")).toBeInTheDocument();
    });
    expect(screen.getByText("ann@example.com")).toBeInTheDocument();
    expect(screen.getByText("+79990001122")).toBeInTheDocument();
    expect(screen.getByText("https://shop.example/p/1")).toBeInTheDocument();
    expect(screen.getByText("lead-form-1")).toBeInTheDocument();
    expect(screen.getByText("99.50")).toBeInTheDocument();
    expect(screen.getByText("RUB")).toBeInTheDocument();
    const leadsStat = screen.getByText("Лиды").closest(".lk-partner__stat");
    expect(within(leadsStat).getByText("1")).toBeInTheDocument();
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
