/**
 * Один блок конструктора = один объект; разные шаблоны по type, общий config.
 */

export const BUILDER_BLOCK_TYPES = ["referralHero", "referralBanner", "referralCard", "referralSplit"];

export function createDefaultBuilderBlockConfig() {
  return {
    badge: "Партнерская программа",
    title: "Станьте рефералом магазина",
    description: "Получайте вознаграждение за клиентов, которые приходят по вашей ссылке.",
    buttonText: "Стать рефералом",
    terms: "Условия программы можно указать здесь.",
    accentColor: "#6366f1",
    theme: "light",
  };
}

function splitAccentStyle(accentColor) {
  return { "--erb-accent": accentColor || "#6366f1" };
}

function HeroTemplate({ config, themeClass }) {
  return (
    <div className={`editable-referral-block-preview__hero ${themeClass}`}>
      {config.badge ? (
        <span className="editable-referral-block-preview__badge">{config.badge}</span>
      ) : null}
      <h3 className="editable-referral-block-preview__title">{config.title}</h3>
      {config.description ? <p className="editable-referral-block-preview__desc">{config.description}</p> : null}
      <button type="button" className="editable-referral-block-preview__btn nodrag nopan" style={splitAccentStyle(config.accentColor)}>
        {config.buttonText}
      </button>
      {config.terms ? <p className="editable-referral-block-preview__terms">{config.terms}</p> : null}
    </div>
  );
}

function BannerTemplate({ config, themeClass }) {
  return (
    <div className={`editable-referral-block-preview__banner ${themeClass}`}>
      <div className="editable-referral-block-preview__banner-main">
        {config.badge ? <span className="editable-referral-block-preview__badge">{config.badge}</span> : null}
        <div className="editable-referral-block-preview__banner-text">
          <h3 className="editable-referral-block-preview__title editable-referral-block-preview__title--sm">{config.title}</h3>
          {config.description ? (
            <p className="editable-referral-block-preview__desc editable-referral-block-preview__desc--sm">{config.description}</p>
          ) : null}
        </div>
      </div>
      <button type="button" className="editable-referral-block-preview__btn editable-referral-block-preview__btn--sm nodrag nopan" style={splitAccentStyle(config.accentColor)}>
        {config.buttonText}
      </button>
    </div>
  );
}

function CardTemplate({ config, themeClass }) {
  return (
    <div className={`editable-referral-block-preview__card ${themeClass}`}>
      {config.badge ? (
        <span className="editable-referral-block-preview__badge editable-referral-block-preview__badge--muted">{config.badge}</span>
      ) : null}
      <h3 className="editable-referral-block-preview__title editable-referral-block-preview__title--md">{config.title}</h3>
      {config.description ? <p className="editable-referral-block-preview__desc">{config.description}</p> : null}
      <button type="button" className="editable-referral-block-preview__btn nodrag nopan" style={splitAccentStyle(config.accentColor)}>
        {config.buttonText}
      </button>
      {config.terms ? <p className="editable-referral-block-preview__terms editable-referral-block-preview__terms--sm">{config.terms}</p> : null}
    </div>
  );
}

function SplitTemplate({ config, themeClass }) {
  return (
    <div className={`editable-referral-block-preview__split ${themeClass}`}>
      <div className="editable-referral-block-preview__split-col">
        {config.badge ? <span className="editable-referral-block-preview__badge">{config.badge}</span> : null}
        <h3 className="editable-referral-block-preview__title editable-referral-block-preview__title--md">{config.title}</h3>
        <button type="button" className="editable-referral-block-preview__btn nodrag nopan" style={splitAccentStyle(config.accentColor)}>
          {config.buttonText}
        </button>
      </div>
      <div className="editable-referral-block-preview__split-col editable-referral-block-preview__split-col--muted">
        {config.description ? <p className="editable-referral-block-preview__desc editable-referral-block-preview__desc--sm">{config.description}</p> : null}
        {config.terms ? <p className="editable-referral-block-preview__terms editable-referral-block-preview__terms--sm">{config.terms}</p> : null}
      </div>
    </div>
  );
}

export default function EditableReferralBlockPreview({ block, selected = false, onSelect }) {
  const config = block?.config ?? createDefaultBuilderBlockConfig();
  const type = block?.type || "referralHero";
  const themeClass = config.theme === "dark" ? "editable-referral-block-preview__surface--dark" : "editable-referral-block-preview__surface--light";

  const handleClick = (event) => {
    event.stopPropagation();
    if (typeof onSelect === "function" && block?.id) {
      onSelect(block.id);
    }
  };

  const handleKeyDown = (event) => {
    if ((event.key === "Enter" || event.key === " ") && typeof onSelect === "function" && block?.id) {
      event.preventDefault();
      event.stopPropagation();
      onSelect(block.id);
    }
  };

  let inner = <HeroTemplate config={config} themeClass={themeClass} />;
  if (type === "referralBanner") {
    inner = <BannerTemplate config={config} themeClass={themeClass} />;
  } else if (type === "referralCard") {
    inner = <CardTemplate config={config} themeClass={themeClass} />;
  } else if (type === "referralSplit") {
    inner = <SplitTemplate config={config} themeClass={themeClass} />;
  }

  return (
    <div
      className={`editable-referral-block-preview nodrag nopan${selected ? " is-selected" : ""}`}
      data-testid="editable-referral-block-preview"
      data-builder-block-type={type}
      data-selected={selected ? "true" : "false"}
      tabIndex={0}
      aria-label="Реферальный блок"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {inner}
    </div>
  );
}
