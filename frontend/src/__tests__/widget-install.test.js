/**
 * Site owner widget install screen (integration API).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import WidgetInstallScreen from "../pages/lk/widget-install/widget-install";

function renderWithLkRouter(ui) {
  return render(<MemoryRouter initialEntries={["/lk/widget-install"]}>{ui}</MemoryRouter>);
}

function renderFocusedWidgetInstall(ui) {
  return render(<MemoryRouter initialEntries={["/lk/partner/project/1/widget"]}>{ui}</MemoryRouter>);
}

describe("WidgetInstallScreen", () => {
  // Contract (owner/LK widget-install): machine key + owner-visible error text both flow through
  // `payload.code ?? payload.detail` — "prefers code" rows assert `detail` does not leak when `code` is set.

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
      site_display_name: "Demo shop",
      publishable_key: "pk_test_widget",
      allowed_origins: ["https://shop.example"],
      platform_preset: "tilda",
      status: "draft",
      verified_at: null,
      activated_at: null,
      widget_enabled: true,
      config_json: { amount_selector: ".js-price" },
      capture_config: {
        required_fields: ["ref", "page_url", "form_id"],
        recommended_fields: ["name", "email", "phone"],
        enabled_optional_fields: ["name", "email", "phone", "amount", "currency", "product_name"],
      },
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
      site_status: "draft",
      verified_at: null,
      activated_at: null,
      integration_status: "healthy",
      integration_warnings: [],
      embed_readiness: {
        origins_configured: true,
        widget_enabled: true,
        publishable_key_present: true,
        public_id_present: true,
      },
      connection_check: {
        status: "not_found",
        last_seen_at: null,
        last_seen_origin: "",
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
      site_membership: {
        count: 0,
        recent_joins: [],
      },
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

  it.each([
    ["detail only", { detail: "integration_load_err" }, undefined],
    ["code only", { code: "integration_load_err" }, undefined],
    ["prefers code", { code: "integration_load_err", detail: "legacy_detail" }, "legacy_detail"],
  ])("shows generic integration load error from API body (%s)", async (_label, errorBody, legacyDetailMustNotAppear) => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => errorBody,
    });

    renderWithLkRouter(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByText("integration_load_err")).toBeInTheDocument();
    });
    if (legacyDetailMustNotAppear) {
      expect(screen.queryByText(legacyDetailMustNotAppear)).not.toBeInTheDocument();
    }
  });

  it("loads integration and shows main snippet onboarding block", async () => {
    const fetchMock = mockFetchIntegrationAndDiagnostics();

    renderWithLkRouter(<WidgetInstallScreen />);

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
      expect(screen.getByRole("heading", { name: /Установите код на сайт/i })).toBeInTheDocument();
    });
    expect(screen.getByTestId("widget-install-snippet-block")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Скопировать код/i })).toBeInTheDocument();
    expect(screen.getByText(/Вставьте код на сайт, опубликуйте изменения/i)).toBeInTheDocument();
    expect(screen.getByText("Вставьте код на сайт")).toBeInTheDocument();
    expect(screen.getByText("Опубликуйте изменения")).toBeInTheDocument();
    expect(screen.getByText("Откройте страницу сайта")).toBeInTheDocument();
    expect(screen.getByText(/Вернитесь и нажмите «Проверить подключение»/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Что подключается/i })).toBeInTheDocument();
    expect(screen.getByText("Demo shop")).toBeInTheDocument();
    expect(screen.getByText(/referral-widget\.v1\.js/)).toBeInTheDocument();
    expect(screen.getAllByText("https://shop.example").length).toBeGreaterThanOrEqual(1);
  });

  it("shows onboarding sections and technical disclosures", async () => {
    mockFetchIntegrationAndDiagnostics();

    renderWithLkRouter(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Установите код на сайт/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /Какие данные отправлять/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Проверка и запуск/i })).toBeInTheDocument();
    expect(screen.getByText("Техническая диагностика")).toBeInTheDocument();
    expect(screen.getByText("Технические метрики")).toBeInTheDocument();
  });

  it("shows membership count and recent joins from diagnostics", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/diagnostics/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            mockDiagnosticsPayload({
              site_membership: {
                count: 2,
                recent_joins: [
                  {
                    joined_at: "2026-02-01T10:00:00+00:00",
                    identity_masked: "a***@example.com",
                  },
                  {
                    joined_at: "2026-01-31T09:00:00+00:00",
                    identity_masked: "b***@example.org",
                  },
                ],
              },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockIntegrationPayload(),
      });
    });

    renderWithLkRouter(<WidgetInstallScreen />);

    const ctaHeading = await screen.findByRole("heading", { name: /Участники по CTA/i });
    const ctaSection = ctaHeading.closest("section");
    await waitFor(() => {
      expect(within(ctaSection).getByText("2")).toBeInTheDocument();
    });
    expect(within(ctaSection).getByText(/a\*\*\*@example\.com/i)).toBeInTheDocument();
    expect(within(ctaSection).getByText(/2026-02-01 10:00:00 ·/)).toBeInTheDocument();
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

    renderWithLkRouter(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByText("/order")).toBeInTheDocument();
    });
    expect(screen.getByText("Успех")).toBeInTheDocument();
    expect(screen.getByText("10.00 RUB")).toBeInTheDocument();
  });

  it.each([
    ["detail only", { detail: "site_missing" }, undefined],
    ["code only", { code: "site_missing" }, undefined],
    ["prefers code", { code: "site_missing", detail: "legacy_detail" }, "legacy_detail"],
  ])("shows empty state and CTA when site_missing (%s)", async (_label, errorBody, legacyDetailMustNotAppear) => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => errorBody,
    });

    renderWithLkRouter(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByText(/ещё не подключён сайт/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Подключить сайт/i })).toBeInTheDocument();
    if (legacyDetailMustNotAppear) {
      expect(screen.queryByText(legacyDetailMustNotAppear)).not.toBeInTheDocument();
    }
  });

  it("create site POSTs bootstrap then reloads integration and diagnostics", async () => {
    let afterBootstrap = false;
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/referrals/site/bootstrap/")) {
        afterBootstrap = true;
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => mockIntegrationPayload(),
        });
      }
      if (!afterBootstrap) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ detail: "site_missing" }),
        });
      }
      if (u.includes("/diagnostics/")) {
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

    renderWithLkRouter(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Подключить сайт/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Подключить сайт/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/referrals/site/bootstrap/"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("pk_test_widget")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /Состояние интеграции/i })).toBeInTheDocument();
  });

  it.each([
    ["detail only", { detail: "server_error" }, undefined],
    ["code only", { code: "server_error" }, undefined],
    ["prefers code", { code: "server_error", detail: "legacy_detail" }, "legacy_detail"],
  ])("shows create error when bootstrap fails (%s)", async (_label, bootstrapBody, legacyDetailMustNotAppear) => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/referrals/site/bootstrap/")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => bootstrapBody,
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({ detail: "site_missing" }),
      });
    });

    renderWithLkRouter(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Подключить сайт/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Подключить сайт/i }));

    await waitFor(() => {
      expect(screen.getByText("server_error")).toBeInTheDocument();
    });
    if (legacyDetailMustNotAppear) {
      expect(screen.queryByText(legacyDetailMustNotAppear)).not.toBeInTheDocument();
    }
  });

  it("copy snippet uses clipboard API", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    mockFetchIntegrationAndDiagnostics();

    renderWithLkRouter(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Скопировать код/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Скопировать код/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("data-rs-key="));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Код скопирован" })).toBeInTheDocument();
    });
  });

  it("renders required and optional capture fields", async () => {
    mockFetchIntegrationAndDiagnostics();

    renderWithLkRouter(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Какие данные отправлять/i })).toBeInTheDocument();
    });

    expect(screen.getByTestId("capture-required-fields")).toHaveTextContent("ref");
    expect(screen.getByTestId("capture-required-fields")).toHaveTextContent("URL страницы");
    expect(screen.getByTestId("capture-optional-fields")).toHaveTextContent("Имя");
    expect(screen.getByTestId("capture-optional-fields")).toHaveTextContent("Email");
    expect(screen.getByTestId("capture-optional-fields")).toHaveTextContent("Телефон");
    expect(screen.getByText("Дополнительные поля")).toBeInTheDocument();
  });

  it("saves capture field config via integration settings", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, options = {}) => {
      const u = String(url);
      if (u.includes("/diagnostics/")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockDiagnosticsPayload(),
        });
      }
      if (u.includes("/referrals/site/integration/") && options.method === "PATCH") {
        const body = JSON.parse(options.body);
        return Promise.resolve({
          ok: true,
          json: async () =>
            mockIntegrationPayload({
              allowed_origins: body.allowed_origins,
              platform_preset: body.platform_preset,
              widget_enabled: body.widget_enabled,
              config_json: body.config_json,
              capture_config: {
                required_fields: ["ref", "page_url", "form_id"],
                recommended_fields: ["name", "email", "phone"],
                enabled_optional_fields: body.capture_config.enabled_optional_fields,
              },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockIntegrationPayload(),
      });
    });

    renderWithLkRouter(<WidgetInstallScreen />);

    const phoneCheckbox = await screen.findByLabelText(/Телефон/i);
    await userEvent.click(phoneCheckbox);
    await userEvent.click(screen.getByRole("button", { name: /Сохранить настройки/i }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([url, options]) => String(url).includes("/referrals/site/integration/") && options?.method === "PATCH"
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse(patchCall[1].body);
      expect(body.capture_config.enabled_optional_fields).toEqual(["name", "email", "amount", "currency", "product_name"]);
    });
  });

  it.each([
    ["detail only", { detail: "patch_save_err" }, undefined],
    ["code only", { code: "patch_save_err" }, undefined],
    ["prefers code", { code: "patch_save_err", detail: "legacy_detail" }, "legacy_detail"],
  ])("shows save hint when integration PATCH fails (%s)", async (_label, errBody, legacyDetailMustNotAppear) => {
    jest.spyOn(global, "fetch").mockImplementation((url, options = {}) => {
      const u = String(url);
      if (u.includes("/diagnostics/")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockDiagnosticsPayload(),
        });
      }
      if (u.includes("/referrals/site/integration/") && options.method === "PATCH") {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => errBody,
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockIntegrationPayload(),
      });
    });

    renderWithLkRouter(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Сохранить настройки/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Сохранить настройки/i }));

    await waitFor(() => {
      expect(screen.getByText("patch_save_err")).toBeInTheDocument();
    });
    if (legacyDetailMustNotAppear) {
      expect(screen.queryByText(legacyDetailMustNotAppear)).not.toBeInTheDocument();
    }
  });

  const siteSelectionSites = [
    { public_id: "site-one", status: "draft" },
    { public_id: "site-two", status: "active" },
  ];

  it.each([
    ["detail only", { detail: "site_selection_required", sites: siteSelectionSites }, undefined],
    ["code only", { code: "site_selection_required", sites: siteSelectionSites }, undefined],
    [
      "prefers code",
      { code: "site_selection_required", detail: "legacy_detail", sites: siteSelectionSites },
      "legacy_detail",
    ],
  ])("shows site chooser when backend requires explicit site selection (%s)", async (_label, errorBody, legacyDetailMustNotAppear) => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => errorBody,
    });

    renderWithLkRouter(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Выберите проект/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /site-one · Черновик/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /site-two · Активно/i })).toBeInTheDocument();
    if (legacyDetailMustNotAppear) {
      expect(screen.queryByText(legacyDetailMustNotAppear)).not.toBeInTheDocument();
    }
  });

  it("verify and activate buttons call lifecycle endpoints", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, options = {}) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/verify/")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockIntegrationPayload({ status: "verified", verified_at: "2026-01-15T12:00:00+00:00" }),
        });
      }
      if (u.includes("/referrals/site/integration/activate/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            mockIntegrationPayload({
              status: "active",
              verified_at: "2026-01-15T12:00:00+00:00",
              activated_at: "2026-01-15T12:05:00+00:00",
            }),
        });
      }
      if (u.includes("/diagnostics/")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockDiagnosticsPayload(),
        });
      }
      if (options.method === "GET" || !options.method) {
        return Promise.resolve({
          ok: true,
          json: async () => mockIntegrationPayload(),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockIntegrationPayload(),
      });
    });

    renderWithLkRouter(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Проверить подключение/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Проверить подключение/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/referrals/site/integration/verify/"),
        expect.objectContaining({ method: "POST" })
      );
    });

    await userEvent.click(screen.getByRole("button", { name: /Активировать сайт/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/referrals/site/integration/activate/"),
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it.each([
    ["detail only", { detail: "verify_other_err" }, undefined],
    ["code only", { code: "verify_other_err" }, undefined],
    ["prefers code", { code: "verify_other_err", detail: "legacy_detail" }, "legacy_detail"],
  ])("shows save hint on verify POST fallback when not site_connection_not_found (%s)", async (_label, errBody, legacyDetailMustNotAppear) => {
    jest.spyOn(global, "fetch").mockImplementation((url, options = {}) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/verify/") && options.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => errBody,
        });
      }
      if (u.includes("/diagnostics/")) {
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

    renderWithLkRouter(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Проверить подключение/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Проверить подключение/i }));

    await waitFor(() => {
      expect(screen.getByText("verify_other_err")).toBeInTheDocument();
    });
    if (legacyDetailMustNotAppear) {
      expect(screen.queryByText(legacyDetailMustNotAppear)).not.toBeInTheDocument();
    }
  });

  it.each([
    ["detail only", { detail: "activate_err" }, undefined],
    ["code only", { code: "activate_err" }, undefined],
    ["prefers code", { code: "activate_err", detail: "legacy_detail" }, "legacy_detail"],
  ])("shows save hint when activation POST fails (%s)", async (_label, errBody, legacyDetailMustNotAppear) => {
    jest.spyOn(global, "fetch").mockImplementation((url, options = {}) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/activate/") && options.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => errBody,
        });
      }
      if (u.includes("/diagnostics/")) {
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

    renderWithLkRouter(<WidgetInstallScreen />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Активировать сайт/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Активировать сайт/i }));

    await waitFor(() => {
      expect(screen.getByText("activate_err")).toBeInTheDocument();
    });
    if (legacyDetailMustNotAppear) {
      expect(screen.queryByText(legacyDetailMustNotAppear)).not.toBeInTheDocument();
    }
  });

  it("renders focused connection check button and idle status", async () => {
    mockFetchIntegrationAndDiagnostics();

    renderFocusedWidgetInstall(
      <WidgetInstallScreen routeSitePublicId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" focused />
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Проверка подключения/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Проверить подключение/i })).toBeInTheDocument();
    expect(screen.getByText("Ещё не проверяли")).toBeInTheDocument();
  });

  it("shows focused connection check loading state", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url, options = {}) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/verify/") && options.method === "POST") {
        return new Promise(() => {});
      }
      if (u.includes("/diagnostics/")) {
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

    renderFocusedWidgetInstall(
      <WidgetInstallScreen routeSitePublicId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" focused />
    );

    await userEvent.click(await screen.findByRole("button", { name: /Проверить подключение/i }));

    expect(screen.getByRole("button", { name: /Проверяем/i })).toBeInTheDocument();
    expect(screen.getByText("Идёт проверка")).toBeInTheDocument();
  });

  it("shows focused connection check success state", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url, options = {}) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/verify/") && options.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () =>
            mockIntegrationPayload({
              status: "verified",
              verified_at: "2026-01-15T12:00:00+00:00",
              connection_check: {
                status: "found",
                last_seen_at: "2026-01-15T11:59:00+00:00",
                last_seen_origin: "https://shop.example",
              },
            }),
        });
      }
      if (u.includes("/diagnostics/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            mockDiagnosticsPayload({
              connection_check: {
                status: "found",
                last_seen_at: "2026-01-15T11:59:00+00:00",
                last_seen_origin: "https://shop.example",
              },
              site_status: "verified",
              verified_at: "2026-01-15T12:00:00+00:00",
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => mockIntegrationPayload(),
      });
    });

    renderFocusedWidgetInstall(
      <WidgetInstallScreen routeSitePublicId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" focused />
    );

    await userEvent.click(await screen.findByRole("button", { name: /Проверить подключение/i }));

    await waitFor(() => {
      expect(screen.getByText("Подключение найдено")).toBeInTheDocument();
    });
    expect(screen.getByText("Подключение найдено. Сайт подключён.")).toBeInTheDocument();
  });

  it.each([
    ["detail only", { detail: "site_connection_not_found" }, undefined],
    ["code only", { code: "site_connection_not_found" }, undefined],
    [
      "prefers code",
      {
        code: "site_connection_not_found",
        detail: "legacy_human_message_should_not_change_branch",
      },
      "legacy_human_message_should_not_change_branch",
    ],
  ])("shows focused connection check failure state (%s)", async (_label, verifyErrorBody, legacyDetailMustNotAppear) => {
    jest.spyOn(global, "fetch").mockImplementation((url, options = {}) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/verify/") && options.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({
            ...verifyErrorBody,
            connection_check: {
              status: "not_found",
              last_seen_at: null,
              last_seen_origin: "",
            },
          }),
        });
      }
      if (u.includes("/diagnostics/")) {
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

    renderFocusedWidgetInstall(
      <WidgetInstallScreen routeSitePublicId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" focused />
    );

    await userEvent.click(await screen.findByRole("button", { name: /Проверить подключение/i }));

    await waitFor(() => {
      expect(screen.getByText("Подключение не найдено")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Проверьте установку, публикацию сайта и откройте страницу ещё раз/i)
    ).toBeInTheDocument();
    if (legacyDetailMustNotAppear) {
      expect(screen.queryByText(legacyDetailMustNotAppear)).not.toBeInTheDocument();
    }
  });
});
