/**
 * AdminPortalDropdown: кастомный popover-dropdown в admin toolbars.
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";

import AdminPortalDropdown from "../pages/lk/admin/AdminPortalDropdown";

const BASIC_OPTIONS = [
  { value: "", label: "Все" },
  { value: "true", label: "Активные" },
  { value: "false", label: "Заблокированные" },
];

function setup(overrides = {}) {
  const onChange = jest.fn();
  const utils = render(
    <AdminPortalDropdown
      ariaLabel="Фильтр"
      value=""
      onChange={onChange}
      options={BASIC_OPTIONS}
      {...overrides}
    />,
  );
  return { onChange, ...utils };
}

describe("AdminPortalDropdown", () => {
  it("renders trigger with current selected option label", () => {
    setup({ value: "true" });
    const trigger = screen.getByRole("combobox", { name: "Фильтр" });
    expect(trigger).toHaveTextContent("Активные");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("falls back to placeholder when value is unknown", () => {
    setup({ value: "missing", placeholder: "Выберите" });
    expect(screen.getByRole("combobox", { name: "Фильтр" })).toHaveTextContent(
      "Выберите",
    );
  });

  it("opens listbox on trigger click and renders all options", () => {
    setup();
    fireEvent.click(screen.getByRole("combobox", { name: "Фильтр" }));
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("combobox", { name: "Фильтр" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("selects an option on click and closes the listbox", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("combobox", { name: "Фильтр" }));
    fireEvent.click(screen.getByRole("option", { name: "Заблокированные" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on Escape without calling onChange", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("combobox", { name: "Фильтр" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ArrowDown/ArrowUp moves highlight and Enter commits selection", () => {
    const { onChange } = setup({ value: "" });
    fireEvent.click(screen.getByRole("combobox", { name: "Фильтр" }));
    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("false");
  });

  it("closes on outside pointerdown without changing value", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("combobox", { name: "Фильтр" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled option is not selectable", () => {
    const onChange = jest.fn();
    render(
      <AdminPortalDropdown
        ariaLabel="Фильтр"
        value=""
        onChange={onChange}
        options={[
          { value: "", label: "Все" },
          { value: "blocked", label: "Заблокировано", disabled: true },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Фильтр" }));
    fireEvent.click(screen.getByRole("option", { name: "Заблокировано" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});
