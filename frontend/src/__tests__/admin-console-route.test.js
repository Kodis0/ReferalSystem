/**
 * /admin-console/* — изолированный admin portal без LK-guard'ов.
 *
 * Покрывает:
 *   - без admin_access_token → видим Lumoref Admin header + AdminLoginForm;
 *   - с admin_access_token и elevated session → видим нав-пункты (Пользователи и т.п.).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

jest.mock("../components/toast/toastBus", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

import AdminCabinet from "../pages/lk/admin/AdminCabinet";

function renderRoute({ initialPath = "/admin-console" } = {}) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/admin-console/*" element={<AdminCabinet />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("/admin-console/* admin portal", () => {
  const originalLocalStorage = global.localStorage;
  let fetchSpy;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: (() => {
        const store = {};
        return {
          getItem: jest.fn((k) => (k in store ? store[k] : null)),
          setItem: jest.fn((k, v) => {
            store[k] = String(v);
          }),
          removeItem: jest.fn((k) => {
            delete store[k];
          }),
        };
      })(),
      configurable: true,
    });
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it("renders AdminLoginForm when no admin_access_token", async () => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });

    renderRoute();

    expect(screen.getByText("Lumoref Admin")).toBeInTheDocument();
    expect(await screen.findByTestId("admin-portal-login")).toBeInTheDocument();
    expect(screen.getByTestId("admin-portal-login-email")).toBeInTheDocument();
    expect(screen.queryByText("Пользователи")).not.toBeInTheDocument();
  });

  it("renders nav sections when admin_access_token + elevated session", async () => {
    window.localStorage.setItem("admin_access_token", "test-admin-token");
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        is_elevated: true,
        elevated_until: "2030-01-01T00:00:00Z",
        confirmed_with: "telegram_approval",
      }),
    });

    await act(async () => {
      renderRoute();
    });

    await waitFor(() => {
      expect(screen.getByTestId("admin-portal-nav-users")).toBeInTheDocument();
    });
    expect(screen.getByText("Lumoref Admin")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-portal-login")).not.toBeInTheDocument();
  });
});
