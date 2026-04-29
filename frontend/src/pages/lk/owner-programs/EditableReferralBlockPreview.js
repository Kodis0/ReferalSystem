/**
 * Один блок конструктора = один объект; разные шаблоны по type, общий config.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { deferResizeObserverCallback } from "../../../resizeObserverDefer";
import LkScrollerScrollbar from "../components/LkScrollerScrollbar";
import { siteStyleProfileToCssVars } from "./siteStyleProfile";

export const BUILDER_BLOCK_TYPES = [
  "referralHero",
  "referralBanner",
  "referralCard",
  "referralSplit",
  "referralMinimal",
  "referralPromo",
];
const REFERRAL_JOIN_PUBLIC_BASE_URL =
  (process.env.REACT_APP_PUBLIC_APP_URL || "https://lumoref.ru").replace(/\/+$/, "");

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

function escapeBuilderBlockCodeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function builderBlockCodeLine(indent, text) {
  return `${"  ".repeat(indent)}${text}`;
}

function builderBlockContentLine(indent, tag, className, value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  return builderBlockCodeLine(indent, `<${tag} class="${className}">${escapeBuilderBlockCodeText(text)}</${tag}>`);
}

function referralBlockButtonText(config) {
  const text = String(config?.buttonText ?? "").trim();
  return text || "Стать рефералом";
}

function buildReferralJoinHref(sitePublicId) {
  const site = String(sitePublicId || "").trim();
  const path = "/registration";
  if (!site) {
    return `${REFERRAL_JOIN_PUBLIC_BASE_URL}${path}`;
  }
  return `${REFERRAL_JOIN_PUBLIC_BASE_URL}${path}?site_public_id=${encodeURIComponent(site)}`;
}

function buildFloatingTextLayerCode(layer) {
  if (!layer || !String(layer.text ?? "").trim()) {
    return null;
  }
  const styleParts = [];
  if (Number.isFinite(layer.xPercent)) {
    styleParts.push(`left: ${Number(layer.xPercent).toFixed(2)}%;`);
  }
  if (Number.isFinite(layer.yPercent)) {
    styleParts.push(`top: ${Number(layer.yPercent).toFixed(2)}%;`);
  }
  if (Number.isFinite(layer.widthPx)) {
    styleParts.push(`width: ${Math.round(layer.widthPx)}px;`);
  }
  if (Number.isFinite(layer.heightPx)) {
    styleParts.push(`height: ${Math.round(layer.heightPx)}px;`);
  }
  const styleAttr = styleParts.length ? ` style="${styleParts.join(" ")}"` : "";
  return builderBlockCodeLine(
    3,
    `<span class="lumo-referral-block__floating-text"${styleAttr}>${escapeBuilderBlockCodeText(layer.text)}</span>`,
  );
}

function buildTildaBlockStyle(config) {
  const accent = String(config.accentColor || "#6366f1").trim() || "#6366f1";
  return `<style>
.lumo-referral-block {
  --lumo-referral-accent: ${escapeBuilderBlockCodeText(accent)};
  box-sizing: border-box;
  width: 100%;
  padding: clamp(40px, 5vw, 72px) clamp(20px, 5.6vw, 72px);
  font-family: Inter, Arial, sans-serif;
  color: #0f172a;
  background:
    radial-gradient(circle at 88% 12%, rgba(99, 102, 241, 0.14), transparent 30%),
    #ffffff;
}
.lumo-referral-block *,
.lumo-referral-block *::before,
.lumo-referral-block *::after {
  box-sizing: border-box;
}
.lumo-referral-block__inner {
  width: min(100%, 1160px);
  margin: 0 auto;
}
.lumo-referral-block__surface {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  min-height: clamp(220px, 28vw, 460px);
  justify-content: center;
  padding: clamp(32px, 4vw, 56px);
  border-radius: 28px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.92), rgba(248, 250, 252, 0.96)),
    #f8fafc;
  box-shadow:
    0 26px 70px rgba(15, 23, 42, 0.14),
    0 10px 26px rgba(15, 23, 42, 0.08);
}
.lumo-referral-block--dark {
  color: #f8fafc;
  background:
    radial-gradient(circle at 88% 12%, rgba(129, 140, 248, 0.2), transparent 32%),
    #0f172a;
}
.lumo-referral-block--dark .lumo-referral-block__surface {
  background:
    linear-gradient(145deg, rgba(23, 33, 43, 0.96), rgba(15, 23, 42, 0.98)),
    #17212b;
}
.lumo-referral-block__badge {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.12);
  color: var(--lumo-referral-accent);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.lumo-referral-block__title {
  margin: 0;
  max-width: 760px;
  font-size: clamp(28px, 4vw, 56px);
  font-weight: 800;
  line-height: 1.04;
  letter-spacing: -0.04em;
}
.lumo-referral-block__description,
.lumo-referral-block__terms {
  margin: 0;
  max-width: 680px;
  font-size: clamp(16px, 1.5vw, 20px);
  line-height: 1.55;
  color: #475569;
}
.lumo-referral-block--dark .lumo-referral-block__description,
.lumo-referral-block--dark .lumo-referral-block__terms {
  color: #cbd5e1;
}
.lumo-referral-block__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  max-width: 100%;
  min-height: 48px;
  padding: 0 24px;
  border-radius: 999px;
  background: var(--lumo-referral-accent);
  color: #ffffff !important;
  font-size: 15px;
  font-weight: 800;
  line-height: 1;
  text-decoration: none !important;
  box-shadow: 0 16px 34px rgba(99, 102, 241, 0.26);
}
.lumo-referral-block--banner .lumo-referral-block__surface {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 24px;
  padding: 28px 32px;
}
.lumo-referral-block--banner .lumo-referral-block__title {
  font-size: clamp(22px, 2.5vw, 34px);
}
.lumo-referral-block--card .lumo-referral-block__surface {
  max-width: none;
}
.lumo-referral-block--split .lumo-referral-block__surface {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0;
  padding: 0;
  overflow: hidden;
}
.lumo-referral-block__col {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
  padding: 40px;
}
.lumo-referral-block__col--muted {
  background: rgba(15, 23, 42, 0.05);
}
.lumo-referral-block--dark .lumo-referral-block__col--muted {
  background: rgba(255, 255, 255, 0.06);
}
.lumo-referral-block--minimal .lumo-referral-block__surface {
  gap: 14px;
  padding: 28px 32px;
}
.lumo-referral-block--minimal .lumo-referral-block__title {
  font-size: clamp(22px, 2.4vw, 34px);
}
.lumo-referral-block__floating-text {
  display: block;
  margin-top: 16px;
  font-size: 15px;
  line-height: 1.45;
  color: inherit;
}
@media (max-width: 760px) {
  .lumo-referral-block {
    padding: 32px 16px;
  }
  .lumo-referral-block__surface,
  .lumo-referral-block__col {
    padding: 28px 20px;
    border-radius: 22px;
  }
  .lumo-referral-block--banner .lumo-referral-block__surface,
  .lumo-referral-block--split .lumo-referral-block__surface {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .lumo-referral-block__button {
    width: 100%;
  }
}
</style>`;
}

function buildBuilderBlockCode(block, sitePublicId) {
  const config = { ...createDefaultBuilderBlockConfig(), ...(block?.config || {}) };
  const type = block?.type || "referralHero";
  const theme = config.theme === "dark" ? "dark" : "light";
  const ctaText = referralBlockButtonText(config);
  const ctaHref = buildReferralJoinHref(sitePublicId);
  const typeClass = type.replace(/^referral/, "").toLowerCase();
  const blockClasses = [
    "lumo-referral-block",
    `lumo-referral-block--${typeClass}`,
    theme === "dark" ? "lumo-referral-block--dark" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const lines = [
    buildTildaBlockStyle(config),
    `<section class="${blockClasses}">`,
    builderBlockCodeLine(1, `<div class="lumo-referral-block__inner">`),
    builderBlockCodeLine(2, `<div class="lumo-referral-block__surface">`),
  ];
  const pushContent = (line) => {
    if (line) {
      lines.push(line);
    }
  };

  if (type === "referralBanner") {
    lines.push(builderBlockCodeLine(3, `<div class="lumo-referral-block__content">`));
    pushContent(builderBlockContentLine(4, "span", "lumo-referral-block__badge", config.badge));
    pushContent(builderBlockContentLine(4, "h2", "lumo-referral-block__title", config.title));
    pushContent(builderBlockContentLine(4, "p", "lumo-referral-block__description", config.description));
    lines.push(builderBlockCodeLine(3, `</div>`));
    pushContent(
      ctaText
        ? builderBlockCodeLine(
            3,
            `<a class="lumo-referral-block__button" href="${escapeBuilderBlockCodeText(ctaHref)}">${escapeBuilderBlockCodeText(ctaText)}</a>`,
          )
        : null,
    );
  } else if (type === "referralSplit") {
    lines.push(builderBlockCodeLine(3, `<div class="lumo-referral-block__col">`));
    pushContent(builderBlockContentLine(4, "span", "lumo-referral-block__badge", config.badge));
    pushContent(builderBlockContentLine(4, "h2", "lumo-referral-block__title", config.title));
    pushContent(
      ctaText
        ? builderBlockCodeLine(
            4,
            `<a class="lumo-referral-block__button" href="${escapeBuilderBlockCodeText(ctaHref)}">${escapeBuilderBlockCodeText(ctaText)}</a>`,
          )
        : null,
    );
    lines.push(builderBlockCodeLine(3, `</div>`));
    lines.push(builderBlockCodeLine(3, `<div class="lumo-referral-block__col lumo-referral-block__col--muted">`));
    pushContent(builderBlockContentLine(4, "p", "lumo-referral-block__description", config.description));
    pushContent(builderBlockContentLine(4, "p", "lumo-referral-block__terms", config.terms));
    lines.push(builderBlockCodeLine(3, `</div>`));
  } else if (type === "referralMinimal") {
    pushContent(builderBlockContentLine(3, "h2", "lumo-referral-block__title", config.title));
    pushContent(builderBlockContentLine(3, "p", "lumo-referral-block__description", config.description));
    pushContent(
      ctaText
        ? builderBlockCodeLine(
            3,
            `<a class="lumo-referral-block__button" href="${escapeBuilderBlockCodeText(ctaHref)}">${escapeBuilderBlockCodeText(ctaText)}</a>`,
          )
        : null,
    );
  } else {
    pushContent(builderBlockContentLine(3, "span", "lumo-referral-block__badge", config.badge));
    pushContent(builderBlockContentLine(3, "h2", "lumo-referral-block__title", config.title));
    pushContent(builderBlockContentLine(3, "p", "lumo-referral-block__description", config.description));
    pushContent(
      ctaText
        ? builderBlockCodeLine(
            3,
            `<a class="lumo-referral-block__button" href="${escapeBuilderBlockCodeText(ctaHref)}">${escapeBuilderBlockCodeText(ctaText)}</a>`,
          )
        : null,
    );
    pushContent(builderBlockContentLine(3, "p", "lumo-referral-block__terms", config.terms));
  }

  const floatingLines = Array.isArray(config.floatingTextLayers)
    ? config.floatingTextLayers.map(buildFloatingTextLayerCode).filter(Boolean)
    : [];
  lines.push(...floatingLines);
  lines.push(builderBlockCodeLine(2, `</div>`));
  lines.push(builderBlockCodeLine(1, `</div>`));
  lines.push(`</section>`);
  return lines.join("\n");
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

function TemplateCtaLink({ config, className, textEditEnabled, onEditField, ctaHref }) {
  return (
    <a
      href={ctaHref}
      className={`${className} nodrag nopan`}
      style={splitAccentStyle(config.accentColor)}
      onClick={(event) => event.preventDefault()}
    >
      <InlineEditableField
        as="span"
        className="editable-referral-block-preview__btn-label"
        enabled={textEditEnabled}
        value={referralBlockButtonText(config)}
        onEdit={(next) => onEditField("buttonText", next)}
      />
    </a>
  );
}

function HeroTemplate({ config, themeClass, textEditEnabled, onEditField, ctaHref }) {
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
      <TemplateCtaLink
        config={config}
        className="editable-referral-block-preview__btn"
        textEditEnabled={textEditEnabled}
        onEditField={onEditField}
        ctaHref={ctaHref}
      />
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

function BannerTemplate({ config, themeClass, textEditEnabled, onEditField, ctaHref }) {
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
      <TemplateCtaLink
        config={config}
        className="editable-referral-block-preview__btn editable-referral-block-preview__btn--sm"
        textEditEnabled={textEditEnabled}
        onEditField={onEditField}
        ctaHref={ctaHref}
      />
    </div>
  );
}

function CardTemplate({ config, themeClass, textEditEnabled, onEditField, ctaHref }) {
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
      <TemplateCtaLink
        config={config}
        className="editable-referral-block-preview__btn"
        textEditEnabled={textEditEnabled}
        onEditField={onEditField}
        ctaHref={ctaHref}
      />
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

function SplitTemplate({ config, themeClass, textEditEnabled, onEditField, ctaHref }) {
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
        <TemplateCtaLink
          config={config}
          className="editable-referral-block-preview__btn"
          textEditEnabled={textEditEnabled}
          onEditField={onEditField}
          ctaHref={ctaHref}
        />
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

function MinimalTemplate({ config, themeClass, textEditEnabled, onEditField, ctaHref }) {
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
      <TemplateCtaLink
        config={config}
        className="editable-referral-block-preview__btn editable-referral-block-preview__btn--sm"
        textEditEnabled={textEditEnabled}
        onEditField={onEditField}
        ctaHref={ctaHref}
      />
    </div>
  );
}

function PromoTemplate({ config, themeClass, textEditEnabled, onEditField, ctaHref }) {
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
      <TemplateCtaLink
        config={config}
        className="editable-referral-block-preview__btn"
        textEditEnabled={textEditEnabled}
        onEditField={onEditField}
        ctaHref={ctaHref}
      />
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

function BuilderBlockCodeView({ block, sitePublicId }) {
  const [copied, setCopied] = useState(false);
  const codeWrapRef = useRef(null);
  const codeScrollRef = useRef(null);
  const code = useMemo(() => buildBuilderBlockCode(block, sitePublicId), [block, sitePublicId]);

  useEffect(() => {
    const wrap = codeWrapRef.current;
    if (!wrap) {
      return undefined;
    }

    const onWheel = (event) => {
      const scroller = codeScrollRef.current;
      if (!scroller) return;
      const multiplier = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? scroller.clientHeight : 1;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      scroller.scrollTop += event.deltaY * multiplier;
      scroller.scrollLeft += event.deltaX * multiplier;
    };

    wrap.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      wrap.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, []);

  const handleCopy = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const handleCodeWheel = (event) => {
    const scroller = codeScrollRef.current;
    if (!scroller) return;
    event.preventDefault();
    event.stopPropagation();
    scroller.scrollTop += event.deltaY;
    scroller.scrollLeft += event.deltaX;
  };

  return (
    <div className="editable-referral-block-preview__code-view nodrag nopan nowheel">
      <div className="editable-referral-block-preview__code-head">
        <span className="editable-referral-block-preview__code-title">Dev Mode</span>
        <button
          type="button"
          className="editable-referral-block-preview__code-copy"
          onClick={handleCopy}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div
        ref={codeWrapRef}
        className="editable-referral-block-preview__code-scroll-wrap nodrag nopan nowheel"
        onWheel={handleCodeWheel}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <pre ref={codeScrollRef} className="editable-referral-block-preview__code-pre nowheel">
          <code>{code}</code>
        </pre>
        <LkScrollerScrollbar scrollerRef={codeScrollRef} theme="dark" />
      </div>
    </div>
  );
}

export default function EditableReferralBlockPreview({
  block,
  selected = false,
  onSelect,
  textEditEnabled = false,
  devMode = false,
  sitePublicId = "",
  onInlineEditField,
}) {
  const rootRef = useRef(null);
  const pendingFocusLayerIdRef = useRef(null);
  const [selectedFloatingLayerId, setSelectedFloatingLayerId] = useState(null);
  const config = block?.config ?? createDefaultBuilderBlockConfig();
  const type = block?.type || "referralHero";
  const themeClass = config.theme === "dark" ? "editable-referral-block-preview__surface--dark" : "editable-referral-block-preview__surface--light";
  const ctaHref = useMemo(() => buildReferralJoinHref(sitePublicId), [sitePublicId]);
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
      ctaHref={ctaHref}
    />
  );
  if (type === "referralBanner") {
    inner = (
      <BannerTemplate
        config={config}
        themeClass={themeClass}
        textEditEnabled={textEditEnabled}
        onEditField={handleEditField}
        ctaHref={ctaHref}
      />
    );
  } else if (type === "referralCard") {
    inner = (
      <CardTemplate
        config={config}
        themeClass={themeClass}
        textEditEnabled={textEditEnabled}
        onEditField={handleEditField}
        ctaHref={ctaHref}
      />
    );
  } else if (type === "referralSplit") {
    inner = (
      <SplitTemplate
        config={config}
        themeClass={themeClass}
        textEditEnabled={textEditEnabled}
        onEditField={handleEditField}
        ctaHref={ctaHref}
      />
    );
  } else if (type === "referralMinimal") {
    inner = (
      <MinimalTemplate
        config={config}
        themeClass={themeClass}
        textEditEnabled={textEditEnabled}
        onEditField={handleEditField}
        ctaHref={ctaHref}
      />
    );
  } else if (type === "referralPromo") {
    inner = (
      <PromoTemplate
        config={config}
        themeClass={themeClass}
        textEditEnabled={textEditEnabled}
        onEditField={handleEditField}
        ctaHref={ctaHref}
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
      data-dev-mode={devMode ? "true" : "false"}
      style={siteStyleVars}
      tabIndex={0}
      aria-label="Реферальный блок"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="editable-referral-block-preview__stack">
        <div
          className={`editable-referral-block-preview__template-shell${
            textEditEnabled && !devMode ? " editable-referral-block-preview__template-shell--text-capture" : ""
          }`}
        >
          {devMode ? <BuilderBlockCodeView block={block} sitePublicId={sitePublicId} /> : inner}
        </div>
        {textEditEnabled && !devMode ? (
          <div
            role="presentation"
            aria-hidden="true"
            className="editable-referral-block-preview__text-placement"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleTextPlacementClick}
          />
        ) : null}
        {!devMode && (textEditEnabled || floatingLayers.length > 0) ? (
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
