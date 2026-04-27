/**
 * Owner projects list IA + create-project flow.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router-dom";
import LkSidebar from "../pages/lk/LkSidebar";
import CreateOwnerProjectPage from "../pages/lk/owner-programs/CreateOwnerProjectPage";
import OwnerSitesListPage from "../pages/lk/owner-programs/OwnerSitesListPage";
import ProjectInfoPage from "../pages/lk/owner-programs/ProjectInfoPage";
import ProjectOverviewPage from "../pages/lk/owner-programs/ProjectOverviewPage";
import ProjectMembersPage from "../pages/lk/owner-programs/ProjectMembersPage";
import ProjectSettingsPage from "../pages/lk/owner-programs/ProjectSettingsPage";
import SiteProjectLayout from "../pages/lk/owner-programs/SiteProjectLayout";
import ProjectReferralBlockScreen from "../pages/lk/owner-programs/ProjectReferralBlockScreen";
import ProjectWidgetInstallScreen from "../pages/lk/widget-install/ProjectWidgetInstallScreen";
import ProjectSiteManagementScreen from "../pages/lk/widget-install/ProjectSiteManagementScreen";
import WidgetInstallScreen from "../pages/lk/widget-install/widget-install";
import LegacyOwnerSiteRedirect from "../pages/lk/owner-programs/LegacyOwnerSiteRedirect";
import SiteDashboardPage from "../pages/lk/owner-programs/SiteDashboardPage";
import { isUuidString } from "../pages/registration/postJoinNavigation";

if (typeof window.ResizeObserver === "undefined") {
  class ResizeObserver {
    observe() {}

    unobserve() {}

    disconnect() {}
  }

  window.ResizeObserver = ResizeObserver;
  global.ResizeObserver = ResizeObserver;
}

/** Mirrors lk.js `SiteShellDefaultToDashboard` for isolated route trees in tests. */
function SiteShellDefaultToDashboardStub() {
  const { projectId, sitePublicId } = useParams();
  const raw = String(sitePublicId || "").trim();
  const pid = String(projectId ?? "");
  if (!isUuidString(raw)) {
    return <Navigate to={`/lk/partner/project/${pid}/sites`} replace />;
  }
  const sid = encodeURIComponent(raw);
  return <Navigate to={`/lk/partner/project/${pid}/sites/${sid}/dashboard`} replace />;
}

function makeSite({
  public_id,
  project_id = 1,
  status = "draft",
  widget_enabled = true,
  allowed_origins_count = 1,
  primary_origin = "",
  primary_origin_label = "",
  platform_preset = "tilda",
  avatar_data_url = "",
  project = {},
} = {}) {
  return {
    public_id,
    project_id,
    status,
    widget_enabled,
    allowed_origins_count,
    primary_origin,
    primary_origin_label: typeof primary_origin_label === "string" ? primary_origin_label : "",
    platform_preset,
    avatar_data_url: typeof avatar_data_url === "string" ? avatar_data_url : "",
    display_name: typeof project.name === "string" ? project.name : "",
    description: typeof project.description === "string" ? project.description : "",
    project: {
      id: project_id,
      name: project.name || "",
      description: project.description || "",
      avatar_data_url: project.avatar_data_url || "",
    },
  };
}

function makeProject({ id, name, description = "", sites = [], isDefault = false }) {
  return {
    id,
    is_default: isDefault,
    primary_site_public_id: sites[0]?.public_id || "",
    sites_count: sites.length,
    project: { id, name, description, avatar_data_url: "", is_default: isDefault },
    sites,
  };
}

function makeOwnerProjectsPayload(projects) {
  return {
    projects,
    sites: projects.flatMap((project) => project.sites),
  };
}

// Stub for tests that mount project-level pages in isolation. SiteProjectLayout
// publishes only primarySitePublicId for these pages — they no longer derive a
// "current site" from useParams/query/state.
function ProjectStubLayout({ primarySitePublicId, projectId = null }) {
  return <Outlet context={{ primarySitePublicId, projectId, headLoading: false }} />;
}

