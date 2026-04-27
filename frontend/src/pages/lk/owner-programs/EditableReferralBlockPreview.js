/**
 * Один блок конструктора = один объект; разные шаблоны по type, общий config.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { deferResizeObserverCallback } from "../../../resizeObserverDefer";
import { siteStyleProfileToCssVars } from "./siteStyleProfile";

export const BUILDER_BLOCK_TYPES = [
  "referralHero",
  "referralBanner",
  "referralCard",
  "referralSplit",
  "referralMinimal",
  "referralPromo",
];

export function createDefaultBuilderBlockConfig() {
  return {
    badge: "Партнерская программа",
    title: "Станьте рефералом магазина",
    description: "Получайте вознаграждение за клиентов, которые приходят по вашей ссылке.",
    buttonText: "Стать рефералом",
    terms: "Условия программы можно указать здесь.",
    accentColor: "#6366f1",
    theme: "light",
    floatingTextLayers: [],
  };
}

function splitAccentStyle(accentColor) {
  return { "--erb-accent": accentColor || "#6366f1" };
}

function newFloatingTextLayerId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ftl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function InlineEditableField({ enabled, value, onEdit, className, as = "p", placeholder = "" }) {
  const Tag = as;
  const normalizedValue = typeof value === "string" ? value : "";
  if (!enabled && !normalizedValue.trim()) {
    return null;
  }
  const commitValue = (event) => {
    if (!enabled || typeof onEdit !== "function") {
      return;
    }
    onEdit(event.currentTarget.textContent ?? "");
  };
  const handleMouseDown = (event) => {
    if (!enabled) return;
    event.stopPropagation();
  };
  const handleClick = (event) => {
    if (!enabled) return;
    event.stopPropagation();
  };
  const handleKeyDown = (event) => {
    if (!enabled) return;
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };
  const handleBlur = (event) => {
    commitValue(event);
  };

  return (
    <Tag
      className={className}
      contentEditable={enabled}
      suppressContentEditableWarning
      spellCheck={false}
      data-empty={enabled && !normalizedValue.trim() ? "true" : "false"}
      data-placeholder={placeholder}
      onBlur={handleBlur}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {normalizedValue}
    </Tag>
  );
}

function FloatingTextLayerItem({
  layer,
  enabled,
  isSelected,
  onSelectLayer,
  onUpdateLayer,
  onRemove,
  autoFocus,
  onAutoFocusConsumed,
}) {
  const textRef = useRef(null);
  const shellRef = useRef(null);
  const [isEditing, setIsEditing] = useState(() => Boolean(autoFocus && enabled));
  const [frameSizeLabel, setFrameSizeLabel] = useState("");
  const dragRef = useRef(null);
  const selectedRef = useRef(false);
  selectedRef.current = Boolean(isSelected);

  useLayoutEffect(() => {
    if (!autoFocus || !enabled || !textRef.current) {
      return;
    }
    textRef.current.focus();
    const sel = window.getSelection?.();
    if (!sel) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(textRef.current);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    if (typeof onAutoFocusConsumed === "function") {
      onAutoFocusConsumed();
    }
    setIsEditing(true);
  }, [autoFocus, enabled, layer.id, onAutoFocusConsumed]);

  useLayoutEffect(() => {
    if (!isSelected || isEditing || !shellRef.current) {
      setFrameSizeLabel("");
      return;
    }
    const el = shellRef.current;
    let deferId = 0;
    const updateFrameLabel = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.round(r.width));
      const h = Math.max(0, Math.round(r.height));
      setFrameSizeLabel(`${w} × ${h}`);
    };
    const scheduleFrameLabel = () => {
      clearTimeout(deferId);
      deferId = deferResizeObserverCallback(() => {
        deferId = 0;
        updateFrameLabel();
      });
    };
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => scheduleFrameLabel()) : null;
    updateFrameLabel();
    if (ro) {
      ro.observe(el);
    }
    window.addEventListener("resize", scheduleFrameLabel);
    return () => {
      clearTimeout(deferId);
      window.removeEventListener("resize", scheduleFrameLabel);
      if (ro) {
        ro.disconnect();
      }
    };
  }, [isSelected, isEditing, layer.id, layer.widthPx, layer.heightPx, layer.text]);

  const commit = (event) => {
    if (!enabled) {
      return;
    }
    const next = event.currentTarget.textContent ?? "";
    if (!next.trim()) {
      if (typeof onRemove === "function") {
        onRemove(layer.id);
      }
      return;
    }
    if (typeof onUpdateLayer === "function") {
      onUpdateLayer(layer.id, { text: next });
    }
    setIsEditing(false);
    if (next.trim() && typeof onSelectLayer === "function") {
      onSelectLayer(layer.id);
    }
  };

  const startResize = (axis) => (event) => {
    if (!enabled || !isSelected) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const shell = shellRef.current;
    if (!shell) return;
    const root = shell.closest(".editable-referral-block-preview");
    if (!(root instanceof HTMLElement)) {
      return;
    }
    const rootRect = root.getBoundingClientRect();
    if (!rootRect.width || !rootRect.height) {
      return;
    }
    const rect = shell.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = rect.width;
    const startH = rect.height;
    const startLeftPx = rect.left - rootRect.left;
    const startTopPx = rect.top - rootRect.top;

    dragRef.current = {
      axis,
      startX,
      startY,
      startW,
      startH,
      startLeftPx,
      startTopPx,
      rootW: rootRect.width,
      rootH: rootRect.height,
    };

    const onMove = (moveEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = moveEvent.clientX - drag.startX;
      const dy = moveEvent.clientY - drag.startY;
      const patch = {};
      if (drag.axis === "se") {
        patch.widthPx = Math.max(24, Math.round(drag.startW + dx));
        patch.heightPx = Math.max(18, Math.round(drag.startH + dy));
      } else if (drag.axis === "ne") {
        patch.widthPx = Math.max(24, Math.round(drag.startW + dx));
        patch.heightPx = Math.max(18, Math.round(drag.startH - dy));
        const nextTopPx = drag.startTopPx + dy;
        patch.yPercent = Math.max(0, Math.min(92, (nextTopPx / drag.rootH) * 100));
      } else if (drag.axis === "sw") {
        patch.widthPx = Math.max(24, Math.round(drag.startW - dx));
        patch.heightPx = Math.max(18, Math.round(drag.startH + dy));
        const nextLeftPx = drag.startLeftPx + dx;
        patch.xPercent = Math.max(0, Math.min(92, (nextLeftPx / drag.rootW) * 100));
      } else if (drag.axis === "nw") {
        patch.widthPx = Math.max(24, Math.round(drag.startW - dx));
        patch.heightPx = Math.max(18, Math.round(drag.startH - dy));
        const nextLeftPx = drag.startLeftPx + dx;
        const nextTopPx = drag.startTopPx + dy;
        patch.xPercent = Math.max(0, Math.min(92, (nextLeftPx / drag.rootW) * 100));
        patch.yPercent = Math.max(0, Math.min(92, (nextTopPx / drag.rootH) * 100));
      }
      if (typeof onUpdateLayer === "function") {
        onUpdateLayer(layer.id, patch);
      }
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const sized = Number.isFinite(layer.widthPx) || Number.isFinite(layer.heightPx);
  const shellStyle = {};
  if (Number.isFinite(layer.widthPx)) {
    shellStyle.width = `${layer.widthPx}px`;
  }
  if (Number.isFinite(layer.heightPx)) {
    shellStyle.height = `${layer.heightPx}px`;
  }

  const canType = enabled && isEditing;

  return (
    <div
      className="editable-referral-block-preview__floating-layer"
      style={{ left: `${layer.xPercent}%`, top: `${layer.yPercent}%`, pointerEvents: enabled ? "auto" : "none" }}
    >
      <div
        ref={shellRef}
        className={`editable-referral-block-preview__floating-shell${sized ? " is-sized" : ""}${
          isSelected && enabled && !isEditing ? " is-selected" : ""
        }`}
        style={shellStyle}
        onMouseDown={(e) => {
          if (!enabled) return;
          e.stopPropagation();
          if (e.target === e.currentTarget && typeof onSelectLayer === "function") {
            onSelectLayer(layer.id);
          }
        }}
      >
        <div
          ref={textRef}
          className="editable-referral-block-preview__floating-text"
          contentEditable={canType}
          suppressContentEditableWarning
          spellCheck={false}
          data-empty={enabled && !(layer.text || "").trim() ? "true" : "false"}
          onFocus={() => {
            if (!enabled) return;
            setIsEditing(true);
          }}
          onMouseDown={(e) => {
            if (!enabled) return;
            e.stopPropagation();
          }}
          onClick={(e) => {
            if (!enabled) return;
            e.stopPropagation();
            if (isEditing) {
              return;
            }
            if (selectedRef.current) {
              setIsEditing(true);
              window.requestAnimationFrame(() => {
                textRef.current?.focus();
              });
              return;
            }
            if (typeof onSelectLayer === "function") {
              onSelectLayer(layer.id);
            }
          }}
          onDoubleClick={(e) => {
            if (!enabled) return;
            e.preventDefault();
            e.stopPropagation();
            setIsEditing(true);
            window.requestAnimationFrame(() => {
              textRef.current?.focus();
            });
          }}
          onKeyDown={(e) => {
            if (!enabled) return;
            e.stopPropagation();
            if (!canType) {
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.currentTarget.blur();
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onBlur={commit}
        >
          {typeof layer.text === "string" ? layer.text : ""}
        </div>

        {enabled && isSelected && !isEditing && (layer.text || "").trim() ? (
          <>
            <span className="editable-referral-block-preview__floating-baseline" aria-hidden="true" />
            <button
              type="button"
              className="editable-referral-block-preview__floating-handle editable-referral-block-preview__floating-handle--nw"
              aria-label="Изменить размер"
              onMouseDown={startResize("nw")}
            />
            <button
              type="button"
              className="editable-referral-block-preview__floating-handle editable-referral-block-preview__floating-handle--ne"
              aria-label="Изменить размер"
              onMouseDown={startResize("ne")}
            />
            <button
              type="button"
              className="editable-referral-block-preview__floating-handle editable-referral-block-preview__floating-handle--sw"
              aria-label="Изменить размер"
              onMouseDown={startResize("sw")}
            />
            <button
              type="button"
              className="editable-referral-block-preview__floating-handle editable-referral-block-preview__floating-handle--se"
              aria-label="Изменить размер"
              onMouseDown={startResize("se")}
            />
            {frameSizeLabel ? (
              <div className="editable-referral-block-preview__floating-size" aria-hidden="true">
                {frameSizeLabel}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function HeroTemplate({ config, themeClass, textEditEnabled, onEditField }) {
  return (
    <div className={`editable-referral-block-preview__hero ${themeClass}`}>
      {config.badge ? (
        <InlineEditableField
          as="span"
          className="editable-referral-block-preview__badge"
          enabled={textEditEnabled}
          value={config.badge}
          placeholder="Бейдж"
          onEdit={(next) => onEditField("badge", next)}
        />
      ) : null}
      <InlineEditableField
        as="h3"
        className="editable-referral-block-preview__title"
        enabled={textEditEnabled}
        value={config.title}
        onEdit={(next) => onEditField("title", next)}
      />
      {config.description ? (
        <InlineEditableField
          as="p"
          className="editable-referral-block-preview__desc"
          enabled={textEditEnabled}
          value={config.description}
          placeholder="Добавьте описание"
          onEdit={(next) => onEditField("description", next)}
        />
      ) : null}
      <button type="button" className="editable-referral-block-preview__btn nodrag nopan" style={splitAccentStyle(config.accentColor)}>
        <InlineEditableField
          as="span"
          className="editable-referral-block-preview__btn-label"
          enabled={textEditEnabled}
          value={config.buttonText}
          onEdit={(next) => onEditField("buttonText", next)}
        />
      </button>
      {config.terms ? (
        <InlineEditableField
          as="p"
          className="editable-referral-block-preview__terms"
          enabled={textEditEnabled}
          value={config.terms}
          placeholder="Добавьте условия"
          onEdit={(next) => onEditField("terms", next)}
        />
      ) : null}
    </div>
  );
}

function BannerTemplate({ config, themeClass, textEditEnabled, onEditField }) {
  return (
    <div className={`editable-referral-block-preview__banner ${themeClass}`}>
      <div className="editable-referral-block-preview__banner-main">
        {config.badge ? (
          <InlineEditableField
            as="span"
            className="editable-referral-block-preview__badge"
            enabled={textEditEnabled}
            value={config.badge}
            placeholder="Бейдж"
            onEdit={(next) => onEditField("badge", next)}
          />
        ) : null}
        <div className="editable-referral-block-preview__banner-text">
          <InlineEditableField
            as="h3"
            className="editable-referral-block-preview__title editable-referral-block-preview__title--sm"
            enabled={textEditEnabled}
            value={config.title}
            onEdit={(next) => onEditField("title", next)}
          />
          {config.description ? (
            <InlineEditableField
              as="p"
              className="editable-referral-block-preview__desc editable-referral-block-preview__desc--sm"
              enabled={textEditEnabled}
              value={config.description}
              placeholder="Добавьте описание"
              onEdit={(next) => onEditField("description", next)}
            />
          ) : null}
        </div>
      </div>
      <button type="button" className="editable-referral-block-preview__btn editable-referral-block-preview__btn--sm nodrag nopan" style={splitAccentStyle(config.accentColor)}>
        <InlineEditableField
          as="span"
          className="editable-referral-block-preview__btn-label"
          enabled={textEditEnabled}
          value={config.buttonText}
          onEdit={(next) => onEditField("buttonText", next)}
        />
      </button>
    </div>
  );
}

function CardTemplate({ config, themeClass, textEditEnabled, onEditField }) {
  return (
    <div className={`editable-referral-block-preview__card ${themeClass}`}>
      {config.badge ? (
        <InlineEditableField
          as="span"
          className="editable-referral-block-preview__badge editable-referral-block-preview__badge--muted"
          enabled={textEditEnabled}
          value={config.badge}
          placeholder="Бейдж"
          onEdit={(next) => onEditField("badge", next)}
        />
      ) : null}
      <InlineEditableField
        as="h3"
        className="editable-referral-block-preview__title editable-referral-block-preview__title--md"
        enabled={textEditEnabled}
        value={config.title}
        onEdit={(next) => onEditField("title", next)}
      />
      {config.description ? (
        <InlineEditableField
          as="p"
          className="editable-referral-block-preview__desc"
          enabled={textEditEnabled}
          value={config.description}
          placeholder="Добавьте описание"
          onEdit={(next) => onEditField("description", next)}
        />
      ) : null}
      <button type="button" className="editable-referral-block-preview__btn nodrag nopan" style={splitAccentStyle(config.accentColor)}>
        <InlineEditableField
          as="span"
          className="editable-referral-block-preview__btn-label"
          enabled={textEditEnabled}
          value={config.buttonText}
          onEdit={(next) => onEditField("buttonText", next)}
        />
      </button>
      {config.terms ? (
        <InlineEditableField
          as="p"
          className="editable-referral-block-preview__terms editable-referral-block-preview__terms--sm"
          enabled={textEditEnabled}
          value={config.terms}
          placeholder="Добавьте условия"
          onEdit={(next) => onEditField("terms", next)}
        />
      ) : null}
    </div>
  );
}

function SplitTemplate({ config, themeClass, textEditEnabled, onEditField }) {
  return (
    <div className={`editable-referral-block-preview__split ${themeClass}`}>
      <div className="editable-referral-block-preview__split-col">
        {config.badge ? (
          <InlineEditableField
            as="span"
            className="editable-referral-block-preview__badge"
            enabled={textEditEnabled}
            value={config.badge}
            placeholder="Бейдж"
            onEdit={(next) => onEditField("badge", next)}
          />
        ) : null}
        <InlineEditableField
          as="h3"
          className="editable-referral-block-preview__title editable-referral-block-preview__title--md"
          enabled={textEditEnabled}
          value={config.title}
          onEdit={(next) => onEditField("title", next)}
        />
        <button type="button" className="editable-referral-block-preview__btn nodrag nopan" style={splitAccentStyle(config.accentColor)}>
          <InlineEditableField
            as="span"
            className="editable-referral-block-preview__btn-label"
            enabled={textEditEnabled}
            value={config.buttonText}
            onEdit={(next) => onEditField("buttonText", next)}
          />
        </button>
      </div>
      <div className="editable-referral-block-preview__split-col editable-referral-block-preview__split-col--muted">
        {config.description ? (
          <InlineEditableField
            as="p"
            className="editable-referral-block-preview__desc editable-referral-block-preview__desc--sm"
            enabled={textEditEnabled}
            value={config.description}
            placeholder="Добавьте описание"
            onEdit={(next) => onEditField("description", next)}
          />
        ) : null}
        {config.terms ? (
          <InlineEditableField
            as="p"
            className="editable-referral-block-preview__terms editable-referral-block-preview__terms--sm"
            enabled={textEditEnabled}
            value={config.terms}
            placeholder="Добавьте условия"
            onEdit={(next) => onEditField("terms", next)}
          />
        ) : null}
      </div>
    </div>
  );
}

function MinimalTemplate({ config, themeClass, textEditEnabled, onEditField }) {
  return (
    <div className={`editable-referral-block-preview__minimal ${themeClass}`}>
      <InlineEditableField
        as="h3"
        className="editable-referral-block-preview__title editable-referral-block-preview__title--sm"
        enabled={textEditEnabled}
        value={config.title}
        onEdit={(next) => onEditField("title", next)}
      />
      {config.description ? (
        <InlineEditableField
          as="p"
          className="editable-referral-block-preview__desc editable-referral-block-preview__desc--sm"
          enabled={textEditEnabled}
          value={config.description}
          placeholder="Добавьте описание"
          onEdit={(next) => onEditField("description", next)}
        />
      ) : null}
      <button type="button" className="editable-referral-block-preview__btn editable-referral-block-preview__btn--sm nodrag nopan" style={splitAccentStyle(config.accentColor)}>
        <InlineEditableField
          as="span"
          className="editable-referral-block-preview__btn-label"
          enabled={textEditEnabled}
          value={config.buttonText}
          onEdit={(next) => onEditField("buttonText", next)}
        />
      </button>
    </div>
  );
}

function PromoTemplate({ config, themeClass, textEditEnabled, onEditField }) {
  return (
    <div className={`editable-referral-block-preview__promo ${themeClass}`}>
      <div className="editable-referral-block-preview__promo-top">
        {config.badge ? (
          <InlineEditableField
            as="span"
            className="editable-referral-block-preview__badge"
            enabled={textEditEnabled}
            value={config.badge}
            placeholder="Бейдж"
            onEdit={(next) => onEditField("badge", next)}
          />
        ) : null}
        <p className="editable-referral-block-preview__terms editable-referral-block-preview__terms--sm">
          Промо-предложение
        </p>
      </div>
      <InlineEditableField
        as="h3"
        className="editable-referral-block-preview__title editable-referral-block-preview__title--md"
        enabled={textEditEnabled}
        value={config.title}
        onEdit={(next) => onEditField("title", next)}
      />
      {config.description ? (
        <InlineEditableField
          as="p"
          className="editable-referral-block-preview__desc"
          enabled={textEditEnabled}
          value={config.description}
          placeholder="Добавьте описание"
          onEdit={(next) => onEditField("description", next)}
        />
      ) : null}
      <button type="button" className="editable-referral-block-preview__btn nodrag nopan" style={splitAccentStyle(config.accentColor)}>
        <InlineEditableField
          as="span"
          className="editable-referral-block-preview__btn-label"
          enabled={textEditEnabled}
          value={config.buttonText}
          onEdit={(next) => onEditField("buttonText", next)}
        />
      </button>
      {config.terms ? (
        <InlineEditableField
          as="p"
          className="editable-referral-block-preview__terms"
          enabled={textEditEnabled}
          value={config.terms}
          placeholder="Добавьте условия"
          onEdit={(next) => onEditField("terms", next)}
        />
      ) : null}
    </div>
  );
}

export default function EditableReferralBlockPreview({
  block,
  selected = false,
  onSelect,
  textEditEnabled = false,
  onInlineEditField,
}) {
  const rootRef = useRef(null);
  const pendingFocusLayerIdRef = useRef(null);
  const [selectedFloatingLayerId, setSelectedFloatingLayerId] = useState(null);
  const config = block?.config ?? createDefaultBuilderBlockConfig();
  const type = block?.type || "referralHero";
  const themeClass = config.theme === "dark" ? "editable-referral-block-preview__surface--dark" : "editable-referral-block-preview__surface--light";
  const siteStyleVars = useMemo(() => siteStyleProfileToCssVars(config.siteStyleProfile), [config.siteStyleProfile]);
  const floatingLayers = useMemo(() => {
    const raw = config.floatingTextLayers;
    return Array.isArray(raw) ? raw : [];
  }, [config.floatingTextLayers]);

  useEffect(() => {
    if (!textEditEnabled) {
      setSelectedFloatingLayerId(null);
    }
  }, [textEditEnabled]);

  useEffect(() => {
    if (!textEditEnabled) {
      return undefined;
    }
    const onKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }
      const active = document.activeElement;
      if (!active || !(active instanceof HTMLElement)) {
        return;
      }
      if (!rootRef.current || !rootRef.current.contains(active)) {
        return;
      }
      if (active.classList.contains("editable-referral-block-preview__floating-text")) {
        event.preventDefault();
        event.stopPropagation();
        active.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [textEditEnabled]);

  const handleEditField = (field, value) => {
    if (typeof onInlineEditField === "function" && block?.id) {
      onInlineEditField(block.id, field, value);
    }
  };

  const handleClick = (event) => {
    event.stopPropagation();
    if (typeof onSelect === "function" && block?.id) {
      onSelect(block.id);
    }
    /* В режиме «Текст» новые слои создаёт только __text-placement: шаблон с contentEditable иначе перехватывает клики. */
  };

  const handleTextPlacementClick = (event) => {
    event.stopPropagation();
    if (typeof onSelect === "function" && block?.id) {
      onSelect(block.id);
    }
    if (!textEditEnabled || !rootRef.current) {
      return;
    }
    setSelectedFloatingLayerId(null);
    const rect = rootRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((event.clientY - rect.top) / rect.height) * 100;
    const nextLayer = {
      id: newFloatingTextLayerId(),
      text: "",
      xPercent: Math.max(0, Math.min(92, xPercent)),
      yPercent: Math.max(0, Math.min(92, yPercent)),
    };
    pendingFocusLayerIdRef.current = nextLayer.id;
    setSelectedFloatingLayerId(nextLayer.id);
    handleEditField("floatingTextLayers", [...floatingLayers, nextLayer]);
  };

  const handleKeyDown = (event) => {
    if ((event.key === "Enter" || event.key === " ") && typeof onSelect === "function" && block?.id) {
      event.preventDefault();
      event.stopPropagation();
      onSelect(block.id);
    }
  };

  const handleUpdateFloatingLayer = (layerId, patch) => {
    const nextLayers = floatingLayers.map((l) => (l && l.id === layerId ? { ...l, ...patch } : l));
    handleEditField("floatingTextLayers", nextLayers);
  };

  const handleRemoveFloatingLayer = (layerId) => {
    const nextLayers = floatingLayers.filter((l) => l && l.id !== layerId);
    handleEditField("floatingTextLayers", nextLayers);
    setSelectedFloatingLayerId((cur) => (cur === layerId ? null : cur));
  };

  const handleFloatingAutoFocusConsumed = useCallback(() => {
    pendingFocusLayerIdRef.current = null;
  }, []);

  let inner = (
    <HeroTemplate
      config={config}
      themeClass={themeClass}
      textEditEnabled={textEditEnabled}
      onEditField={handleEditField}
    />
  );
  if (type === "referralBanner") {
    inner = (
      <BannerTemplate
        config={config}
        themeClass={themeClass}
        textEditEnabled={textEditEnabled}
        onEditField={handleEditField}
      />
    );
  } else if (type === "referralCard") {
    inner = (
      <CardTemplate
        config={config}
        themeClass={themeClass}
        textEditEnabled={textEditEnabled}
        onEditField={handleEditField}
      />
    );
  } else if (type === "referralSplit") {
    inner = (
      <SplitTemplate
        config={config}
        themeClass={themeClass}
        textEditEnabled={textEditEnabled}
        onEditField={handleEditField}
      />
    );
  } else if (type === "referralMinimal") {
    inner = (
      <MinimalTemplate
        config={config}
        themeClass={themeClass}
        textEditEnabled={textEditEnabled}
        onEditField={handleEditField}
      />
    );
  } else if (type === "referralPromo") {
    inner = (
      <PromoTemplate
        config={config}
        themeClass={themeClass}
        textEditEnabled={textEditEnabled}
        onEditField={handleEditField}
      />
    );
  }

  return (
    <div
      ref={rootRef}
      className={`editable-referral-block-preview nodrag nopan${selected ? " is-selected" : ""}`}
      data-testid="editable-referral-block-preview"
      data-builder-block-type={type}
      data-site-styled={config.siteStyleProfile ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      data-text-edit-enabled={textEditEnabled ? "true" : "false"}
      style={siteStyleVars}
      tabIndex={0}
      aria-label="Реферальный блок"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="editable-referral-block-preview__stack">
        <div
          className={`editable-referral-block-preview__template-shell${
            textEditEnabled ? " editable-referral-block-preview__template-shell--text-capture" : ""
          }`}
        >
          {inner}
        </div>
        {textEditEnabled ? (
          <div
            role="presentation"
            aria-hidden="true"
            className="editable-referral-block-preview__text-placement"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleTextPlacementClick}
          />
        ) : null}
        {textEditEnabled || floatingLayers.length > 0 ? (
          <div className="editable-referral-block-preview__floating-root" aria-hidden={!textEditEnabled}>
            {floatingLayers.map((layer) => (
              <FloatingTextLayerItem
                key={layer.id}
                layer={layer}
                enabled={textEditEnabled}
                isSelected={selectedFloatingLayerId === layer.id}
                onSelectLayer={(id) => setSelectedFloatingLayerId(id)}
                autoFocus={pendingFocusLayerIdRef.current === layer.id}
                onAutoFocusConsumed={handleFloatingAutoFocusConsumed}
                onUpdateLayer={(id, patch) => {
                  pendingFocusLayerIdRef.current = null;
                  handleUpdateFloatingLayer(id, patch);
                }}
                onRemove={(id) => {
                  pendingFocusLayerIdRef.current = null;
                  handleRemoveFloatingLayer(id);
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
