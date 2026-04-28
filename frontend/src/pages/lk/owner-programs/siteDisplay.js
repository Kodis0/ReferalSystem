/** Human-readable Site lifecycle for owner UI (matches widget-install wording). */
export function siteLifecycleLabelRu(status) {
  const map = {
    draft: "Черновик",
    verified: "Проверен",
    active: "Активен",
  };
  return map[status] || status || "—";
}

export function formatSiteCardTitle(publicId, primaryOrigin, displayName) {
  if (typeof displayName === "string" && displayName.trim()) {
    return displayName.trim();
  }
  if (primaryOrigin) {
    try {
      if (String(primaryOrigin).includes("://")) {
        const host = new URL(primaryOrigin).hostname;
        if (host) return host;
      }
    } catch {
      /* ignore */
    }
    return String(primaryOrigin).replace(/^https?:\/\//i, "").split("/")[0] || publicId;
  }
  if (!publicId) return "Проект";
  const compact = String(publicId).replace(/-/g, "");
  return `Проект · ${compact.slice(0, 8)}…`;
}

export function formatDomainLine(primaryOrigin, allowedOrigins) {
  const raw =
    (typeof primaryOrigin === "string" && primaryOrigin.trim()) ||
    (Array.isArray(allowedOrigins) && typeof allowedOrigins[0] === "string" ? allowedOrigins[0] : "") ||
    "";
  if (!raw) return "Домен не задан";
  try {
    if (raw.includes("://")) {
      const u = new URL(raw);
      return u.host || raw;
    }
  } catch {
    /* ignore */
  }
  return raw.length > 96 ? `${raw.slice(0, 96)}…` : raw;
}

/** Prefer API `primary_origin_label` (Unicode host); else derive from `primary_origin`. */
export function sitePrimaryDomainLabel(siteLike) {
  const label = typeof siteLike?.primary_origin_label === "string" ? siteLike.primary_origin_label.trim() : "";
  if (label) return label;
  const raw = typeof siteLike?.primary_origin === "string" ? siteLike.primary_origin.trim() : "";
  if (!raw) return "";
  const line = formatDomainLine(raw, [raw]);
  return line === "Домен не задан" ? "" : line;
}

/** Absolute http(s) URL for opening the site in a browser tab, or empty string if none. */
export function sitePrimaryBrowseHref(siteLike) {
  const raw = typeof siteLike?.primary_origin === "string" ? siteLike.primary_origin.trim() : "";
  if (raw) {
    try {
      const u = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    } catch {
      /* ignore */
    }
  }
  const host = sitePrimaryDomainLabel(siteLike).trim();
  if (!host) return "";
  try {
    return new URL(`https://${host}`).href;
  } catch {
    return "";
  }
}
