import { CirclePause, CirclePlay, PlugZap, RefreshCw, Trash2 } from "lucide-react";

/**
 * Кнопки в шапке сайта (удалить / вкл-выкл сбор / проверить / обновить).
 * Общий для `widget-install` и `SiteShellToolbarSubscriber`.
 */
export default function SiteShellWidgetActionsBar({
  actionsRef,
  deleteSiteBusy,
  verifyLoading,
  refreshBusy,
  lifecycleStatus,
  widgetEnabled,
  toggleBusy,
}) {
  const captureRunning = lifecycleStatus === "active" && widgetEnabled;
  const toggleLabel = (() => {
    if (lifecycleStatus !== "active") return toggleBusy ? "Активация…" : "Активировать сайт";
    if (!widgetEnabled) return toggleBusy ? "Сохраняем…" : "Включить сбор заявок";
    return toggleBusy ? "Сохраняем…" : "Выключить сбор заявок";
  })();
  const ToggleIcon = captureRunning ? CirclePause : CirclePlay;
  const actionBusy = verifyLoading || refreshBusy || deleteSiteBusy || toggleBusy;

  return (
    <>
      <button
        type="button"
        className="owner-programs__icon-action owner-programs__icon-action_danger"
        onClick={() => actionsRef.current.onDeleteSite?.()}
        disabled={actionBusy}
        aria-label="Удалить сайт"
        data-testid="site-shell-action-delete"
      >
        <Trash2 size={22} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className={`owner-programs__icon-action${captureRunning ? " owner-programs__icon-action_on" : ""}`}
        onClick={() => actionsRef.current.onUnifiedToggle?.()}
        disabled={actionBusy}
        aria-label={toggleLabel}
        title={toggleLabel}
        data-testid="site-shell-action-toggle-capture"
      >
        <ToggleIcon size={22} strokeWidth={2} aria-hidden />
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
        <PlugZap size={22} strokeWidth={2} aria-hidden />
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
        <RefreshCw size={22} strokeWidth={2} className={refreshBusy ? "owner-programs__icon-action-spin" : ""} aria-hidden />
      </button>
    </>
  );
}
