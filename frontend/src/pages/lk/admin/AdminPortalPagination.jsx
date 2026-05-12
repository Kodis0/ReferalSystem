import "./admin.css";

/**
 * Pagination в стиле `OwnerActivityHistoryPanel`:
 *   ← Назад · 1 … 4 5 [6] 7 … 12 · Вперёд →   (всего {count})
 *
 * Логика номеров повторяет owner-эталон: до 7 страниц — все номера,
 * больше — первая, последняя и ±1 от текущей с `…` на разрывах >1.
 */
export default function AdminPortalPagination({
  page,
  numPages,
  count,
  onPageChange,
  ariaLabel = "Постраничная навигация",
}) {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safeNumPages =
    Number.isFinite(numPages) && numPages > 0 ? Math.max(1, Math.floor(numPages)) : 1;
  const hasCount = typeof count === "number" && Number.isFinite(count);

  if (safeNumPages <= 1) {
    if (!hasCount) return null;
    return (
      <nav className="admin-portal__pagination" aria-label={ariaLabel}>
        <span className="admin-portal__pagination-info">всего {count}</span>
      </nav>
    );
  }

  const visibleNums = Array.from({ length: safeNumPages }, (_, i) => i + 1).filter(
    (n) => safeNumPages <= 7 || n === 1 || n === safeNumPages || Math.abs(n - safePage) <= 1,
  );

  const goPrev = () => {
    if (typeof onPageChange === "function" && safePage > 1) onPageChange(safePage - 1);
  };
  const goNext = () => {
    if (typeof onPageChange === "function" && safePage < safeNumPages) onPageChange(safePage + 1);
  };

  return (
    <nav className="admin-portal__pagination" aria-label={ariaLabel}>
      <button
        type="button"
        className="admin-portal__pagination-btn"
        disabled={safePage <= 1}
        onClick={goPrev}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M17 11H9.41l3.3-3.29a1 1 0 0 0-1.42-1.42l-5 5a1 1 0 0 0-.21.33 1 1 0 0 0 0 .76 1 1 0 0 0 .21.33l5 5a1 1 0 1 0 1.42-1.42L9.41 13H17a1 1 0 0 0 0-2Z"
          />
        </svg>
        Назад
      </button>

      <div className="admin-portal__pagination-nums" aria-live="polite">
        {visibleNums.map((n, idx, arr) => {
          const prev = arr[idx - 1];
          const showEllipsis = idx > 0 && prev != null && n - prev > 1;
          const isActive = n === safePage;
          return (
            <span key={n} className="admin-portal__pagination-num-wrap">
              {showEllipsis ? (
                <span className="admin-portal__pagination-ellipsis" aria-hidden="true">
                  …
                </span>
              ) : null}
              <button
                type="button"
                className={
                  "admin-portal__pagination-num" +
                  (isActive ? " admin-portal__pagination-num--active" : "")
                }
                onClick={() => {
                  if (typeof onPageChange === "function" && !isActive) onPageChange(n);
                }}
                disabled={isActive}
                aria-current={isActive ? "page" : undefined}
                aria-label={`Страница ${n}`}
              >
                {n}
              </button>
            </span>
          );
        })}
      </div>

      <button
        type="button"
        className="admin-portal__pagination-btn"
        disabled={safePage >= safeNumPages}
        onClick={goNext}
      >
        Вперёд
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M7 13h7.59l-3.3 3.29a1 1 0 1 0 1.42 1.42l5-5a1 1 0 0 0 .21-.33 1 1 0 0 0 0-.76 1 1 0 0 0-.21-.33l-5-5a1 1 0 0 0-1.72.71 1 1 0 0 0 .3.71l3.3 3.29H7a1 1 0 0 0 0 2Z"
          />
        </svg>
      </button>

      {hasCount ? (
        <span className="admin-portal__pagination-info">всего {count}</span>
      ) : null}
    </nav>
  );
}
