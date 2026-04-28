import { useEffect, useRef, useState } from "react";

/**
 * Тонкий оверлей-скролл как у главной ЛК (`LKPageScrollbar` в lk.js), привязан к правому краю
 * скролл-контейнера. Родитель — `position: relative` (см. `thread-scroll-wrap`).
 */
export default function LkScrollerScrollbar({ scrollerRef, theme }) {
  const [metrics, setMetrics] = useState({
    visible: false,
    thumbHeight: 0,
    thumbTop: 0,
  });
  const trackRef = useRef(null);
  const dragOffsetRef = useRef(0);

  useEffect(() => {
    let rafId = 0;

    function updateScrollbar() {
      const scroller = scrollerRef.current;
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
    const scroller = scrollerRef.current;
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleUpdate) : null;
    scroller?.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    if (scroller && resizeObserver) {
      resizeObserver.observe(scroller);
    }

    return () => {
      cancelAnimationFrame(rafId);
      scroller?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [scrollerRef]);

  function scrollToPointer(pointerY) {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    if (!scroller || !track) return;

    const viewportHeight = scroller.clientHeight || 0;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - viewportHeight);
    const trackRect = track.getBoundingClientRect();
    const maxThumbTop = Math.max(1, track.clientHeight - metrics.thumbHeight);
    const nextThumbTop = Math.min(Math.max(0, pointerY - trackRect.top - dragOffsetRef.current), maxThumbTop);

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
      className={`lk-page-scrollbar lk-page-scrollbar_nested lk-page-scrollbar_${theme}`}
      aria-hidden="true"
      data-visible={metrics.visible ? "true" : "false"}
      onPointerDown={(event) => startDrag(event, metrics.thumbHeight / 2)}
    >
      <div
        className="lk-page-scrollbar__thumb"
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
