/**
 * /admin-console/* — top-level route guard chain (ProtectedRoute → AdminProtectedRoute → AdminCabinet).
 *
 * Покрывает:
 *   - non-staff пользователь редиректится из админ-портала (на /lk/dashboard);
 *   - staff с валидным токеном видит AdminCabinet shell ("Lumoref Admin").
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProtectedRoute from "../components/protectedroute";
import AdminProtectedRoute from "../components/AdminProtectedRoute";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../components/toast/toastBus", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock("../pages/lk/admin/AdminMfaGate", () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="admin-mfa-gate-stub">{children}</div>,
}));

import useCurrentUser from "../hooks/useCurrentUser";
import AdminCabinet from "../pages/lk/admin/AdminCabinet";

function makeValidJwt() {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64");
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64");
  return `${header}.${payload}.sig`;
}

function renderAdminConsoleRoute({ initialPath = "/admin-console" } = {}) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/admin-console/*"
          element={
            <ProtectedRoute>
              <AdminProtectedRoute>
                <AdminCabinet />
              </AdminProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div data-testid="login-page">LOGIN_PAGE</div>} />
        <Route path="/lk/dashboard" element={<div data-testid="dashboard-page">DASHBOARD_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("/admin-console/* route guard chain", () => {
  const originalLocalStorage = global.localStorage;

  afterEach(() => {
    useCurrentUser.mockReset();
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it("redirects to /login when access token is missing", () => {
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: jest.fn(() => null),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
      configurable: true,
    });
    useCurrentUser.mockReturnValue({ user: null, loading: false });

    renderAdminConsoleRoute();

    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByText(/Lumoref Admin/)).not.toBeInTheDocument();
  });

  it("redirects non-staff user to /lk/dashboard even with valid token", () => {
    const token = makeValidJwt();
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: jest.fn((key) => (key === "access_token" ? token : null)),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
      configurable: true,
    });
    useCurrentUser.mockReturnValue({ user: { is_staff: false }, loading: false });

    renderAdminConsoleRoute();

    expect(screen.getByTestId("dashboard-page")).toBeInTheDocument();
    expect(screen.queryByText(/Lumoref Admin/)).not.toBeInTheDocument();
  });

  it("renders AdminCabinet shell for staff user with valid token", () => {
    const token = makeValidJwt();
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: jest.fn((key) => (key === "access_token" ? token : null)),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
      configurable: true,
    });
    useCurrentUser.mockReturnValue({
      user: { is_staff: true, email: "admin@example.com" },
      loading: false,
    });

    renderAdminConsoleRoute();

    expect(screen.getByText("Lumoref Admin")).toBeInTheDocument();
    expect(screen.getByTestId("admin-portal-logout")).toBeInTheDocument();
    expect(screen.getByTestId("admin-mfa-gate-stub")).toBeInTheDocument();
  });
});
