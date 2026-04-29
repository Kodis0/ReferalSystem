/**
 * Agent-side program detail (member SiteMembership by site public_id).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  function renderDetail(routeState) {
    return render(
      <MemoryRouter initialEntries={[{ pathname: `/lk/referral-program/${SITE_ID}`, state: routeState }]}>
        <Routes>
          <Route path="/lk/referral-program/:sitePublicId" element={<AgentProgramDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("renders joined program with participant fields", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes(`/users/programs/${SITE_ID}/`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            program: {
              site_public_id: SITE_ID,
              site_display_label: "Demo Shop",
              site_origin_label: "demo.example",
              site_description: "Partner program description",
              joined_at: "2026-01-10T12:00:00+00:00",
              site_status: "verified",
              program_active: true,
              commission_percent: "12.50",
              referral_lock_days: 30,
              participants_count: 7,
              joined: true,
              ref_code: "ABC123",
              referral_link: "https://app.example.com/?ref=ABC123",
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
    expect(screen.getByText("Demo Shop")).toBeInTheDocument();
    expect(screen.getByText("Partner program description")).toBeInTheDocument();
    expect(screen.getByText(/Дата подключения:/i)).toBeInTheDocument();
    expect(screen.getByText("12,5%")).toBeInTheDocument();
    expect(screen.getByText("30 дн.")).toBeInTheDocument();
    expect(screen.getByText("Активна")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Назад" })).toHaveAttribute("href", "/lk/programs");
    expect(screen.getByTestId("agent-program-joined-state")).toHaveTextContent("Вы участвуете в программе");
    expect(screen.getByText("Реферальный код: ABC123")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://app.example.com/?ref=ABC123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скопировать ссылку" })).toBeInTheDocument();
  });

  it("renders detail avatar from API with stable cache version", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes(`/users/programs/${SITE_ID}/`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            program: {
              site_public_id: SITE_ID,
              site_display_label: "Demo Shop",
              site_origin_label: "demo.example",
              avatar_data_url: "https://cdn.example/detail-icon.png",
              avatar_updated_at: "2026-04-29T19:00:00+00:00",
              site_status: "verified",
              program_active: true,
              joined: true,
            },
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    const { container } = renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("agent-program-title")).toHaveTextContent("demo.example");
    });
    const img = container.querySelector(".lk-dashboard__program-card-avatar-img");
    expect(img).toHaveAttribute(
      "src",
      "https://cdn.example/detail-icon.png?v=2026-04-29T19%3A00%3A00%2B00%3A00"
    );
  });

  it("returns to my programs when opened from my programs", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes(`/users/programs/${SITE_ID}/`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            program: {
              site_public_id: SITE_ID,
              site_display_label: "Demo Shop",
              site_origin_label: "demo.example",
              site_status: "verified",
              program_active: true,
              joined: true,
            },
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderDetail({ from: "/lk/my-programs" });

    await waitFor(() => {
      expect(screen.getByTestId("agent-program-title")).toHaveTextContent("demo.example");
    });
    expect(screen.getByRole("link", { name: "Назад" })).toHaveAttribute("href", "/lk/my-programs");
  });

  it("does not join when opening an unjoined program detail", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, options) => {
      if (String(url).includes(`/users/programs/${SITE_ID}/`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            program: {
              site_public_id: SITE_ID,
              site_display_label: "Demo Shop",
              site_origin_label: "demo.example",
              site_description: "Partner program description",
              site_status: "verified",
              program_active: true,
              commission_percent: "12.50",
              referral_lock_days: 30,
              participants_count: 7,
              joined: false,
            },
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("agent-program-unjoined-state")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Вступить в программу" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/users/site/join/"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("joins only the current program after explicit click", async () => {
    let detailCalls = 0;
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, options) => {
      if (String(url).includes("/users/site/join/") && options?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ status: "joined", site_public_id: SITE_ID }) });
      }
      if (String(url).includes(`/users/programs/${SITE_ID}/`)) {
        detailCalls += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            program: {
              site_public_id: SITE_ID,
              site_display_label: "Demo Shop",
              site_origin_label: "demo.example",
              site_status: "verified",
              program_active: true,
              joined: detailCalls > 1,
              joined_at: detailCalls > 1 ? "2026-01-10T12:00:00+00:00" : undefined,
            },
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderDetail();

    const joinButton = await screen.findByRole("button", { name: "Вступить в программу" });
    fireEvent.click(joinButton);

    await waitFor(() => {
      expect(screen.getByTestId("agent-program-joined-state")).toHaveTextContent("Вы участвуете в программе");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/users/site/join/"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ site_public_id: SITE_ID }),
      })
    );
    expect(
      fetchMock.mock.calls.filter(([url, options]) => String(url).includes("/users/site/join/") && options?.method === "POST")
    ).toHaveLength(1);
  });

  it("shows not found on 404", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("/users/programs/")) {
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
      if (String(url).includes("/users/programs/")) {
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
