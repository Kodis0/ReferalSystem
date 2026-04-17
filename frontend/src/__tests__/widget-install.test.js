/**
 * Site owner widget install screen (integration API).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WidgetInstallScreen from "../pages/lk/widget-install/widget-install";

describe("WidgetInstallScreen", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  function mockIntegrationPayload(overrides = {}) {
    return {
      public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      publishable_key: "pk_test_widget",
      allowed_origins: ["https://shop.example"],
      platform_preset: "tilda",
      widget_enabled: true,
      config_json: { amount_selector: ".js-price" },
      widget_embed_snippet:
        '<script src="https://app.example/widgets/referral-widget.v1.js"\n' +
        '  data-rs-api="https://api.example"\n' +
        '  data-rs-site="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"\n' +
        '  data-rs-key="pk_test_widget"\n' +
        "  async></script>",
      public_api_base: "https://api.example",
      widget_script_base: "https://app.example",
      ...overrides,
    };
  }

  function mockDiagnosticsPayload(overrides = {}) {
    return {
      site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      integration_status: "healthy",
      integration_warnings: [],
      embed_readiness: {
        origins_configured: true,
        widget_enabled: true,
        publishable_key_present: true,
        public_id_present: true,
      },
      widget_runtime: {
        observe_success: true,
        report_observed_outcome: false,
        amount_selector: ".js-price",
        product_name_selector: "",
        currency: "",
      },
      platform_preset: "tilda",
      widget_enabled: true,
      allowed_origins: ["https://shop.example"],
      windows: {
        "24h": {
          submit_attempt_count: 0,
          success_observed_count: 0,
          failure_observed_count: 0,
          not_observed_count: 0,
          outcome_unset_count: 0,
        },
        "7d": {
          submit_attempt_count: 0,
          success_observed_count: 0,
          failure_observed_count: 0,
          not_observed_count: 0,
          outcome_unset_count: 0,
        },
      },
      has_recent_leads: false,
      recent_leads_count: 0,
      ingest_quality: {
        source: "public_lead_ingest_audit",
        "24h": {
          total_requests: 0,
          by_code: {},
          created_count: 0,
          duplicate_suppressed_count: 0,
          outcome_updated_count: 0,
          outcome_unchanged_count: 0,
          rate_limited_count: 0,
          rejected_count: 0,
          success_count: 0,
          duplicate_ratio_lead_submitted: null,
          success_ratio: null,
        },
        "7d": {
          total_requests: 0,
          by_code: {},
          created_count: 0,
          duplicate_suppressed_count: 0,
          outcome_updated_count: 0,
          outcome_unchanged_count: 0,
          rate_limited_count: 0,
          rejected_count: 0,
          success_count: 0,
          duplicate_ratio_lead_submitted: null,
          success_ratio: null,
        },
      },
      recent_leads: [],
      ...overrides,
    };
  }

  function mockFetchIntegrationAndDiagnostics() {
    return jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/diagnostics/")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockDiagnosticsPayload(),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockIntegrationPayload(),
      });
    });
  }

  it("loads integration and shows snippet and ids", async () => {
    const fetchMock = mockFetchIntegrationAndDiagnostics();

    render(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/referrals/site/integration/"),
        expect.objectContaining({ method: "GET" }),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/referrals/site/integration/diagnostics/"),
        expect.objectContaining({ method: "GET" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("pk_test_widget")).toBeInTheDocument();
    });
    expect(screen.getByText(/referral-widget\.v1\.js/)).toBeInTheDocument();
    expect(screen.getAllByText("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").length).toBeGreaterThanOrEqual(1);
  });

  it("shows diagnostics health section", async () => {
    mockFetchIntegrationAndDiagnostics();

    render(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Состояние интеграции/i })).toBeInTheDocument();
    });
    expect(screen.getByText("В норме")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Наблюдаемые итоги/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Качество публичного ingest/i })).toBeInTheDocument();
  });

  it("shows recent lead row with outcome badge", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/diagnostics/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            mockDiagnosticsPayload({
              has_recent_leads: true,
              recent_leads: [
                {
                  id: 1,
                  created_at: "2026-01-15T12:00:00+00:00",
                  page_path: "/order",
                  page_key: "/order",
                  form_id: "f1",
                  ref_code: "ABC",
                  submission_stage: "submit_attempt",
                  submission_stage_label: "Попытка",
                  submission_stage_badge: "stage_submit_attempt",
                  client_observed_outcome: "success_observed",
                  client_outcome_label: "Успех",
                  client_outcome_badge: "outcome_success",
                  client_outcome_reason: "",
                  customer_email_masked: "b***@example.com",
                  customer_phone_masked: null,
                  amount: "10.00",
                  currency: "RUB",
                  product_name: "X",
                },
              ],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockIntegrationPayload(),
      });
    });

    render(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByText("/order")).toBeInTheDocument();
    });
    expect(screen.getByText("Успех")).toBeInTheDocument();
    expect(screen.getByText("10.00 RUB")).toBeInTheDocument();
  });

  it("shows admin message when site_missing", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "site_missing" }),
    });

    render(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByText(/объект Site/i)).toBeInTheDocument();
    });
  });

  it("copy snippet uses clipboard API", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    mockFetchIntegrationAndDiagnostics();

    render(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Копировать сниппет/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Копировать сниппет/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("data-rs-key="));
    });
  });
});
