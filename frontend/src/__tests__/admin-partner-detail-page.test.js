/**
 * AdminPartnerDetailPage: детали партнёра + смена статуса (PATCH).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminPartnerDetailPage from "../pages/lk/admin/AdminPartnerDetailPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

jest.mock("../components/toast/toastBus", () => ({
  __esModule: true,
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

function makePartnerPayload(overrides = {}) {
  return {
    id: 1,
    user_id: 100,
    user_email: "alice@example.com",
    status: "pending",
    balance_available: "0",
    balance_total: "0",
    commission_percent: "5",
    created_at: "2026-01-01T10:00:00Z",
    updated_at: "2026-01-02T10:00:00Z",
    user_public_id: "abc1234",
    user_fio: "Алиса Тестовая",
    user_phone: "+79990001122",
    account_type: "individual",
    owned_projects_count: 0,
    owned_sites_count: 0,
    commissions_count: 0,
    orders_count: 0,
    ...overrides,
  };
}

function renderPage(initialPartnerId = 1) {
  return render(
    <MemoryRouter initialEntries={[`/admin-console/partners/${initialPartnerId}`]}>
      <Routes>
        <Route
          path="/admin-console/partners/:partnerId"
          element={<AdminPartnerDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminPartnerDetailPage", () => {
  let fetchSpy;
  const originalLocalStorage = global.localStorage;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: jest.fn(() => "test-token"),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
      configurable: true,
    });

    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makePartnerPayload(),
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
    jest.restoreAllMocks();
  });

  it("renders fetched partner detail for the route :partnerId", async () => {
    renderPage(1);

    const emailNodes = await screen.findAllByText("alice@example.com");
    expect(emailNodes.length).toBeGreaterThan(0);
    // "pending" — и в бейдже статуса, и в кнопке смены статуса.
    expect(screen.getAllByText("pending").length).toBeGreaterThan(0);
    expect(screen.getByText("Алиса Тестовая")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/referrals/admin/partners/1/");
  });

  it("click active + confirm → PATCH → status state обновился", async () => {
    fetchSpy.mockReset();
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makePartnerPayload({ status: "pending" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makePartnerPayload({ status: "active" }),
      });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    renderPage(1);
    await screen.findAllByText("alice@example.com");

    const activeBtn = await screen.findByRole("button", { name: "active" });
    fireEvent.click(activeBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
    expect(confirmSpy).toHaveBeenCalled();

    const patchCall = fetchSpy.mock.calls[1];
    expect(String(patchCall[0])).toContain("/referrals/admin/partners/1/status/");
    expect(patchCall[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(patchCall[1].body)).toEqual({ status: "active" });

    // После успешного PATCH статус в DOM = active (бейдж + текущая активная кнопка).
    await waitFor(() => {
      const activeBadge = screen.getAllByText("active").find((node) =>
        Array.from(node.classList || []).some((c) => c.startsWith("lk-admin-users__badge")),
      );
      expect(activeBadge).toBeTruthy();
    });
  });

  it("cancel в confirm → PATCH не отправляется", async () => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makePartnerPayload({ status: "pending" }),
    });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);

    renderPage(1);
    await screen.findAllByText("alice@example.com");

    const activeBtn = await screen.findByRole("button", { name: "active" });
    fireEvent.click(activeBtn);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Состояние не изменилось → "pending" всё ещё в DOM (badge + кнопка).
    expect(screen.getAllByText("pending").length).toBeGreaterThan(0);
  });
});
