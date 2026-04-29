/**
 * Профиль стиля импортированной секции для адаптации шаблонов реферальных блоков.
 * Источник данных: foreground_overlays со сканирования страницы (см. page_scan collectStyle).
 */

export const DEFAULT_SITE_STYLE_PROFILE = {
  colors: {
    background: "#ffffff",
    surface: "rgba(248, 250, 252, 0.92)",
    text: "#0f172a",
    mutedText: "#64748b",
    accent: "#6366f1",
    buttonBg: "#6366f1",
    buttonText: "#ffffff",
  },
  typography: {
    headingFont: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    bodyFont: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    headingTransform: "none",
    headingLetterSpacing: "normal",
  },
  radius: {
    button: "12px",
    card: "16px",
  },
  layout: {
    sidePadding: "clamp(20px, 5.6vw, 72px)",
  },
};

function pick(obj, ...keys) {
  if (!obj || typeof obj !== "object") {
    return "";
  }
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) {
      return String(v).trim();
    }
  }
  return "";
}

function parsePx(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const m = String(value || "").match(/^(-?\d+(?:\.\d+)?)px$/i);
  return m ? Number(m[1]) : null;
}

function normalizeOverlayStyle(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const fontSizePx = parsePx(raw.font_size_px ?? raw.fontSizePx) ?? parsePx(raw.font_size ?? raw.fontSize);
  const borderRadiusPx = parsePx(raw.border_radius_px ?? raw.borderRadiusPx) ?? parsePx(raw.border_radius ?? raw.borderRadius);
  return {
    color: pick(raw, "color"),
    fontFamily: pick(raw, "font_family", "fontFamily"),
    fontSize: pick(raw, "font_size", "fontSize"),
    fontWeight: pick(raw, "font_weight", "fontWeight"),
    textTransform: pick(raw, "text_transform", "textTransform") || "none",
    letterSpacing: pick(raw, "letter_spacing", "letterSpacing") || "normal",
    backgroundColor: pick(raw, "background_color", "backgroundColor"),
    borderRadius: pick(raw, "border_radius", "borderRadius"),
    fontSizePx: Number.isFinite(fontSizePx) ? fontSizePx : null,
    borderRadiusPx: Number.isFinite(borderRadiusPx) ? borderRadiusPx : null,
  };
}

function isTransparentColor(value) {
  const s = String(value || "").toLowerCase().replace(/\s/g, "");
  return (
    !s ||
    s === "transparent" ||
    s === "rgba(0,0,0,0)" ||
    s.startsWith("rgba(0,0,0,0)") ||
    s.startsWith("rgba(0,0,0,0.0)")
  );
}

function parseRgbChannels(str) {
  const s = String(str || "").trim();
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  }
  const hx = s.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (hx) {
    return { r: parseInt(hx[1], 16), g: parseInt(hx[2], 16), b: parseInt(hx[3], 16) };
  }
  const hx3 = s.match(/^#([\da-f])([\da-f])([\da-f])$/i);
  if (hx3) {
    return {
      r: parseInt(hx3[1] + hx3[1], 16),
      g: parseInt(hx3[2] + hx3[2], 16),
      b: parseInt(hx3[3] + hx3[3], 16),
    };
  }
  return null;
}

function luminanceFromColor(str) {
  const ch = parseRgbChannels(str);
  if (!ch) {
    return 0.4;
  }
  return (0.299 * ch.r + 0.587 * ch.g + 0.114 * ch.b) / 255;
}

function inferThemeFromPrimaryText(textColor) {
  const lum = luminanceFromColor(textColor);
  return lum > 0.62 ? "dark" : "light";
}

function mergeProfile(partial) {
  const base = {
    colors: { ...DEFAULT_SITE_STYLE_PROFILE.colors },
    typography: { ...DEFAULT_SITE_STYLE_PROFILE.typography },
    radius: { ...DEFAULT_SITE_STYLE_PROFILE.radius },
    layout: { ...DEFAULT_SITE_STYLE_PROFILE.layout },
  };
  if (!partial || typeof partial !== "object") {
    return base;
  }
  if (partial.colors && typeof partial.colors === "object") {
    base.colors = { ...base.colors, ...partial.colors };
  }
  if (partial.typography && typeof partial.typography === "object") {
    base.typography = { ...base.typography, ...partial.typography };
  }
  if (partial.radius && typeof partial.radius === "object") {
    base.radius = { ...base.radius, ...partial.radius };
  }
  if (partial.layout && typeof partial.layout === "object") {
    base.layout = { ...base.layout, ...partial.layout };
  }
  return base;
}

