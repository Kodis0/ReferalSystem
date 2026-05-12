/**
 * /lk/admin/* legacy redirect → /admin-console/*, сохраняя sub-path и query.
 *
 * Дублируем `LkAdminLegacyRedirect` из App.js, чтобы тест не подтягивал
 * тяжёлые модули (registration.js и пр.) при импорте App.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

function LkAdminLegacyRedirect() {
  const { pathname, search, hash } = useLocation();
  const rest = pathname.replace(/^\/lk\/admin/, "");
  return <Navigate to={`/admin-console${rest}${search || ""}${hash || ""}`} replace />;
}

function LocationProbe() {
  const { pathname, search } = useLocation();
  return (
    <div>
      <span data-testid="probe-pathname">{pathname}</span>
      <span data-testid="probe-search">{search}</span>
    </div>
  );
}

function renderWithEntry(initialEntry) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/lk/admin/*" element={<LkAdminLegacyRedirect />} />
        <Route path="/admin-console/*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LkAdminLegacyRedirect", () => {
  it("redirects /lk/admin → /admin-console", () => {
    renderWithEntry("/lk/admin");
    expect(screen.getByTestId("probe-pathname").textContent).toBe("/admin-console");
  });

  it("preserves sub-path: /lk/admin/users/42 → /admin-console/users/42", () => {
    renderWithEntry("/lk/admin/users/42");
    expect(screen.getByTestId("probe-pathname").textContent).toBe("/admin-console/users/42");
  });

  it("preserves nested sub-paths: /lk/admin/support/abc-123 → /admin-console/support/abc-123", () => {
    renderWithEntry("/lk/admin/support/abc-123");
    expect(screen.getByTestId("probe-pathname").textContent).toBe(
      "/admin-console/support/abc-123",
    );
  });

  it("preserves query string", () => {
    renderWithEntry("/lk/admin/users?page=2&filter=staff");
    expect(screen.getByTestId("probe-pathname").textContent).toBe("/admin-console/users");
    expect(screen.getByTestId("probe-search").textContent).toBe("?page=2&filter=staff");
  });
});
