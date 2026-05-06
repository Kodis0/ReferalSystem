import { CirclePause, CirclePlay, RefreshCw, Trash2 } from "lucide-react";

/** Иконка «Проверить подключение» — Vector.svg (блискавка), высота = size, ширина по пропорции 14×19. */
function SiteShellVerifyIcon({ size = 22 }) {
  const height = size;
  const width = (size * 14) / 19;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox="0 0 14 19"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7.417 8.25L8.667 0.75L0.75 10.75H5.75L4.5 18.25L12.417 8.25H7.417Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Кнопки в шапке сайта (архивировать / вкл-выкл сбор / проверить / обновить).
 * Общий для `widget-install` и `SiteShellToolbarSubscriber`.
 *
 * @param {"toolbar"|"menu"} [props.variant] — `menu`: пункты как в выпадающем меню карточки сайта.
 * @param {string} [props.deleteConfirmTitle] — подпись для confirm при архивации (например имя из списка сайтов).
 */
export default function SiteShellWidgetActionsBar({
  actionsRef,
  deleteSiteBusy,
  verifyLoading,
  refreshBusy,
  lifecycleStatus,
  widgetEnabled,
  toggleBusy,
  variant = "toolbar",
  deleteConfirmTitle,
  /** Для меню карточки сайта — сохраняем `project-child-site-delete-*` в тестах */
  deleteMenuTestId,
  /** Пока нет payload интеграции, переключение виджета для `active` — no-op без `data`; блокируем кнопку. */
  toggleDisabledUntilReady = false,
  /** Только `variant="menu"`: текст после ошибки активации */
  activateError = "",
}) {
  const captureRunning = lifecycleStatus === "active" && widgetEnabled;
  const toggleLabel = (() => {
    if (lifecycleStatus !== "active") return toggleBusy ? "Активация…" : "Активировать сайт";
    if (!widgetEnabled) return toggleBusy ? "Сохраняем…" : "Включить сбор заявок";
    return toggleBusy ? "Сохраняем…" : "Выключить сбор заявок";
  })();
  const ToggleIcon = captureRunning ? CirclePause : CirclePlay;
  const iconSize = variant === "menu" ? 18 : 22;

  if (variant === "menu") {
    return (
      <>
        {activateError ? (
          <div className="owner-programs__service-card-menu-hint" role="alert">
            {activateError}
          </div>
        ) : null}
        <button
          type="button"
          className="owner-programs__service-card-menu-item owner-programs__service-card-menu-item_row owner-programs__service-card-menu-item_danger"
          onClick={() => actionsRef.current.onDeleteSite?.(deleteConfirmTitle)}
          disabled={deleteSiteBusy}
          role="menuitem"
          aria-label="Архивировать сайт"
          data-testid={deleteMenuTestId || "site-shell-action-delete"}
        >
          <span className="owner-programs__service-card-menu-item_icon" aria-hidden="true">
            <Trash2 size={iconSize} strokeWidth={2} />
          </span>
          <span>Архивировать сайт</span>
        </button>
        <button
          type="button"
          className={`owner-programs__service-card-menu-item owner-programs__service-card-menu-item_row${captureRunning ? " owner-programs__service-card-menu-item_active" : ""}`}
          onClick={() => actionsRef.current.onUnifiedToggle?.()}
          disabled={toggleBusy || toggleDisabledUntilReady}
          role="menuitem"
          aria-label={toggleLabel}
          data-testid="site-shell-action-toggle-capture"
        >
          <span className="owner-programs__service-card-menu-item_icon" aria-hidden="true">
            <ToggleIcon size={iconSize} strokeWidth={2} />
          </span>
          <span>{toggleLabel}</span>
        </button>
        <button
          type="button"
          className="owner-programs__service-card-menu-item owner-programs__service-card-menu-item_row"
          onClick={() => actionsRef.current.onVerify?.()}
          disabled={verifyLoading}
          role="menuitem"
          aria-label={verifyLoading ? "Проверяем подключение…" : "Проверить подключение"}
          data-testid="site-shell-action-verify"
        >
          <span className="owner-programs__service-card-menu-item_icon" aria-hidden="true">
            <SiteShellVerifyIcon size={iconSize} />
          </span>
          <span>{verifyLoading ? "Проверка…" : "Проверить подключение"}</span>
        </button>
        <button
          type="button"
          className="owner-programs__service-card-menu-item owner-programs__service-card-menu-item_row"
          onClick={() => actionsRef.current.onRefreshStatus?.()}
          disabled={refreshBusy}
          role="menuitem"
          aria-label={refreshBusy ? "Обновление статуса…" : "Обновить статус"}
          data-testid="site-shell-action-refresh"
        >
          <span className="owner-programs__service-card-menu-item_icon" aria-hidden="true">
            <RefreshCw size={iconSize} strokeWidth={2} className={refreshBusy ? "owner-programs__icon-action-spin" : ""} />
          </span>
          <span>{refreshBusy ? "Обновление…" : "Обновить статус"}</span>
        </button>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="owner-programs__icon-action owner-programs__icon-action_danger"
        onClick={() => actionsRef.current.onDeleteSite?.(deleteConfirmTitle)}
        disabled={deleteSiteBusy}
        aria-label="Архивировать сайт"
        data-testid="site-shell-action-delete"
      >
        <Trash2 size={iconSize} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className={`owner-programs__icon-action${captureRunning ? " owner-programs__icon-action_on" : ""}`}
        onClick={() => actionsRef.current.onUnifiedToggle?.()}
        disabled={toggleBusy || toggleDisabledUntilReady}
        aria-label={toggleLabel}
        title={toggleLabel}
        data-testid="site-shell-action-toggle-capture"
      >
        <ToggleIcon size={iconSize} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className="owner-programs__icon-action"
        onClick={() => actionsRef.current.onVerify?.()}
        disabled={verifyLoading}
        aria-label={verifyLoading ? "Проверяем подключение…" : "Проверить подключение"}
        title="Проверить подключение"
        data-testid="site-shell-action-verify"
      >
        <SiteShellVerifyIcon size={iconSize} />
      </button>
      <button
        type="button"
        className="owner-programs__icon-action"
        onClick={() => actionsRef.current.onRefreshStatus?.()}
        disabled={refreshBusy}
        aria-label={refreshBusy ? "Обновление статуса…" : "Обновить статус"}
        title="Обновить статус"
        data-testid="site-shell-action-refresh"
      >
        <RefreshCw size={iconSize} strokeWidth={2} className={refreshBusy ? "owner-programs__icon-action-spin" : ""} aria-hidden />
      </button>
    </>
  );
}
