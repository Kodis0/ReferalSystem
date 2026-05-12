/**
 * AdminSupportTicketDetailPage: детали обращения + close/reopen toggle.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminSupportTicketDetailPage from "../pages/lk/admin/AdminSupportTicketDetailPage";

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

const TICKET_ID = "11111111-1111-1111-1111-111111111111";

function makeTicketPayload(overrides = {}) {
  return {
    id: TICKET_ID,
    user_id: 42,
    user_email: "alice@example.com",
    user_public_id: "abc1234",
    type_slug: "help-question",
    target_key: "tg-1",
    target_label: "Hello",
    body: "BODY_CONTENT",
    attachment_names: "",
    is_closed: false,
    closed_at: null,
    created_at: "2026-01-01T10:00:00Z",
    ...overrides,
  };
}

function renderPage(initialTicketId = TICKET_ID) {
  return render(
    <MemoryRouter initialEntries={[`/lk/admin/support/${initialTicketId}`]}>
      <Routes>
        <Route
          path="/lk/admin/support/:ticketId"
          element={<AdminSupportTicketDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminSupportTicketDetailPage", () => {
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
      json: async () => makeTicketPayload(),
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

  it("renders fetched ticket detail with body content", async () => {
    renderPage();

    expect(await screen.findByText("BODY_CONTENT")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain(`/users/admin/support-tickets/${TICKET_ID}/`);
  });

  it("click + confirm → PATCH adminSupportTicketUpdate → state обновился, кнопка стала «Открыть обращение»", async () => {
    fetchSpy.mockReset();
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeTicketPayload({ is_closed: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          makeTicketPayload({ is_closed: true, closed_at: "2026-01-02T10:00:00Z" }),
      });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    renderPage();
    await screen.findByText("BODY_CONTENT");
    const btn = await screen.findByRole("button", { name: "Закрыть обращение" });
    fireEvent.click(btn);

    await screen.findByRole("button", { name: "Открыть обращение" });
    expect(confirmSpy).toHaveBeenCalled();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const patchCall = fetchSpy.mock.calls[1];
    expect(String(patchCall[0])).toContain(
      `/users/admin/support-tickets/${TICKET_ID}/`,
    );
    expect(patchCall[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(patchCall[1].body)).toEqual({ is_closed: true });
  });

  it("cancel в confirm → не отправляет PATCH и состояние не меняется", async () => {
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeTicketPayload({ is_closed: false }),
    });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);

    renderPage();
    await screen.findByText("BODY_CONTENT");
    const btn = await screen.findByRole("button", { name: "Закрыть обращение" });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Закрыть обращение" }),
    ).toBeInTheDocument();
  });
});
