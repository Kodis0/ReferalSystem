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

  function renderDetail() {
    return render(
      <MemoryRouter initialEntries={[`/lk/referral-program/${SITE_ID}`]}>
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

  it("shows join button for unjoined program and reloads after successful join", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url, options) => {
      if (String(url).includes(`/users/programs/${SITE_ID}/`)) {
        const joined = fetchMock.mock.calls.some(
          ([calledUrl, calledOptions]) =>
            String(calledUrl).includes("/users/site/join/") && calledOptions?.method === "POST"
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            program: {
              site_public_id: SITE_ID,
              site_display_label: "Demo Shop",
              site_origin_label: "demo.example",
              site_description: "Partner program description",
              joined_at: joined ? "2026-01-10T12:00:00+00:00" : undefined,
              site_status: "verified",
              program_active: true,
              commission_percent: "12.50",
              referral_lock_days: 30,
              participants_count: joined ? 8 : 7,
              joined,
              ref_code: joined ? "ABC123" : undefined,
            },
          }),
        });
      }
      if (String(url).includes("/users/site/join/") && options?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ status: "joined" }) });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderDetail();

    const button = await screen.findByTestId("agent-program-join-button");
    expect(button).toHaveTextContent("Стать участником");

    fireEvent.click(button);

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
  });

  it("opens unjoined catalog program when detail endpoint returns 404", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes(`/users/programs/${SITE_ID}/`)) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (String(url).endsWith("/users/programs/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            programs: [
              {
                site_public_id: SITE_ID,
                site_display_label: "Demo Shop",
                site_origin_label: "demo.example",
                site_description: "Catalog description",
                site_status: "verified",
                program_active: true,
                commission_percent: "12.50",
                referral_lock_days: 30,
                participants_count: 7,
                joined: false,
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("agent-program-title")).toHaveTextContent("demo.example");
    });
    expect(screen.getByText("Catalog description")).toBeInTheDocument();
    expect(screen.getByTestId("agent-program-join-button")).toHaveTextContent("Стать участником");
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
