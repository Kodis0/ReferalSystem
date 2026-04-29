import { CirclePause, CirclePlay, RefreshCw, Trash2, Zap } from "lucide-react";

/**
 * Кнопки в шапке сайта (удалить / вкл-выкл сбор / проверить / обновить).
 * Общий для `widget-install` и `SiteShellToolbarSubscriber`.
 *
 * @param {"toolbar"|"menu"} [props.variant] — `menu`: пункты как в выпадающем меню карточки сайта.
 * @param {string} [props.deleteConfirmTitle] — подпись для confirm при удалении (например имя из списка сайтов).
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
  const actionBusy = verifyLoading || refreshBusy || deleteSiteBusy || toggleBusy;
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
          disabled={actionBusy}
          role="menuitem"
          aria-label="Удалить сайт"
          data-testid={deleteMenuTestId || "site-shell-action-delete"}
        >
          <span className="owner-programs__service-card-menu-item_icon" aria-hidden="true">
            <Trash2 size={iconSize} strokeWidth={2} />
          </span>
          <span>Удалить сайт</span>
        </button>
        <button
          type="button"
          className={`owner-programs__service-card-menu-item owner-programs__service-card-menu-item_row${captureRunning ? " owner-programs__service-card-menu-item_active" : ""}`}
          onClick={() => actionsRef.current.onUnifiedToggle?.()}
          disabled={actionBusy || toggleDisabledUntilReady}
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
          disabled={actionBusy}
          role="menuitem"
          aria-label={verifyLoading ? "Проверяем подключение…" : "Проверить подключение"}
          data-testid="site-shell-action-verify"
        >
          <span className="owner-programs__service-card-menu-item_icon" aria-hidden="true">
            <Zap size={iconSize} strokeWidth={2} />
          </span>
          <span>{verifyLoading ? "Проверка…" : "Проверить подключение"}</span>
        </button>
        <button
          type="button"
          className="owner-programs__service-card-menu-item owner-programs__service-card-menu-item_row"
          onClick={() => actionsRef.current.onRefreshStatus?.()}
          disabled={actionBusy}
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
        disabled={actionBusy}
        aria-label="Удалить сайт"
        data-testid="site-shell-action-delete"
      >
        <Trash2 size={iconSize} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className={`owner-programs__icon-action${captureRunning ? " owner-programs__icon-action_on" : ""}`}
        onClick={() => actionsRef.current.onUnifiedToggle?.()}
        disabled={actionBusy || toggleDisabledUntilReady}
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
        disabled={actionBusy}
        aria-label={verifyLoading ? "Проверяем подключение…" : "Проверить подключение"}
        title="Проверить подключение"
        data-testid="site-shell-action-verify"
      >
        <Zap size={iconSize} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className="owner-programs__icon-action"
        onClick={() => actionsRef.current.onRefreshStatus?.()}
        disabled={actionBusy}
        aria-label={refreshBusy ? "Обновление статуса…" : "Обновить статус"}
        title="Обновить статус"
        data-testid="site-shell-action-refresh"
      >
        <RefreshCw size={iconSize} strokeWidth={2} className={refreshBusy ? "owner-programs__icon-action-spin" : ""} aria-hidden />
      </button>
    </>
  );
}
