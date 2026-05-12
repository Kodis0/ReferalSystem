/**
 * AdminLoginForm: изолированная форма входа в `/admin-console`.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminLoginForm from "../pages/lk/admin/AdminLoginForm";

describe("AdminLoginForm", () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
  });

  it("renders email and password inputs", () => {
    render(<AdminLoginForm onSuccess={() => {}} />);
    expect(screen.getByTestId("admin-portal-login-email")).toBeInTheDocument();
    expect(screen.getByTestId("admin-portal-login-password")).toBeInTheDocument();
    expect(screen.getByTestId("admin-portal-login-submit")).toBeInTheDocument();
  });

  it("calls /users/admin/login/ with credentials on submit", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access: "A", refresh: "R" }),
    });
    const onSuccess = jest.fn();
    render(<AdminLoginForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByTestId("admin-portal-login-email"), {
      target: { value: "a@b.c" },
    });
    fireEvent.change(screen.getByTestId("admin-portal-login-password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByTestId("admin-portal-login-submit"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [calledUrl, calledOptions] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toContain("/users/admin/login/");
    expect(calledOptions.method).toBe("POST");
    expect(JSON.parse(calledOptions.body)).toEqual({ email: "a@b.c", password: "secret" });
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({ access: "A", refresh: "R" }),
    );
  });

  it("shows 'Неверный email или пароль' on 401", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: "x", code: "ADMIN_LOGIN_INVALID" }),
    });
    const onSuccess = jest.fn();
    render(<AdminLoginForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByTestId("admin-portal-login-email"), {
      target: { value: "a@b.c" },
    });
    fireEvent.change(screen.getByTestId("admin-portal-login-password"), {
      target: { value: "bad" },
    });
    fireEvent.click(screen.getByTestId("admin-portal-login-submit"));

    expect(await screen.findByTestId("admin-portal-login-error")).toHaveTextContent(
      "Неверный email или пароль",
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("shows 'Этот аккаунт не является администратором' on 403 ADMIN_LOGIN_NOT_STAFF", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: "x", code: "ADMIN_LOGIN_NOT_STAFF" }),
    });
    render(<AdminLoginForm onSuccess={() => {}} />);

    fireEvent.change(screen.getByTestId("admin-portal-login-email"), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByTestId("admin-portal-login-password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByTestId("admin-portal-login-submit"));

    expect(await screen.findByTestId("admin-portal-login-error")).toHaveTextContent(
      "Этот аккаунт не является администратором",
    );
  });

  it("calls onSuccess with tokens on 200", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access: "ACC", refresh: "REF" }),
    });
    const onSuccess = jest.fn();
    render(<AdminLoginForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByTestId("admin-portal-login-email"), {
      target: { value: "a@b.c" },
    });
    fireEvent.change(screen.getByTestId("admin-portal-login-password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByTestId("admin-portal-login-submit"));

    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({ access: "ACC", refresh: "REF" }),
    );
  });
});
