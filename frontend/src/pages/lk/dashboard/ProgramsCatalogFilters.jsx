import { ChevronDown } from "lucide-react";

export const COMMISSION_FILTER_OPTIONS = [
  { value: "", label: "Все" },
  { value: "lt5", label: "до 5%" },
  { value: "5-10", label: "5–10%" },
  { value: "10-20", label: "10–20%" },
  { value: "gte20", label: "20% и выше" },
];

export const PARTICIPANTS_FILTER_OPTIONS = [
  { value: "", label: "Все" },
  { value: "lt10", label: "до 10" },
  { value: "10-50", label: "10–50" },
  { value: "50-200", label: "50–200" },
  { value: "gte200", label: "200 и выше" },
];

export function CatalogFilterListbox({
  fieldKey,
  labelText,
  labelId,
  triggerId,
  listboxId,
  value,
  onChange,
  options,
  openField,
  setOpenField,
}) {
  const isOpen = openField === fieldKey;
  const currentLabel = options.find((o) => o.value === value)?.label ?? options[0].label;
  return (
    <div className="lk-dashboard__programs-filter" data-programs-catalog-filter-menu>
      <span className="lk-dashboard__programs-filter-label" id={labelId}>
        {labelText}
      </span>
      <div className="lk-dashboard__programs-filter-menu-wrap">
        <button
          type="button"
          id={triggerId}
          className="lk-dashboard__programs-filter-menu-trigger"
          aria-labelledby={labelId}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          data-testid={`programs-catalog-filter-${fieldKey}-trigger`}
          onClick={() => setOpenField(isOpen ? null : fieldKey)}
        >
          <span className="lk-dashboard__programs-filter-menu-trigger-label">{currentLabel}</span>
          <ChevronDown
            size={18}
            aria-hidden
            className={
              isOpen
                ? "lk-dashboard__programs-filter-menu-chevron lk-dashboard__programs-filter-menu-chevron_open"
                : "lk-dashboard__programs-filter-menu-chevron"
            }
          />
        </button>
        {isOpen ? (
          <div
            className="lk-header__menu lk-dashboard__programs-filter-lk-menu"
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
          >
            {options.map((opt) => (
              <button
                key={opt.value === "" ? "__all" : opt.value}
                type="button"
                role="option"
                aria-selected={value === opt.value}
                className="lk-header__menu-item"
                onClick={() => {
                  onChange(opt.value);
                  setOpenField(null);
                }}
              >
                <span className="lk-header__menu-item-text">{opt.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
