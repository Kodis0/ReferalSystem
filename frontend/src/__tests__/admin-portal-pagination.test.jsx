/**
 * AdminPortalPagination: пагинация в стиле OwnerActivityHistoryPanel
 * (Назад, номера с …-ellipsis, Вперёд).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

import AdminPortalPagination from "../pages/lk/admin/AdminPortalPagination";

describe("AdminPortalPagination", () => {
  test("renders root nav with default aria-label and Назад / Вперёд buttons", () => {
    render(
      <AdminPortalPagination page={1} numPages={5} count={42} onPageChange={() => {}} />,
    );
    const nav = screen.getByRole("navigation", { name: /Постраничная навигация/i });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Назад/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Вперёд/i })).toBeInTheDocument();
  });

  test("Назад disabled on first page, Вперёд enabled", () => {
    render(<AdminPortalPagination page={1} numPages={5} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Назад/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Вперёд/i })).not.toBeDisabled();
  });

  test("Вперёд disabled on last page, Назад enabled", () => {
    render(<AdminPortalPagination page={5} numPages={5} onPageChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Вперёд/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Назад/i })).not.toBeDisabled();
  });

  test("clicking Вперёд calls onPageChange(page + 1)", () => {
    const onPageChange = jest.fn();
    render(<AdminPortalPagination page={2} numPages={5} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Вперёд/i }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  test("clicking Назад calls onPageChange(page - 1)", () => {
    const onPageChange = jest.fn();
    render(<AdminPortalPagination page={3} numPages={5} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Назад/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  test("renders ALL numbers when numPages <= 7", () => {
    render(<AdminPortalPagination page={3} numPages={5} onPageChange={() => {}} />);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^Страница ${n}$`) }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: /^Страница 6$/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("…")).not.toBeInTheDocument();
  });

  test("renders first/last + ±1 around current with ellipsis when numPages > 7", () => {
    render(<AdminPortalPagination page={6} numPages={12} onPageChange={() => {}} />);
    for (const n of [1, 5, 6, 7, 12]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^Страница ${n}$`) }),
      ).toBeInTheDocument();
    }
    for (const n of [2, 3, 4, 8, 9, 10, 11]) {
      expect(
        screen.queryByRole("button", { name: new RegExp(`^Страница ${n}$`) }),
      ).not.toBeInTheDocument();
    }
    expect(screen.getAllByText("…").length).toBeGreaterThanOrEqual(1);
  });

  test("clicking a number calls onPageChange(n) and active number is disabled", () => {
    const onPageChange = jest.fn();
    render(
      <AdminPortalPagination page={2} numPages={5} onPageChange={onPageChange} />,
    );
    const active = screen.getByRole("button", { name: /^Страница 2$/ });
    expect(active).toBeDisabled();
    expect(active).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("button", { name: /^Страница 4$/ }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  test("renders count info when count is provided", () => {
    render(
      <AdminPortalPagination page={1} numPages={5} count={42} onPageChange={() => {}} />,
    );
    expect(screen.getByText(/всего\s+42/i)).toBeInTheDocument();
  });

  test("returns null when numPages <= 1 and no count", () => {
    const { container } = render(
      <AdminPortalPagination page={1} numPages={1} onPageChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("renders only info span when numPages <= 1 and count is provided", () => {
    render(
      <AdminPortalPagination page={1} numPages={1} count={0} onPageChange={() => {}} />,
    );
    expect(screen.getByRole("navigation", { name: /Постраничная/i })).toBeInTheDocument();
    expect(screen.getByText(/всего\s+0/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Назад/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Вперёд/i })).not.toBeInTheDocument();
  });
});
