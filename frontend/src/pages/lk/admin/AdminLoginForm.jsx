import { useState } from "react";
import { API_ENDPOINTS } from "../../../config/api";

/**
 * Изолированная форма admin-логина (вход в `/admin-console`).
 *
 * POST `/users/admin/login/` → access/refresh JWT, которые AdminAccessGate сохраняет в
 * `admin_access_token`/`admin_refresh_token`. Сюда фронт пользовательского ЛК не лезет.
 */
export default function AdminLoginForm({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    const emailTrimmed = email.trim();
    if (!emailTrimmed || !password) {
      setError("Введите email и пароль");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(API_ENDPOINTS.adminLogin, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailTrimmed, password }),
      });
      let body = null;
      try {
        body = await res.json();
      } catch (_) {
        body = null;
      }
      if (!res.ok) {
        const code = body && body.code;
        if (code === "ADMIN_LOGIN_NOT_STAFF") {
          setError("Этот аккаунт не является администратором");
        } else if (code === "ADMIN_LOGIN_INVALID") {
          setError("Неверный email или пароль");
        } else {
          setError((body && body.detail) || "Не удалось войти");
        }
        return;
      }
      if (!body || !body.access || !body.refresh) {
        setError("Не удалось войти");
        return;
      }
      if (typeof onSuccess === "function") {
        onSuccess({ access: body.access, refresh: body.refresh });
      }
    } catch (_) {
      setError("Сеть недоступна. Попробуйте ещё раз.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className="admin-portal__login"
      aria-labelledby="admin-portal-login-title"
      data-testid="admin-portal-login"
    >
      <h2 id="admin-portal-login-title" className="admin-portal__login-title">
        Вход в админ-консоль
      </h2>
      <form className="admin-portal__login-form" onSubmit={handleSubmit} noValidate>
        <label className="admin-portal__login-field">
          <span className="admin-portal__login-label">Email</span>
          <input
            type="email"
            className="admin-portal__login-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            data-testid="admin-portal-login-email"
            disabled={submitting}
          />
        </label>
        <label className="admin-portal__login-field">
          <span className="admin-portal__login-label">Пароль</span>
          <input
            type="password"
            className="admin-portal__login-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            data-testid="admin-portal-login-password"
            disabled={submitting}
          />
        </label>
        {error ? (
          <p
            className="admin-portal__login-error"
            role="alert"
            data-testid="admin-portal-login-error"
          >
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="admin-portal__login-button"
          disabled={submitting}
          data-testid="admin-portal-login-submit"
        >
          {submitting ? "Входим…" : "Войти"}
        </button>
      </form>
    </section>
  );
}
