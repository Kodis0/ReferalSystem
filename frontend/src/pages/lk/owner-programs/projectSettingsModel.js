/** Pure payload ↔ form mapping for site settings. No React / IO. */

export const REFERRAL_LOCK_DAYS_MIN = 1;
export const REFERRAL_LOCK_DAYS_MAX = 365;

export function formatApiFieldErrors(payload) {
  if (!payload || typeof payload !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(payload)) {
    if (k === "detail" || k === "code") continue;
    if (Array.isArray(v)) parts.push(`${k}: ${v.join(" ")}`);
    else if (typeof v === "string") parts.push(`${k}: ${v}`);
  }
  return parts.join("\n");
}

export function primaryOriginFromPayload(payload) {
  const origins = Array.isArray(payload?.allowed_origins) ? payload.allowed_origins : [];
  const first = origins[0];
  return typeof first === "string" ? first : "";
}

export function siteNameFromPayload(payload) {
  if (typeof payload?.site_display_name === "string" && payload.site_display_name.trim()) {
    return payload.site_display_name.trim();
  }
  return "";
}

export function siteDescriptionFromPayload(payload) {
  if (typeof payload?.site_description === "string") {
    return payload.site_description;
  }
  return "";
}

function parseCommissionPercent(value) {
  if (typeof value === "string") {
    return Number(value.trim().replace(",", "."));
  }
  return Number(value);
}

export function commissionPercentFromPayload(payload) {
  const value = payload?.commission_percent;
  if (value === null || value === undefined || value === "") return "5";
  const numberValue = parseCommissionPercent(value);
  if (!Number.isFinite(numberValue) || numberValue < 5) return "5";
  return String(numberValue);
}

export function referralLockDaysFromPayload(payload) {
  const cfg =
    payload?.config_json && typeof payload.config_json === "object" && !Array.isArray(payload.config_json)
      ? payload.config_json
      : null;
  const top = payload?.referral_lock_days;
  const fromCfg = cfg?.referral_lock_days;
  const value =
    top !== null && top !== undefined && top !== ""
      ? top
      : fromCfg !== null && fromCfg !== undefined && fromCfg !== ""
        ? fromCfg
        : undefined;
  if (value === null || value === undefined || value === "") return "";
  const numberValue = parseInt(String(value), 10);
  if (
    !Number.isFinite(numberValue) ||
    numberValue < REFERRAL_LOCK_DAYS_MIN ||
    numberValue > REFERRAL_LOCK_DAYS_MAX
  ) {
    return "";
  }
  return String(numberValue);
}

export function referralLockDaysAfterSaveFromResponse(payload, submittedReferralLockDays) {
  const cfg =
    payload?.config_json && typeof payload.config_json === "object" && !Array.isArray(payload.config_json)
      ? payload.config_json
      : null;
  const saved = payload?.referral_lock_days ?? cfg?.referral_lock_days ?? submittedReferralLockDays;
  return String(saved);
}

export function normalizeCommissionPercentInput(value) {
  const numberValue = parseCommissionPercent(value);
  return Math.max(5, Number.isFinite(numberValue) ? numberValue : 5);
}

export function normalizeReferralLockDaysInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const numberValue = Number(raw);
  if (!Number.isInteger(numberValue)) return "";
  return String(Math.min(REFERRAL_LOCK_DAYS_MAX, Math.max(REFERRAL_LOCK_DAYS_MIN, numberValue)));
}
