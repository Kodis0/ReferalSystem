import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
import { toast } from "../../../components/toast/toastBus";
import useCurrentUser from "../../../hooks/useCurrentUser";
import "./admin.css";

function formatDateTime(value) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

function YesNoBadge({ value }) {
  return (
    <span
      className={`lk-admin-users__badge${value ? " lk-admin-users__badge_yes" : " lk-admin-users__badge_no"}`}
    >
      {value ? "Да" : "Нет"}
    </span>
  );
}

function DetailRow({ label, children }) {
  return (
    <div className="lk-admin-user-detail__row">
      <span className="lk-admin-user-detail__row-label">{label}</span>
      <span className="lk-admin-user-detail__row-value">{children}</span>
    </div>
  );
}

export default function AdminUserDetailPage() {
  const { userId } = useParams();
  const { user: currentUser } = useCurrentUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [user, setUser] = useState(null);
  const [togglingActive, setTogglingActive] = useState(false);
  const [toggleError, setToggleError] = useState(null);
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotFound(false);
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {
        // ignore
      }
    }
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const token =
        typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
      const res = await fetch(API_ENDPOINTS.adminUserDetail(userId), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        signal: controller.signal,
      });
      if (res.status === 404) {
        setNotFound(true);
        setUser(null);
        return;
      }
      if (!res.ok) {
        setError(res.status === 403 ? "Недостаточно прав" : "Не удалось загрузить пользователя");
        setUser(null);
        return;
      }
      const payload = await res.json().catch(() => null);
      setUser(payload || null);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setError("Сетевая ошибка, попробуйте позже");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
    return () => {
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, [load]);

  const handleToggleActive = useCallback(async () => {
    if (!user) return;
    const nextValue = !user.is_active;
    const confirmText = user.is_active
      ? `Заблокировать пользователя ${user.email || user.public_id || `#${user.id}`}?`
      : `Разблокировать пользователя ${user.email || user.public_id || `#${user.id}`}?`;
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      if (!window.confirm(confirmText)) return;
    }
    setTogglingActive(true);
    setToggleError(null);
    try {
      const token =
        typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
      const res = await fetch(API_ENDPOINTS.adminUserSetActive(user.id), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ is_active: nextValue }),
      });
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!res.ok) {
        if (body && body.code === "ADMIN_MFA_REQUIRED") {
          setToggleError("Нужно заново подтвердить вход в админку");
        } else {
          setToggleError((body && body.detail) || "Не удалось изменить статус");
        }
        return;
      }
      if (body && typeof body === "object") {
        setUser(body);
      }
    } catch (_) {
      toast.error("Сеть недоступна. Попробуйте ещё раз.");
    } finally {
      setTogglingActive(false);
    }
  }, [user]);

  const backLink = (
    <Link to="/lk/admin/users" className="lk-admin-user-detail__back">
      <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>К списку пользователей</span>
    </Link>
  );

  if (loading) {
    return (
      <section className="lk-admin-user-detail" aria-labelledby="lk-admin-user-detail-title">
        {backLink}
        <p className="lk-admin-users__muted">Загрузка…</p>
      </section>
    );
  }

  if (notFound) {
    return (
      <section className="lk-admin-user-detail" aria-labelledby="lk-admin-user-detail-title">
        {backLink}
        <h1 id="lk-admin-user-detail-title" className="lk-admin-cabinet__title">
          Пользователь не найден
        </h1>
        <p className="lk-admin-users__muted">
          Учётной записи с идентификатором {userId} нет в системе.
        </p>
      </section>
    );
  }

  if (error || !user) {
    return (
      <section className="lk-admin-user-detail" aria-labelledby="lk-admin-user-detail-title">
        {backLink}
        <div className="lk-admin-users__error" role="alert">
          {error || "Не удалось загрузить пользователя"}
        </div>
      </section>
    );
  }

  const heading = user.email || user.public_id || `#${user.id}`;
  const pp = user.partner_profile || null;
  const isSelf = currentUser != null && Number(currentUser.id) === Number(user.id);
  const isProtectedSuperuser =
    Boolean(user.is_superuser) && !Boolean(currentUser && currentUser.is_superuser);
  const toggleDisabled = togglingActive || isSelf || isProtectedSuperuser;
  const toggleLabel = user.is_active
    ? "Заблокировать пользователя"
    : "Разблокировать пользователя";
  const toggleClass = user.is_active
    ? "lk-admin-user-detail__btn lk-admin-user-detail__btn--danger"
    : "lk-admin-user-detail__btn lk-admin-user-detail__btn--primary";

  return (
    <section className="lk-admin-user-detail" aria-labelledby="lk-admin-user-detail-title">
      {backLink}
      <header className="lk-admin-user-detail__header">
        <h1 id="lk-admin-user-detail-title" className="lk-admin-cabinet__title">
          {heading}
        </h1>
      </header>

      <div className="lk-admin-user-detail__cards">
        <article className="lk-admin-user-detail__card" aria-label="Основное">
          <h2 className="lk-admin-user-detail__card-title">Основное</h2>
          <DetailRow label="ID">{user.id}</DetailRow>
          <DetailRow label="public_id">{user.public_id || "—"}</DetailRow>
          <DetailRow label="Email">{user.email || "—"}</DetailRow>
          {user.username !== undefined && (
            <DetailRow label="Username">{user.username || "—"}</DetailRow>
          )}
          <DetailRow label="ФИО">{user.fio || "—"}</DetailRow>
          <DetailRow label="Телефон">{user.phone || "—"}</DetailRow>
          <DetailRow label="Тип аккаунта">{user.account_type || "—"}</DetailRow>
          <DetailRow label="Регистрация">{formatDateTime(user.date_joined)}</DetailRow>
          <DetailRow label="Последний вход">{formatDateTime(user.last_login)}</DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Доступ">
          <h2 className="lk-admin-user-detail__card-title">Доступ</h2>
          <DetailRow label="Активен">
            <YesNoBadge value={Boolean(user.is_active)} />
          </DetailRow>
          <DetailRow label="Staff">
            <YesNoBadge value={Boolean(user.is_staff)} />
          </DetailRow>
          <DetailRow label="Superuser">
            <YesNoBadge value={Boolean(user.is_superuser)} />
          </DetailRow>
          <div className="lk-admin-user-detail__access-actions">
            <button
              type="button"
              className={toggleClass}
              onClick={handleToggleActive}
              disabled={toggleDisabled}
              title={
                isSelf
                  ? "Нельзя менять активность собственной учётной записи"
                  : isProtectedSuperuser
                    ? "Это действие доступно только суперадминистратору"
                    : undefined
              }
            >
              {togglingActive ? "Сохраняем…" : toggleLabel}
            </button>
          </div>
          {toggleError ? (
            <p className="lk-admin-user-detail__access-error" role="alert">
              {toggleError}
            </p>
          ) : null}
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Аккаунты и связи">
          <h2 className="lk-admin-user-detail__card-title">Аккаунты и связи</h2>
          <DetailRow label="Владелец аккаунта (account_owner_id)">
            {user.account_owner_id == null ? "—" : user.account_owner_id}
          </DetailRow>
          <DetailRow label="Дополнительных пользователей">
            {Number(user.additional_users_count) || 0}
          </DetailRow>
          <DetailRow label="Проектов во владении">
            {Number(user.owned_projects_count) || 0}
          </DetailRow>
          <DetailRow label="Сайтов во владении">
            {Number(user.owned_sites_count) || 0}
          </DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Партнёрский профиль">
          <h2 className="lk-admin-user-detail__card-title">Партнёрский профиль</h2>
          {pp ? (
            <>
              <DetailRow label="ID">{pp.id}</DetailRow>
              <DetailRow label="Статус">{pp.status || "—"}</DetailRow>
              <DetailRow label="Баланс доступный">{pp.balance_available ?? "—"}</DetailRow>
              <DetailRow label="Баланс суммарный">{pp.balance_total ?? "—"}</DetailRow>
              <DetailRow label="Комиссия, %">{pp.commission_percent ?? "—"}</DetailRow>
            </>
          ) : (
            <p className="lk-admin-users__muted">Партнёрский профиль не создан</p>
          )}
        </article>
      </div>
    </section>
  );
}
