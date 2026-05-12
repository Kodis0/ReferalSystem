/**
 * AdminUsersPage: read-only список пользователей админ-кабинета.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminUsersPage from "../pages/lk/admin/AdminUsersPage";

jest.mock("../hooks/useCurrentUser", () => ({
  __esModule: true,
  default: jest.fn(() => ({ user: { is_staff: true }, loading: false })),
}));

describe("AdminUsersPage", () => {
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
      json: async () => ({
        count: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
        results: [
          {
            id: 1,
            public_id: "abc1234",
            email: "alice@example.com",
            fio: "Алиса Тестовая",
            phone: "+79990001122",
            is_staff: false,
            is_active: true,
            is_superuser: false,
            account_owner_id: null,
            date_joined: "2026-01-01T10:00:00Z",
            last_login: null,
          },
        ],
      }),
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it("renders fetched user row with email and public_id", async () => {
    render(
      <MemoryRouter>
        <AdminUsersPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByText("Алиса Тестовая")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/users/admin/users/");
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("page_size=20");
  });
});
