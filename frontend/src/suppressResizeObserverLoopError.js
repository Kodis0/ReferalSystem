/**
 * Chrome/WebKit may throw a global ErrorEvent when a ResizeObserver callback
 * schedules layout that needs another notification in the same frame.
 * It is benign; React Flow and other libs can trigger it in dev.
 * @see https://github.com/WICG/resize-observer/issues/38
 */
if (typeof window !== "undefined") {
  const RE = /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)\b/i;
  window.addEventListener(
    "error",
    (event) => {
      const msg = typeof event.message === "string" ? event.message : "";
      if (RE.test(msg)) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    true,
  );
}
