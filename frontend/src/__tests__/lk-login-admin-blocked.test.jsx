/**
 * Login: при ответе backend'а ADMIN_USE_ADMIN_CONSOLE показывается ссылка на /admin-console.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

jest.mock("../components/toast/toastBus", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

import Login from "../pages/login/login";

describe("Lk login: admin-blocked hint", () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation((url) => {
      const urlStr = String(url);
      if (urlStr.includes("/users/token/")) {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({
            detail: "Этот аккаунт администратора. Используйте /admin-console для входа.",
            code: "ADMIN_USE_ADMIN_CONSOLE",
          }),
        });
      }
      // password-reset captcha и др. — нейтральный ответ
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    });
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
  });

  it("shows admin-console link on ADMIN_USE_ADMIN_CONSOLE response", async () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    const emailInput = await waitFor(() => {
      const el = document.querySelector("input#email");
      if (!el) throw new Error("email input not found");
      return el;
    });
    fireEvent.change(emailInput, { target: { value: "admin@example.com" } });

    const passwordInput = document.querySelector("input#password");
    expect(passwordInput).toBeTruthy();
    fireEvent.change(passwordInput, { target: { value: "secret123" } });

    const submitBtn = screen.getByTestId("submit-form-btn");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const link = screen.queryByTestId("login-admin-console-link");
      expect(link).not.toBeNull();
    });

    const link = screen.getByTestId("login-admin-console-link");
    expect(link).toHaveAttribute("href", "/admin-console");
  });
});
