/** Единая синхронизация каталога программ и «Мои программы» после смены данных сайта. */

export const LK_PROGRAM_LISTS_REFETCH_EVENT = "lk-program-lists-refetch";
export const LUMOREF_SITE_STATUS_CHANGED_EVENT = "lumoref:site-status-changed";

export function dispatchLkProgramListsRefetch() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LK_PROGRAM_LISTS_REFETCH_EVENT));
}

export function dispatchLumorefSiteStatusChanged(sitePublicId) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(LUMOREF_SITE_STATUS_CHANGED_EVENT, {
      detail: { site_public_id: sitePublicId || "" },
    }),
  );
}
