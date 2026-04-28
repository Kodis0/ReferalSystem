import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Fingerprint, KeyRound, User } from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
import { persistReturningUserWelcome } from "../../login/login";
import AccountSettingsAvatar from "./AccountSettingsAvatar";
import OwnerActivityHistoryPanel from "../owner-programs/OwnerActivityHistoryPanel";
import "../owner-programs/owner-programs.css";
import "./settings.css";

const TAB_IDS = ["general", "security", "users", "notifications", "history"];

const TAB_LABELS = {
  general: "Информация",
  security: "Безопасность и вход",
  users: "Пользователи",
  notifications: "Уведомления",
  history: "История",
};

function displayNameFromUser(user) {
  if (!user) return "";
  const fio = typeof user.fio === "string" ? user.fio.trim() : "";
  if (fio) return fio;
  const patronymic = typeof user.patronymic === "string" ? user.patronymic.trim() : "";
  const ru = [user.last_name, user.first_name, patronymic].filter(Boolean).join(" ").trim();
  if (ru) return ru;
  const parts = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (parts) return parts;
  if (user.username) return String(user.username);
  return "";
}

/** Иконка ВК как в референсе (socialNetwork vk). */
function OauthVkBrandIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#2787F5"
        d="m21.9 16.84-.07-.14a10.78 10.78 0 0 0-2-2.42l-.01-.02-.01-.01-.01-.01h-.01c-.45-.45-.73-.75-.85-.9-.21-.3-.26-.59-.14-.89.08-.23.4-.7.93-1.43l.68-.93c1.2-1.68 1.72-2.76 1.56-3.22l-.06-.11c-.04-.07-.15-.13-.32-.18-.18-.06-.4-.07-.67-.03l-3 .02a.37.37 0 0 0-.2 0l-.14.04-.05.03-.05.03a.47.47 0 0 0-.11.11.76.76 0 0 0-.1.2 18.3 18.3 0 0 1-1.83 3.64 5.63 5.63 0 0 1-.93 1.1c-.12.1-.21.14-.27.13a7.35 7.35 0 0 1-.18-.04.72.72 0 0 1-.24-.27c-.05-.12-.1-.26-.12-.43a4.95 4.95 0 0 1-.03-.97l.01-.46a28.65 28.65 0 0 1 .05-1.67v-.6c0-.22 0-.38-.03-.5a1.77 1.77 0 0 0-.11-.36.58.58 0 0 0-.21-.26c-.1-.06-.21-.11-.35-.15a6.6 6.6 0 0 0-1.4-.14c-1.3-.01-2.13.07-2.5.26a2 2 0 0 0-.4.33c-.12.16-.13.25-.04.27.41.06.7.22.88.47l.06.13c.05.1.1.26.15.5a8.96 8.96 0 0 1-.15 3.57l-.12.24a.18.18 0 0 1-.05.06.75.75 0 0 1-.29.05c-.1 0-.21-.05-.35-.15a2.4 2.4 0 0 1-.43-.42 5.64 5.64 0 0 1-.5-.75c-.2-.32-.39-.7-.59-1.14l-.17-.32a27.9 27.9 0 0 1-.9-2.03.72.72 0 0 0-.25-.35l-.05-.03a1.06 1.06 0 0 0-.4-.16l-2.86.02c-.3 0-.5.07-.6.2l-.04.07A.37.37 0 0 0 2 7c0 .08.02.18.06.3a37 37 0 0 0 2.64 5.28 27.35 27.35 0 0 0 2.13 2.98l.26.26a12.47 12.47 0 0 0 1.8 1.35 5.66 5.66 0 0 0 2.9.77h1.2a.8.8 0 0 0 .55-.24l.04-.06a1.16 1.16 0 0 0 .11-.5 3.8 3.8 0 0 1 .25-1.42 1.4 1.4 0 0 1 .4-.48.68.68 0 0 1 .08-.04c.17-.06.37 0 .6.17.22.17.43.38.63.64.2.25.43.53.71.84a5 5 0 0 0 .73.7l.2.14c.15.08.33.16.55.24.22.07.41.09.58.05l2.67-.04c.26 0 .47-.05.61-.14.15-.09.23-.2.26-.3a.9.9 0 0 0 0-.37 1.43 1.43 0 0 0-.07-.3Z"
      />
    </svg>
  );
}

function LoginTelegramIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#2AABEE"
        d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
      />
    </svg>
  );
}

function LoginGoogleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function loadGoogleIdentityScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("no_window"));
      return;
    }
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const existing = document.querySelector("script[data-lumo-gis='1']");
    if (existing) {
      const done = () => {
        if (window.google?.accounts?.id) resolve();
        else reject(new Error("gis_unavailable"));
      };
      if (window.google?.accounts?.id) {
        resolve();
      } else {
        existing.addEventListener("load", done, { once: true });
        existing.addEventListener("error", () => reject(new Error("gis_load_failed")), { once: true });
      }
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.dataset.lumoGis = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("gis_load_failed"));
    document.head.appendChild(s);
  });
}

function AccountSettingsMessageModal({ open, title, message, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="lk-personalization-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lk-personalization-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="lk-personalization-modal__close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
        <div className="lk-personalization">
          <div className="lk-personalization__title">{title}</div>
          <p className="lk-settings-stub-modal__text">{message}</p>
          <div className="lk-settings-stub-modal__actions">
            <button type="button" className="lk-settings-personal-btn lk-settings-personal-btn_primary" onClick={onClose}>
              Понятно
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const VK_OAUTH_ERROR_HINTS = {
  vk_oauth_denied: "Вход через VK отменён.",
  vk_oauth_not_configured: "Вход через VK не настроен на сервере.",
  vk_state_invalid: "Сессия VK устарела. Откройте «ВК» в настройках снова.",
  vk_token_exchange_failed: "Не удалось завершить вход через VK. Попробуйте ещё раз.",
  vk_email_fetch_failed: "Не удалось получить email из VK.",
  vk_email_missing: "VK не передал email. Проверьте доступ приложения к почте.",
  vk_email_not_registered: "Этот VK привязан к почте, для которой нет аккаунта. Войдите под тем же email, что в VK.",
  vk_missing_device_id: "Ответ VK неполный. Обновите страницу и попробуйте снова.",
  account_disabled: "Аккаунт отключён.",
};

function Settings({ user, fetchUser, setUser }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const t = searchParams.get("tab");
    return TAB_IDS.includes(t) ? t : "general";
  });
  const [loginStubOpen, setLoginStubOpen] = useState(false);
  const [securityStub, setSecurityStub] = useState(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthHint, setOauthHint] = useState("");
  const [accountAdditionalList, setAccountAdditionalList] = useState(null);
  const [accountAdditionalError, setAccountAdditionalError] = useState(null);
  const [accountAdditionalLoading, setAccountAdditionalLoading] = useState(false);
  const googleCredentialHandlerRef = useRef(() => {});

  useEffect(() => {
    if (tab !== "users" || !user) return undefined;
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      setAccountAdditionalList([]);
      setAccountAdditionalError(null);
      setAccountAdditionalLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setAccountAdditionalLoading(true);
      setAccountAdditionalError(null);
      try {
        const res = await fetch(API_ENDPOINTS.accountUsers, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 403) {
          setAccountAdditionalError("forbidden");
          setAccountAdditionalList(null);
          setAccountAdditionalLoading(false);
          return;
        }
        if (!res.ok) {
          setAccountAdditionalError("load");
          setAccountAdditionalList(null);
          setAccountAdditionalLoading(false);
          return;
        }
        setAccountAdditionalList(Array.isArray(data.results) ? data.results : []);
        setAccountAdditionalLoading(false);
      } catch {
        if (!cancelled) {
          setAccountAdditionalError("load");
          setAccountAdditionalList(null);
          setAccountAdditionalLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, user]);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (TAB_IDS.includes(t)) setTab(t);
  }, [searchParams]);

  useEffect(() => {
    const code = searchParams.get("vk_error");
    if (!code || typeof code !== "string") return;
    setOauthHint(VK_OAUTH_ERROR_HINTS[code] || `Ошибка входа через VK (${code}).`);
    const next = new URLSearchParams(searchParams);
    next.delete("vk_error");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const hasToken = typeof window !== "undefined" && !!localStorage.getItem("access_token");
  const loadingProfile = hasToken && user === null;

  const displayName = useMemo(() => displayNameFromUser(user), [user]);
  const loginSubtitle =
    user && typeof user.username === "string" && user.username.trim() ? user.username.trim() : "не задан";

  const tabListId = "lk-settings-tabs";
  const tabPanelId = "lk-settings-panel";

  googleCredentialHandlerRef.current = async (credentialResponse) => {
    const cred = credentialResponse?.credential;
    if (!cred) {
      setOauthBusy(false);
      return;
    }
    setOauthHint("");
    try {
      const response = await fetch(API_ENDPOINTS.tokenGoogle, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: cred }),
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) {
        setOauthHint(
          typeof data?.detail === "string" && data.detail
            ? data.detail
            : "Не удалось войти через Google. Попробуйте снова.",
        );
        setOauthBusy(false);
        return;
      }

      localStorage.setItem("access_token", data.access);
      localStorage.setItem("refresh_token", data.refresh);
      if (data.user) {
        localStorage.setItem("user", JSON.stringify(data.user));
      }
      persistReturningUserWelcome(data.user);
      navigate("/lk/partner");
    } catch {
      setOauthHint("Произошла ошибка, попробуйте позже");
    } finally {
      setOauthBusy(false);
    }
  };

  useEffect(() => {
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!clientId) return undefined;

    let cancelled = false;
    (async () => {
      try {
        await loadGoogleIdentityScript();
        if (cancelled || typeof window === "undefined" || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp) => googleCredentialHandlerRef.current(resp),
        });
      } catch {
        /* optional until click */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSettingsGoogleClick = async () => {
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setOauthHint(
        "Вход через Google не настроен: задайте REACT_APP_GOOGLE_CLIENT_ID (тот же Web client ID, что и GOOGLE_OAUTH_CLIENT_ID на сервере).",
      );
      return;
    }
    setOauthHint("");
    try {
      if (typeof window === "undefined" || !window.google?.accounts?.id) {
        await loadGoogleIdentityScript();
      }
      if (typeof window === "undefined" || !window.google?.accounts?.id) {
        setOauthHint("Не удалось загрузить вход Google. Проверьте сеть и обновите страницу.");
        return;
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => googleCredentialHandlerRef.current(resp),
      });
    } catch {
      setOauthHint("Не удалось загрузить скрипт Google. Попробуйте позже.");
      return;
    }

    setOauthBusy(true);
    window.google.accounts.id.prompt((notification) => {
      if (notification.isDismissedMoment?.() || notification.isSkippedMoment?.()) {
        setOauthBusy(false);
      }
      if (notification.isNotDisplayed?.()) {
        setOauthBusy(false);
        const reason = notification.getNotDisplayedReason?.();
        const hints = {
          unregistered_domain:
            "Этот сайт не указан в «Authorized JavaScript origins» в Google Cloud Console.",
          invalid_client: "Неверный Google Client ID (REACT_APP_GOOGLE_CLIENT_ID).",
          missing_client_id: "Не задан Google Client ID.",
        };
        if (reason && hints[reason]) {
          setOauthHint(hints[reason]);
        }
      }
    });
  };

  const handleSettingsVkClick = () => {
    setOauthHint("");
    const params = new URLSearchParams({
      next: "/lk/settings",
      scheme: "light",
    });
    window.location.assign(`${API_ENDPOINTS.tokenVkStart}?${params.toString()}`);
  };

  const handleSettingsTelegramClick = () => {
    setOauthHint("");
    window.location.assign(API_ENDPOINTS.tokenTelegramStart);
  };

  return (
    <div className="lk-settings" data-testid="lk-account-settings">
      <div className="lk-settings__identity">
        <div className="lk-settings__identity-avatar-col">
          <AccountSettingsAvatar user={user} fetchUser={fetchUser} setUser={setUser} disabled={loadingProfile || !user} />
        </div>
        <div className="lk-settings__identity-text">
          {loadingProfile && (
            <>
              <h1 className="lk-settings__title lk-settings__title_identity" aria-busy="true">
                <span
                  className="lk-settings__skeleton lk-settings__skeleton_line lk-settings__skeleton_identity-title"
                  aria-hidden
                />
              </h1>
              <div className="lk-settings__identity-email lk-settings__skeleton lk-settings__skeleton_line lk-settings__skeleton_line_short" />
            </>
          )}
          {!loadingProfile && !user && (
            <>
              <h1 className="lk-settings__title lk-settings__title_identity">Профиль недоступен</h1>
              <p className="lk-settings__identity-email">
                Не удалось загрузить данные.{" "}
                <button type="button" className="lk-settings__link-btn" onClick={() => fetchUser()}>
                  Повторить
                </button>
              </p>
            </>
          )}
          {!loadingProfile && user && (
            <>
              <h1 className="lk-settings__title lk-settings__title_identity">{displayName || "Без имени"}</h1>
              <p className="lk-settings__identity-email">{user.email || "—"}</p>
            </>
          )}
        </div>
      </div>

      <div className="lk-settings__tabs" role="tablist" aria-label="Разделы настроек аккаунта" id={tabListId}>
        {TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`lk-settings-tab-${id}`}
            className={`lk-settings__tab ${tab === id ? "lk-settings__tab_active" : ""}`}
            aria-selected={tab === id}
            aria-controls={tabPanelId}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => {
              setTab(id);
              const next = new URLSearchParams(searchParams);
              if (id === "general") next.delete("tab");
              else next.set("tab", id);
              setSearchParams(next, { replace: true });
            }}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      <div
        className="lk-settings__panel"
        role="tabpanel"
        id={tabPanelId}
        aria-labelledby={`lk-settings-tab-${tab}`}
        tabIndex={0}
        key={tab}
      >
        {tab === "general" && (
          <>
            <section className="lk-settings__section" aria-labelledby="lk-settings-manage-heading">
              <h3 className="lk-settings__manage-section-title" id="lk-settings-manage-heading">
                Управление
              </h3>

              <div className="lk-settings__manage-list">
                <div className="lk-settings__manage-row">
                  <div className="lk-settings__manage-row-icon" aria-hidden="true">
                    <User size={24} strokeWidth={1.75} />
                  </div>
                  <div className="lk-settings__manage-row-body">
                    <div className="lk-settings__manage-row-title">Личные данные</div>
                    <div className="lk-settings__manage-row-sub">{displayName || "Имя не указано"}</div>
                  </div>
                  <Link
                    className="lk-settings__manage-action lk-settings__manage-action_link"
                    to="/lk/settings/personal"
                    aria-disabled={!user || loadingProfile}
                    onClick={(e) => {
                      if (!user || loadingProfile) e.preventDefault();
                    }}
                  >
                    Изменить
                  </Link>
                </div>

                <div className="lk-settings__manage-row">
                  <div className="lk-settings__manage-row-icon" aria-hidden="true">
                    <KeyRound size={24} strokeWidth={1.75} />
                  </div>
                  <div className="lk-settings__manage-row-body">
                    <div className="lk-settings__manage-row-title">Логин аккаунта</div>
                    <div className="lk-settings__manage-row-sub">{loadingProfile ? "…" : loginSubtitle}</div>
                  </div>
                  <button type="button" className="lk-settings__manage-action" onClick={() => setLoginStubOpen(true)}>
                    Изменить
                  </button>
                </div>
              </div>
            </section>

            <section className="lk-settings__section lk-settings__section_linked" aria-labelledby="lk-settings-linked-heading">
              <h3 className="lk-settings__manage-section-title" id="lk-settings-linked-heading">
                Привязанные аккаунты
              </h3>
              <div className="lk-settings__linked-card">
                <p className="lk-settings__linked-text">Нет привязанных аккаунтов</p>
                <button type="button" className="lk-settings__linked-btn" onClick={() => navigate("/lk/settings/bind-account")}>
                  Привязать аккаунт
                </button>
              </div>
            </section>

          </>
        )}

        {tab === "security" && (
          <section className="lk-settings__section lk-settings__section_security" aria-labelledby="lk-settings-security-heading">
            <div className="lk-settings__controls-block">
              <div className="lk-settings__controls-block-title">
                <h2 className="lk-settings__section-title lk-settings__section-title_h2" id="lk-settings-security-heading">
                  Способы входа
                </h2>
              </div>
              <div className="lk-settings__card lk-settings__card_controls">
                <div className="lk-settings__control-row">
                  <div className="lk-settings__control-description">
                    <div className="lk-settings__control-avatar-wrap">
                      <div className="lk-settings__control-avatar lk-settings__control-avatar_secondary" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                          <path
                            fill="currentColor"
                            d="M17 9V7A5 5 0 0 0 7 7v2a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-7a3 3 0 0 0-3-3ZM9 7a3 3 0 1 1 6 0v2H9V7Zm9 12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7Z"
                          />
                        </svg>
                      </div>
                    </div>
                    <div className="lk-settings__control-text">
                      <p className="lk-settings__control-title">Пароль</p>
                      <p className="lk-settings__control-sub" title="Рекомендуем периодически менять пароль">
                        Рекомендуем периодически менять пароль
                      </p>
                    </div>
                  </div>
                  <div className="lk-settings__control-content">
                    <button
                      type="button"
                      className="lk-settings__manage-action"
                      data-testid="change-password-btn"
                      onClick={() => navigate("/lk/settings/change-password")}
                    >
                      Изменить
                    </button>
                  </div>
                </div>

                <div className="lk-settings__control-row">
                  <div className="lk-settings__control-description">
                    <div className="lk-settings__control-avatar-wrap">
                      <div className="lk-settings__control-avatar lk-settings__control-avatar_secondary" aria-hidden="true">
                        <Fingerprint size={22} strokeWidth={1.75} />
                      </div>
                    </div>
                    <div className="lk-settings__control-text">
                      <p className="lk-settings__control-title">Авторизация через Passkey</p>
                      <p
                        className="lk-settings__control-sub"
                        title="Отпечаток, скан лица, скан сетчатки или пин-код"
                      >
                        Отпечаток, скан лица, скан сетчатки или пин-код
                      </p>
                    </div>
                  </div>
                  <div className="lk-settings__control-content">
                    <button
                      type="button"
                      className="lk-settings__manage-action"
                      data-testid="passkey-btn"
                      onClick={() => setSecurityStub("passkey")}
                    >
                      Управлять
                    </button>
                  </div>
                </div>

                <div className="lk-settings__control-row lk-settings__control-row_social">
                  <div className="lk-settings__control-description">
                    <div className="lk-settings__control-avatar-wrap">
                      <div className="lk-settings__control-avatar lk-settings__control-avatar_secondary" aria-hidden="true">
                        <KeyRound size={22} strokeWidth={1.75} />
                      </div>
                    </div>
                    <div className="lk-settings__control-text">
                      <p className="lk-settings__control-title">Быстрая авторизация через социальные сети</p>
                      <p
                        className="lk-settings__control-sub"
                        title="Привяжите соцсети для входа в один клик без ввода пароля"
                      >
                        Привяжите соцсети для входа в один клик без ввода пароля
                      </p>
                    </div>
                  </div>
                  <div className="lk-settings__control-content lk-settings__control-content_oauth">
                    <div className="lk-settings__oauth-login-wrap">
                      <div className="lk-settings__oauth-network-list" data-testid="oauth-types-list">
                        <button
                          type="button"
                          className="lk-settings__oauth-network-btn lk-settings__oauth-network-btn_vk"
                          aria-label="Войти через VK"
                          onClick={handleSettingsVkClick}
                        >
                          <OauthVkBrandIcon />
                          <span>ВК</span>
                        </button>
                        <button
                          type="button"
                          className="lk-settings__oauth-network-btn lk-settings__oauth-network-btn_telegram"
                          aria-label="Войти через Telegram"
                          onClick={handleSettingsTelegramClick}
                        >
                          <LoginTelegramIcon />
                          <span>Telegram</span>
                        </button>
                        <button
                          type="button"
                          className="lk-settings__oauth-network-btn lk-settings__oauth-network-btn_google"
                          aria-label="Войти через Google"
                          disabled={oauthBusy}
                          onClick={handleSettingsGoogleClick}
                        >
                          <LoginGoogleIcon />
                          <span>Google</span>
                        </button>
                      </div>
                      {oauthHint ? <p className="lk-settings__oauth-hint">{oauthHint}</p> : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {tab === "users" && (
          <section
            className="lk-settings__section lk-settings__section_account-users"
            aria-labelledby="lk-settings-users-heading"
          >
            <div className="lk-settings__controls-block lk-settings__controls-block_account-users">
              <div className="lk-settings__controls-block-title lk-settings__controls-block-title_users">
                <h2 className="lk-settings__section-title lk-settings__section-title_h2" id="lk-settings-users-heading">
                  Дополнительные пользователи
                </h2>
              </div>

              {accountAdditionalLoading && (
                <div className="lk-settings__account-users-loading" aria-busy="true">
                  <span
                    className="lk-settings__skeleton lk-settings__skeleton_line lk-settings__skeleton_identity-title"
                    aria-hidden
                  />
                  <span
                    className="lk-settings__skeleton lk-settings__skeleton_line lk-settings__skeleton_line_short"
                    aria-hidden
                  />
                </div>
              )}

              {!accountAdditionalLoading && accountAdditionalError === "forbidden" && (
                <p className="lk-settings__account-users-forbidden">
                  Список доступен только владельцу основного аккаунта. Вы вошли как дополнительный пользователь.
                </p>
              )}

              {!accountAdditionalLoading &&
                accountAdditionalError !== "forbidden" &&
                (accountAdditionalError === "load" ||
                  (Array.isArray(accountAdditionalList) && accountAdditionalList.length === 0)) && (
                  <>
                    <p className="lk-settings__account-users-empty">У вас нет созданных пользователей</p>
                    <Link
                      className="lk-settings__account-users-create-btn"
                      to="/lk/settings/users/create"
                      data-testid="account-user-create-btn"
                      data-test-id="account-user-create-btn"
                    >
                      Создать
                    </Link>
                  </>
                )}

              {!accountAdditionalLoading &&
                accountAdditionalError !== "forbidden" &&
                accountAdditionalError !== "load" &&
                accountAdditionalList &&
                accountAdditionalList.length > 0 && (
                  <>
                    <ul className="lk-settings__account-users-list" aria-label="Дополнительные пользователи">
                      {accountAdditionalList.map((row) => (
                        <li key={row.public_id} className="lk-settings__account-users-row">
                          <div className="lk-settings__account-users-row-main">
                            <span className="lk-settings__account-users-name">
                              {displayNameFromUser(row) || "Без имени"}
                            </span>
                            <span className="lk-settings__account-users-email">{row.email || "—"}</span>
                          </div>
                          {!row.is_active ? (
                            <span className="lk-settings__account-users-inactive">Неактивен</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <div className="lk-settings__account-users-create-wrap">
                      <Link
                        className="lk-settings__account-users-create-btn"
                        to="/lk/settings/users/create"
                        data-testid="account-user-create-btn-list"
                        data-test-id="account-user-create-btn"
                      >
                        Создать
                      </Link>
                    </div>
                  </>
                )}
            </div>
          </section>
        )}

        {tab === "notifications" && (
          <section className="lk-settings__section" aria-labelledby="lk-settings-notify-heading">
            <h2 className="lk-settings__section-title" id="lk-settings-notify-heading">
              Каналы уведомлений
            </h2>
            <div className="lk-settings__card">
              <div className="lk-settings__notify-block">
                <h3 className="lk-settings__notify-label">Email</h3>
                <p className="lk-settings__muted">Выбор писем по событиям аккаунта будет доступен здесь.</p>
              </div>
              <div className="lk-settings__notify-block">
                <h3 className="lk-settings__notify-label">Системные</h3>
                <p className="lk-settings__muted">Настройки внутри кабинета (баннеры, подсказки) подключим отдельно.</p>
              </div>
            </div>
          </section>
        )}

        {tab === "history" && (
          <section className="lk-settings__section" aria-labelledby="lk-settings-history-heading">
            <h2 className="lk-settings__section-title" id="lk-settings-history-heading">
              История действий
            </h2>
            <div className="lk-settings__account-history-wrap">
              <OwnerActivityHistoryPanel
                activityBaseUrl={API_ENDPOINTS.accountOwnerActivity}
                portalId="lk-settings-account-activity-datepicker-portal"
                showInnerTitle={false}
                showServiceColumn
                ownerShellBackTo="/lk/settings?tab=history"
              />
            </div>
          </section>
        )}
      </div>

      <AccountSettingsMessageModal
        open={loginStubOpen}
        title="Логин аккаунта"
        message="Изменение логина появится в этом разделе позже. Пока используйте текущий логин для входа."
        onClose={() => setLoginStubOpen(false)}
      />
      <AccountSettingsMessageModal
        open={securityStub === "passkey"}
        title="Passkey"
        message="Управление ключами Passkey в этом разделе будет доступно позже."
        onClose={() => setSecurityStub(null)}
      />
    </div>
  );
}

export default Settings;
