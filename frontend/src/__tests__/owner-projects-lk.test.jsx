/**
 * Owner projects list IA + create-project flow.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LkSidebar from "../pages/lk/LkSidebar";
import CreateOwnerProjectPage from "../pages/lk/owner-programs/CreateOwnerProjectPage";
import OwnerSitesListPage from "../pages/lk/owner-programs/OwnerSitesListPage";
import ProjectOverviewPage from "../pages/lk/owner-programs/ProjectOverviewPage";

describe("LkSidebar owner IA", () => {
  it('shows "Проекты" and omits referral-program entry', () => {
    render(
      <MemoryRouter initialEntries={["/lk/partner"]}>
        <LkSidebar />
      </MemoryRouter>
    );
    expect(screen.getByText("Проекты")).toBeInTheDocument();
    expect(screen.queryByText("Партнёрские программы")).not.toBeInTheDocument();
    expect(screen.queryByText("Реферальная программа")).not.toBeInTheDocument();
    expect(screen.getByText("Агентские программы")).toBeInTheDocument();
    expect(screen.queryByText("Виджет")).not.toBeInTheDocument();
  });
});

describe("OwnerSitesListPage → create flow", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it("opens /lk/partner/new from create button", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "site_missing" }),
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner"]}>
        <Routes>
          <Route path="/lk/partner" element={<OwnerSitesListPage />} />
          <Route path="/lk/partner/new" element={<div data-testid="create-flow">create</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Проекты" })).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Создать проект" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Создать проект" }));
    await waitFor(() => {
      expect(screen.getByTestId("create-flow")).toBeInTheDocument();
    });
  });
});

describe("CreateOwnerProjectPage", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  function setup(newPublicId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb") {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      if (String(url).includes("/referrals/site/create/") && opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: newPublicId,
            publishable_key: "pk_new",
            allowed_origins: ["https://new.example"],
            platform_preset: "tilda",
            status: "draft",
            verified_at: null,
            activated_at: null,
            widget_enabled: true,
            config_json: { display_name: "From API" },
            widget_embed_snippet: "",
            public_api_base: "https://api.example",
            widget_script_base: "https://app.example",
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    return fetchMock;
  }

  it("submits create and redirects to new project overview", async () => {
    setup();
    render(
      <MemoryRouter initialEntries={["/lk/partner/new"]}>
        <Routes>
          <Route path="/lk/partner/new" element={<CreateOwnerProjectPage />} />
          <Route path="/lk/partner/:sitePublicId/overview" element={<div data-testid="overview">overview</div>} />
        </Routes>
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText(/Название проекта/i), "Мой магазин");
    await userEvent.type(screen.getByLabelText(/Домен/i), "shop.example");
    await userEvent.click(screen.getByRole("button", { name: /Создать проект/i }));

    await waitFor(() => {
      expect(screen.getByTestId("overview")).toBeInTheDocument();
    });
  });
});

describe("ProjectOverviewPage", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it("shows product summary, hides raw warning codes, maps diagnostics copy", async () => {
    const siteId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/") && !u.includes("diagnostics")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteId,
            allowed_origins: ["https://shop.example"],
            platform_preset: "tilda",
            status: "active",
            config_json: { display_name: "Магазин" },
          }),
        });
      }
      if (u.includes("diagnostics")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            integration_status: "healthy",
            integration_warnings: ["observe_success_off"],
            site_membership: { count: 3 },
            windows: { "7d": { submit_attempt_count: 5 } },
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/${siteId}/overview`]}>
        <Routes>
          <Route path="/lk/partner/:sitePublicId/overview" element={<ProjectOverviewPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Магазин" })).toBeInTheDocument();
    });

    expect(screen.getByText("shop.example")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Настроить виджет/i })).toHaveAttribute("href", `/lk/partner/${siteId}/widget`);
    expect(screen.queryByText("observe_success_off")).not.toBeInTheDocument();
    expect(screen.getByText(/Страница успеха может не отслеживаться/i)).toBeInTheDocument();
  });
});
