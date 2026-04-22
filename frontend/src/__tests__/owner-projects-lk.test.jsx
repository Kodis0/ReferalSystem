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
import ProjectMembersPage from "../pages/lk/owner-programs/ProjectMembersPage";
import ProjectSettingsPage from "../pages/lk/owner-programs/ProjectSettingsPage";
import SiteProjectLayout from "../pages/lk/owner-programs/SiteProjectLayout";

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
          <Route path="/lk/partner/:sitePublicId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Магазин" })).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { level: 2, name: "Обзор" })).toBeInTheDocument();
    expect(screen.getByText(/shop\.example/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Настройки виджета/i })).toHaveAttribute("href", `/lk/partner/${siteId}/widget`);
    expect(screen.queryByText("observe_success_off")).not.toBeInTheDocument();
    expect(screen.getByText(/Страница успеха может не отслеживаться/i)).toBeInTheDocument();
  });
});

describe("ProjectMembersPage", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  const siteId = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  it("renders empty state when there are no members", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0, members: [] }),
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/${siteId}/members`]}>
        <Routes>
          <Route path="/lk/partner/:sitePublicId/members" element={<ProjectMembersPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("members-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/Пока нет участников/i)).toBeInTheDocument();
  });

  it("renders member rows from API", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        count: 2,
        members: [
          { identity_masked: "u***@example.com", joined_at: "2026-01-10T12:00:00Z", ref_code: "ABC" },
          { identity_masked: "v***@example.org", joined_at: "2026-01-09T08:00:00Z" },
        ],
      }),
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/${siteId}/members`]}>
        <Routes>
          <Route path="/lk/partner/:sitePublicId/members" element={<ProjectMembersPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("members-list")).toBeInTheDocument();
    });
    const identities = screen.getAllByTestId("member-identity");
    expect(identities).toHaveLength(2);
    expect(identities[0]).toHaveTextContent("u***@example.com");
    expect(screen.getByText(/ABC/)).toBeInTheDocument();
  });

  it("shows error when members request fails", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "site_missing" }),
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/${siteId}/members`]}>
        <Routes>
          <Route path="/lk/partner/:sitePublicId/members" element={<ProjectMembersPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("site_missing")).toBeInTheDocument();
    });
  });
});

describe("ProjectSettingsPage", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  const siteId = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  it("renders loaded display name, origin and platform", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/") && (!opts || !opts.method || opts.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteId,
            allowed_origins: ["https://shop.example"],
            platform_preset: "tilda",
            config_json: { display_name: "Магазин" },
            widget_enabled: true,
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/${siteId}/settings`]}>
        <Routes>
          <Route path="/lk/partner/:sitePublicId/settings" element={<ProjectSettingsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-settings-form")).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Название проекта/i)).toHaveValue("Магазин");
    expect(screen.getByLabelText(/Домен или origin/i)).toHaveValue("https://shop.example");
    expect(screen.getByLabelText(/Платформа/i)).toHaveValue("tilda");
  });

  it("save sends PATCH and shows success", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/") && (!opts || !opts.method || opts.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteId,
            allowed_origins: ["https://a.example"],
            platform_preset: "tilda",
            config_json: { display_name: "A" },
            widget_enabled: true,
          }),
        });
      }
      if (u.includes("/referrals/site/integration/") && opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteId,
            allowed_origins: ["https://b.example"],
            platform_preset: "generic",
            config_json: { display_name: "B" },
            widget_enabled: true,
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/${siteId}/settings`]}>
        <Routes>
          <Route path="/lk/partner/:sitePublicId/settings" element={<ProjectSettingsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-settings-form")).toBeInTheDocument();
    });
    await userEvent.clear(screen.getByLabelText(/Название проекта/i));
    await userEvent.type(screen.getByLabelText(/Название проекта/i), "B");
    await userEvent.clear(screen.getByLabelText(/Домен или origin/i));
    await userEvent.type(screen.getByLabelText(/Домен или origin/i), "https://b.example");
    await userEvent.selectOptions(screen.getByLabelText(/Платформа/i), "generic");
    await userEvent.click(screen.getByRole("button", { name: /Сохранить/i }));

    await waitFor(() => {
      expect(screen.getByTestId("settings-save-success")).toBeInTheDocument();
    });
  });

  it("shows error when save fails", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/") && (!opts || !opts.method || opts.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteId,
            allowed_origins: ["https://a.example"],
            platform_preset: "tilda",
            config_json: {},
            widget_enabled: true,
          }),
        });
      }
      if (u.includes("/referrals/site/integration/") && opts?.method === "PATCH") {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ detail: "bad_payload" }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/${siteId}/settings`]}>
        <Routes>
          <Route path="/lk/partner/:sitePublicId/settings" element={<ProjectSettingsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-settings-form")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /Сохранить/i }));
    await waitFor(() => {
      expect(screen.getByText("bad_payload")).toBeInTheDocument();
    });
  });

  it("delete after confirmation redirects to project list", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/") && (!opts || !opts.method || opts.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteId,
            allowed_origins: ["https://a.example"],
            platform_preset: "tilda",
            config_json: { display_name: "X" },
            widget_enabled: true,
          }),
        });
      }
      if (u.includes("/referrals/site/integration/") && opts?.method === "DELETE") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: "deleted" }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/${siteId}/settings`]}>
        <Routes>
          <Route path="/lk/partner" element={<div data-testid="partner-list">Список</div>} />
          <Route path="/lk/partner/:sitePublicId/settings" element={<ProjectSettingsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("delete-project-button")).toBeInTheDocument();
    });
    await userEvent.type(screen.getByTestId("delete-confirm-input"), "УДАЛИТЬ");
    await userEvent.click(screen.getByTestId("delete-project-button"));

    await waitFor(() => {
      expect(screen.getByTestId("partner-list")).toBeInTheDocument();
    });
  });

  it("shows error when delete fails", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/") && (!opts || !opts.method || opts.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteId,
            allowed_origins: ["https://a.example"],
            platform_preset: "tilda",
            config_json: {},
            widget_enabled: true,
          }),
        });
      }
      if (u.includes("/referrals/site/integration/") && opts?.method === "DELETE") {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ detail: "site_missing" }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/${siteId}/settings`]}>
        <Routes>
          <Route path="/lk/partner/:sitePublicId/settings" element={<ProjectSettingsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("delete-project-button")).toBeInTheDocument();
    });
    await userEvent.type(screen.getByTestId("delete-confirm-input"), "УДАЛИТЬ");
    await userEvent.click(screen.getByTestId("delete-project-button"));

    await waitFor(() => {
      expect(screen.getByText("site_missing")).toBeInTheDocument();
    });
  });
});
