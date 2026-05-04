/** Общая геометрия для плавающей кнопки «глаз» на hero-баннерах (каталог / мои программы). */

export const CATALOG_HERO_EYE_SIZE_PX = 30;

export const CATALOG_HERO_EYE_EDGE_INSET_PX = 10;

export function roundFixedEyePos(pos) {
  if (!pos) return null;
  return { top: Math.round(pos.top), left: Math.round(pos.left) };
}

/** Без лишних setState при скролле/raf — убирает микродёргание портала */
export function eyePosUnchanged(prev, next) {
  return Boolean(prev && next && prev.top === next.top && prev.left === next.left);
}

export function rectCenterToFixedEyeTopLeft(rect) {
  const half = CATALOG_HERO_EYE_SIZE_PX / 2;
  return roundFixedEyePos({
    top: rect.top + rect.height / 2 - half,
    left: rect.left + rect.width / 2 - half,
  });
}

/** Одинаковый inset от верхнего и правого края баннера (как `top`/`right` у `--corner`). */
export function floatingEyeTopLeftFromBannerInset(bannerEl) {
  if (!bannerEl) return null;
  const br = bannerEl.getBoundingClientRect();
  if (br.width < 1 || br.height < 1) return null;
  const inset = CATALOG_HERO_EYE_EDGE_INSET_PX;
  const size = CATALOG_HERO_EYE_SIZE_PX;
  return roundFixedEyePos({
    top: br.top + inset,
    left: br.right - inset - size,
  });
}

/** Скрытый баннер: слот у строки заголовка; иначе правый край строки. */
export function floatingEyePosHeroHidden(inlineAnchorEl, rowEl) {
  const half = CATALOG_HERO_EYE_SIZE_PX / 2;
  if (inlineAnchorEl) {
    const ir = inlineAnchorEl.getBoundingClientRect();
    if (ir.width >= 1 && ir.height >= 1) {
      return roundFixedEyePos({
        top: ir.top + ir.height / 2 - half,
        left: Math.round(ir.left),
      });
    }
  }
  if (!rowEl) return null;
  const rr = rowEl.getBoundingClientRect();
  if (rr.width < 1 || rr.height < 1) return null;
  const left = Math.round(rr.right - CATALOG_HERO_EYE_EDGE_INSET_PX - CATALOG_HERO_EYE_SIZE_PX);
  return roundFixedEyePos({
    top: rr.top + rr.height / 2 - half,
    left,
  });
}
