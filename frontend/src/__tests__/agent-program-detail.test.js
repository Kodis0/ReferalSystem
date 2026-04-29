/**
 * Agent-side program detail (member SiteMembership by site public_id).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AgentProgramDetailPage from "../pages/lk/dashboard/AgentProgramDetailPage";

const SITE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("Agent program detail page", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  function renderDetail() {
    return render(
      <MemoryRouter initialEntries={[`/lk/referral-program/${SITE_ID}`]}>
        <Routes>
          <Route path="/lk/referral-program/:sitePublicId" element={<AgentProgramDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("renders program label, joined line, and next section", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes(`/users/me/programs/${SITE_ID}/`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            program: {
              site_public_id: SITE_ID,
              site_display_label: "Demo Shop",
              site_origin_label: "demo.example",
              joined_at: "2026-01-10T12:00:00+00:00",
              site_status: "verified",
            },
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("agent-program-title")).toHaveTextContent("demo.example");
    });
    expect(screen.getByText(/Дата подключения:/i)).toBeInTheDocument();
    expect(screen.getByText("verified")).toBeInTheDocument();
    expect(screen.getByText(/Что дальше/i)).toBeInTheDocument();
    const listLinks = screen.getAllByRole("link", { name: /К агентским программам/i });
    expect(listLinks.length).toBe(2);
    listLinks.forEach((el) => {
      expect(el).toHaveAttribute("href", "/lk/dashboard#my-programs");
    });
  });

  it("shows not found on 404", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/me/programs/")) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("agent-program-not-found")).toBeInTheDocument();
    });
  });

  it("shows error on failed fetch", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/me/programs/")) {
        return Promise.reject(new Error("network"));
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("agent-program-error")).toBeInTheDocument();
    });
  });
});
