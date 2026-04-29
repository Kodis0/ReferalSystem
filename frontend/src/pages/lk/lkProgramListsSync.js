/** Единая синхронизация каталога программ и «Мои программы» после смены данных сайта. */

export const LK_PROGRAM_LISTS_REFETCH_EVENT = "lk-program-lists-refetch";
export const LUMOREF_SITE_STATUS_CHANGED_EVENT = "lumoref:site-status-changed";

export function dispatchLkProgramListsRefetch() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LK_PROGRAM_LISTS_REFETCH_EVENT));
}

function siteStatusChangedDetail(siteOrPublicId) {
  if (siteOrPublicId && typeof siteOrPublicId === "object") {
    const sitePublicId = String(siteOrPublicId.public_id || siteOrPublicId.site_public_id || "").trim();
    const siteStatus = String(siteOrPublicId.status || siteOrPublicId.site_status || "").trim();
    const hasWidgetEnabled = typeof siteOrPublicId.widget_enabled === "boolean";
    const widgetEnabled = hasWidgetEnabled ? Boolean(siteOrPublicId.widget_enabled) : undefined;
    const detail = {
      site_public_id: sitePublicId,
    };
    if (siteStatus) detail.site_status = siteStatus;
    if (hasWidgetEnabled) {
      detail.widget_enabled = widgetEnabled;
      detail.program_active = siteStatus === "active" && widgetEnabled === true;
    }
    return detail;
  }
  return { site_public_id: siteOrPublicId || "" };
}

export function dispatchLumorefSiteStatusChanged(siteOrPublicId) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(LUMOREF_SITE_STATUS_CHANGED_EVENT, {
      detail: siteStatusChangedDetail(siteOrPublicId),
    }),
  );
}
