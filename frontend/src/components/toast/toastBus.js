/**
 * Глобальные уведомления (нижний левый угол). Слушатель — `<ToastStack />` в App.
 *
 * @param {string} message
 * @param {{ variant?: 'info'|'success'|'error', duration?: number }} [options]
 */
export function toast(message, options = {}) {
  if (typeof window === "undefined") return;
  const detail = {
    message: String(message ?? ""),
    variant: "info",
    duration: 5000,
    ...options,
  };
  if (!detail.message.trim()) return;
  window.dispatchEvent(new CustomEvent("app-toast", { detail }));
}

toast.error = (message, options = {}) => toast(message, { variant: "error", ...options });
toast.success = (message, options = {}) => toast(message, { variant: "success", ...options });
