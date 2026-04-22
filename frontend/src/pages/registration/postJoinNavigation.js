/**
 * Post-join confirmation: shared query contract for signup CTA and logged-in CTA join.
 * Dashboard reads these params once and clears the URL (replace) to avoid stale deep-links.
 *
 * Optional `site_label` is a server-provided human-readable line (same as API `site_display_label`).
 */

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
/** Keep in sync with backend _sanitize max length. */
const MAX_SITE_LABEL_LEN = 120;

export function isUuidString(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function sanitizeSiteLabelForQuery(value) {
  if (value == null || typeof value !== "string") {
    return "";
  }
  const s = value.trim().replace(/\s+/g, " ");
  if (!s) {
    return "";
  }
  return s.length > MAX_SITE_LABEL_LEN ? s.slice(0, MAX_SITE_LABEL_LEN) : s;
}

/**
 * @param {string} sitePublicId
 * @param {"joined"|"already_joined"} outcome
 * @param {string} [siteDisplayLabel] from API `site_display_label` (optional)
 * @returns {string} pathname + query for SPA dashboard
 */
export function buildPostJoinDashboardPath(sitePublicId, outcome, siteDisplayLabel) {
  if (!sitePublicId || !isUuidString(sitePublicId)) {
    return "/lk/dashboard";
  }
  const o = outcome === "already_joined" ? "already_joined" : "joined";
  const q = new URLSearchParams({
    post_join: "1",
    site: sitePublicId.trim(),
    outcome: o,
  });
  const label = sanitizeSiteLabelForQuery(siteDisplayLabel);
  if (label) {
    q.set("site_label", label);
  }
  return `/lk/dashboard?${q.toString()}`;
}

/**
 * Safe display line for MVP (no extra server field): short fingerprint of public_id.
 * @param {string} sitePublicId
 */
export function formatSitePublicIdForDisplay(sitePublicId) {
  if (!sitePublicId || !isUuidString(sitePublicId)) {
    return "эта программа";
  }
  const compact = sitePublicId.replace(/-/g, "");
  return `Программа · ${compact.slice(0, 8)}…`;
}

/**
 * Prefer server-provided label; otherwise UUID fingerprint (MVP fallback).
 * @param {string} [siteDisplayLabel]
 * @param {string} sitePublicId
 */
export function resolvePostJoinSiteLabel(siteDisplayLabel, sitePublicId) {
  const t =
    typeof siteDisplayLabel === "string"
      ? siteDisplayLabel.trim().slice(0, MAX_SITE_LABEL_LEN)
      : "";
  if (t) {
    return t;
  }
  return formatSitePublicIdForDisplay(sitePublicId);
}

/**
 * @param {URLSearchParams} searchParams
 * @returns {{ site_public_id: string, outcome: "joined"|"already_joined", site_display_label?: string }|null}
 */
export function parsePostJoinFromSearchParams(searchParams) {
  if (!searchParams || typeof searchParams.get !== "function") {
    return null;
  }
  if (searchParams.get("post_join") !== "1") {
    return null;
  }
  const site = (searchParams.get("site") || "").trim();
  if (!isUuidString(site)) {
    return null;
  }
  const raw = searchParams.get("outcome") || "";
  const outcome = raw === "already_joined" ? "already_joined" : "joined";
  const rawLabel = searchParams.get("site_label");
  let site_display_label;
  if (rawLabel != null && String(rawLabel).trim()) {
    site_display_label = String(rawLabel).trim().slice(0, MAX_SITE_LABEL_LEN);
  }
  return {
    site_public_id: site,
    outcome,
    ...(site_display_label ? { site_display_label } : {}),
  };
}