function foregroundOverlaysFromBlock(block) {
  if (!block || typeof block !== "object") {
    return [];
  }
  const raw = block.foreground_overlays ?? block.foregroundOverlays ?? [];
  return Array.isArray(raw) ? raw : [];
}

/**
 * @param {Record<string, unknown>|null|undefined} block — секция скриншотного импорта
 * @returns {typeof DEFAULT_SITE_STYLE_PROFILE}
 */
export function buildSiteStyleProfileFromScreenshotBlock(block) {
  const overlays = foregroundOverlaysFromBlock(block);
  const blockWidth = Number(block?.width);
  const parsed = overlays
    .map((o) => ({
      type: String(o?.type || "text").toLowerCase() === "button" ? "button" : "text",
      style: normalizeOverlayStyle(o?.style && typeof o.style === "object" ? o.style : {}),
      x: Number(o?.x),
      xPercent: Number(o?.x_percent ?? o?.xPercent),
    }))
    .filter((o) => o.type === "button" || (o.style.color && !isTransparentColor(o.style.color)));

  const textRows = parsed.filter((o) => o.type === "text");
  const buttonRows = parsed.filter((o) => o.type === "button");

  const textBySize = [...textRows].sort((a, b) => {
    const ap = a.style.fontSizePx ?? 0;
    const bp = b.style.fontSizePx ?? 0;
    return bp - ap;
  });

  const headingRow = textBySize[0] || textRows[0] || null;
  const bodyRow = textBySize.find((r) => r !== headingRow) || textRows[1] || textRows[0] || null;

  const buttonRow =
    buttonRows.find((b) => b.style.backgroundColor && !isTransparentColor(b.style.backgroundColor)) || buttonRows[0];

  let text = DEFAULT_SITE_STYLE_PROFILE.colors.text;
  if (headingRow?.style?.color) {
    text = headingRow.style.color;
  } else if (textRows[0]?.style?.color) {
    text = textRows[0].style.color;
  }

  let mutedText = DEFAULT_SITE_STYLE_PROFILE.colors.mutedText;
  if (bodyRow?.style?.color && bodyRow.style.color !== text) {
    mutedText = bodyRow.style.color;
  } else {
    const lum = luminanceFromColor(text);
    mutedText = lum > 0.55 ? "rgba(248, 250, 252, 0.72)" : "rgba(71, 85, 105, 0.95)";
  }

  let buttonBg = DEFAULT_SITE_STYLE_PROFILE.colors.buttonBg;
  let buttonText = DEFAULT_SITE_STYLE_PROFILE.colors.buttonText;
  let buttonRadius = DEFAULT_SITE_STYLE_PROFILE.radius.button;
  if (buttonRow?.style?.backgroundColor && !isTransparentColor(buttonRow.style.backgroundColor)) {
    buttonBg = buttonRow.style.backgroundColor;
  }
  if (buttonRow?.style?.color && !isTransparentColor(buttonRow.style.color)) {
    buttonText = buttonRow.style.color;
  }
  if (buttonRow?.style?.borderRadius) {
    buttonRadius = buttonRow.style.borderRadius;
  } else if (buttonRow?.style?.borderRadiusPx != null) {
    buttonRadius = `${Math.max(4, Math.round(buttonRow.style.borderRadiusPx))}px`;
  }

  const headingFont =
    headingRow?.style?.fontFamily || bodyRow?.style?.fontFamily || DEFAULT_SITE_STYLE_PROFILE.typography.headingFont;
  const bodyFont =
    bodyRow?.style?.fontFamily || headingRow?.style?.fontFamily || DEFAULT_SITE_STYLE_PROFILE.typography.bodyFont;

  const headingTransform =
    headingRow?.style?.textTransform && headingRow.style.textTransform !== "none"
      ? headingRow.style.textTransform
      : DEFAULT_SITE_STYLE_PROFILE.typography.headingTransform;
  const headingLetterSpacing = headingRow?.style?.letterSpacing || DEFAULT_SITE_STYLE_PROFILE.typography.headingLetterSpacing;

  const accent =
    buttonRow?.style?.backgroundColor && !isTransparentColor(buttonRow.style.backgroundColor)
      ? buttonRow.style.backgroundColor
      : DEFAULT_SITE_STYLE_PROFILE.colors.accent;

  const themeGuess = inferThemeFromPrimaryText(text);
  const background =
    themeGuess === "dark"
      ? luminanceFromColor(text) > 0.7
        ? "#0f172a"
        : "#111827"
      : "#ffffff";
  const surface =
    themeGuess === "dark" ? "rgba(15, 23, 42, 0.55)" : "rgba(248, 250, 252, 0.94)";

  const cardRadiusPx = Math.min(28, Math.max(10, (parsePx(buttonRadius) || 12) + 4));
  const leftPercents = parsed
    .map((row) => {
      if (Number.isFinite(row.xPercent)) {
        return row.xPercent;
      }
      if (Number.isFinite(row.x) && Number.isFinite(blockWidth) && blockWidth > 0) {
        return (row.x / blockWidth) * 100;
      }
      return null;
    })
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 40);
  const minLeftPercent = leftPercents.length ? Math.min(...leftPercents) : null;
  const sidePadding =
    minLeftPercent != null
      ? `clamp(20px, ${Math.max(3.5, Math.min(12, minLeftPercent)).toFixed(2)}%, 96px)`
      : DEFAULT_SITE_STYLE_PROFILE.layout.sidePadding;

  return mergeProfile({
    colors: {
      background,
      surface,
      text,
      mutedText,
      accent,
      buttonBg,
      buttonText,
    },
    typography: {
      headingFont,
      bodyFont,
      headingTransform,
      headingLetterSpacing,
    },
    radius: {
      button: buttonRadius,
      card: `${cardRadiusPx}px`,
    },
    layout: {
      sidePadding,
    },
  });
}

