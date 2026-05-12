/**
 * AdminUserDetailPage: read-only детали пользователя в админ-кабинете + Шаг 7 (block/unblock).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminUserDetailPage from "../pages/lk/admin/AdminUserDetailPage";
import useCurrentUser from "../hooks/useCurrentUser";

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

function makeUserPayload(overrides = {}) {
  return {
    id: 1,
    public_id: "abc",
    email: "alice@example.com",
    username: "aliceuser",
    fio: "Алиса Тестовая",
    phone: "+79990001122",
    account_type: "individual",
    is_active: true,
    is_staff: false,
    is_superuser: false,
    account_owner_id: null,
    additional_users_count: 0,
    owned_projects_count: 0,
    owned_sites_count: 0,
    partner_profile: null,
    date_joined: "2026-01-01T10:00:00Z",
    last_login: null,
    ...overrides,
  };
}

function renderPage(initialUserId = 1) {
  return render(
    <MemoryRouter initialEntries={[`/lk/admin/users/${initialUserId}`]}>
      <Routes>
        <Route path="/lk/admin/users/:userId" element={<AdminUserDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminUserDetailPage", () => {
  let fetchSpy;
  const originalLocalStorage = global.localStorage;

  beforeEach(() => {
    useCurrentUser.mockReturnValue({
      user: { id: 99, is_staff: true, is_superuser: false },
      loading: false,
    });

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
      json: async () => makeUserPayload(),
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

  it("renders fetched user detail for the route :userId", async () => {
    renderPage(1);

    const emailNodes = await screen.findAllByText("alice@example.com");
    expect(emailNodes.length).toBeGreaterThan(0);
    expect(screen.getByText("Алиса Тестовая")).toBeInTheDocument();
    expect(screen.getByText("Партнёрский профиль не создан")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("/users/admin/users/1/");
  });

  it("показывает кнопку «Заблокировать пользователя» когда target.is_active=true и not self", async () => {
    renderPage(1);

    await screen.findAllByText("alice@example.com");
    const btn = await screen.findByRole("button", { name: "Заблокировать пользователя" });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("click + confirm → POST adminUserSetActive → state обновился, кнопка стала «Разблокировать»", async () => {
    fetchSpy.mockReset();
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeUserPayload({ is_active: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeUserPayload({ is_active: false }),
      });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    renderPage(1);
    await screen.findAllByText("alice@example.com");
    const btn = await screen.findByRole("button", { name: "Заблокировать пользователя" });
    fireEvent.click(btn);

    await screen.findByRole("button", { name: "Разблокировать пользователя" });
    expect(confirmSpy).toHaveBeenCalled();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const postCall = fetchSpy.mock.calls[1];
    expect(String(postCall[0])).toContain("/users/admin/users/1/active/");
    expect(postCall[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(postCall[1].body)).toEqual({ is_active: false });
  });

  it("cancel в confirm → не отправляет POST и состояние не меняется", async () => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeUserPayload({ is_active: true }),
    });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);

    renderPage(1);
    await screen.findAllByText("alice@example.com");
    const btn = await screen.findByRole("button", { name: "Заблокировать пользователя" });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Заблокировать пользователя" }),
    ).toBeInTheDocument();
  });

  it("target = self → кнопка disabled", async () => {
    useCurrentUser.mockReturnValue({
      user: { id: 1, is_staff: true, is_superuser: false },
      loading: false,
    });
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeUserPayload({ id: 1, is_active: true }),
    });

    renderPage(1);
    await screen.findAllByText("alice@example.com");
    const btn = await screen.findByRole("button", { name: "Заблокировать пользователя" });
    expect(btn).toBeDisabled();
  });
});
