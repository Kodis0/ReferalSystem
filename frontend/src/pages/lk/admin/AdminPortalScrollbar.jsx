import { useEffect, useRef, useState } from "react";

/**
 * Overlay-скролл для admin-портала: тонкий thumb справа поверх контента,
 * аналогично `LKPageScrollbar` в lk.js. Слушает window scroll, а размеры/прогресс
 * читает из `document.scrollingElement` (или `documentElement` как fallback).
 *
 * Тема (`dark` / `light`) синхронизируется с `data-theme` на `<html>` через MutationObserver.
 */
export default function AdminPortalScrollbar() {
  const [metrics, setMetrics] = useState({ visible: false, thumbHeight: 0, thumbTop: 0 });
  const [theme, setTheme] = useState(() => {
    if (typeof document === "undefined") return "dark";
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  });
  const trackRef = useRef(null);
  const dragOffsetRef = useRef(0);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let rafId = 0;

    function getScroller() {
      return document.scrollingElement || document.documentElement;
    }

    function updateScrollbar() {
      const scroller = getScroller();
      if (!scroller) return;
      const viewportHeight = scroller.clientHeight || 0;
      const scrollHeight = scroller.scrollHeight || 0;
      const trackHeight = trackRef.current?.clientHeight || viewportHeight;
      const maxScrollTop = Math.max(0, scrollHeight - viewportHeight);

      if (maxScrollTop <= 1 || viewportHeight <= 0 || trackHeight <= 0) {
        setMetrics({ visible: false, thumbHeight: 0, thumbTop: 0 });
        return;
      }

      const thumbHeight = Math.max(44, Math.round((trackHeight * viewportHeight) / scrollHeight));
      const thumbTop = Math.round((scroller.scrollTop / maxScrollTop) * (trackHeight - thumbHeight));
      setMetrics({ visible: true, thumbHeight, thumbTop });
    }

    function scheduleUpdate() {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateScrollbar);
    }

    updateScrollbar();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleUpdate) : null;
    if (resizeObserver && document.body) resizeObserver.observe(document.body);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, []);

  function scrollToPointer(pointerY) {
    const scroller = document.scrollingElement || document.documentElement;
    const track = trackRef.current;
    if (!scroller || !track) return;
    const viewportHeight = scroller.clientHeight || 0;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - viewportHeight);
    const trackRect = track.getBoundingClientRect();
    const maxThumbTop = Math.max(1, track.clientHeight - metrics.thumbHeight);
    const nextThumbTop = Math.min(
      Math.max(0, pointerY - trackRect.top - dragOffsetRef.current),
      maxThumbTop,
    );
    scroller.scrollTop = (nextThumbTop / maxThumbTop) * maxScrollTop;
  }

  function startDrag(event, offsetY) {
    if (!metrics.visible) return;
    event.preventDefault();
    dragOffsetRef.current = offsetY;
    scrollToPointer(event.clientY);

    function onPointerMove(moveEvent) {
      scrollToPointer(moveEvent.clientY);
    }
    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  return (
    <div
      ref={trackRef}
      className={`admin-portal-scrollbar admin-portal-scrollbar_${theme}`}
      aria-hidden="true"
      data-visible={metrics.visible ? "true" : "false"}
      onPointerDown={(event) => startDrag(event, metrics.thumbHeight / 2)}
    >
      <div
        className="admin-portal-scrollbar__thumb"
        style={{
          height: `${metrics.thumbHeight}px`,
          transform: `translateY(${metrics.thumbTop}px)`,
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          startDrag(event, event.clientY - event.currentTarget.getBoundingClientRect().top);
        }}
      />
    </div>
  );
}
