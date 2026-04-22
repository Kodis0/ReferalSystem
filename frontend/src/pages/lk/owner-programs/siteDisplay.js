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
