/** Единая синхронизация каталога программ и «Мои программы» после смены аватаров (аккаунт / сайт / проект). */

export const LK_PROGRAM_LISTS_REFETCH_EVENT = "lk-program-lists-refetch";

export function dispatchLkProgramListsRefetch() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LK_PROGRAM_LISTS_REFETCH_EVENT));
}
