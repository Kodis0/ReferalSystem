/**
 * LK dashboard — агентские программы (member SiteMembership list).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LkSidebar from "../pages/lk/LkSidebar";
import { MyProgramsSection } from "../pages/lk/dashboard/myProgramsSection";
import MyProgramsPage from "../pages/lk/dashboard/MyProgramsPage";
import ProgramsCatalogPage from "../pages/lk/dashboard/ProgramsCatalogPage";

if (typeof window.ResizeObserver === "undefined") {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserver;
  global.ResizeObserver = ResizeObserver;
}

describe("Dashboard My Programs", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it("renders empty state when no memberships", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/me/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ programs: [] }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    render(
      <MemoryRouter>
        <MyProgramsSection />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Агентские программы" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Вы пока не участвуете ни в одной программе.")).toBeInTheDocument();
      expect(
        screen.getByText("Откройте каталог, выберите программу и получите персональную ссылку.")
      ).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/users/me/programs/"),
      expect.any(Object)
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/users/programs/"),
      expect.any(Object)
    );
  });

  it("renders connected programs as owner-style cards", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/me/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                site_display_label: "Demo Shop",
                site_origin_label: "demo.example",
                joined_at: "2026-01-10T12:00:00+00:00",
                site_status: "verified",
                platform_preset: "tilda",
                referral_lock_days: 45,
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    render(
      <MemoryRouter>
        <MyProgramsSection />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("my-programs-list")).toBeInTheDocument();
    });
    expect(screen.getByText("Demo Shop")).toBeInTheDocument();
    expect(screen.getByText("demo.example · Готова к активации · tilda · Срок закрепления: 45 дн.")).toBeInTheDocument();
    const card = screen.getByTestId("agent-program-list-link");
    expect(card).toHaveClass("owner-programs__service-card");
    expect(screen.getByRole("button", { name: "Выйти" })).toBeInTheDocument();
  });

  it("renders inactive connected program without success status", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/me/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                site_display_label: "Stopped Shop",
                site_origin_label: "stopped.example",
                site_status: "active",
                widget_enabled: false,
                program_active: false,
                platform_preset: "tilda",
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    render(
      <MemoryRouter>
        <MyProgramsSection />
      </MemoryRouter>
    );

    const card = await screen.findByTestId("agent-program-list-link");
    expect(screen.getByText("stopped.example · Виджет выключен · tilda · Срок закрепления: —")).toBeInTheDocument();
    expect(screen.getByText("Программа временно остановлена.")).toBeInTheDocument();
    expect(card.querySelector(".owner-programs__service-card-status-dot_success")).not.toBeInTheDocument();
    expect(card.querySelector(".owner-programs__service-card-status-dot_muted")).toBeInTheDocument();
  });

  it("refetches my programs on site status change event", async () => {
    let active = true;
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/me/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                site_display_label: "Dynamic Shop",
                site_origin_label: "dynamic.example",
                site_status: "active",
                widget_enabled: active,
                program_active: active,
                platform_preset: "tilda",
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    render(
      <MemoryRouter>
        <MyProgramsSection />
      </MemoryRouter>
    );

    await screen.findByText("dynamic.example · Активна · tilda · Срок закрепления: —");
    active = false;
    act(() => {
      window.dispatchEvent(
        new CustomEvent("lumoref:site-status-changed", {
          detail: { site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
        }),
      );
    });

    await screen.findByText("dynamic.example · Виджет выключен · tilda · Срок закрепления: —");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders connected program avatar from API and falls back to letter without avatar", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/me/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                site_display_label: "Demo Shop",
                site_origin_label: "demo.example",
                avatar_data_url: "https://cdn.example/my-icon.png",
                avatar_updated_at: "2026-04-29T18:30:00+00:00",
                site_status: "verified",
                platform_preset: "tilda",
              },
              {
                site_public_id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
                site_display_label: "Other Shop",
                site_origin_label: "other.example",
                avatar_data_url: "",
                site_status: "verified",
                platform_preset: "tilda",
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    const { container } = render(
      <MemoryRouter>
        <MyProgramsSection />
      </MemoryRouter>
    );

    await screen.findByText("Demo Shop");
    const img = container.querySelector(".owner-programs__service-card-avatar-img");
    expect(img).toHaveAttribute(
      "src",
      "https://cdn.example/my-icon.png?v=2026-04-29T18%3A30%3A00%2B00%3A00"
    );
    expect(screen.getByText("O")).toBeInTheDocument();
  });

  it("removes program after leaving membership", async () => {
    const siteId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    let programsPayload = [
      {
        site_public_id: siteId,
        site_display_label: "Demo Shop",
        site_origin_label: "demo.example",
        site_status: "verified",
        platform_preset: "tilda",
      },
    ];
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, options) => {
      const u = String(url);
      if (u.includes("/users/me/programs/") && (!options?.method || options.method === "GET")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ programs: programsPayload }),
        });
      }
      if (u.includes("/users/site/leave/") && options?.method === "POST") {
        programsPayload = [];
        return Promise.resolve({ ok: true, json: async () => ({ status: "left", site_public_id: siteId }) });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    render(
      <MemoryRouter>
        <MyProgramsSection />
      </MemoryRouter>
    );

    const leaveButton = await screen.findByRole("button", { name: "Выйти" });
    fireEvent.click(leaveButton);

    await waitFor(() => {
      expect(screen.queryByText("Demo Shop")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Вы пока не участвуете ни в одной программе.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/users/site/leave/"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ site_public_id: siteId }),
      })
    );
  });

  it("opens program card by click", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/me/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                site_display_label: "Demo Shop",
                site_origin_label: "demo.example",
                site_status: "verified",
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    render(
      <MemoryRouter initialEntries={["/lk/my-programs"]}>
        <Routes>
          <Route path="/lk/my-programs" element={<MyProgramsSection />} />
          <Route path="/lk/referral-program/:sitePublicId" element={<div>Program detail</div>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByTestId("agent-program-list-link"));
    expect(screen.getByText("Program detail")).toBeInTheDocument();
  });

  /**
   * Регрессия: каталог и «Мои программы» должны быть РАЗНЫМИ маршрутами
   * с РАЗНЫМИ компонентами и РАЗНЫМИ endpoint'ами.
   *
   * Симптом, который ловим: после открытия карточки в каталоге переход в
   * «Мои программы» показывал весь каталог (см. репорт). Корень — обе
   * sidebar-ссылки исторически вели на `/lk/programs`, и/или маршрут
   * `/lk/my-programs` отсутствовал и падал на каталог.
   */
  it("route /lk/my-programs renders MyProgramsPage and hits /users/me/programs/, not catalog", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.endsWith("/users/me/programs/")) {
        return Promise.resolve({ ok: true, json: async () => ({ programs: [] }) });
      }
      if (u.endsWith("/users/programs/")) {
        // Catalog endpoint must NOT be called from the My Programs route.
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              { site_public_id: "leak-1", site_display_label: "Leaked Catalog A", site_status: "verified" },
              { site_public_id: "leak-2", site_display_label: "Leaked Catalog B", site_status: "verified" },
            ],
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    render(
      <MemoryRouter initialEntries={["/lk/my-programs"]}>
        <Routes>
          <Route path="/lk/programs" element={<ProgramsCatalogPage />} />
          <Route path="/lk/my-programs" element={<MyProgramsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Вы пока не участвуете ни в одной программе.")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Агентские программы" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Каталог реферальных программ" })).not.toBeInTheDocument();
    expect(screen.queryByText("Leaked Catalog A")).not.toBeInTheDocument();
    expect(screen.queryByText("Leaked Catalog B")).not.toBeInTheDocument();

    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(calledUrls.some((u) => u.endsWith("/users/me/programs/"))).toBe(true);
    expect(calledUrls.some((u) => u.endsWith("/users/programs/"))).toBe(false);
  });

  /**
   * Регрессия: реальный sidebar + реальный маршрут.
   *
   * Симптом: и «Каталог программ», и «Мои программы» в сайдбаре исторически
   * вели на `/lk/programs`, и/или маршрут `/lk/my-programs` отсутствовал в
   * `lk.js`, поэтому клик по «Мои программы» отрисовывал ProgramsCatalogPage.
   * Этот тест собирает реальный `<LkSidebar>` + `<Routes>` как в `lk.js` и
   * после клика на ссылку «Мои программы» требует, чтобы отрисовалась именно
   * `MyProgramsPage` (заголовок «Агентские программы»), а не каталог.
   *
   * Должен падать при любой из ошибок: неверный href в сайдбаре, отсутствующий
   * маршрут в `lk.js`, неверный компонент за маршрутом.
   */
  it("sidebar 'Мои программы' click renders MyProgramsPage, not the catalog", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url) => {
      const u = String(url);
      if (u.endsWith("/users/me/programs/")) {
        return Promise.resolve({ ok: true, json: async () => ({ programs: [] }) });
      }
      if (u.endsWith("/users/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                site_display_label: "Catalog Only",
                site_origin_label: "catalog.example",
                site_status: "verified",
                joined: false,
              },
            ],
          }),
        });
      }
      if (u.includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({ ok: true, json: async () => ({ projects: [], sites: [] }) });
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    render(
      <MemoryRouter initialEntries={["/lk/programs"]}>
        <LkSidebar />
        <Routes>
          <Route path="/lk/programs" element={<ProgramsCatalogPage />} />
          <Route path="/lk/my-programs" element={<MyProgramsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Каталог реферальных программ" })
      ).toBeInTheDocument();
    });

    const myProgramsLink = screen.getByRole("link", { name: /Мои программы/i });
    expect(myProgramsLink).toHaveAttribute("href", "/lk/my-programs");
    fireEvent.click(myProgramsLink);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Агентские программы" })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("heading", { name: "Каталог реферальных программ" })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Catalog Only")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Вы пока не участвуете ни в одной программе.")).toBeInTheDocument();
    });

    const joinPosts = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes("/users/site/join/") && opts?.method === "POST"
    );
    expect(joinPosts).toHaveLength(0);

    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(calledUrls.some((u) => u.endsWith("/users/me/programs/"))).toBe(true);
  });
});

