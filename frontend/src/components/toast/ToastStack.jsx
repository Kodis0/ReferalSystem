import { useCallback, useEffect, useState } from "react";
import "./toast.css";

export default function ToastStack() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const d = e.detail || {};
      const msg = d.message;
      if (msg == null || String(msg).trim() === "") return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const duration = typeof d.duration === "number" && d.duration > 0 ? d.duration : 5000;
      const variant =
        d.variant === "success" ? "success" : d.variant === "error" ? "error" : "info";
      setItems((prev) => [...prev, { id, message: String(msg), duration, variant }]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    };
    window.addEventListener("app-toast", handler);
    return () => window.removeEventListener("app-toast", handler);
  }, []);

  const dismiss = useCallback((id) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (items.length === 0) return null;

  return (
    <ul className="app-toast-stack" aria-live="polite" aria-relevant="additions text">
      {items.map((t) => (
        <li key={t.id} className={`app-toast app-toast_variant_${t.variant}`}>
          <div className="app-toast__progress" aria-hidden="true">
            <div className="app-toast__progress-fill" style={{ animationDuration: `${t.duration}ms` }} />
          </div>
          <div className="app-toast__row">
            <p className="app-toast__message">{t.message}</p>
            <button type="button" className="app-toast__close" onClick={() => dismiss(t.id)} aria-label="Закрыть">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="m13.41 12 3.3-3.29a1 1 0 1 0-1.42-1.42L12 10.59l-3.29-3.3a1 1 0 0 0-1.42 1.42l3.3 3.29-3.3 3.29a1 1 0 0 0 .33 1.64 1 1 0 0 0 1.09-.22l3.29-3.3 3.29 3.3a1 1 0 0 0 1.42 0 1 1 0 0 0 0-1.42L13.41 12Z"
                />
              </svg>
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
