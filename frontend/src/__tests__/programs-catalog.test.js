/**
 * LK programs catalog — all system programs list.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
              },
              {
                site_public_id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
                site_display_label: "Other Shop",
                site_origin_label: "other.example",
                joined: false,
                site_status: "active",
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
      expect(screen.getByText("demo.example")).toBeInTheDocument();
      expect(screen.getByText("other.example")).toBeInTheDocument();
    });
    expect(screen.getByText("Подключена")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();

    const links = screen.getAllByTestId("programs-catalog-list-link");
    expect(links[0]).toHaveAttribute("href", "/lk/referral-program/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(links[1]).toHaveAttribute("href", "/lk/referral-program/bbbbbbbb-cccc-dddd-eeee-ffffffffffff");
    expect(screen.getByText("Доступна для подключения")).toBeInTheDocument();
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
              },
              {
                site_public_id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
                site_display_label: "Partner Store",
                site_origin_label: "other.example",
                joined: false,
                site_status: "active",
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
    expect(screen.queryByText("demo.example")).not.toBeInTheDocument();
    expect(screen.getByText("other.example")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Demo Shop" } });
    expect(screen.getByText("demo.example")).toBeInTheDocument();
    expect(screen.queryByText("other.example")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByText("По вашему запросу программ не найдено.")).toBeInTheDocument();
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
      expect(screen.getByText("Пока нет подключенных программ.")).toBeInTheDocument();
    });
  });
});
