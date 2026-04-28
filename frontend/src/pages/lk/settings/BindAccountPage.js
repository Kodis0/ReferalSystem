import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { mergeSessionsAfterBind } from "../../../utils/lkMultiAccounts";
import "./settings.css";

function translateBindApiMessage(text) {
  const raw = String(text ?? "").trim();
  const known = {
    "This field may not be blank.": "Это поле обязательно для заполнения.",
    "This field is required.": "Это поле обязательно для заполнения.",
    "Enter a valid email address.": "Введите корректный email.",
    "Ensure this field has no more than 254 characters.": "Не более 254 символов.",
    "No active account found with the given credentials.": "Неверный email или пароль.",
  };
  if (known[raw]) return known[raw];
  if (/may not be blank/i.test(raw)) return "Это поле обязательно для заполнения.";
  if (/\bis required\b/i.test(raw)) return "Это поле обязательно для заполнения.";
  return raw;
}

function bindFieldLabelRu(key) {
  if (key === "email") return "Почта";
  if (key === "password") return "Пароль";
  if (key === "non_field_errors") return "";
  return key;
}

function formatBindApiErrors(data) {
  if (!data || typeof data !== "object") return "";
  if (data.detail != null && data.detail !== "") {
    if (typeof data.detail === "string") {
      return translateBindApiMessage(data.detail);
    }
    if (Array.isArray(data.detail)) {
      return data.detail
        .map((x) => (typeof x === "string" ? translateBindApiMessage(x) : String(x)))
        .join("\n")
        .trim();
    }
  }
  const lines = [];
  for (const key of Object.keys(data)) {
    if (key === "detail") continue;
    const val = data[key];
    const label = bindFieldLabelRu(key);
    if (Array.isArray(val)) {
      const text = val.map(translateBindApiMessage).join(" ");
      if (label) lines.push(`${label}: ${text}`);
      else lines.push(text);
    } else if (typeof val === "string") {
      const msg = translateBindApiMessage(val);
      if (label) lines.push(`${label}: ${msg}`);
      else lines.push(msg);
    }
  }
  return lines.join("\n").trim();
}

function EyeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M21.92 11.6C19.9 6.91 16.1 4 12 4s-7.9 2.91-9.92 7.6a1 1 0 0 0 0 .8C4.1 17.09 7.9 20 12 20s7.9-2.91 9.92-7.6a1 1 0 0 0 0-.8ZM12 18c-3.17 0-6.17-2.29-7.9-6C5.83 8.29 8.83 6 12 6s6.17 2.29 7.9 6c-1.73 3.71-4.73 6-7.9 6Zm0-10a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.79-2.81 3.77-4.53-1.87-3.21-5.39-5.22-9.33-5.22-1.36 0-2.66.26-3.85.74l2.24 2.24c.57-.23 1.18-.37 1.85-.37zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
      />
    </svg>
  );
}

export default function BindAccountPage({ fetchUser, setUser, setAuthUser }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");
      const trimmed = email.trim();
      if (!trimmed || !password) {
        setError("Заполните почту и пароль.");
        return;
      }
      setLoading(true);
      try {
        const response = await fetch(API_ENDPOINTS.token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed, password }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const msg = formatBindApiErrors(data) || "Не удалось выполнить вход. Проверьте данные.";
          setError(msg);
          return;
        }
        if (data.access && data.refresh && data.user) {
          mergeSessionsAfterBind({
            newAccess: data.access,
            newRefresh: data.refresh,
            newUser: data.user,
          });
        }
        if (data.access) localStorage.setItem("access_token", data.access);
        if (data.refresh) localStorage.setItem("refresh_token", data.refresh);
        if (data.user) localStorage.setItem("user", JSON.stringify(data.user));
        if (data.user && typeof setUser === "function") {
          setUser(data.user);
        }
        if (data.user && typeof setAuthUser === "function") {
          setAuthUser(data.user);
        }
        if (typeof fetchUser === "function") {
          const fresh = await fetchUser();
          if (fresh && typeof setAuthUser === "function") {
            setAuthUser(fresh);
          }
        }
        navigate("/lk/partner");
      } catch {
        setError("Произошла ошибка, попробуйте позже.");
      } finally {
        setLoading(false);
      }
    },
    [email, password, fetchUser, navigate, setAuthUser, setUser],
  );

  return (
    <div
      id="lk-settings-bind-account-page"
      className="lk-settings-personal-page"
      data-testid="lk-bind-account-page"
    >
      <div className="page">
        <div className="page__returnButton">
          <Link className="tw-link link_primary link_s" to="/lk/settings">
            <svg xmlns="http://www.w3.org/2000/svg" width="7" height="13" fill="none" viewBox="0 0 7 13" aria-hidden="true">
              <path
                fill="currentColor"
                d="M1 6.99a1 1 0 0 1 .23-.64l4-5a1 1 0 0 1 1.54 1.29L3.29 6.99l3.32 4.35a1 1 0 0 1-.15 1.4A1 1 0 0 1 5 12.62l-3.83-5A1 1 0 0 1 1 7Z"
              />
            </svg>
            Назад
          </Link>
        </div>

        <div className="lk-settings-personal-page__header">
          <h1 className="lk-settings-personal-page__title">Привязать аккаунт</h1>
        </div>

        <form className="lk-settings-personal-page__form" lang="ru" onSubmit={onSubmit} noValidate>
          <label className="lk-settings-personal-page__field">
            <span className="lk-settings-personal-page__field-label">Почта</span>
            <input
              className="lk-settings-personal-page__control"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              inputMode="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              disabled={loading}
            />
          </label>

          <label className="lk-settings-personal-page__field">
            <span className="lk-settings-personal-page__field-label">Пароль</span>
            <div className="lk-settings-bind-account-page__password-shell">
              <input
                className="lk-settings-personal-page__control lk-settings-bind-account-page__password-input"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                autoCapitalize="none"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                disabled={loading}
              />
              <button
                type="button"
                className="lk-settings-bind-account-page__password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                disabled={loading}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>

          {error ? (
            <div className="lk-settings-personal-error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="lk-settings-personal-page__actions">
            <button
              type="submit"
              className="baseButton button button_size_medium baseButton__size_medium baseButton__color_primary"
              data-test-id="submit-form-btn"
              data-testid="submit-form-btn"
              disabled={loading}
            >
              {loading ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
