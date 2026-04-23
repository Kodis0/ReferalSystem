import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { KeyRound, User } from "lucide-react";
import AccountSettingsAvatar from "./AccountSettingsAvatar";
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

function Settings({ user, fetchUser }) {
  const [tab, setTab] = useState("general");
  const [loginStubOpen, setLoginStubOpen] = useState(false);
  const [bindStubOpen, setBindStubOpen] = useState(false);

  const hasToken = typeof window !== "undefined" && !!localStorage.getItem("access_token");
  const loadingProfile = hasToken && user === null;

  const displayName = useMemo(() => displayNameFromUser(user), [user]);
  const loginSubtitle =
    user && typeof user.username === "string" && user.username.trim() ? user.username.trim() : "не задан";

  const tabListId = "lk-settings-tabs";
  const tabPanelId = "lk-settings-panel";

  return (
    <div className="lk-settings" data-testid="lk-account-settings">
      <div className="lk-settings__identity">
        <div className="lk-settings__identity-avatar-col">
          <AccountSettingsAvatar user={user} fetchUser={fetchUser} disabled={loadingProfile || !user} />
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
            onClick={() => setTab(id)}
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
                    <User size={20} strokeWidth={1.75} />
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
                    <KeyRound size={20} strokeWidth={1.75} />
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
                <button type="button" className="lk-settings__linked-btn" onClick={() => setBindStubOpen(true)}>
                  Привязать аккаунт
                </button>
              </div>
            </section>

          </>
        )}

        {tab === "security" && (
          <section className="lk-settings__section" aria-labelledby="lk-settings-security-heading">
            <h2 className="lk-settings__section-title" id="lk-settings-security-heading">
              Пароль и вход
            </h2>
            <div className="lk-settings__card">
              <ul className="lk-settings__bullet-list">
                <li>Держите пароль в секрете и не используйте его на других сервисах.</li>
                <li>Выход из аккаунта доступен в меню профиля в шапке.</li>
                <li>При подозрении на доступ посторонних смените пароль и обратитесь в поддержку.</li>
              </ul>
              <p className="lk-settings__placeholder">
                Смена пароля и дополнительные способы входа появятся в этом разделе, когда мы подключим их к
                кабинету.
              </p>
            </div>
          </section>
        )}

        {tab === "users" && (
          <section className="lk-settings__section" aria-labelledby="lk-settings-users-heading">
            <h2 className="lk-settings__section-title" id="lk-settings-users-heading">
              Пользователи аккаунта
            </h2>
            <div className="lk-settings__card lk-settings__card_empty">
              <p className="lk-settings__empty-title">Пока нет отдельного списка</p>
              <p className="lk-settings__muted">
                Совместный доступ к сайтам и проектам настраивается внутри соответствующего проекта. Общий
                каталог пользователей аккаунта здесь появится позже.
              </p>
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
            <div className="lk-settings__card lk-settings__card_empty">
              <p className="lk-settings__empty-title">Журнал пока пуст</p>
              <p className="lk-settings__muted">
                Здесь будет отображаться история входов и важных изменений в аккаунте, когда журналирование
                будет включено для вашего окружения.
              </p>
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
        open={bindStubOpen}
        title="Привязка аккаунта"
        message="Привязка внешних аккаунтов будет доступна в следующих версиях."
        onClose={() => setBindStubOpen(false)}
      />
    </div>
  );
}

export default Settings;
