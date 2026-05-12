/**
 * AdminProtectedRoute: гард для админ-разделов ЛК.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminProtectedRoute from "../components/AdminProtectedRoute";
import useCurrentUser from "../hooks/useCurrentUser";
import { toast } from "../components/toast/toastBus";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../components/toast/toastBus", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

function renderRoutes() {
  return render(
    <MemoryRouter initialEntries={["/lk/admin"]}>
      <Routes>
        <Route
          path="/lk/admin"
          element={
            <AdminProtectedRoute>
              <div>ADMIN_CONTENT</div>
            </AdminProtectedRoute>
          }
        />
        <Route path="/lk/dashboard" element={<div>DASHBOARD_CONTENT</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminProtectedRoute", () => {
  beforeEach(() => {
    useCurrentUser.mockReset();
    toast.error.mockReset();
  });

  it("redirects non-admin user to /lk/dashboard and shows error toast", () => {
    useCurrentUser.mockReturnValue({ user: { is_staff: false }, loading: false });

    renderRoutes();

    expect(screen.queryByText("ADMIN_CONTENT")).not.toBeInTheDocument();
    expect(screen.getByText("DASHBOARD_CONTENT")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Доступ только для администраторов");
  });

  it("renders children for admin user (is_staff=true)", () => {
    useCurrentUser.mockReturnValue({ user: { is_staff: true }, loading: false });

    renderRoutes();

    expect(screen.getByText("ADMIN_CONTENT")).toBeInTheDocument();
    expect(screen.queryByText("DASHBOARD_CONTENT")).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("redirects when user is null (not authenticated)", () => {
    useCurrentUser.mockReturnValue({ user: null, loading: false });

    renderRoutes();

    expect(screen.queryByText("ADMIN_CONTENT")).not.toBeInTheDocument();
    expect(screen.getByText("DASHBOARD_CONTENT")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Доступ только для администраторов");
  });
});