const DETAIL_PATH = "/lk/referral-program/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("LkSidebar — каталог / мои программы / карточка (active state)", () => {
  beforeEach(() => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/referrals/site/owner-sites/")) {
        return Promise.resolve({ ok: true, json: async () => ({ projects: [], sites: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function renderSidebarAt(entry) {
    const initial = Array.isArray(entry) ? entry : [entry];
    return render(
      <MemoryRouter initialEntries={initial}>
        <Routes>
          <Route path="*" element={<LkSidebar />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("/lk/programs highlights Каталог программ", async () => {
    renderSidebarAt("/lk/programs");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Каталог программ/i })).toHaveClass("lk-sidebar__nav-link_active");
    });
    expect(screen.getByRole("link", { name: /Мои программы/i })).not.toHaveClass("lk-sidebar__nav-link_active");
  });

  it("/lk/my-programs highlights Мои программы", async () => {
    renderSidebarAt("/lk/my-programs");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Мои программы/i })).toHaveClass("lk-sidebar__nav-link_active");
    });
    expect(screen.getByRole("link", { name: /Каталог программ/i })).not.toHaveClass("lk-sidebar__nav-link_active");
  });

  it("detail with state from=/lk/programs highlights Каталог программ", async () => {
    renderSidebarAt({ pathname: DETAIL_PATH, state: { from: "/lk/programs" } });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Каталог программ/i })).toHaveClass("lk-sidebar__nav-link_active");
    });
    expect(screen.getByRole("link", { name: /Мои программы/i })).not.toHaveClass("lk-sidebar__nav-link_active");
  });

  it("detail with state from=/lk/my-programs highlights Мои программы", async () => {
    renderSidebarAt({ pathname: DETAIL_PATH, state: { from: "/lk/my-programs" } });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Мои программы/i })).toHaveClass("lk-sidebar__nav-link_active");
    });
    expect(screen.getByRole("link", { name: /Каталог программ/i })).not.toHaveClass("lk-sidebar__nav-link_active");
  });

  it("detail without state defaults to Каталог программ", async () => {
    renderSidebarAt({ pathname: DETAIL_PATH });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Каталог программ/i })).toHaveClass("lk-sidebar__nav-link_active");
    });
    expect(screen.getByRole("link", { name: /Мои программы/i })).not.toHaveClass("lk-sidebar__nav-link_active");
  });
});
