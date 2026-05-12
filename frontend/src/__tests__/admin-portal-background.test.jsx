/**
 * AdminCabinet body-guard: предотвращает «протечку» фона лендинга/login/LK.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

jest.mock("../components/toast/toastBus", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock("../pages/lk/admin/AdminAccessGate", () => ({
  __esModule: true,
  default: () => <div data-testid="admin-access-gate-stub" />,
}));

import AdminCabinet from "../pages/lk/admin/AdminCabinet";

function renderAtAdminConsole() {
  return render(
    <MemoryRouter initialEntries={["/admin-console"]}>
      <Routes>
        <Route path="/admin-console/*" element={<AdminCabinet />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminCabinet body-guard", () => {
  const originalLocalStorage = global.localStorage;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: jest.fn(() => null),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
    document.documentElement.removeAttribute("data-admin-portal");
    document.body.removeAttribute("data-admin-portal");
    document.documentElement.removeAttribute("data-lk-page");
    document.body.removeAttribute("data-lk-page");
  });

  it("sets data-admin-portal on html and body when mounted", () => {
    const { unmount } = renderAtAdminConsole();

    expect(document.documentElement.getAttribute("data-admin-portal")).toBe("true");
    expect(document.body.getAttribute("data-admin-portal")).toBe("true");

    unmount();

    expect(document.documentElement.hasAttribute("data-admin-portal")).toBe(false);
    expect(document.body.hasAttribute("data-admin-portal")).toBe(false);
  });

  it("clears foreign data-lk-page while mounted and restores it on unmount", () => {
    document.documentElement.setAttribute("data-lk-page", "true");
    document.body.setAttribute("data-lk-page", "true");

    const { unmount } = renderAtAdminConsole();

    expect(document.documentElement.hasAttribute("data-lk-page")).toBe(false);
    expect(document.body.hasAttribute("data-lk-page")).toBe(false);
    expect(document.body.getAttribute("data-admin-portal")).toBe("true");

    unmount();

    expect(document.documentElement.getAttribute("data-lk-page")).toBe("true");
    expect(document.body.getAttribute("data-lk-page")).toBe("true");
    expect(document.body.hasAttribute("data-admin-portal")).toBe(false);
  });
});