describe("LkSidebar owner IA", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ projects: [], sites: [] }),
    });
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it('shows "Проекты" and omits referral-program entry', async () => {
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
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/referrals/site/owner-sites/"),
        expect.any(Object),
      );
    });
  });

  it("reorders sidebar projects dynamically while dragging from handle", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        makeOwnerProjectsPayload([
          makeProject({
            id: 101,
            name: "Alpha",
            sites: [makeSite({ public_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", project_id: 101, primary_origin: "https://alpha.example", project: { name: "Alpha" } })],
          }),
          makeProject({
            id: 102,
            name: "Beta",
            sites: [makeSite({ public_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", project_id: 102, primary_origin: "https://beta.example", project: { name: "Beta" } })],
          }),
          makeProject({
            id: 103,
            name: "Gamma",
            sites: [makeSite({ public_id: "cccccccc-cccc-cccc-cccc-cccccccccccc", project_id: 103, primary_origin: "https://gamma.example", project: { name: "Gamma" } })],
          }),
        ]),
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner"]}>
        <LkSidebar />
      </MemoryRouter>
    );

    const sourceId = "project-101";
    const middleId = "project-102";
    const targetId = "project-103";

    await waitFor(() => {
      expect(screen.getByTestId(`sidebar-project-${sourceId}`)).toBeInTheDocument();
      expect(screen.getByTestId(`sidebar-project-${targetId}`)).toBeInTheDocument();
    });

    const projectsBlock = document.getElementById("lk-sidebar-projects-block");
    const sourceRow = screen.getByTestId(`sidebar-project-${sourceId}`);
    const middleRow = screen.getByTestId(`sidebar-project-${middleId}`);
    const targetRow = screen.getByTestId(`sidebar-project-${targetId}`);
    const sourceHandle = sourceRow.querySelector("[data-projects-drag-handle='true']");
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: jest.fn(),
      setDragImage: jest.fn(),
      getData: jest.fn(() => sourceId),
    };

    expect(projectsBlock).not.toBeNull();
    expect(sourceHandle).not.toBeNull();

    middleRow.getBoundingClientRect = () => ({
      top: 100,
      bottom: 140,
      height: 40,
      left: 0,
      right: 240,
      width: 240,
    });
    targetRow.getBoundingClientRect = () => ({
      top: 140,
      bottom: 180,
      height: 40,
      left: 0,
      right: 240,
      width: 240,
    });

    fireEvent.mouseDown(sourceHandle);
    fireEvent.dragStart(sourceHandle, { dataTransfer });

    await waitFor(() => {
      expect(sourceRow).toHaveClass("lk-sidebar__project--dragging");
    });
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(sourceRow, expect.any(Number), expect.any(Number));

    fireEvent.dragOver(middleRow, { dataTransfer, clientY: 135 });
    await waitFor(() => {
      expect(
        Array.from(projectsBlock.querySelectorAll("[data-testid^='sidebar-project-']")).map((node) =>
          node.getAttribute("data-id"),
        ),
      ).toEqual([middleId, sourceId, targetId]);
    });

    fireEvent.dragOver(targetRow, { dataTransfer, clientY: 175 });
    await waitFor(() => {
      expect(
        Array.from(projectsBlock.querySelectorAll("[data-testid^='sidebar-project-']")).map((node) =>
          node.getAttribute("data-id"),
        ),
      ).toEqual([middleId, targetId, sourceId]);
    });

    fireEvent.dragOver(middleRow, { dataTransfer, clientY: 105 });
    await waitFor(() => {
      expect(
        Array.from(projectsBlock.querySelectorAll("[data-testid^='sidebar-project-']")).map((node) =>
          node.getAttribute("data-id"),
        ),
      ).toEqual([sourceId, middleId, targetId]);
    });

    fireEvent.drop(targetRow, { dataTransfer });
    fireEvent.dragEnd(sourceHandle, { dataTransfer });
  });

  it("links project without sites to services overview", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        makeOwnerProjectsPayload([
          makeProject({
            id: 104,
            name: "No Sites Yet",
            sites: [],
          }),
        ]),
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner"]}>
        <LkSidebar />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /No Sites Yet/i })).toHaveAttribute(
        "href",
        "/lk/partner/project/104/sites",
      );
    });
  });

  it("links project with sites to canonical project route", async () => {
    const siteId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        makeOwnerProjectsPayload([
          makeProject({
            id: 105,
            name: "With Site",
            sites: [makeSite({ public_id: siteId, project_id: 105, primary_origin: "https://with-site.example", project: { name: "With Site" } })],
          }),
        ]),
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner"]}>
        <LkSidebar />
      </MemoryRouter>
    );

    await waitFor(() => {
      const href = screen.getByRole("link", { name: /With Site/i }).getAttribute("href");
      expect(href).toBe(`/lk/partner/project/105/sites?site_public_id=${siteId}`);
      const u = new URL(href, "http://localhost");
      expect(u.pathname).toBe("/lk/partner/project/105/sites");
      expect(u.pathname).not.toMatch(/\/sites\/[0-9a-f-]{8}-/i);
      expect(u.searchParams.get("site_public_id")).toBe(siteId);
      expect([...u.searchParams.keys()].filter((k) => k === "site_public_id").length).toBe(1);
    });
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
      ok: true,
      status: 200,
      json: async () => ({ projects: [], sites: [] }),
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
      expect(screen.getByRole("link", { name: "Создать" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("link", { name: "Создать" }));
    await waitFor(() => {
      expect(screen.getByTestId("create-flow")).toBeInTheDocument();
    });
  });

  it("renders one project card for a project with multiple sites", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        makeOwnerProjectsPayload([
          makeProject({
            id: 201,
            name: "Shop A",
            sites: [
              makeSite({
                public_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                project_id: 201,
                status: "draft",
                primary_origin: "https://shop.example",
                project: { name: "Shop A" },
              }),
              makeSite({
                public_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                project_id: 201,
                status: "active",
                widget_enabled: false,
                allowed_origins_count: 0,
                primary_origin: "https://store.example",
                project: { name: "Shop A" },
              }),
            ],
          }),
        ]),
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner"]}>
        <Routes>
          <Route path="/lk/partner" element={<OwnerSitesListPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("projects-cards")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /Shop A/i })).toHaveAttribute(
      "href",
      "/lk/partner/project/201/sites?site_public_id=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    expect(screen.getByTestId("project-card-sites-project-201")).toHaveTextContent("Сайтов: 2");
  });

  it("opens project overview for project without sites", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        makeOwnerProjectsPayload([
          makeProject({
            id: 202,
            name: "Empty project",
            sites: [],
          }),
        ]),
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner"]}>
        <Routes>
          <Route path="/lk/partner" element={<OwnerSitesListPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Empty project/i })).toHaveAttribute(
        "href",
        "/lk/partner/project/202/sites",
      );
    });
  });

  it("reorders project cards dynamically while dragging", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        makeOwnerProjectsPayload([
          makeProject({
            id: 301,
            name: "Alpha",
            sites: [makeSite({ public_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", project_id: 301, primary_origin: "https://alpha.example", project: { name: "Alpha" } })],
          }),
          makeProject({
            id: 302,
            name: "Beta",
            sites: [makeSite({ public_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", project_id: 302, primary_origin: "https://beta.example", project: { name: "Beta" } })],
          }),
          makeProject({
            id: 303,
            name: "Gamma",
            sites: [makeSite({ public_id: "cccccccc-cccc-cccc-cccc-cccccccccccc", project_id: 303, primary_origin: "https://gamma.example", project: { name: "Gamma" } })],
          }),
        ]),
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner"]}>
        <Routes>
          <Route path="/lk/partner" element={<OwnerSitesListPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("projects-cards")).toBeInTheDocument();
    });

    const list = screen.getByTestId("projects-cards");
    const sourceId = "project-301";
    const targetId = "project-303";
    const sourceCard = screen.getByTestId(`project-card-${sourceId}`);
    const middleId = "project-302";
    const middleCard = screen.getByTestId(`project-card-${middleId}`);
    const targetCard = screen.getByTestId(`project-card-${targetId}`);
    const sourceHandle = sourceCard.querySelector("[data-projects-drag-handle='true']");
    const sourceLink = sourceCard.querySelector("a");
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: jest.fn(),
      setDragImage: jest.fn(),
      getData: jest.fn(() => sourceId),
    };

    expect(sourceHandle).not.toBeNull();
    expect(sourceLink).not.toBeNull();

    middleCard.getBoundingClientRect = () => ({
      top: 182,
      bottom: 344,
      height: 162,
      left: 760,
      right: 1056,
      width: 296,
    });
    targetCard.getBoundingClientRect = () => ({
      top: 360,
      bottom: 522,
      height: 162,
      left: 444,
      right: 740,
      width: 296,
    });
    sourceCard.getBoundingClientRect = () => ({
      top: 182,
      bottom: 344,
      height: 162,
      left: 444,
      right: 740,
      width: 296,
    });

    fireEvent.mouseDown(sourceHandle);
    fireEvent.dragStart(sourceLink, { dataTransfer });

    await waitFor(() => {
      expect(sourceCard).toHaveClass("owner-programs__project-card-container--dragging");
    });
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(sourceCard, expect.any(Number), expect.any(Number));

    fireEvent.dragOver(middleCard, { dataTransfer, clientX: 1030, clientY: 240 });
    await waitFor(() => {
      expect(Array.from(list.children).map((node) => node.getAttribute("data-id"))).toEqual([
        middleId,
        sourceId,
        targetId,
      ]);
    });

    fireEvent.dragOver(targetCard, { dataTransfer, clientX: 592, clientY: 500 });
    await waitFor(() => {
      expect(Array.from(list.children).map((node) => node.getAttribute("data-id"))).toEqual([
        middleId,
        targetId,
        sourceId,
      ]);
    });

    fireEvent.dragOver(middleCard, { dataTransfer, clientX: 780, clientY: 240 });
    await waitFor(() => {
      expect(Array.from(list.children).map((node) => node.getAttribute("data-id"))).toEqual([
        sourceId,
        middleId,
        targetId,
      ]);
    });

    fireEvent.drop(targetCard, { dataTransfer });
    fireEvent.dragEnd(sourceLink, { dataTransfer });
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

  function setup() {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      if (String(url).includes("/referrals/project/create/") && opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 901,
            primary_site_public_id: "",
            sites_count: 0,
            project: {
              id: 901,
              name: "From API",
              description: "",
              avatar_data_url: "",
            },
            sites: [],
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    return fetchMock;
  }

  it("submits create and redirects to projects list", async () => {
    const fetchMock = setup();
    render(
      <MemoryRouter initialEntries={["/lk/partner/new"]}>
        <Routes>
          <Route path="/lk/partner/new" element={<CreateOwnerProjectPage />} />
          <Route
            path="/lk/partner/project/:projectId/sites"
            element={<div data-testid="project-services">project-services</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText(/Название проекта/i), "Мой магазин");
    await userEvent.click(screen.getByTestId("submit-form-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("project-services")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/referrals/project/create/"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringMatching(/"avatar_data_url":"data:image\/svg\+xml;base64,/),
      }),
    );
  });

  it("surfaces API error code when detail is omitted on create failure", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      if (String(url).includes("/referrals/project/create/") && opts?.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ code: "display_name_required" }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    render(
      <MemoryRouter initialEntries={["/lk/partner/new"]}>
        <Routes>
          <Route path="/lk/partner/new" element={<CreateOwnerProjectPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText(/Название проекта/i), "Мой магазин");
    await userEvent.click(screen.getByTestId("submit-form-btn"));
    await waitFor(() => {
      expect(screen.getByText("display_name_required")).toBeInTheDocument();
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

  it("shows services tab content with search and layout switch", async () => {
    const siteId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 401,
                name: "Магазин",
                sites: [makeSite({ public_id: siteId, project_id: 401, primary_origin: "https://shop.ru", project: { name: "Магазин" } })],
              }),
            ]),
        });
      }
      if (u.includes("/referrals/site/reachability/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ reachable: true }),
        });
      }
      if (u.includes("/referrals/site/integration/") && !u.includes("diagnostics")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteId,
            allowed_origins: ["https://shop.ru"],
            platform_preset: "tilda",
            status: "active",
            config_json: { display_name: "Legacy магазин" },
            project: { id: 401, name: "Магазин", description: "", avatar_data_url: "" },
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/401/overview?site_public_id=${siteId}`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Магазин" })).toBeInTheDocument();
    });

    expect(screen.getByTestId("project-services-search")).toBeInTheDocument();
    expect(screen.getByTestId("project-services-layout-cards")).toBeInTheDocument();
    expect(screen.getByTestId(`project-child-site-${siteId}`)).toBeInTheDocument();
    expect(screen.getByLabelText("Флаг страны RU")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("В сети · текущий")).toBeInTheDocument();
    });
  });
});

describe("SiteProjectLayout child sites", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it("opens create dropdown with site item", async () => {
    const siteA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 501,
                name: "Shared project",
                sites: [makeSite({ public_id: siteA, project_id: 501, status: "draft", primary_origin: "https://alpha.example", project: { name: "Shared project" } })],
              }),
            ]),
        });
      }
      if (u.includes("/referrals/site/integration/") && !u.includes("diagnostics")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteA,
            allowed_origins: ["https://alpha.example"],
            platform_preset: "tilda",
            status: "draft",
            config_json: {},
            widget_enabled: true,
            project: { id: 501, name: "Shared project", description: "", avatar_data_url: "" },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/501/overview?site_public_id=${siteA}`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-create-menu-trigger")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("project-create-menu-trigger"));

    expect(screen.getByTestId("project-create-menu-dropdown")).toBeInTheDocument();
    expect(screen.getByTestId("project-create-menu-site")).toHaveTextContent("Сайт");
  });

  it("opens empty project on overview without auto-opening site form", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 502,
                name: "Empty shared project",
                sites: [],
              }),
            ]),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner/project/502/overview"]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-services-page")).toBeInTheDocument();
    });
    expect(screen.getByTestId("project-services-empty")).toHaveTextContent("У проекта пока нет сайтов.");
    expect(screen.getByTestId("project-delete-empty-button")).toBeInTheDocument();
    expect(screen.queryByTestId("project-add-site-origin")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Пользователи" })).toBeInTheDocument();
  });

  it("hides delete action for default empty project", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 503,
                name: "Общий проект",
                sites: [],
                isDefault: true,
              }),
            ]),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner/project/503/overview"]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-services-page")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("project-delete-empty-button")).not.toBeInTheDocument();
  });

  it("deletes empty project from header action and redirects to project list", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 502,
                name: "Empty shared project",
                sites: [],
              }),
            ]),
        });
      }
      if (u.includes("/referrals/project/502/") && opts?.method === "DELETE") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: "deleted" }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner/project/502/overview"]}>
        <Routes>
          <Route path="/lk/partner" element={<div data-testid="partner-list">Список</div>} />
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-delete-empty-button")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("project-delete-empty-button"));
    expect(screen.getByTestId("project-delete-dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("project-delete-dialog-confirm"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/referrals/project/502/"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("partner-list")).toBeInTheDocument();
    });
  });

  it("removes project avatar from project header", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            projects: [
              {
                id: 503,
                primary_site_public_id: "",
                sites_count: 0,
                sites: [],
                project: {
                  id: 503,
                  name: "Avatar project",
                  description: "",
                  avatar_data_url: "data:image/png;base64,AAA",
                },
              },
            ],
            sites: [],
          }),
        });
      }
      if (u.includes("/referrals/project/503/") && opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 503,
            primary_site_public_id: "",
            sites_count: 0,
            sites: [],
            project: { id: 503, name: "Avatar project", description: "", avatar_data_url: "" },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner/project/503/overview"]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByAltText("Фото проекта")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Удалить фото проекта" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/referrals/project/503/"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ avatar_data_url: "" }),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByAltText("Фото проекта")).not.toBeInTheDocument();
    });
    expect(document.querySelector(".owner-programs__shell-avatar-input")).not.toBeDisabled();
  });

  it("shows child sites list on services tab and opens site by card click", async () => {
    const siteA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const siteB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 501,
                name: "Shared project",
                sites: [
                  makeSite({ public_id: siteA, project_id: 501, status: "draft", primary_origin: "https://alpha.example", project: { name: "Shared project" } }),
                  makeSite({ public_id: siteB, project_id: 501, status: "active", primary_origin: "https://beta.example", project: { name: "Shared project" }, platform_preset: "generic" }),
                ],
              }),
            ]),
        });
      }
      if (u.includes("/referrals/site/integration/analytics/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            series: { by_day: [] },
            funnel: {},
            kpis: {},
            recent_sales: [],
          }),
        });
      }
      if (u.includes("/referrals/site/integration/") && u.includes("diagnostics")) {
        let selectedSite = siteA;
        try {
          const parsed = new URL(u, "http://localhost");
          const q = String(parsed.searchParams.get("site_public_id") || "").trim();
          if (q === siteB) selectedSite = siteB;
          else if (q === siteA) selectedSite = siteA;
        } catch {
          selectedSite = u.includes(siteB) ? siteB : siteA;
        }
        const status = selectedSite === siteB ? "active" : "draft";
        return Promise.resolve({
          ok: true,
          json: async () => ({
            integration_status: "healthy",
            site_status: status,
            site_public_id: selectedSite,
            connection_check: { status: status === "active" ? "found" : "not_found", last_seen_at: null },
            integration_warnings: [],
            embed_readiness: { origins_configured: true, publishable_key_present: true, public_id_present: true },
            widget_enabled: true,
          }),
        });
      }
      if (u.includes("/referrals/site/integration/") && !u.includes("diagnostics")) {
        let selectedSite = siteA;
        try {
          const parsed = new URL(u, "http://localhost");
          const q = String(parsed.searchParams.get("site_public_id") || "").trim();
          if (q === siteB) selectedSite = siteB;
          else if (q === siteA) selectedSite = siteA;
        } catch {
          selectedSite = u.includes(siteB) ? siteB : siteA;
        }
        const origin = selectedSite === siteB ? "https://beta.example" : "https://alpha.example";
        const status = selectedSite === siteB ? "active" : "draft";
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: selectedSite,
            allowed_origins: [origin],
            platform_preset: selectedSite === siteB ? "generic" : "tilda",
            status,
            config_json: {},
            widget_enabled: true,
            site_display_name: selectedSite === siteB ? "Beta site" : "Alpha site",
            publishable_key: "pk_test",
            widget_embed_snippet: "<script>stub</script>",
            public_api_base: "https://api.example",
            widget_script_base: "https://app.example",
            project: { id: 501, name: "Shared project", description: "", avatar_data_url: "" },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/501/overview?site_public_id=${siteA}`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
            <Route path="sites/:sitePublicId/dashboard" element={<SiteDashboardPage />} />
            <Route path="sites/:sitePublicId/widget" element={<ProjectSiteManagementScreen />} />
            <Route path="sites/:sitePublicId" element={<SiteShellDefaultToDashboardStub />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-child-sites-list")).toBeInTheDocument();
    });
    expect(screen.getByTestId(`project-child-site-${siteA}`)).toHaveTextContent("текущий");
    expect(screen.getByTestId(`project-child-site-${siteB}`)).toHaveTextContent("beta.example");

    await userEvent.click(screen.getByTestId(`project-child-site-${siteB}`));

    await waitFor(() => {
      expect(screen.getByText(/Статистика за/i)).toBeInTheDocument();
    });
  });

  it("hides shell header and tabs on project info page", async () => {
    const siteA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 501,
                name: "Shared project",
                sites: [
                  makeSite({
                    public_id: siteA,
                    project_id: 501,
                    status: "draft",
                    primary_origin: "https://alpha.example",
                    project: { name: "Shared project", description: "" },
                  }),
                ],
              }),
            ]),
        });
      }
      if (u.includes("/referrals/site/integration/") && !u.includes("diagnostics")) {
        if (opts?.method === "PATCH") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              public_id: siteA,
              allowed_origins: ["https://alpha.example"],
              project: { id: 501, name: "Shared project", description: "", avatar_data_url: "" },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteA,
            allowed_origins: ["https://alpha.example"],
            platform_preset: "tilda",
            status: "draft",
            config_json: {},
            widget_enabled: true,
            project: { id: 501, name: "Shared project", description: "", avatar_data_url: "" },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/501/info?site_public_id=${siteA}`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="info" element={<ProjectInfoPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-info-page")).toBeInTheDocument();
    });
    expect(screen.queryByText("Комментарий к проекту не указан")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Разделы проекта" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-create-menu-trigger")).not.toBeInTheDocument();
  });

  it("returns to project overview after saving project info", async () => {
    const siteA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    let currentProjectName = "Shared project";
    let currentProjectDescription = "old comment";
    jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 501,
                name: currentProjectName,
                description: currentProjectDescription,
                sites: [
                  makeSite({
                    public_id: siteA,
                    project_id: 501,
                    status: "draft",
                    primary_origin: "https://alpha.example",
                    project: { name: currentProjectName, description: currentProjectDescription },
                  }),
                ],
              }),
            ]),
        });
      }
      if (u.includes("/referrals/project/501/")) {
        if (opts?.method === "PATCH") {
          currentProjectName = "Updated project";
          currentProjectDescription = "new comment";
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 501,
              project: { id: 501, name: currentProjectName, description: currentProjectDescription, avatar_data_url: "" },
              primary_site_public_id: siteA,
              sites_count: 1,
              sites: [
                makeSite({
                  public_id: siteA,
                  project_id: 501,
                  status: "draft",
                  primary_origin: "https://alpha.example",
                  project: { name: currentProjectName, description: currentProjectDescription },
                }),
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 501,
            project: { id: 501, name: currentProjectName, description: currentProjectDescription, avatar_data_url: "" },
            primary_site_public_id: siteA,
            sites_count: 1,
            sites: [
              makeSite({
                public_id: siteA,
                project_id: 501,
                status: "draft",
                primary_origin: "https://alpha.example",
                project: { name: currentProjectName, description: currentProjectDescription },
              }),
            ],
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/501/info?site_public_id=${siteA}`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="info" element={<ProjectInfoPage />} />
            <Route path="overview" element={<ProjectOverviewPage />} />
            <Route path="sites" element={<ProjectOverviewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-info-page")).toBeInTheDocument();
    });

    await userEvent.clear(screen.getByRole("textbox", { name: "Название" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Название" }), "Updated project");
    await userEvent.clear(screen.getByRole("textbox", { name: "Комментарий" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Комментарий" }), "new comment");
    await userEvent.click(screen.getByTestId("submit-form-btn"));

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Updated project" })).toBeInTheDocument();
    });
    expect(screen.getByText("new comment")).toBeInTheDocument();
  });

  it("shows users tab for project and loads members from primary site", async () => {
    const siteA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 501,
                name: "Shared project",
                sites: [makeSite({ public_id: siteA, project_id: 501, primary_origin: "https://alpha.example", project: { name: "Shared project" } })],
              }),
            ]),
        });
      }
      if (u.includes("/referrals/site/integration/members/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            count: 1,
            members: [{ identity_masked: "u***@example.com", joined_at: "2026-01-10T12:00:00Z", ref_code: "ABC" }],
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner/project/501/members"]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
            <Route path="members" element={<ProjectMembersPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Пользователи" })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("members-list")).toBeInTheDocument();
    });
    expect(screen.getByText(/ABC/)).toBeInTheDocument();
  });

  it("shows empty users state for project without sites", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 502,
                name: "Empty project",
                sites: [],
              }),
            ]),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner/project/502/members"]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
            <Route path="members" element={<ProjectMembersPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("members-empty")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Пользователи" })).toBeInTheDocument();
    expect(screen.getByText(/У вас нет добавленных пользователей/i)).toBeInTheDocument();
    expect(screen.getByTestId("members-add-button")).toHaveTextContent("Добавить");
  });

  it("hides shell chrome while create-site form is open", async () => {
    const siteA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 501,
                name: "Shared project",
                sites: [makeSite({ public_id: siteA, project_id: 501, status: "draft", primary_origin: "https://alpha.example", project: { name: "Shared project" } })],
              }),
            ]),
        });
      }
      if (u.includes("/referrals/site/integration/") && !u.includes("diagnostics")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteA,
            allowed_origins: ["https://alpha.example"],
            platform_preset: "tilda",
            status: "draft",
            config_json: {},
            widget_enabled: true,
            project: { id: 501, name: "Shared project", description: "", avatar_data_url: "" },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/501/overview?site_public_id=${siteA}`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
            <Route path="sites" element={<ProjectOverviewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-create-menu-trigger")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("project-create-menu-trigger"));
    await userEvent.click(screen.getByTestId("project-create-menu-site"));
    expect(screen.getByTestId("project-add-site-origin")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Разделы проекта" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-create-menu-trigger")).not.toBeInTheDocument();
  });

  it("creates site and opens project-scoped focused connect screen", async () => {
    const siteA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const siteB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const widgetSnippet =
      '<script src="https://app.example/widgets/referral-widget.v1.js"\n' +
      '  data-rs-api="https://api.example"\n' +
      `  data-rs-site="${siteB}"\n` +
      '  data-rs-key="pk_site_b"\n' +
      "  async></script>";
    jest.spyOn(global, "fetch").mockImplementation((url, opts = {}) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 501,
                name: "Shared project",
                sites: [
                  makeSite({ public_id: siteA, project_id: 501, status: "draft", primary_origin: "https://alpha.example", project: { name: "Shared project" } }),
                  makeSite({ public_id: siteB, project_id: 501, status: "draft", primary_origin: "https://beta.example", display_name: "Landing beta", project: { name: "Shared project" } }),
                ],
              }),
            ]),
        });
      }
      if (u.includes("/referrals/project/501/site/create/") && opts.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteB,
            allowed_origins: ["https://beta.example"],
            platform_preset: "generic",
            status: "draft",
            site_display_name: "Landing beta",
            config_json: { site_display_name: "Landing beta" },
            widget_enabled: true,
            project: { id: 501, name: "Shared project", description: "", avatar_data_url: "" },
          }),
        });
      }
      if (u.includes("/referrals/site/integration/") && !u.includes("diagnostics")) {
        let selectedSite = siteA;
        try {
          const parsed = new URL(u, "http://localhost");
          const q = String(parsed.searchParams.get("site_public_id") || "").trim();
          if (q === siteB) selectedSite = siteB;
          else if (q === siteA) selectedSite = siteA;
        } catch {
          selectedSite = u.includes(siteB) ? siteB : siteA;
        }
        const origin = selectedSite === siteB ? "https://beta.example" : "https://alpha.example";
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: selectedSite,
            allowed_origins: [origin],
            platform_preset: selectedSite === siteB ? "generic" : "tilda",
            status: "draft",
            site_display_name: selectedSite === siteB ? "Landing beta" : "Shared project",
            capture_config: {
              required_fields: ["ref", "page_url", "form_id"],
              recommended_fields: ["name", "email", "phone"],
              enabled_optional_fields: ["name", "email", "phone", "amount", "currency", "product_name"],
            },
            config_json: {},
            widget_enabled: true,
            widget_embed_snippet:
              selectedSite === siteB
                ? widgetSnippet
                : '<script src="https://app.example/widgets/referral-widget.v1.js" data-rs-site="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"></script>',
            project: { id: 501, name: "Shared project", description: "", avatar_data_url: "" },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/501/overview?site_public_id=${siteA}`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
            <Route path="sites" element={<ProjectOverviewPage />} />
            <Route path="widget" element={<ProjectWidgetInstallScreen />} />
          </Route>
          <Route path="/lk/widget-install" element={<WidgetInstallScreen />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-create-menu-trigger")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("project-create-menu-trigger"));
    await userEvent.click(screen.getByTestId("project-create-menu-site"));
    await userEvent.type(screen.getByTestId("project-add-site-name"), "Landing beta");
    expect(screen.queryByRole("navigation", { name: "Разделы проекта" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-create-menu-trigger")).not.toBeInTheDocument();
    await userEvent.type(screen.getByTestId("project-add-site-origin"), "https://beta.example");
    await userEvent.click(screen.getByTestId("project-add-site-platform"));
    await userEvent.click(screen.getByRole("option", { name: "Generic" }));
    await userEvent.click(screen.getByTestId("project-add-site-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("project-site-connect-page")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Подключите сайт" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Скопировать код" })).toBeInTheDocument();
    });
    const snippetAfterCreate = screen.getByTestId("widget-install-snippet-block");
    expect(snippetAfterCreate).toHaveTextContent(siteB);
    expect(snippetAfterCreate).toHaveTextContent("pk_site_b");
    expect(screen.getByRole("heading", { name: "Видеоинструкция" })).toBeInTheDocument();
    expect(screen.getByTestId("project-site-connect-back")).toHaveAttribute("href", "/lk/partner/project/501");
    expect(screen.queryByRole("navigation", { name: "Разделы проекта" })).not.toBeInTheDocument();
    expect(screen.queryByText("Shared project")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-services-page")).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/referrals/project/501/site/create/"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          site_display_name: "Landing beta",
          origin: "https://beta.example",
          platform_preset: "generic",
        }),
      }),
    );
  });

  it("creates first site and opens the same focused connect screen inside project shell", async () => {
    const siteA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const widgetSnippet =
      '<script src="https://app.example/widgets/referral-widget.v1.js"\n' +
      '  data-rs-api="https://api.example"\n' +
      `  data-rs-site="${siteA}"\n` +
      '  data-rs-key="pk_site_a"\n' +
      "  async></script>";
    let ownerSitesCalls = 0;
    jest.spyOn(global, "fetch").mockImplementation((url, opts = {}) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        ownerSitesCalls += 1;
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 502,
                name: "Empty project",
                sites:
                  ownerSitesCalls === 1
                    ? []
                    : [makeSite({ public_id: siteA, project_id: 502, status: "draft", primary_origin: "https://alpha.example", project: { name: "Empty project" } })],
              }),
            ]),
        });
      }
      if (u.includes("/referrals/project/502/site/create/") && opts.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteA,
            site_display_name: "Landing alpha",
          }),
        });
      }
      if (u.includes("/referrals/site/integration/") && !u.includes("diagnostics")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteA,
            allowed_origins: ["https://alpha.example"],
            platform_preset: "tilda",
            status: "draft",
            site_display_name: "Landing alpha",
            capture_config: {
              required_fields: ["ref", "page_url", "form_id"],
              recommended_fields: ["name", "email", "phone"],
              enabled_optional_fields: ["name", "email", "phone"],
            },
            config_json: {},
            widget_enabled: true,
            widget_embed_snippet: widgetSnippet,
            project: { id: 502, name: "Empty project", description: "", avatar_data_url: "" },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={["/lk/partner/project/502/overview"]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
            <Route path="sites" element={<ProjectOverviewPage />} />
            <Route path="widget" element={<ProjectWidgetInstallScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-create-menu-trigger")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("project-create-menu-trigger"));
    await userEvent.click(screen.getByTestId("project-create-menu-site"));
    await userEvent.type(screen.getByTestId("project-add-site-name"), "Landing alpha");
    await userEvent.type(screen.getByTestId("project-add-site-origin"), "https://alpha.example");
    await userEvent.click(screen.getByTestId("project-add-site-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("project-site-connect-page")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Подключите сайт" })).toBeInTheDocument();
    expect(screen.getByTestId("widget-install-snippet-block")).toHaveTextContent(siteA);
    expect(screen.getByRole("button", { name: "Скопировать код" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Видеоинструкция" })).toBeInTheDocument();
    expect(screen.getByTestId("project-site-connect-back")).toHaveAttribute("href", "/lk/partner/project/502");
    expect(screen.queryByRole("navigation", { name: "Разделы проекта" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-services-page")).not.toBeInTheDocument();
  });

  it("removes site card immediately while delete is in progress", async () => {
    const siteA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const siteB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    let ownerSitesCalls = 0;
    let resolveDeleteRequest;
    const deleteRequest = new Promise((resolve) => {
      resolveDeleteRequest = resolve;
    });
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        ownerSitesCalls += 1;
        const projects =
          ownerSitesCalls === 1
            ? [
                makeProject({
                  id: 501,
                  name: "Shared project",
                  sites: [
                    makeSite({ public_id: siteA, project_id: 501, status: "draft", primary_origin: "https://alpha.example", project: { name: "Shared project" } }),
                    makeSite({ public_id: siteB, project_id: 501, status: "active", primary_origin: "https://beta.ru", project: { name: "Shared project" }, platform_preset: "generic" }),
                  ],
                }),
              ]
            : [
                makeProject({
                  id: 501,
                  name: "Shared project",
                  sites: [makeSite({ public_id: siteA, project_id: 501, status: "draft", primary_origin: "https://alpha.example", project: { name: "Shared project" } })],
                }),
              ];
        return Promise.resolve({ ok: true, json: async () => makeOwnerProjectsPayload(projects) });
      }
      if (u.includes("/referrals/project/501/site/create/") && opts?.method === "DELETE") {
        return deleteRequest;
      }
      if (u.includes("/referrals/site/integration/") && !u.includes("diagnostics")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteA,
            allowed_origins: ["https://alpha.example"],
            platform_preset: "tilda",
            status: "draft",
            config_json: {},
            widget_enabled: true,
            project: { id: 501, name: "Shared project", description: "", avatar_data_url: "" },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    jest.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/501/overview?site_public_id=${siteA}`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId(`project-child-site-${siteB}`)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId(`project-child-site-menu-trigger-${siteB}`));
    await userEvent.click(screen.getByTestId(`project-child-site-delete-${siteB}`));

    await waitFor(() => {
      expect(screen.queryByTestId(`project-child-site-${siteB}`)).not.toBeInTheDocument();
    });
    expect(screen.getByText("Сайтов: 1")).toBeInTheDocument();

    resolveDeleteRequest({
      ok: true,
      json: async () => ({ status: "deleted" }),
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/referrals/project/501/site/create/"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId(`project-child-site-${siteB}`)).not.toBeInTheDocument();
    });
  });

  it("removes current single site without page refresh", async () => {
    const siteA = "0f002d23-37f0-46c3-a797-a3d2fb34ce94";
    let ownerSitesCalls = 0;
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        ownerSitesCalls += 1;
        const projects =
          ownerSitesCalls === 1
            ? [
                makeProject({
                  id: 701,
                  name: "Тест project",
                  sites: [
                    makeSite({
                      public_id: siteA,
                      project_id: 701,
                      status: "draft",
                      primary_origin: "https://project17993236.tilda.ws",
                      project: { name: "Тест project" },
                    }),
                  ],
                }),
              ]
            : [makeProject({ id: 701, name: "Тест project", sites: [] })];
        return Promise.resolve({ ok: true, json: async () => makeOwnerProjectsPayload(projects) });
      }
      if (u.includes("/referrals/project/701/site/create/") && opts?.method === "DELETE") {
        return Promise.resolve({ ok: true, json: async () => ({ status: "deleted" }) });
      }
      if (u.includes("/referrals/site/integration/") && !u.includes("diagnostics")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteA,
            allowed_origins: ["https://project17993236.tilda.ws"],
            platform_preset: "tilda",
            status: "draft",
            config_json: {},
            widget_enabled: true,
            project: { id: 701, name: "Тест project", description: "", avatar_data_url: "" },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    jest.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/701/overview?site_public_id=${siteA}`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId(`project-child-site-${siteA}`)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId(`project-child-site-menu-trigger-${siteA}`));
    await userEvent.click(screen.getByTestId(`project-child-site-delete-${siteA}`));

    await waitFor(() => {
      expect(screen.queryByTestId(`project-child-site-${siteA}`)).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("project-services-empty")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/referrals/project/701/site/create/"),
      expect.objectContaining({ method: "DELETE" }),
    );
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
      <MemoryRouter initialEntries={[`/lk/partner/project/1/members`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<ProjectStubLayout primarySitePublicId={siteId} projectId={1} />}>
            <Route path="members" element={<ProjectMembersPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("members-empty")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Пользователи" })).toBeInTheDocument();
    expect(screen.getByText(/У вас нет добавленных пользователей/i)).toBeInTheDocument();
    expect(screen.getByTestId("members-add-button")).toHaveTextContent("Добавить");
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
      <MemoryRouter initialEntries={[`/lk/partner/project/1/members`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<ProjectStubLayout primarySitePublicId={siteId} projectId={1} />}>
            <Route path="members" element={<ProjectMembersPage />} />
          </Route>
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
      <MemoryRouter initialEntries={[`/lk/partner/project/1/members`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<ProjectStubLayout primarySitePublicId={siteId} projectId={1} />}>
            <Route path="members" element={<ProjectMembersPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("site_missing")).toBeInTheDocument();
    });
  });

  it("shows error when members request fails with machine code only", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ code: "site_missing" }),
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/1/members`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<ProjectStubLayout primarySitePublicId={siteId} projectId={1} />}>
            <Route path="members" element={<ProjectMembersPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("site_missing")).toBeInTheDocument();
    });
  });

  it("prefers machine code over detail when both are present", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ code: "site_missing", detail: "legacy_detail_only" }),
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/1/members`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<ProjectStubLayout primarySitePublicId={siteId} projectId={1} />}>
            <Route path="members" element={<ProjectMembersPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("site_missing")).toBeInTheDocument();
    });
    expect(screen.queryByText("legacy_detail_only")).not.toBeInTheDocument();
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

  it("loads settings under canonical project route with selected site query", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeOwnerProjectsPayload([
              makeProject({
                id: 601,
                name: "Canonical project",
                sites: [makeSite({ public_id: siteId, project_id: 601, primary_origin: "https://shop.example", project: { name: "Canonical project" } })],
              }),
            ]),
        });
      }
      if (u.includes("/referrals/site/integration/") && (!opts || !opts.method || opts.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteId,
            allowed_origins: ["https://shop.example"],
            platform_preset: "tilda",
            site_display_name: "Canonical site",
            site_description: "Описание сайта",
            project: { id: 601, name: "Canonical project", description: "Описание", avatar_data_url: "" },
            config_json: { display_name: "legacy" },
            widget_enabled: true,
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/601/settings?site_public_id=${siteId}`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="settings" element={<ProjectSettingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-settings-form")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`site_public_id=${siteId}`),
      expect.objectContaining({ method: "GET" }),
    );
  });

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
            site_display_name: "Магазин",
            site_description: "Описание",
            project: { name: "Магазин", description: "Описание", avatar_data_url: "" },
            config_json: { display_name: "legacy" },
            widget_enabled: true,
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/1/settings`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<ProjectStubLayout primarySitePublicId={siteId} projectId={1} />}>
            <Route path="settings" element={<ProjectSettingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-settings-form")).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Название сайта/i)).toHaveValue("Магазин");
    expect(screen.getByLabelText(/Описание сайта/i)).toHaveValue("Описание");
    expect(screen.getByLabelText(/Домен или origin/i)).toHaveValue("https://shop.example");
    expect(screen.getByTestId("proj-settings-platform-select")).toHaveTextContent("Tilda");
  });

  it("save sends PATCH and shows success", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/") && (!opts || !opts.method || opts.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteId,
            allowed_origins: ["https://a.example"],
            platform_preset: "tilda",
            site_display_name: "A",
            site_description: "Old desc",
            project: { name: "A", description: "Old desc", avatar_data_url: "" },
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
            site_display_name: "B",
            site_description: "New desc",
            project: { name: "A", description: "Old desc", avatar_data_url: "" },
            config_json: { display_name: "A", description: "Old desc" },
            widget_enabled: true,
          }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/1/settings`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<ProjectStubLayout primarySitePublicId={siteId} projectId={1} />}>
            <Route path="settings" element={<ProjectSettingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-settings-form")).toBeInTheDocument();
    });
    await userEvent.clear(screen.getByLabelText(/Название сайта/i));
    await userEvent.type(screen.getByLabelText(/Название сайта/i), "B");
    await userEvent.clear(screen.getByLabelText(/Описание сайта/i));
    await userEvent.type(screen.getByLabelText(/Описание сайта/i), "New desc");
    await userEvent.clear(screen.getByLabelText(/Домен или origin/i));
    await userEvent.type(screen.getByLabelText(/Домен или origin/i), "https://b.example");
    await userEvent.click(screen.getByTestId("proj-settings-platform-select"));
    await userEvent.click(await screen.findByRole("option", { name: "Generic" }));
    await userEvent.click(screen.getByRole("button", { name: /Сохранить/i }));

    await waitFor(() => {
      expect(screen.getByTestId("settings-save-success")).toBeInTheDocument();
    });
    const patchCall = fetchMock.mock.calls.find(([, opts]) => opts?.method === "PATCH");
    expect(JSON.parse(patchCall[1].body)).toEqual({
      site_display_name: "B",
      site_description: "New desc",
      origin: "https://b.example",
      platform_preset: "generic",
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
            project: { name: "", description: "", avatar_data_url: "" },
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
      <MemoryRouter initialEntries={[`/lk/partner/project/1/settings`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<ProjectStubLayout primarySitePublicId={siteId} projectId={1} />}>
            <Route path="settings" element={<ProjectSettingsPage />} />
          </Route>
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

  it("shows error when save fails with machine code only", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url, opts) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/") && (!opts || !opts.method || opts.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteId,
            allowed_origins: ["https://a.example"],
            platform_preset: "tilda",
            project: { name: "", description: "", avatar_data_url: "" },
            config_json: {},
            widget_enabled: true,
          }),
        });
      }
      if (u.includes("/referrals/site/integration/") && opts?.method === "PATCH") {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ code: "bad_payload" }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/1/settings`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<ProjectStubLayout primarySitePublicId={siteId} projectId={1} />}>
            <Route path="settings" element={<ProjectSettingsPage />} />
          </Route>
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

});

describe("Canonical site identity contract", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  // --- Helpers ----------------------------------------------------------------
  const projectId = 901;
  const siteFromPath = "11111111-1111-1111-1111-111111111111";
  const siteFromQuery = "22222222-2222-2222-2222-222222222222";
  const primarySite = "33333333-3333-3333-3333-333333333333";
  const firstSite = "44444444-4444-4444-4444-444444444444";

  function mockOwnerAndIntegration({ owner, byId, defaultIntegration, pageScan }) {
    return jest.spyOn(global, "fetch").mockImplementation((url, opts = {}) => {
      const u = String(url);
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({ ok: true, json: async () => owner });
      }
      if (u.includes("/referrals/site/page-scan/")) {
        if (typeof pageScan === "function") {
          return Promise.resolve(pageScan(url, opts));
        }
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
      }
      if (u.includes("/referrals/site/integration/analytics/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            series: { by_day: [] },
            funnel: {},
            kpis: {},
            recent_sales: [],
          }),
        });
      }
      if (u.includes("/referrals/site/integration/") && u.includes("diagnostics")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            integration_status: "healthy",
            connection_check: { status: "not_found", last_seen_at: null },
            integration_warnings: [],
            embed_readiness: { origins_configured: true, publishable_key_present: true, public_id_present: true },
            widget_enabled: true,
          }),
        });
      }
      if (u.includes("/referrals/site/integration/") && !u.includes("diagnostics")) {
        let resolvedSite = "";
        try {
          const parsed = new URL(u, "http://localhost");
          resolvedSite = String(parsed.searchParams.get("site_public_id") || "").trim();
        } catch {
          resolvedSite = "";
        }
        const payload =
          (resolvedSite && byId[resolvedSite]) || defaultIntegration || { public_id: resolvedSite };
        return Promise.resolve({ ok: true, json: async () => payload });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });
  }

  function makeIntegrationPayload(siteId, displayName) {
    return {
      public_id: siteId,
      allowed_origins: [`https://${displayName.replace(/\s+/g, "-").toLowerCase()}.example`],
      platform_preset: "tilda",
      status: "draft",
      site_display_name: displayName,
      config_json: {},
      widget_enabled: true,
      project: { id: projectId, name: "P", description: "", avatar_data_url: "" },
    };
  }

  function makePageScanPayload(blocks, platform = "tilda", { visualVideoCount = 0 } = {}) {
    return {
      url: "https://example.com/page",
      platform,
      visual_import_available: true,
      visual_mode: "screenshot",
      visual_video_count: visualVideoCount,
      blocks,
    };
  }

  function mockLegacyOwnerSiteRedirectIntegration() {
    return jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/") && !u.includes("diagnostics")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteFromPath,
            allowed_origins: ["https://x.example"],
            platform_preset: "tilda",
            project: { id: projectId, name: "P", description: "", avatar_data_url: "" },
            config_json: {},
            widget_enabled: true,
            status: "draft",
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });
  }

  function CanonicalPathProbe() {
    const { pathname, search } = useLocation();
    return (
      <span data-testid="canonical-path-probe">
        {pathname}
        {search}
      </span>
    );
  }

  function UrlSnapshot() {
    const { pathname, search } = useLocation();
    return <span data-testid="url-snapshot">{pathname}{search}</span>;
  }

  it('renders the "Блок для сайта" tab with builder foundation shell', async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Builder site"),
      },
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/sites/${siteFromPath}/referral-block`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="sites/:sitePublicId/referral-block" element={<ProjectReferralBlockScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("referral-builder-canvas")).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "Блок для сайта" })).toBeInTheDocument();
    expect(screen.getByTestId("referral-builder-shell")).toBeInTheDocument();
    expect(screen.getByTestId("referral-builder-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("referral-builder-preview-node")).not.toBeInTheDocument();
    expect(screen.getByLabelText("URL страницы")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Импорт дизайна" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Режим просмотра" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Мобильный 360" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Планшет" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Десктоп" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "На весь экран" })).toBeInTheDocument();
  });

  it("imports screenshot blocks into a single page stack with inline insertion slots", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Builder site"),
      },
      pageScan: () => ({
        ok: true,
        json: async () =>
          makePageScanPayload([
            {
              id: "screenshot-section-1",
              selector: null,
              title: "Секция 1",
              position: 1,
              kind: "screenshot",
              screenshot_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z8n8AAAAASUVORK5CYII=",
              width: 1440,
              height: 720,
            },
            {
              id: "screenshot-section-2",
              selector: null,
              title: "Секция 2",
              position: 2,
              kind: "screenshot",
              screenshot_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z8n8AAAAASUVORK5CYII=",
              width: 1440,
              height: 640,
            },
          ]),
      }),
    });

    const { container } = render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/sites/${siteFromPath}/referral-block`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="sites/:sitePublicId/referral-block" element={<ProjectReferralBlockScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("referral-builder-canvas")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("URL страницы"), "https://example.com/page");
    await userEvent.click(screen.getByRole("button", { name: "Импорт дизайна" }));

    await waitFor(() => {
      expect(screen.getByTestId("imported-page-stack-node")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("referral-builder-blocks-dock")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "На весь экран" }));
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-lk-referral-builder-expanded");
    });

    let pageStack = screen.getByTestId("imported-page-stack-node");
    expect(pageStack).toHaveAttribute("data-preview-mode", "desktop");
    await userEvent.click(screen.getByRole("button", { name: "Мобильный 360" }));
    await waitFor(() => {
      expect(screen.getByTestId("imported-page-stack-node")).toHaveAttribute("data-preview-mode", "mobile");
    });
    await userEvent.click(screen.getByRole("button", { name: "Планшет" }));
    await waitFor(() => {
      expect(screen.getByTestId("imported-page-stack-node")).toHaveAttribute("data-preview-mode", "tablet");
    });
    pageStack = screen.getByTestId("imported-page-stack-node");
    expect(screen.queryByTestId("referral-builder-preview-node")).not.toBeInTheDocument();
    expect(screen.queryByTestId("referral-builder-blocks-dock")).not.toBeInTheDocument();
    expect(screen.queryByTestId("site-scan-block-node")).not.toBeInTheDocument();
    expect(screen.queryByTestId("imported-site-block-node")).not.toBeInTheDocument();
    expect(screen.queryByTestId("screenshot-site-block-node")).not.toBeInTheDocument();
    expect(screen.queryByTestId("referral-insert-slot-node")).not.toBeInTheDocument();
    expect(within(pageStack).getAllByTestId("imported-page-section")).toHaveLength(2);
    const slotNodes = within(pageStack).getAllByTestId("imported-page-insert-slot");
    const slotButtons = slotNodes.map((slotNode) => {
      const btn = slotNode.querySelector("button.imported-page-insert-slot__button");
      if (!btn) {
        throw new Error("insert slot button missing");
      }
      return btn;
    });
    expect(slotButtons).toHaveLength(3);
    const images = within(pageStack).getAllByTestId("imported-page-section-image");
    expect(images[0]).toHaveAttribute("src", expect.stringContaining("data:image/png;base64,"));
    expect(container.querySelector("iframe")).toBeNull();
    fireEvent.click(slotButtons[1]);

    await waitFor(() => {
      const activeBtn = within(pageStack)
        .getAllByTestId("imported-page-insert-slot")[1]
        .querySelector("button.imported-page-insert-slot__button");
      expect(activeBtn).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.getByTestId("referral-builder-blocks-dock")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Выбор блока" })).toBeInTheDocument();

    expect(screen.queryByTestId("referral-builder-preview-node")).not.toBeInTheDocument();
    expect(screen.queryByTestId("referral-builder-inline-preview")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("builder-library-hero"));

    await waitFor(() => {
      expect(within(pageStack).getByTestId("editable-referral-block-preview")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("referral-builder-blocks-dock")).not.toBeInTheDocument();

    const editable = within(pageStack).getByTestId("editable-referral-block-preview");
    expect(editable).toHaveAttribute("data-builder-block-type", "referralHero");
    expect(editable).toHaveAttribute("data-selected", "true");
    expect(within(editable).getByText("Станьте рефералом магазина")).toBeInTheDocument();
    expect(screen.getAllByText("Стать рефералом").length).toBeGreaterThanOrEqual(1);

    const sectionImages = within(pageStack).getAllByTestId("imported-page-section-image");
    sectionImages.forEach((img) => {
      expect(img).not.toHaveAttribute("contenteditable");
    });
  });

  it("renders html5 video overlays on imported screenshot sections", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Builder site"),
      },
      pageScan: () => ({
        ok: true,
        json: async () =>
          makePageScanPayload(
            [
              {
                id: "screenshot-section-1",
                selector: null,
                title: "Секция 1",
                position: 1,
                kind: "screenshot",
                screenshot_data_url:
                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z8n8AAAAASUVORK5CYII=",
                width: 1440,
                height: 720,
                media_overlays: [
                  {
                    type: "video",
                    src: "https://example.com/assets/hero.mp4",
                    poster: "",
                    x_percent: 10,
                    y_percent: 5,
                    width_percent: 80,
                    height_percent: 40,
                    muted: true,
                    autoplay: true,
                    loop: true,
                    plays_inline: true,
                  },
                ],
              },
            ],
            "generic",
            { visualVideoCount: 1 },
          ),
      }),
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/sites/${siteFromPath}/referral-block`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="sites/:sitePublicId/referral-block" element={<ProjectReferralBlockScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("referral-builder-canvas")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("URL страницы"), "https://example.com/page");
    await userEvent.click(screen.getByRole("button", { name: "Импорт дизайна" }));

    await waitFor(() => {
      expect(screen.getByTestId("imported-page-stack-node")).toBeInTheDocument();
    });

    const pageStack = screen.getByTestId("imported-page-stack-node");
    expect(within(pageStack).getByTestId("imported-page-section-image")).toBeInTheDocument();
    const videos = within(pageStack).getAllByTestId("imported-section-video-overlay");
    expect(videos).toHaveLength(1);
    expect(videos[0]).toHaveAttribute("src", "https://example.com/assets/hero.mp4");
    expect(videos[0].muted).toBe(true);
    expect(videos[0].autoplay).toBe(true);
    expect(videos[0].loop).toBe(true);
    expect(videos[0].playsInline).toBe(true);

    await waitFor(() => {
      expect(screen.getByTestId("referral-builder-scan-success")).toHaveTextContent(/найдено 1 видео/);
      expect(screen.getByTestId("referral-builder-scan-success")).toHaveTextContent(
        /Видео проигрываются поверх снимка страницы/,
      );
    });
  });

  it("imported stack exposes section kinds and omits insert slot before header", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Builder site"),
      },
      pageScan: () => ({
        ok: true,
        json: async () =>
          makePageScanPayload(
            [
              {
                id: "hdr",
                selector: null,
                title: "Шапка",
                position: 1,
                kind: "header",
                screenshot_data_url:
                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z8n8AAAAASUVORK5CYII=",
                width: 1440,
                height: 80,
              },
              {
                id: "mid",
                selector: null,
                title: "Контент",
                position: 2,
                kind: "screenshot",
                screenshot_data_url:
                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z8n8AAAAASUVORK5CYII=",
                width: 1440,
                height: 400,
              },
              {
                id: "ftr",
                selector: null,
                title: "Подвал",
                position: 3,
                kind: "footer",
                screenshot_data_url:
                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z8n8AAAAASUVORK5CYII=",
                width: 1440,
                height: 120,
              },
            ],
            "generic",
            { visualVideoCount: 0 },
          ),
      }),
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/sites/${siteFromPath}/referral-block`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="sites/:sitePublicId/referral-block" element={<ProjectReferralBlockScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("referral-builder-canvas")).toBeInTheDocument();
    });
    await userEvent.type(screen.getByLabelText("URL страницы"), "https://example.com/page");
    await userEvent.click(screen.getByRole("button", { name: "Импорт дизайна" }));

    await waitFor(() => {
      expect(screen.getByTestId("imported-page-stack-node")).toBeInTheDocument();
    });

    const pageStack = screen.getByTestId("imported-page-stack-node");
    const sections = within(pageStack).getAllByTestId("imported-page-section");
    expect(sections).toHaveLength(3);
    expect(sections[0]).toHaveAttribute("data-section-kind", "header");
    expect(sections[1]).toHaveAttribute("data-section-kind", "screenshot");
    expect(sections[2]).toHaveAttribute("data-section-kind", "footer");

    const stackBody = pageStack.querySelector(".imported-page-stack-node__body");
    expect(stackBody).toBeTruthy();
    const firstChild = stackBody.firstElementChild;
    expect(firstChild?.getAttribute("data-testid")).toBe("imported-page-section");
    const slotButtons = within(pageStack).getAllByTestId("imported-page-insert-slot");
    expect(slotButtons.length).toBeGreaterThanOrEqual(3);
  });

  it("renders layered screenshot with video under foreground text and button", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Builder site"),
      },
      pageScan: () => ({
        ok: true,
        json: async () =>
          makePageScanPayload(
            [
              {
                id: "screenshot-section-1",
                selector: null,
                title: "Секция 1",
                position: 1,
                kind: "screenshot",
                screenshot_data_url:
                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z8n8AAAAASUVORK5CYII=",
                width: 1440,
                height: 720,
                media_overlays: [
                  {
                    type: "video",
                    src: "https://example.com/assets/hero.mp4",
                    poster: "",
                    x: 0,
                    y: 0,
                    width: 1440,
                    height: 720,
                    x_percent: 0,
                    y_percent: 0,
                    width_percent: 100,
                    height_percent: 100,
                    muted: true,
                    autoplay: true,
                    loop: true,
                    plays_inline: true,
                  },
                ],
                foreground_overlays: [
                  {
                    type: "text",
                    text: "RECENT LAUNCH",
                    href: "",
                    x: 115,
                    y: 446,
                    width: 576,
                    height: 58,
                    x_percent: 8,
                    y_percent: 62,
                    width_percent: 40,
                    height_percent: 8,
                    style: { color: "rgb(255,255,255)", font_size: "14px" },
                  },
                  {
                    type: "button",
                    text: "REWATCH",
                    href: "",
                    x: 115,
                    y: 562,
                    width: 173,
                    height: 43,
                    x_percent: 8,
                    y_percent: 78,
                    width_percent: 12,
                    height_percent: 6,
                    style: { background_color: "rgb(0,0,0)", border_radius: "4px" },
                  },
                ],
              },
            ],
            "generic",
            { visualVideoCount: 1 },
          ),
      }),
    });

    const { container } = render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/sites/${siteFromPath}/referral-block`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="sites/:sitePublicId/referral-block" element={<ProjectReferralBlockScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("referral-builder-canvas")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("URL страницы"), "https://example.com/page");
    await userEvent.click(screen.getByRole("button", { name: "Импорт дизайна" }));

    await waitFor(() => {
      expect(screen.getByTestId("imported-page-stack-node")).toBeInTheDocument();
    });

    const pageStack = screen.getByTestId("imported-page-stack-node");
    expect(within(pageStack).getByTestId("imported-page-section-image")).toBeInTheDocument();
    const videos = within(pageStack).getAllByTestId("imported-section-video-overlay");
    expect(videos).toHaveLength(1);
    expect(videos[0]).toHaveAttribute("src", "https://example.com/assets/hero.mp4");
    expect(videos[0].muted).toBe(true);
    expect(videos[0].autoplay).toBe(true);
    expect(videos[0].loop).toBe(true);
    expect(videos[0].playsInline).toBe(true);

    const fgText = within(pageStack).getByTestId("imported-section-foreground-text");
    expect(fgText).toHaveTextContent("RECENT LAUNCH");
    expect(fgText).toHaveStyle({ background: "transparent" });

    const cropImages = within(pageStack).getAllByTestId("imported-section-foreground-crop-image");
    expect(cropImages).toHaveLength(1);
    const sectionImg = within(pageStack).getByTestId("imported-page-section-image");
    expect(cropImages[0]).toHaveAttribute("src", sectionImg.getAttribute("src"));
    expect(cropImages[0].style.transform).toMatch(/translate\(-111px,\s*-558px\)/);

    const fg = within(pageStack).getByTestId("imported-section-foreground-crop");
    expect(fg).toHaveAttribute("data-foreground-type", "button");
    expect(fg).toHaveClass("owner-programs__imported-section-foreground-crop--button");

    const overlayLayer = within(pageStack).getByTestId("imported-screenshot-overlay-layer");
    expect(overlayLayer.getAttribute("style") || "").toMatch(/width:\s*1440px/);
    expect(overlayLayer.getAttribute("style") || "").toMatch(/height:\s*720px/);
    expect(overlayLayer.getAttribute("style") || "").toMatch(/transform:\s*scale\(/);
    expect(overlayLayer.contains(videos[0])).toBe(true);
    expect(overlayLayer.contains(fgText)).toBe(true);

    expect(videos[0].style.width).toBe("1442px");
    expect(videos[0].style.left).toBe("0px");
    expect(videos[0].style.left).not.toContain("%");

    expect(fgText.style.left).toBe("115px");
    expect(fgText.style.width).toBe("576px");
    expect(fg.style.left).toBe("111px");
    expect(fg.style.width).toBe("181px");

    const sectionRoot = container.querySelector(".owner-programs__imported-screenshot-section");
    expect(sectionRoot).toBeTruthy();
    const children = Array.from(sectionRoot.children);
    const imgIdx = children.findIndex((el) => el.matches("img"));
    const layerIdx = children.findIndex((el) => el.getAttribute("data-testid") === "imported-screenshot-overlay-layer");
    expect(imgIdx).toBeGreaterThanOrEqual(0);
    expect(layerIdx).toBeGreaterThan(imgIdx);
    expect(videos[0]).toHaveStyle({ zIndex: "1" });
  });

  it("builder blocks: selecting block, inspector title, and delete", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Builder site"),
      },
      pageScan: () => ({
        ok: true,
        json: async () =>
          makePageScanPayload([
            {
              id: "screenshot-section-1",
              selector: null,
              title: "Секция 1",
              position: 1,
              kind: "screenshot",
              screenshot_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z8n8AAAAASUVORK5CYII=",
              width: 1440,
              height: 720,
            },
          ]),
      }),
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/sites/${siteFromPath}/referral-block`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="sites/:sitePublicId/referral-block" element={<ProjectReferralBlockScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("referral-builder-canvas")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("URL страницы"), "https://example.com/page");
    await userEvent.click(screen.getByRole("button", { name: "Импорт дизайна" }));

    await waitFor(() => {
      expect(screen.getByTestId("imported-page-stack-node")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "На весь экран" }));
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-lk-referral-builder-expanded");
    });

    const pageStack = screen.getByTestId("imported-page-stack-node");
    fireEvent.click(within(pageStack).getAllByTestId("imported-page-insert-slot")[0].querySelector("button"));
    fireEvent.click(screen.getByTestId("builder-library-hero"));

    await waitFor(() => {
      expect(within(pageStack).getByTestId("editable-referral-block-preview")).toBeInTheDocument();
    });

    const blockEl = within(pageStack).getByTestId("editable-referral-block-preview");
    expect(blockEl).toHaveClass("is-selected");

    fireEvent.click(blockEl);
    expect(blockEl).toHaveAttribute("data-selected", "true");

    const titleInput = screen.getByTestId("builder-inspector-title");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Заголовок из инспектора");

    await waitFor(() => {
      expect(within(blockEl).getByText("Заголовок из инспектора")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("builder-inspector-delete"));

    await waitFor(() => {
      expect(within(pageStack).queryByTestId("editable-referral-block-preview")).not.toBeInTheDocument();
    });
  });

  it("deletes the selected imported screenshot block on Delete", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Builder site"),
      },
      pageScan: () => ({
        ok: true,
        json: async () =>
          makePageScanPayload([
            {
              id: "screenshot-section-1",
              selector: null,
              title: "Секция 1",
              position: 1,
              kind: "screenshot",
              screenshot_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z8n8AAAAASUVORK5CYII=",
              width: 1440,
              height: 720,
            },
            {
              id: "screenshot-section-2",
              selector: null,
              title: "Секция 2",
              position: 2,
              kind: "screenshot",
              screenshot_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z8n8AAAAASUVORK5CYII=",
              width: 1440,
              height: 640,
            },
          ]),
      }),
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/sites/${siteFromPath}/referral-block`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="sites/:sitePublicId/referral-block" element={<ProjectReferralBlockScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("referral-builder-canvas")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("URL страницы"), "https://example.com/page");
    await userEvent.click(screen.getByRole("button", { name: "Импорт дизайна" }));

    await waitFor(() => {
      expect(screen.getByTestId("imported-page-stack-node")).toBeInTheDocument();
    });

    const pageStack = screen.getByTestId("imported-page-stack-node");
    const sectionsBeforeDelete = within(pageStack).getAllByTestId("imported-page-section");
    expect(sectionsBeforeDelete).toHaveLength(2);

    fireEvent.click(sectionsBeforeDelete[0]);
    fireEvent.keyDown(window, { key: "Delete" });

    await waitFor(() => {
      expect(within(pageStack).getAllByTestId("imported-page-section")).toHaveLength(1);
    });

    expect(within(pageStack).getAllByTestId("imported-page-insert-slot")).toHaveLength(2);
  });

  it("shows explicit warning when visual import is unavailable and falls back to section map", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Builder site"),
      },
      pageScan: () => ({
        ok: true,
        json: async () => ({
          url: "https://example.com/page",
          platform: "tilda",
          visual_import_available: false,
          detail: "Visual import is not available on this server",
          blocks: [
            {
              id: "rec123456789",
              selector: "#rec123456789",
              title: "Блок 1",
              preview_text: "Текстовая карта секции",
              position: 1,
              kind: "hero",
            },
          ],
        }),
      }),
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/sites/${siteFromPath}/referral-block`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="sites/:sitePublicId/referral-block" element={<ProjectReferralBlockScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("referral-builder-canvas")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("URL страницы"), "https://example.com/page");
    await userEvent.click(screen.getByRole("button", { name: "Импорт дизайна" }));

    await waitFor(() => {
      expect(screen.getByTestId("site-scan-block-node")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("imported-site-block-node")).not.toBeInTheDocument();
    expect(screen.queryByTestId("screenshot-site-block-node")).not.toBeInTheDocument();
    expect(screen.getByTestId("referral-builder-preview-node")).toBeInTheDocument();
  });

  it("shows a friendly scan error without the referral preview placeholder", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Builder site"),
      },
      pageScan: () => ({
        ok: false,
        status: 400,
        json: async () => ({ detail: "Не удалось просканировать страницу" }),
      }),
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/sites/${siteFromPath}/referral-block`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="sites/:sitePublicId/referral-block" element={<ProjectReferralBlockScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("referral-builder-canvas")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("URL страницы"), "https://bad.example/page");
    await userEvent.click(screen.getByRole("button", { name: "Импорт дизайна" }));

    await waitFor(() => {
      expect(screen.getByText("Не удалось просканировать страницу")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("referral-builder-preview-node")).not.toBeInTheDocument();
  });

  it("shows backend scan detail when it is available", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Builder site"),
      },
      pageScan: () => ({
        ok: false,
        status: 400,
        json: async () => ({ detail: "Разрешены только адреса с http:// или https://." }),
      }),
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/sites/${siteFromPath}/referral-block`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="sites/:sitePublicId/referral-block" element={<ProjectReferralBlockScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("referral-builder-canvas")).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("URL страницы"), "example.com/page");
    await userEvent.click(screen.getByRole("button", { name: "Импорт дизайна" }));

    await waitFor(() => {
      expect(screen.getByText("Разрешены только адреса с http:// или https://.")).toBeInTheDocument();
    });
  });

  // --- 1. Direct open of canonical route renders exactly that site -----------
  it("canonical route renders exactly :sitePublicId from path", async () => {
    const fetchMock = mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [
            makeSite({ public_id: primarySite, project_id: projectId, project: { name: "P" } }),
            makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } }),
          ],
        }),
      ]),
      byId: {
        [primarySite]: makeIntegrationPayload(primarySite, "Primary site"),
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Path site"),
      },
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/sites/${siteFromPath}`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="sites/:sitePublicId/dashboard" element={<SiteDashboardPage />} />
            <Route path="sites/:sitePublicId/widget" element={<ProjectSiteManagementScreen />} />
            <Route path="sites/:sitePublicId" element={<SiteShellDefaultToDashboardStub />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Статистика за/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("project-create-menu-trigger")).not.toBeInTheDocument();

    const analyticsCalls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((u) => u.includes("/referrals/site/integration/analytics/"));
    expect(analyticsCalls.some((u) => u.includes(siteFromPath))).toBe(true);
    expect(analyticsCalls.every((u) => !u.includes(primarySite))).toBe(true);
  });

  // STAB-008 · canonical current-site policy: on `/sites/:sitePublicId/…`, path wins over
  // `?site_public_id=` (strip on mismatch only), no rewrite when values match, project-level
  // routes leave the query unchanged.

  // --- 2. Path beats query: query is ignored on a canonical site route -------
  it("[STAB-008] site-scoped route removes conflicting site_public_id; path wins (no search)", async () => {
    const fetchMock = mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [
            makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } }),
            makeSite({ public_id: siteFromQuery, project_id: projectId, project: { name: "P" } }),
          ],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Path wins"),
        [siteFromQuery]: makeIntegrationPayload(siteFromQuery, "Query loses"),
      },
    });

    render(
      <MemoryRouter
        initialEntries={[
          `/lk/partner/project/${projectId}/sites/${siteFromPath}/dashboard?site_public_id=${siteFromQuery}`,
        ]}
      >
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route
              path="sites/:sitePublicId/dashboard"
              element={
                <>
                  <UrlSnapshot />
                  <SiteDashboardPage />
                </>
              }
            />
            <Route path="sites/:sitePublicId/widget" element={<ProjectSiteManagementScreen />} />
            <Route path="sites/:sitePublicId" element={<SiteShellDefaultToDashboardStub />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Статистика за/i)).toBeInTheDocument();
    });

    await waitFor(() => {
      const snap = screen.getByTestId("url-snapshot").textContent;
      expect(snap).toBe(`/lk/partner/project/${projectId}/sites/${siteFromPath}/dashboard`);
      expect(snap).not.toContain("site_public_id");
    });

    const analyticsCalls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((u) => u.includes("/referrals/site/integration/analytics/"));
    expect(analyticsCalls.some((u) => u.includes(siteFromPath))).toBe(true);
    expect(analyticsCalls.every((u) => !u.includes(siteFromQuery))).toBe(true);
  });

  it("[STAB-008] site-scoped route strips conflicting site_public_id and preserves other query params", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [
            makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } }),
            makeSite({ public_id: siteFromQuery, project_id: projectId, project: { name: "P" } }),
          ],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Path wins"),
        [siteFromQuery]: makeIntegrationPayload(siteFromQuery, "Query loses"),
      },
    });

    render(
      <MemoryRouter
        initialEntries={[
          `/lk/partner/project/${projectId}/sites/${siteFromPath}/dashboard?site_public_id=${siteFromQuery}&keep=1`,
        ]}
      >
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route
              path="sites/:sitePublicId/dashboard"
              element={
                <>
                  <UrlSnapshot />
                  <SiteDashboardPage />
                </>
              }
            />
            <Route path="sites/:sitePublicId/widget" element={<ProjectSiteManagementScreen />} />
            <Route path="sites/:sitePublicId" element={<SiteShellDefaultToDashboardStub />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Статистика за/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      const snap = screen.getByTestId("url-snapshot").textContent;
      expect(snap).toBe(`/lk/partner/project/${projectId}/sites/${siteFromPath}/dashboard?keep=1`);
      expect(snap).not.toContain("site_public_id");
    });
  });

  it("[STAB-008] site-scoped route does not rewrite URL when site_public_id matches path (case-insensitive)", async () => {
    const pathId = siteFromPath;
    const upperQuery = pathId.toUpperCase();
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: pathId, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [pathId]: makeIntegrationPayload(pathId, "Same id"),
      },
    });

    const initial = `/lk/partner/project/${projectId}/sites/${pathId}?site_public_id=${encodeURIComponent(upperQuery)}`;
    const afterIndex = `/lk/partner/project/${projectId}/sites/${pathId}/dashboard`;
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route
              path="sites/:sitePublicId/dashboard"
              element={
                <>
                  <UrlSnapshot />
                  <SiteDashboardPage />
                </>
              }
            />
            <Route path="sites/:sitePublicId/widget" element={<ProjectSiteManagementScreen />} />
            <Route path="sites/:sitePublicId" element={<SiteShellDefaultToDashboardStub />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Статистика за/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("url-snapshot").textContent).toBe(afterIndex);
    });
  });

  it("[STAB-008] project-level route leaves site_public_id and other query params untouched", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Overview site"),
      },
    });

    const initial = `/lk/partner/project/${projectId}/overview?site_public_id=${siteFromPath}&keep=1`;
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="overview" element={<UrlSnapshot />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      const snap = screen.getByTestId("url-snapshot").textContent;
      expect(snap).toBe(initial);
      expect(snap).toContain(`site_public_id=${siteFromPath}`);
      expect(snap).toContain("keep=1");
    });
  });

  // --- 3. Invalid canonical site id never falls back to primary/first --------
  it("invalid :sitePublicId redirects to project sites list, not to primary/first site", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [
            makeSite({ public_id: primarySite, project_id: projectId, project: { name: "P" } }),
            makeSite({ public_id: firstSite, project_id: projectId, project: { name: "P" } }),
          ],
        }),
      ]),
      byId: {
        [primarySite]: makeIntegrationPayload(primarySite, "Primary"),
        [firstSite]: makeIntegrationPayload(firstSite, "First"),
      },
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/sites/not-a-uuid`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="sites" element={<div data-testid="project-sites-list">Sites</div>} />
            <Route path="sites/:sitePublicId/dashboard" element={<SiteDashboardPage />} />
            <Route path="sites/:sitePublicId/widget" element={<ProjectSiteManagementScreen />} />
            <Route path="sites/:sitePublicId" element={<SiteShellDefaultToDashboardStub />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-sites-list")).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "First" })).not.toBeInTheDocument();
  });

  // --- 4. Legacy /project/:projectId/site?site_public_id=... → canonical ----
  it("legacy /project/:projectId/site?site_public_id=... redirects to canonical /sites/:sitePublicId", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: siteFromQuery, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [siteFromQuery]: makeIntegrationPayload(siteFromQuery, "Migrated"),
      },
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/site?site_public_id=${siteFromQuery}`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="site" element={<ProjectSiteManagementScreen legacyTabRoute />} />
            <Route path="sites" element={<div data-testid="project-sites-list">Sites</div>} />
            <Route path="sites/:sitePublicId/dashboard" element={<SiteDashboardPage />} />
            <Route path="sites/:sitePublicId/widget" element={<ProjectSiteManagementScreen />} />
            <Route path="sites/:sitePublicId" element={<SiteShellDefaultToDashboardStub />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("project-site-management-page")).toHaveAttribute("data-site-label", "Migrated");
    });
  });

  // --- 5. Legacy /lk/partner/:sitePublicId/* → canonical project site route --
  it("LegacyOwnerSiteRedirect lands on canonical /project/:projectId/sites/:sitePublicId/dashboard", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/referrals/site/integration/") && !u.includes("diagnostics")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            public_id: siteFromPath,
            allowed_origins: ["https://x.example"],
            platform_preset: "tilda",
            project: { id: projectId, name: "P", description: "", avatar_data_url: "" },
            config_json: {},
            widget_enabled: true,
            status: "draft",
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: "missing" }) });
    });

    render(
      <MemoryRouter initialEntries={[`/lk/partner/${siteFromPath}/overview`]}>
        <Routes>
          <Route path="/lk/partner/:sitePublicId/*" element={<LegacyOwnerSiteRedirect />} />
          <Route
            path="/lk/partner/project/:projectId/sites/:sitePublicId/dashboard"
            element={<div data-testid="canonical-site-landing">canonical</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("canonical-site-landing")).toBeInTheDocument();
    });
  });

  it.each([
    ["overview", `/lk/partner/${siteFromPath}/overview`, `/lk/partner/project/${projectId}/sites/${siteFromPath}/dashboard`],
    [
      "base path (no trailing section)",
      `/lk/partner/${siteFromPath}`,
      `/lk/partner/project/${projectId}/sites/${siteFromPath}/dashboard`,
    ],
    ["members", `/lk/partner/${siteFromPath}/members`, `/lk/partner/project/${projectId}/sites/${siteFromPath}/members`],
    ["settings", `/lk/partner/${siteFromPath}/settings`, `/lk/partner/project/${projectId}/sites/${siteFromPath}/settings`],
    ["widget", `/lk/partner/${siteFromPath}/widget`, `/lk/partner/project/${projectId}/sites/${siteFromPath}/widget`],
    [
      "dashboard",
      `/lk/partner/${siteFromPath}/dashboard`,
      `/lk/partner/project/${projectId}/sites/${siteFromPath}/dashboard`,
    ],
    ["site tab", `/lk/partner/${siteFromPath}/site`, `/lk/partner/project/${projectId}/sites/${siteFromPath}/widget`],
    [
      "sites section",
      `/lk/partner/${siteFromPath}/sites`,
      `/lk/partner/project/${projectId}/sites/${siteFromPath}/dashboard`,
    ],
    ["info", `/lk/partner/${siteFromPath}/info`, `/lk/partner/project/${projectId}/info`],
    [
      "unknown section (default)",
      `/lk/partner/${siteFromPath}/unknown`,
      `/lk/partner/project/${projectId}/sites/${siteFromPath}/dashboard`,
    ],
  ])(
    "LegacyOwnerSiteRedirect maps legacy %s to canonical path",
    async (_label, legacyInitialPath, expectedCanonicalPath) => {
      mockLegacyOwnerSiteRedirectIntegration();

      render(
        <MemoryRouter initialEntries={[legacyInitialPath]}>
          <Routes>
            <Route path="/lk/partner/:sitePublicId/*" element={<LegacyOwnerSiteRedirect />} />
            <Route
              path="/lk/partner/project/:projectId/sites/:sitePublicId/members"
              element={<CanonicalPathProbe />}
            />
            <Route
              path="/lk/partner/project/:projectId/sites/:sitePublicId/settings"
              element={<CanonicalPathProbe />}
            />
            <Route path="/lk/partner/project/:projectId/info" element={<CanonicalPathProbe />} />
            <Route
              path="/lk/partner/project/:projectId/sites/:sitePublicId/dashboard"
              element={<CanonicalPathProbe />}
            />
            <Route
              path="/lk/partner/project/:projectId/sites/:sitePublicId/widget"
              element={<CanonicalPathProbe />}
            />
            <Route path="/lk/partner/project/:projectId/sites/:sitePublicId" element={<CanonicalPathProbe />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("canonical-path-probe").textContent).toBe(expectedCanonicalPath);
      });
    },
  );

  // --- 6. Connect flow lands on canonical site route (state-driven only) ----
  it("ProjectWidgetInstallScreen redirects to project sites list when no transitional state", () => {
    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/widget`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="widget" element={<ProjectWidgetInstallScreen />} />
            <Route path="sites" element={<div data-testid="project-sites-list">Sites</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    // No state.sitePublicIdForConnect → navigate to /sites, never render widget UI.
    expect(screen.queryByTestId("widget-install-snippet-block")).not.toBeInTheDocument();
  });

  // --- 7. Canonical route does not pollute URL with ?site_public_id= --------
  it("canonical site route does not append ?site_public_id= to the URL via history sync", async () => {
    mockOwnerAndIntegration({
      owner: makeOwnerProjectsPayload([
        makeProject({
          id: projectId,
          name: "P",
          sites: [makeSite({ public_id: siteFromPath, project_id: projectId, project: { name: "P" } })],
        }),
      ]),
      byId: {
        [siteFromPath]: makeIntegrationPayload(siteFromPath, "Canonical only"),
      },
    });

    // Set a stable browser-like URL so widget-install's syncSelectedSiteInUrl
    // can be observed if it ever ran.
    const initialHref = `http://localhost/lk/partner/project/${projectId}/sites/${siteFromPath}`;
    window.history.replaceState({}, "", initialHref);

    render(
      <MemoryRouter initialEntries={[`/lk/partner/project/${projectId}/sites/${siteFromPath}`]}>
        <Routes>
          <Route path="/lk/partner/project/:projectId" element={<SiteProjectLayout />}>
            <Route path="sites/:sitePublicId/dashboard" element={<SiteDashboardPage />} />
            <Route path="sites/:sitePublicId/widget" element={<ProjectSiteManagementScreen />} />
            <Route path="sites/:sitePublicId" element={<SiteShellDefaultToDashboardStub />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Статистика за/i)).toBeInTheDocument();
    });

    // MemoryRouter does not sync in-app navigations to window.location; `search` reflects replaceState above.
    expect(window.location.search).toBe("");
  });
});
