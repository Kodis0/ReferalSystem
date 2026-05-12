import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import "./admin.css";

/**
 * Кастомный dropdown в стиле popover `.lk-header__menu` для admin toolbars.
 *
 * Не использует native `<select>` — управление полностью на React state.
 * Контракт `onChange(nextValue: string)` совпадает с `(e) => setX(e.target.value)`,
 * так что переход со `<select>` без изменения сигнатур страниц.
 *
 * A11y: combobox-trigger + listbox-popover (`aria-activedescendant`, `aria-selected`).
 */
export default function AdminPortalDropdown({
  id,
  label,
  ariaLabel,
  value,
  onChange,
  options,
  placeholder = "",
  dataTestId,
  minWidth = "140px",
}) {
  const autoId = useId();
  const resolvedId = id || `admin-portal-dropdown-${autoId}`;
  const listboxId = `${resolvedId}-listbox`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listboxRef = useRef(null);

  const items = useMemo(
    () => (Array.isArray(options) ? options : []),
    [options],
  );

  const selectableIndices = useMemo(
    () =>
      items
        .map((opt, idx) => ({ opt, idx }))
        .filter(({ opt }) => !opt.divider && !opt.disabled)
        .map(({ idx }) => idx),
    [items],
  );

  const selectedIndex = useMemo(() => {
    return items.findIndex((opt) => !opt.divider && opt.value === value);
  }, [items, value]);

  const triggerText = useMemo(() => {
    if (selectedIndex >= 0) return items[selectedIndex].label;
    return placeholder;
  }, [items, selectedIndex, placeholder]);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    if (triggerRef.current) triggerRef.current.focus();
  }, []);

  const openMenu = useCallback(
    (preferIndex) => {
      setOpen(true);
      let next = preferIndex;
      if (typeof next !== "number" || next < 0) {
        next = selectedIndex >= 0 ? selectedIndex : selectableIndices[0] ?? -1;
      }
      setActiveIndex(next);
    },
    [selectedIndex, selectableIndices],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open && listboxRef.current) {
      listboxRef.current.focus({ preventScroll: true });
    }
  }, [open]);

  const moveActive = useCallback(
    (delta) => {
      if (selectableIndices.length === 0) return;
      const currentPos = selectableIndices.indexOf(activeIndex);
      let nextPos;
      if (currentPos === -1) {
        nextPos = delta > 0 ? 0 : selectableIndices.length - 1;
      } else {
        nextPos =
          (currentPos + delta + selectableIndices.length) %
          selectableIndices.length;
      }
      setActiveIndex(selectableIndices[nextPos]);
    },
    [activeIndex, selectableIndices],
  );

  const commitSelection = useCallback(
    (idx) => {
      const opt = items[idx];
      if (!opt || opt.divider || opt.disabled) return;
      if (typeof onChange === "function") onChange(opt.value);
      setOpen(false);
      setActiveIndex(-1);
      if (triggerRef.current) triggerRef.current.focus();
    },
    [items, onChange],
  );

  const onTriggerKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu();
    }
  };

  const onListboxKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) commitSelection(activeIndex);
    } else if (e.key === "Tab") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const optionId = (idx) => `${resolvedId}-option-${idx}`;

  return (
    <div
      ref={rootRef}
      className="admin-portal-dropdown"
      style={{ "--admin-dropdown-min-width": typeof minWidth === "number" ? `${minWidth}px` : minWidth }}
    >
      <button
        ref={triggerRef}
        id={resolvedId}
        type="button"
        className="admin-portal-dropdown__trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel || label || undefined}
        data-testid={dataTestId}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="admin-portal-dropdown__trigger-label">{triggerText}</span>
        <span
          className={
            "admin-portal-dropdown__chevron" +
            (open ? " admin-portal-dropdown__chevron--open" : "")
          }
          aria-hidden="true"
        >
          <ChevronDown size={16} strokeWidth={1.75} />
        </span>
      </button>
      {open ? (
        <ul
          ref={listboxRef}
          id={listboxId}
          className="admin-portal-dropdown__menu"
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={
            activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          onKeyDown={onListboxKeyDown}
        >
          {items.map((opt, idx) => {
            if (opt.divider) {
              return (
                <li
                  key={`divider-${idx}`}
                  role="presentation"
                  aria-hidden="true"
                >
                  <hr className="admin-portal-dropdown__divider" />
                </li>
              );
            }
            const isSelected = idx === selectedIndex;
            const isActive = idx === activeIndex;
            const isDisabled = Boolean(opt.disabled);
            const className =
              "admin-portal-dropdown__option" +
              (isActive ? " admin-portal-dropdown__option--active" : "") +
              (isSelected ? " admin-portal-dropdown__option--selected" : "") +
              (isDisabled ? " admin-portal-dropdown__option--disabled" : "");
            return (
              <li
                key={`${opt.value}-${idx}`}
                id={optionId(idx)}
                role="option"
                aria-selected={isSelected}
                aria-disabled={isDisabled || undefined}
                className={className}
                data-value={opt.value}
                onMouseEnter={() => {
                  if (!isDisabled) setActiveIndex(idx);
                }}
                onClick={() => {
                  if (!isDisabled) commitSelection(idx);
                }}
              >
                <span className="admin-portal-dropdown__option-check" aria-hidden="true">
                  {isSelected ? <Check size={14} strokeWidth={2} /> : null}
                </span>
                <span className="admin-portal-dropdown__option-label">
                  {opt.label}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
