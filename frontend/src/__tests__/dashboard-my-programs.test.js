/**
 * LK dashboard — агентские программы (member SiteMembership list).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MyProgramsSection } from "../pages/lk/dashboard/myProgramsSection";

describe("Dashboard My Programs", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it("renders empty state when no memberships", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
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
      expect(
        screen.getByText(/Пока нет подключённых программ/i)
      ).toBeInTheDocument();
    });
  });

  it("renders program label and joined line", async () => {
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
      expect(screen.getByText("demo.example")).toBeInTheDocument();
    });
    expect(screen.queryByText("Demo Shop")).not.toBeInTheDocument();
    expect(screen.getByText(/Дата подключения:/)).toBeInTheDocument();
    expect(screen.getByText("verified")).toBeInTheDocument();
    const link = screen.getByTestId("agent-program-list-link");
    expect(link).toHaveAttribute("href", "/lk/referral-program/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });
});
