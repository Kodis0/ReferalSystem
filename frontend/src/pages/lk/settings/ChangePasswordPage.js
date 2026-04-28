import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import "./settings.css";

function translateApiMessage(text) {
  const raw = String(text ?? "").trim();
  const known = {
    "This field may not be blank.": "Это поле обязательно для заполнения.",
    "This field is required.": "Это поле обязательно для заполнения.",
  };
  if (known[raw]) return known[raw];
  if (/may not be blank/i.test(raw)) return "Это поле обязательно для заполнения.";
  if (/\bis required\b/i.test(raw)) return "Это поле обязательно для заполнения.";
  return raw;
}

function fieldLabelRu(key) {
  if (key === "old_password") return "Текущий пароль";
  if (key === "new_password") return "Новый пароль";
  if (key === "non_field_errors") return "";
  return key;
}

function formatChangePasswordErrors(data) {
  if (!data || typeof data !== "object") return "";
  const lines = [];
  for (const key of Object.keys(data)) {
    if (key === "detail" || key === "code") continue;
    const val = data[key];
    const label = fieldLabelRu(key);
    if (Array.isArray(val)) {
      const text = val.map(translateApiMessage).join(" ");
      if (label) lines.push(`${label}: ${text}`);
      else lines.push(text);
    } else if (typeof val === "string") {
      const msg = translateApiMessage(val);
      if (label) lines.push(`${label}: ${msg}`);
      else lines.push(msg);
    }
  }
  if (lines.length) return lines.join("\n").trim();
  if (data.detail != null && data.detail !== "" && typeof data.detail === "string") {
    return data.detail.trim();
  }
  return "";
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

function generateStrongPassword() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*-_";
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export default function ChangePasswordPage({ user }) {
  const accountEmail = user && typeof user.email === "string" ? user.email.trim() : "";

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const onSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");
      setSaved(false);
      const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
      if (!token) {
        setError("Сессия истекла. Войдите снова.");
        return;
      }
      setLoading(true);
      try {
        const body = { old_password: oldPassword, new_password: newPassword };
        const response = await fetch(API_ENDPOINTS.changePassword, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const msg = formatChangePasswordErrors(data) || "Не удалось сменить пароль.";
          setError(msg);
          return;
        }
        setSaved(true);
        setOldPassword("");
        setNewPassword("");
      } catch {
        setError("Произошла ошибка, попробуйте позже.");
      } finally {
        setLoading(false);
      }
    },
    [newPassword, oldPassword],
  );

  const fillGenerated = useCallback(() => {
    setNewPassword(generateStrongPassword());
    setError("");
    setSaved(false);
  }, []);

  return (
    <div
      id="lk-settings-change-password-page"
      className="lk-settings-personal-page"
      data-testid="lk-change-password-page"
    >
      <div className="page">
        <div className="page__returnButton">
          <Link className="tw-link link_primary link_s" to="/lk/settings?tab=security">
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
          <h1 className="lk-settings-personal-page__title">Изменить пароль</h1>
        </div>

        <form className="lk-settings-personal-page__form" lang="ru" onSubmit={onSubmit} noValidate autoComplete="on">
          {/*
            Email перед полями пароля: Chrome / менеджеры паролей сопоставляют current-password с сохранённой записью по origin + username.
            Сам пароль с сервера подставить нельзя (он не передаётся). readOnly — чтобы не дублировать редактирование почты на этой форме.
          */}
          {accountEmail ? (
            <input
              id="lk-change-password-username"
              className="lk-settings-change-password-page__autofill-username"
              type="email"
              name="username"
              autoComplete="username"
              value={accountEmail}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
            />
          ) : null}
          <label className="lk-settings-personal-page__field">
            <span className="lk-settings-personal-page__field-label">Текущий пароль</span>
            <div className="lk-settings-bind-account-page__password-shell">
              <input
                className="lk-settings-personal-page__control lk-settings-bind-account-page__password-input"
                name="oldPassword"
                type={showOld ? "text" : "password"}
                autoComplete="current-password"
                autoCapitalize="none"
                value={oldPassword}
                onChange={(ev) => setOldPassword(ev.target.value)}
                disabled={loading}
              />
              <button
                type="button"
                className="lk-settings-bind-account-page__password-toggle"
                onClick={() => setShowOld((v) => !v)}
                aria-label={showOld ? "Скрыть пароль" : "Показать пароль"}
                disabled={loading}
              >
                {showOld ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>

          <label className="lk-settings-personal-page__field" htmlFor="lk-new-password">
            <div className="lk-settings-change-password-page__label-row">
              <span className="lk-settings-personal-page__field-label" id="lk-new-password-label">
                Новый пароль
              </span>
              <button
                type="button"
                className="lk-settings-change-password-page__generate-btn"
                onClick={fillGenerated}
                disabled={loading}
              >
                Сгенерировать
              </button>
            </div>
            <div className="lk-settings-bind-account-page__password-shell">
              <input
                id="lk-new-password"
                className="lk-settings-personal-page__control lk-settings-bind-account-page__password-input"
                name="newPassword"
                type={showNew ? "text" : "password"}
                autoComplete="new-password"
                autoCapitalize="none"
                value={newPassword}
                onChange={(ev) => setNewPassword(ev.target.value)}
                disabled={loading}
                aria-labelledby="lk-new-password-label"
              />
              <button
                type="button"
                className="lk-settings-bind-account-page__password-toggle"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? "Скрыть пароль" : "Показать пароль"}
                disabled={loading}
              >
                {showNew ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>

          {error ? (
            <div className="lk-settings-personal-error" role="alert">
              {error}
            </div>
          ) : null}
          {saved && !error ? <div className="lk-settings-personal-page__saved">Пароль изменён</div> : null}

          <div className="lk-settings-personal-page__actions">
            <button
              type="submit"
              className="baseButton button button_size_medium baseButton__size_medium baseButton__color_primary"
              data-test-id="submit-form-btn"
              data-testid="submit-form-btn"
              disabled={loading}
            >
              {loading ? "Сохранение…" : "Изменить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}