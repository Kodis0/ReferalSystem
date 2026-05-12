/**
 * AdminMfaGate: step-up подтверждение для админ-кабинета.
 *
 * Покрывает:
 *   - блокировку children когда сессия не elevated;
 *   - render children когда сессия уже elevated;
 *   - Telegram MFA: challenge → input → verify success → children;
 *   - Telegram MFA: device-not-configured показывает inline hint;
 *   - dev-confirm fallback (старый flow продолжает работать).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminMfaGate from "../pages/lk/admin/AdminMfaGate";

jest.mock("../components/toast/toastBus", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

function makeOkJson(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function makeErrorJson(status, payload) {
  return { ok: false, status, json: async () => payload };
}

describe("AdminMfaGate", () => {
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
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
  });

  it("blocks children and shows confirm screen when session is not elevated", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeOkJson({ is_elevated: false, elevated_until: null, confirmed_with: null }),
    );

    render(
      <AdminMfaGate>
        <div>ADMIN_CONTENT</div>
      </AdminMfaGate>,
    );

    expect(
      await screen.findByRole("heading", { name: "Подтверждение администратора" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Отправить код в Telegram" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Подтвердить для разработки" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("ADMIN_CONTENT")).not.toBeInTheDocument();
  });

  it("renders children when session is already elevated", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeOkJson({
        is_elevated: true,
        elevated_until: "2026-12-31T00:00:00Z",
        confirmed_with: "telegram",
      }),
    );

    render(
      <AdminMfaGate>
        <div>ADMIN_CONTENT</div>
      </AdminMfaGate>,
    );

    expect(await screen.findByText("ADMIN_CONTENT")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Подтверждение администратора" }),
    ).not.toBeInTheDocument();
  });

  it("shows code input after successful Telegram challenge", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeOkJson({ is_elevated: false, elevated_until: null, confirmed_with: null }),
      )
      .mockResolvedValueOnce(makeOkJson({ detail: "Код отправлен в Telegram", expires_in: 300 }));

    render(
      <AdminMfaGate>
        <div>ADMIN_CONTENT</div>
      </AdminMfaGate>,
    );

    const challengeBtn = await screen.findByRole("button", {
      name: "Отправить код в Telegram",
    });
    fireEvent.click(challengeBtn);

    expect(await screen.findByLabelText("Код из Telegram")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Подтвердить" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Назад" })).toBeInTheDocument();
    expect(
      screen.getByText("Код отправлен в Telegram. Введите 6 цифр."),
    ).toBeInTheDocument();

    const calls = fetchSpy.mock.calls;
    expect(String(calls[1][0])).toContain("/users/admin/mfa/telegram/challenge/");
    expect(calls[1][1]).toMatchObject({ method: "POST" });
  });

  it("verifies code via Telegram and reveals children", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeOkJson({ is_elevated: false, elevated_until: null, confirmed_with: null }),
      )
      .mockResolvedValueOnce(makeOkJson({ detail: "Код отправлен в Telegram", expires_in: 300 }))
      .mockResolvedValueOnce(
        makeOkJson({
          is_elevated: true,
          elevated_until: "2026-12-31T00:00:00Z",
          confirmed_with: "telegram",
        }),
      );

    render(
      <AdminMfaGate>
        <div>ADMIN_CONTENT</div>
      </AdminMfaGate>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Отправить код в Telegram" }),
    );
    const input = await screen.findByLabelText("Код из Telegram");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));

    expect(await screen.findByText("ADMIN_CONTENT")).toBeInTheDocument();

    const calls = fetchSpy.mock.calls;
    expect(String(calls[2][0])).toContain("/users/admin/mfa/telegram/verify/");
    expect(calls[2][1]).toMatchObject({ method: "POST" });
    expect(calls[2][1].body).toBe(JSON.stringify({ code: "123456" }));
  });

  it("shows the device-not-configured hint when Telegram MFA is not bound", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeOkJson({ is_elevated: false, elevated_until: null, confirmed_with: null }),
      )
      .mockResolvedValueOnce(
        makeErrorJson(400, {
          detail: "Telegram MFA не настроен",
          code: "TELEGRAM_MFA_DEVICE_NOT_CONFIGURED",
        }),
      );

    render(
      <AdminMfaGate>
        <div>ADMIN_CONTENT</div>
      </AdminMfaGate>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Отправить код в Telegram" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          "Telegram MFA не настроен. Привяжите Telegram device через Django admin или следующий шаг настройки.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("Код из Telegram")).not.toBeInTheDocument();
    expect(screen.queryByText("ADMIN_CONTENT")).not.toBeInTheDocument();
  });

  it("offers Telegram bind on device-not-configured and walks through bind/start → challenge → code", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeOkJson({ is_elevated: false, elevated_until: null, confirmed_with: null }),
      )
      .mockResolvedValueOnce(
        makeErrorJson(400, {
          detail: "Telegram MFA не настроен",
          code: "TELEGRAM_MFA_DEVICE_NOT_CONFIGURED",
        }),
      )
      .mockResolvedValueOnce(
        makeOkJson({
          bot_link: "https://t.me/testbot?start=AAA",
          expires_in: 600,
          purpose: "initial_bind",
        }),
      )
      .mockResolvedValueOnce(makeOkJson({ detail: "Код отправлен", expires_in: 300 }));

    render(
      <AdminMfaGate>
        <div>ADMIN_CONTENT</div>
      </AdminMfaGate>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Отправить код в Telegram" }),
    );

    const bindBtn = await screen.findByRole("button", { name: "Привязать Telegram" });
    fireEvent.click(bindBtn);

    const openLink = await screen.findByRole("link", { name: "Открыть Telegram" });
    expect(openLink).toHaveAttribute("href", "https://t.me/testbot?start=AAA");
    expect(openLink).toHaveAttribute("target", "_blank");
    expect(
      screen.getByRole("button", { name: "Я привязал Telegram" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Я привязал Telegram" }));

    expect(await screen.findByLabelText("Код из Telegram")).toBeInTheDocument();

    const calls = fetchSpy.mock.calls;
    expect(String(calls[1][0])).toContain("/users/admin/mfa/telegram/challenge/");
    expect(String(calls[2][0])).toContain("/users/admin/mfa/telegram/bind/start/");
    expect(calls[2][1]).toMatchObject({ method: "POST" });
    expect(String(calls[3][0])).toContain("/users/admin/mfa/telegram/challenge/");
  });

  it("shows bootstrap-required message when bind/start returns TELEGRAM_MFA_BOOTSTRAP_REQUIRED", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeOkJson({ is_elevated: false, elevated_until: null, confirmed_with: null }),
      )
      .mockResolvedValueOnce(
        makeErrorJson(400, {
          detail: "Telegram MFA не настроен",
          code: "TELEGRAM_MFA_DEVICE_NOT_CONFIGURED",
        }),
      )
      .mockResolvedValueOnce(
        makeErrorJson(403, {
          detail: "Первичная привязка Telegram доступна только суперадминистратору",
          code: "TELEGRAM_MFA_BOOTSTRAP_REQUIRED",
        }),
      );

    render(
      <AdminMfaGate>
        <div>ADMIN_CONTENT</div>
      </AdminMfaGate>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Отправить код в Telegram" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Привязать Telegram" }),
    );

    expect(await screen.findByText(/суперадминистратор/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Открыть Telegram" })).not.toBeInTheDocument();
  });

  it("posts dev-confirm on button click and reveals children after re-fetch returns elevated", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        makeOkJson({ is_elevated: false, elevated_until: null, confirmed_with: null }),
      )
      .mockResolvedValueOnce(makeOkJson({ is_elevated: true, confirmed_with: "development" }))
      .mockResolvedValueOnce(
        makeOkJson({
          is_elevated: true,
          elevated_until: "2026-12-31T00:00:00Z",
          confirmed_with: "development",
        }),
      );

    render(
      <AdminMfaGate>
        <div>ADMIN_CONTENT</div>
      </AdminMfaGate>,
    );

    const btn = await screen.findByRole("button", { name: "Подтвердить для разработки" });
    fireEvent.click(btn);

    expect(await screen.findByText("ADMIN_CONTENT")).toBeInTheDocument();

    const calls = fetchSpy.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(String(calls[0][0])).toContain("/users/admin/session/");
    expect(String(calls[1][0])).toContain("/users/admin/session/dev-confirm/");
    expect(calls[1][1]).toMatchObject({ method: "POST" });
    expect(String(calls[2][0])).toContain("/users/admin/session/");
  });
});
