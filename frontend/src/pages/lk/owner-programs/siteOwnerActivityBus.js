/** Событие для обновления страницы «История» и других представлений после действий владельца по сайту. */
export const SITE_OWNER_ACTIVITY_EVENT = "referrals-site-owner-activity";

/**
 * @param {string} sitePublicId
 */
export function emitSiteOwnerActivity(sitePublicId) {
  const id = typeof sitePublicId === "string" ? sitePublicId.trim() : "";
  if (!id) return;
  window.dispatchEvent(new CustomEvent(SITE_OWNER_ACTIVITY_EVENT, { detail: { sitePublicId: id } }));
}
