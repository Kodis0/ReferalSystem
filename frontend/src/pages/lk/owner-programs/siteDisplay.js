/** Human-readable Site lifecycle for owner UI (matches widget-install wording). */
export function siteLifecycleLabelRu(status) {
  const map = {
    draft: "Черновик",
    verified: "Готов к активации",
    active: "Активен",
    paused: "Остановлен",
    disabled: "Остановлен",
    inactive: "Остановлен",
  };
  return map[status] || status || "—";
}

function normalizedSiteStatus(siteLike) {
  const raw =
    typeof siteLike?.status === "string" && siteLike.status.trim()
      ? siteLike.status
      : typeof siteLike?.site_status === "string"
        ? siteLike.site_status
        : "";
  return raw.trim().toLowerCase();
}

export function getSiteLifecycleStatus(siteOrIntegration) {
  const status = normalizedSiteStatus(siteOrIntegration);

  if (siteOrIntegration?.widget_enabled === false) {
    return {
      tone: "muted",
      label: "Виджет выключен",
      description: "Сбор заявок для сайта сейчас выключен.",
    };
  }

  if (status === "active") {
    return {
      tone: "success",
      label: "Активен",
      description: "Сайт активирован.",
    };
  }

  if (status === "verified") {
    return {
      tone: "warning",
      label: "Готов к активации",
      description: "Код проверен, сайт ещё не активирован.",
    };
  }

  if (status === "paused" || status === "disabled" || status === "inactive") {
    return {
      tone: "danger",
      label: "Остановлен",
      description: "Сайт не принимает заявки.",
    };
  }

  return {
    tone: "muted",
    label: status === "draft" ? "Черновик" : siteLifecycleLabelRu(status),
    description: "Сайт ещё не активирован.",
  };
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

export function domainHostFromValue(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const raw = value.trim();
  try {
    if (raw.includes("://")) {
      return new URL(raw).hostname.toLowerCase();
    }
  } catch {
    /* ignore */
  }
  return raw.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
}

/** Host for external favicon lookup (matches site card / shell). */
export function siteFaviconHostname(siteLike) {
  const o = typeof siteLike?.primary_origin === "string" ? siteLike.primary_origin.trim() : "";
  if (o) {
    const h = domainHostFromValue(o);
    if (h) return h;
  }
  const l = typeof siteLike?.primary_origin_label === "string" ? siteLike.primary_origin_label.trim() : "";
  if (l) {
    const asUrl = l.includes("://") ? l : `https://${l}`;
    const h = domainHostFromValue(asUrl);
    if (h) return h;
  }
  const catalogOrigin = typeof siteLike?.site_origin_label === "string" ? siteLike.site_origin_label.trim() : "";
  if (catalogOrigin) {
    const asUrl = catalogOrigin.includes("://") ? catalogOrigin : `https://${catalogOrigin}`;
    const h = domainHostFromValue(asUrl);
    if (h) return h;
  }
  return "";
}

export function siteExternalFaviconUrl(hostname) {
  if (!hostname) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
}
