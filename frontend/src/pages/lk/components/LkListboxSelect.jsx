import { useLayoutEffect, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Кастомный listbox в стиле «Личные данные» (`lk-settings-personal-page__select-*`).
 * Родитель должен задавать CSS‑переменные `--lk-form-*` (см. `#lk-settings-personal-page` или `.owner-programs__lk-listbox-select-scope`).
 */
export default function LkListboxSelect({
  value,
  onChange,
  options,
  labelledBy,
  disabled,
  listboxId,
  dataTestId,
}) {
  const [open, setOpen] = useState(false);
  const [dropdownLayout, setDropdownLayout] = useState(null);
  const rootRef = useRef(null);
  const dropdownRef = useRef(null);
  const current = options.find((o) => o.value === value);
  const currentLabel = current?.label ?? String(value ?? "");
  const currentIcon = current?.icon;

  useLayoutEffect(() => {
    if (!open) {
      setDropdownLayout(null);
      return undefined;
    }
    const el = rootRef.current;
    if (!el) {
      setDropdownLayout(null);
      return undefined;
    }
    const gap = 4;
    const formVarNames = [
      "--lk-form-surface",
      "--lk-form-line-color",
      "--lk-form-text-color",
      "--lk-form-text-secondary",
      "--lk-form-radius-medium",
      "--lk-form-font-medium",
      "--lk-form-transition",
    ];

    const sync = () => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const cssVars = {};
      for (const name of formVarNames) {
        const v = cs.getPropertyValue(name).trim();
        if (v) cssVars[name] = v;
      }
      const themeLight = document.documentElement.getAttribute("data-theme") === "light";
      if (!cssVars["--lk-form-surface"]) {
        cssVars["--lk-form-surface"] = themeLight ? "#ffffff" : "#242f3d";
      }
      if (!cssVars["--lk-form-line-color"]) {
        cssVars["--lk-form-line-color"] = themeLight ? "rgba(15, 23, 42, 0.12)" : "#2c3743";
      }
      if (!cssVars["--lk-form-text-color"]) {
        cssVars["--lk-form-text-color"] = themeLight ? "#0f172a" : "#ffffff";
      }
      setDropdownLayout({
        top: r.bottom + gap,
        left: r.left,
        width: r.width,
        cssVars,
      });
    };
    sync();
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      const t = event.target;
      if (rootRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="lk-settings-personal-page__select-shell" ref={rootRef}>
      <button
        type="button"
        className="lk-settings-personal-page__select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={labelledBy}
        disabled={disabled}
        data-testid={dataTestId}
        onClick={() => setOpen((v) => !v)}
      >
        <div
          className={`lk-settings-personal-page__select-trigger-label${currentIcon ? " lk-settings-personal-page__select-trigger-label_row" : ""}`}
        >
          {currentIcon ? (
            <span className="lk-settings-personal-page__select-option-icon" aria-hidden>
              {currentIcon}
            </span>
          ) : null}
          <span className="lk-settings-personal-page__select-trigger-label-text">{currentLabel}</span>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          fill="none"
          viewBox="0 0 24 24"
          className={
            open
              ? "lk-settings-personal-page__select-trigger-arrow lk-settings-personal-page__select-trigger-arrow_open"
              : "lk-settings-personal-page__select-trigger-arrow"
          }
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M12 16a1 1 0 0 1-.64-.23l-5-4a1 1 0 0 1 1.28-1.54L12 13.71l4.36-3.32a1 1 0 0 1 1.41.15 1 1 0 0 1-.14 1.46l-5 3.83A1 1 0 0 1 12 16Z"
          />
        </svg>
      </button>
      {open && dropdownLayout && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={dropdownRef}
              id={listboxId}
              className="lk-settings-personal-page__select-dropdown lk-settings-personal-page__select-dropdown_portal"
              role="listbox"
              aria-labelledby={labelledBy}
              style={{
                ...dropdownLayout.cssVars,
                position: "fixed",
                top: dropdownLayout.top,
                left: dropdownLayout.left,
                width: dropdownLayout.width,
                zIndex: 12000,
                opacity: 1,
                isolation: "isolate",
              }}
            >
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={value === opt.value}
                  className={`lk-settings-personal-page__select-option${value === opt.value ? " lk-settings-personal-page__select-option_active" : ""}`}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  {opt.icon ? (
                    <span className="lk-settings-personal-page__select-option_row">
                      <span className="lk-settings-personal-page__select-option-icon" aria-hidden>
                        {opt.icon}
                      </span>
                      <span className="lk-settings-personal-page__select-option-text">{opt.label}</span>
                    </span>
                  ) : (
                    opt.label
                  )}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
