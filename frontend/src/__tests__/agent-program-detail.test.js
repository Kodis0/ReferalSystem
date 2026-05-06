/**
 * Agent-side program detail (member SiteMembership by site public_id).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
              site_status: "active",
              program_active: true,
              commission_percent: "12.50",
              referral_lock_days: 30,
              participants_count: 7,
              joined: true,
              ref_code: "ABC123",
              referral_link: "https://app.example.com/?ref=ABC123",
              referrer_commission_total: "42.50",
              referrer_sales_total: "850.00",
              recent_orders: [
                {
                  id: 101,
                  amount: "850.00",
                  currency: "RUB",
                  status: "paid",
                  created_at: "2026-01-11T10:15:00+00:00",
                },
              ],
            },
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByTestId("agent-program-title")).toHaveTextContent("Demo Shop");
    });
    expect(screen.getByRole("tablist", { name: "Дашборд программы" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Дашборд" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Название домена")).not.toBeInTheDocument();
    expect(screen.queryByText("Название сайта")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "demo.example" })).toHaveAttribute("href", "https://demo.example/");
    expect(screen.getByRole("link", { name: "demo.example" })).toHaveAttribute("target", "_blank");
    expect(screen.getByText("Partner program description")).toBeInTheDocument();
    expect(screen.getByText(/Дата подключения:/i)).toBeInTheDocument();
    expect(screen.getByText("12,5%")).toBeInTheDocument();
    expect(screen.getByText("30 дн.")).toBeInTheDocument();
    expect(screen.getByText("Активна")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Назад" })).toHaveAttribute("href", "/lk/programs");
    expect(screen.getByTestId("agent-program-joined-state")).toHaveTextContent("Вы участвуете в программе");
    expect(screen.getByText("Реферальный код: ABC123")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://demo.example/?ref=ABC123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скопировать ссылку" })).toBeInTheDocument();
    expect(screen.getByTestId("agent-program-referrer-money")).toHaveTextContent("Ваш доход");
    expect(screen.getByTestId("agent-program-referrer-money")).toHaveTextContent("Продажи по вашей ссылке");
    expect(screen.getByTestId("agent-program-referrer-money")).toHaveTextContent("42,50 ₽");
    expect(screen.getByTestId("agent-program-referrer-money")).toHaveTextContent("850,00 ₽");
    expect(screen.getByTestId("agent-program-referrer-money")).toHaveTextContent("Начислено за оплаченные заказы");
    expect(screen.getByTestId("agent-program-referrer-money")).toHaveTextContent("Сумма заказов клиентов, которых вы привели");
    expect(screen.getByText("Доход за период")).toBeInTheDocument();
    expect(screen.getByTestId("agent-program-earnings-chart")).toHaveTextContent("Ваш доход 42,50 ₽");
    const periodBtn = screen.getByRole("button", { name: /^7 дней$/ });
    expect(periodBtn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(periodBtn);
    expect(periodBtn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("option", { name: "30 дней" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "30 дней" }));
    expect(screen.getByRole("button", { name: /^30 дней$/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("tab", { name: "История заказов" })).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("tab", { name: "История заказов" }));

    expect(screen.getByRole("tab", { name: "История заказов" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("agent-program-referrer-money")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agent-program-joined-state")).not.toBeInTheDocument();
    expect(screen.queryByText("Вознаграждение")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-program-orders-history")).toHaveTextContent("История заказов");
    expect(screen.getByTestId("agent-program-orders-history")).toHaveTextContent("Заказ");
    expect(screen.getByTestId("agent-program-orders-history")).toHaveTextContent("850,00 ₽");
    expect(screen.getByTestId("agent-program-orders-history")).toHaveTextContent("RUB");
    expect(screen.getByTestId("agent-program-orders-history")).toHaveTextContent("Оплачен");
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
              site_status: "active",
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
      expect(screen.getByTestId("agent-program-title")).toHaveTextContent("Demo Shop");
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
              site_status: "active",
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
      expect(screen.getByTestId("agent-program-title")).toHaveTextContent("Demo Shop");
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
              site_status: "active",
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
    expect(screen.queryByRole("tablist", { name: "Дашборд программы" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Вступить в программу" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/users/site/join/"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows owner notice instead of join action for own program", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes(`/users/programs/${SITE_ID}/`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            program: {
              site_public_id: SITE_ID,
              site_display_label: "My Shop",
              site_origin_label: "mine.example",
              site_status: "active",
              program_active: true,
              commission_percent: "5.00",
              referral_lock_days: 30,
              participants_count: 0,
              joined: false,
              is_owner: true,
            },
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderDetail();

    const notice = await screen.findByTestId("agent-program-owner-notice");
    expect(notice).toHaveTextContent("Это ваша программа");
    expect(notice).toHaveTextContent("Вы не можете участвовать");
    expect(notice).toHaveClass("lk-dashboard__my-programs-catalog-banner");
    expect(notice).toHaveClass("lk-dashboard__programs-catalog-hero");
    expect(screen.queryByTestId("agent-program-join-btn")).not.toBeInTheDocument();
  });

  it("shows inactive detail and disables join", async () => {
    jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes(`/users/programs/${SITE_ID}/`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            program: {
              site_public_id: SITE_ID,
              site_display_label: "Stopped Shop",
              site_origin_label: "stopped.example",
              site_status: "active",
              widget_enabled: false,
              program_active: false,
              joined: false,
            },
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderDetail();

    const joinButton = await screen.findByTestId("agent-program-join-btn");
    expect(screen.getByText("Виджет выключен")).toBeInTheDocument();
    expect(screen.getByText("Программа временно остановлена.")).toBeInTheDocument();
    expect(joinButton).toBeDisabled();
    expect(joinButton).toHaveTextContent("Программа временно недоступна");
  });

  it("refetches detail on site status change event", async () => {
    let active = true;
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes(`/users/programs/${SITE_ID}/`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            program: {
              site_public_id: SITE_ID,
              site_display_label: "Dynamic Shop",
              site_origin_label: "dynamic.example",
              site_status: "active",
              widget_enabled: active,
              program_active: active,
              joined: false,
            },
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    renderDetail();

    await screen.findByText("Активна");
    active = false;
    act(() => {
      window.dispatchEvent(
        new CustomEvent("lumoref:site-status-changed", {
          detail: { site_public_id: SITE_ID },
        }),
      );
    });

    await screen.findByText("Виджет выключен");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores detail status event for another site and cleans up listener on unmount", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes(`/users/programs/${SITE_ID}/`)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            program: {
              site_public_id: SITE_ID,
              site_display_label: "Only Shop",
              site_origin_label: "only.example",
              site_status: "active",
              widget_enabled: true,
              program_active: true,
              joined: false,
            },
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    const { unmount } = renderDetail();

    await screen.findByText("Активна");
    act(() => {
      window.dispatchEvent(
        new CustomEvent("lumoref:site-status-changed", {
          detail: { site_public_id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff" },
        }),
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      window.dispatchEvent(new CustomEvent("lumoref:site-status-changed"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
              site_status: "active",
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
