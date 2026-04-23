import { useEffect, useRef, useState } from "react";

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
  const rootRef = useRef(null);
  const currentLabel = options.find((o) => o.value === value)?.label ?? String(value ?? "");

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!rootRef.current || rootRef.current.contains(event.target)) return;
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
        <div className="lk-settings-personal-page__select-trigger-label">{currentLabel}</div>
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
      {open ? (
        <div id={listboxId} className="lk-settings-personal-page__select-dropdown" role="listbox" aria-labelledby={labelledBy}>
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
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
