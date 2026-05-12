/**
 * LkSidebar: после изоляции админ-портала ссылка «Админ» не отображается
 * ни для обычных пользователей, ни для staff.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LkSidebar from "../pages/lk/LkSidebar";

jest.mock("../pages/lk/owner-programs/ownerSitesListApi", () => ({
  __esModule: true,
  fetchOwnerSitesList: jest.fn(async () => ({ ok: true, projects: [] })),
}));

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(),
}));

import useCurrentUser from "../hooks/useCurrentUser";
import { fetchOwnerSitesList } from "../pages/lk/owner-programs/ownerSitesListApi";

describe("LkSidebar (admin portal isolation)", () => {
  beforeEach(() => {
    useCurrentUser.mockReset();
    fetchOwnerSitesList.mockClear();
    fetchOwnerSitesList.mockResolvedValue({ ok: true, projects: [] });
  });

  function renderSidebar() {
    return render(
      <MemoryRouter initialEntries={["/lk/dashboard"]}>
        <LkSidebar />
      </MemoryRouter>,
    );
  }

  it("does not show «Админ» link for staff users", async () => {
    useCurrentUser.mockReturnValue({ user: { is_staff: true, email: "admin@example.com" }, loading: false });

    renderSidebar();

    await waitFor(() => expect(fetchOwnerSitesList).toHaveBeenCalled());
    expect(screen.queryByText(/Админ/i)).toBeNull();
    expect(screen.queryByTestId("lk-sidebar-admin-link")).toBeNull();
  });

  it("does not show «Админ» link for non-staff users", async () => {
    useCurrentUser.mockReturnValue({ user: { is_staff: false, email: "user@example.com" }, loading: false });

    renderSidebar();

    await waitFor(() => expect(fetchOwnerSitesList).toHaveBeenCalled());
    expect(screen.queryByText(/Админ/i)).toBeNull();
    expect(screen.queryByTestId("lk-sidebar-admin-link")).toBeNull();
  });
});