/**
 * @param {typeof DEFAULT_SITE_STYLE_PROFILE|null|undefined} profile
 * @returns {Record<string, string>}
 */
export function siteStyleProfileToCssVars(profile) {
  if (!profile || typeof profile !== "object") {
    return {};
  }
  const { colors, typography, radius, layout } = profile;
  const out = {};
  if (colors && typeof colors === "object") {
    if (colors.background) out["--erb-site-bg"] = colors.background;
    if (colors.surface) out["--erb-site-surface"] = colors.surface;
    if (colors.text) out["--erb-site-text"] = colors.text;
    if (colors.mutedText) out["--erb-site-muted-text"] = colors.mutedText;
    if (colors.accent) out["--erb-site-accent"] = colors.accent;
    if (colors.buttonBg) out["--erb-site-button-bg"] = colors.buttonBg;
    if (colors.buttonText) out["--erb-site-button-text"] = colors.buttonText;
  }
  if (typography && typeof typography === "object") {
    if (typography.headingFont) out["--erb-site-heading-font"] = typography.headingFont;
    if (typography.bodyFont) out["--erb-site-body-font"] = typography.bodyFont;
    if (typography.headingTransform != null) out["--erb-site-heading-transform"] = typography.headingTransform;
    if (typography.headingLetterSpacing != null) {
      out["--erb-site-heading-letter-spacing"] = typography.headingLetterSpacing;
    }
  }
  if (radius && typeof radius === "object") {
    if (radius.button) out["--erb-site-radius-button"] = radius.button;
    if (radius.card) out["--erb-site-radius-card"] = radius.card;
  }
  if (layout && typeof layout === "object") {
    if (layout.sidePadding) out["--erb-site-side-padding"] = layout.sidePadding;
  }
  return out;
}

/**
 * @param {string} slotId — before-{groupId} | after-{groupId}
 * @param {Array<Record<string, unknown>>} screenshotBlocks
 * @returns {Record<string, unknown>|null}
 */
export function screenshotBlockForInsertionSlot(slotId, screenshotBlocks) {
  if (typeof slotId !== "string" || !slotId || !Array.isArray(screenshotBlocks)) {
    return null;
  }
  let gid = "";
  if (slotId.startsWith("before-")) {
    gid = slotId.slice(7);
  } else if (slotId.startsWith("after-")) {
    gid = slotId.slice(6);
  } else {
    return null;
  }
  if (!gid) {
    return null;
  }
  const found = screenshotBlocks.find((b) => {
    const g = b?.groupId ?? b?.group_id;
    return typeof g === "string" && g.trim() === gid;
  });
  return found ?? null;
}

export function themeForSiteStyleProfile(profile) {
  if (!profile?.colors?.text) {
    return "light";
  }
  return inferThemeFromPrimaryText(profile.colors.text);
}
