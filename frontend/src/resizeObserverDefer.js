/**
 * Defer work out of the ResizeObserver delivery / layout pass.
 * rAF can still run in the same frame and retrigger the loop in some cases.
 * @param {() => void} fn
 * @returns {number} timeout id (pass to clearTimeout on cleanup)
 */
export function deferResizeObserverCallback(fn) {
  return window.setTimeout(fn, 0);
}
