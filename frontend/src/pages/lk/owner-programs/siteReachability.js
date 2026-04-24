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

export function reachabilityDotPhase(phase) {
  return phase === "online" ? "online" : phase === "offline" ? "offline" : "pending";
}

export function reachabilityLabel(phase) {
  if (phase === "checking") return "Проверка доступности…";
  if (phase === "online") return "В сети";
  if (phase === "offline") return "Не в сети";
  return "";
}
