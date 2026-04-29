export const SITE_REACHABILITY_POLL_MS = 5 * 60 * 1000;

export function withSitePublicIdQuery(url, sitePublicId) {
  if (!sitePublicId) return url;
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set("site_public_id", sitePublicId);
    return u.toString();
  } catch {
    return url;
  }
}

export function preserveResolvedReachabilityPhase(phase) {
  return phase === "online" || phase === "offline" ? phase : "idle";
}

/** Сайт опубликован (verified/active), владелец выключил виджет / сбор заявок. */
export function isSiteCapturePaused(site) {
  if (!site || typeof site !== "object") return false;
  const st = typeof site.status === "string" ? site.status.trim().toLowerCase() : "";
  const live = st === "verified" || st === "active";
  return Boolean(live && site.widget_enabled === false);
}

export function reachabilityDotPhase(phase) {
  if (phase === "paused") return "paused";
  return phase === "online" ? "online" : phase === "offline" ? "offline" : "pending";
}

export function reachabilityLabel(phase) {
  if (phase === "checking") return "Проверка доступности…";
  if (phase === "paused") return "Сбор остановлен";
  if (phase === "online") return "В сети";
  if (phase === "offline") return "Не в сети";
  return "";
}
