/**
 * AdminAccessGate: проверка фаз loading → login | elevated | mfa.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

jest.mock("../components/toast/toastBus", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

import AdminAccessGate from "../pages/lk/admin/AdminAccessGate";

function setupLocalStorage(initial = {}) {
  const store = { ...initial };
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: jest.fn((k) => (k in store ? store[k] : null)),
      setItem: jest.fn((k, v) => {
        store[k] = String(v);
      }),
      removeItem: jest.fn((k) => {
        delete store[k];
      }),
    },
    configurable: true,
  });
  return store;
}

describe("AdminAccessGate", () => {
  const originalLocalStorage = global.localStorage;
  let fetchSpy;

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it("renders AdminLoginForm when no admin_access_token", async () => {
    setupLocalStorage({});
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    render(
      <MemoryRouter>
        <AdminAccessGate />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("admin-portal-login")).toBeInTheDocument();
    expect(screen.queryByText("Пользователи")).toBeNull();
  });

  it("renders nav sections when admin_access_token + elevated session", async () => {
    setupLocalStorage({ admin_access_token: "tkn" });
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ is_elevated: true, elevated_until: "2030-01-01T00:00:00Z" }),
    });

    await act(async () => {
      render(
        <MemoryRouter>
          <AdminAccessGate />
        </MemoryRouter>,
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId("admin-portal-nav-users")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("admin-portal-login")).toBeNull();
  });

  it("renders MFA pending content when admin_access_token but not elevated", async () => {
    setupLocalStorage({ admin_access_token: "tkn" });
    let callCount = 0;
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation((url) => {
      const urlStr = String(url);
      callCount += 1;
      if (urlStr.includes("/admin/session/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ is_elevated: false, elevated_until: null }),
        });
      }
      if (urlStr.includes("/approval/challenge/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ challenge_id: 7, status: "pending", expires_in: 300 }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: "pending" }) });
    });

    await act(async () => {
      render(
        <MemoryRouter>
          <AdminAccessGate />
        </MemoryRouter>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/отправили запрос в Telegram/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("admin-portal-nav-users")).toBeNull();
    expect(callCount).toBeGreaterThan(0);
  });

  it("falls back to login when adminSession returns 401", async () => {
    setupLocalStorage({ admin_access_token: "stale" });
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    await act(async () => {
      render(
        <MemoryRouter>
          <AdminAccessGate />
        </MemoryRouter>,
      );
    });

    expect(await screen.findByTestId("admin-portal-login")).toBeInTheDocument();
    // adminFetch при 401 должен очистить token.
    expect(window.localStorage.getItem("admin_access_token")).toBe(null);
  });
});
