/**
 * LK programs catalog — all system programs list.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProgramsCatalogPage from "../pages/lk/dashboard/ProgramsCatalogPage";

describe("Programs Catalog", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it("renders all programs and joined state", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                site_display_label: "Demo Shop",
                site_origin_label: "demo.example",
                joined: true,
                joined_at: "2026-01-10T12:00:00+00:00",
                site_status: "verified",
                referral_lock_days: 45,
                commission_percent: "12",
              },
              {
                site_public_id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
                site_display_label: "Other Shop",
                site_origin_label: "other.example",
                joined: false,
                site_status: "active",
                referral_lock_days: 30,
                commission_percent: "8",
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    render(
      <MemoryRouter>
        <ProgramsCatalogPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Каталог реферальных программ" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Demo Shop")).toBeInTheDocument();
      expect(screen.getByText("Other Shop")).toBeInTheDocument();
    });
    expect(screen.queryByText("Подключена")).not.toBeInTheDocument();
    expect(screen.queryByText(/Срок закрепления:/i)).not.toBeInTheDocument();

    const links = screen.getAllByTestId("programs-catalog-list-link");
    expect(links[0]).toHaveAttribute("data-nav-target", "/lk/referral-program/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(links[1]).toHaveAttribute("data-nav-target", "/lk/referral-program/bbbbbbbb-cccc-dddd-eeee-ffffffffffff");
  });

  it("renders API avatar with stable cache version and falls back to letter without avatar", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                site_display_label: "Demo Shop",
                site_origin_label: "demo.example",
                avatar_data_url: "https://cdn.example/icon.png",
                avatar_updated_at: "2026-04-29T18:00:00+00:00",
                joined: false,
                site_status: "verified",
                commission_percent: "8",
              },
              {
                site_public_id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
                site_display_label: "Other Shop",
                site_origin_label: "other.example",
                avatar_data_url: "",
                joined: false,
                site_status: "verified",
                commission_percent: "12",
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    const { container } = render(
      <MemoryRouter>
        <ProgramsCatalogPage />
      </MemoryRouter>
    );

    await screen.findByText("Demo Shop");
    const img = container.querySelector(".lk-dashboard__programs-avatar-img");
    expect(img).toHaveAttribute(
      "src",
      "https://cdn.example/icon.png?v=2026-04-29T18%3A00%3A00%2B00%3A00"
    );
    fireEvent.error(img);
    expect(screen.getByText("D")).toBeInTheDocument();
    expect(screen.getByText("O")).toBeInTheDocument();
  });

  it("mount loads catalog via GET /users/programs/ only and never POST /users/site/join/", async () => {
    const siteId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).endsWith("/users/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: siteId,
                site_display_label: "Other Shop",
                site_origin_label: "other.example",
                joined: false,
                site_status: "active",
                commission_percent: "10",
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    render(
      <MemoryRouter>
        <ProgramsCatalogPage />
      </MemoryRouter>
    );

    await screen.findByText("Other Shop");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/users/programs/");
    expect(String(fetchMock.mock.calls[0][0])).not.toMatch(
      /\/users\/programs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i
    );
    const joinPosts = fetchMock.mock.calls.filter(
      ([u, opts]) => String(u).includes("/users/site/join/") && opts?.method === "POST"
    );
    expect(joinPosts).toHaveLength(0);
  });

  it("opens a program card without joining", async () => {
    const siteId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: siteId,
                site_display_label: "Other Shop",
                site_origin_label: "other.example",
                joined: false,
                site_status: "active",
                commission_percent: "10",
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    render(
      <MemoryRouter initialEntries={["/lk/programs"]}>
        <Routes>
          <Route path="/lk/programs" element={<ProgramsCatalogPage />} />
          <Route path="/lk/referral-program/:sitePublicId" element={<div>Program detail route</div>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByTestId("programs-catalog-list-link"));

    expect(screen.getByText("Program detail route")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/users/site/join/"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("clicking the site domain link does not open the program card", async () => {
    const siteId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: siteId,
                site_display_label: "Other Shop",
                site_origin_label: "other.example",
                joined: false,
                site_status: "active",
                commission_percent: "10",
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    render(
      <MemoryRouter initialEntries={["/lk/programs"]}>
        <Routes>
          <Route path="/lk/programs" element={<ProgramsCatalogPage />} />
          <Route path="/lk/referral-program/:sitePublicId" element={<div>Program detail route</div>} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("Other Shop");
    fireEvent.click(screen.getByLabelText("Открыть сайт other.example"));
    expect(screen.queryByText("Program detail route")).not.toBeInTheDocument();
  });

  it("filters programs by domain and display name", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                site_display_label: "Demo Shop",
                site_origin_label: "demo.example",
                joined: true,
                joined_at: "2026-01-10T12:00:00+00:00",
                site_status: "verified",
                commission_percent: "8",
                participants_count: 3,
              },
              {
                site_public_id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
                site_display_label: "Partner Store",
                site_origin_label: "other.example",
                joined: false,
                site_status: "active",
                commission_percent: "15",
                participants_count: 40,
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    render(
      <MemoryRouter>
        <ProgramsCatalogPage />
      </MemoryRouter>
    );

    const search = await screen.findByRole("searchbox", { name: "Поиск программ" });
    fireEvent.change(search, { target: { value: "other.example" } });
    expect(screen.queryByText("Demo Shop")).not.toBeInTheDocument();
    expect(screen.getByText("Partner Store")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Demo Shop" } });
    expect(screen.getByText("Demo Shop")).toBeInTheDocument();
    expect(screen.queryByText("Partner Store")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByText("По вашему запросу программ не найдено.")).toBeInTheDocument();
  });

  it("filters programs by commission percent and participants count", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                site_display_label: "Low",
                site_origin_label: "low.example",
                joined: false,
                site_status: "active",
                commission_percent: "3",
                participants_count: 5,
              },
              {
                site_public_id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
                site_display_label: "High",
                site_origin_label: "high.example",
                joined: false,
                site_status: "active",
                commission_percent: "25",
                participants_count: 150,
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    render(
      <MemoryRouter>
        <ProgramsCatalogPage />
      </MemoryRouter>
    );

    await screen.findByText("Low");
    expect(screen.getByText("High")).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId("programs-catalog-filters-toggle"));
    fireEvent.click(await screen.findByTestId("programs-catalog-filter-commission-trigger"));
    fireEvent.click(screen.getByRole("option", { name: "20% и выше" }));
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("programs-catalog-filter-commission-trigger"));
    fireEvent.click(screen.getByRole("option", { name: "Все" }));
    fireEvent.click(screen.getByTestId("programs-catalog-filter-participants-trigger"));
    fireEvent.click(screen.getByRole("option", { name: "до 10" }));
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.queryByText("High")).not.toBeInTheDocument();
  });

  it("renders empty state", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ programs: [] }),
        });
      }
      return Promise.reject(new Error("unexpected fetch"));
    });

    render(
      <MemoryRouter>
        <ProgramsCatalogPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Пока нет доступных программ.")).toBeInTheDocument();
      expect(
        screen.getByText("Когда владельцы сайтов опубликуют реферальные программы, они появятся здесь.")
      ).toBeInTheDocument();
    });
  });
});
