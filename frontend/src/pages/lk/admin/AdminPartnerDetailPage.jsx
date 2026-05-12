import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
import { adminFetch } from "../../../components/adminAuth";
import { toast } from "../../../components/toast/toastBus";
import "./admin.css";

const ALLOWED_STATUSES = ["pending", "active", "blocked"];

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

function PartnerStatusBadge({ value }) {
  const known = ALLOWED_STATUSES.includes(value);
  const cls = known
    ? `lk-admin__badge--status-${value}`
    : "lk-admin-users__badge_no";
  return (
    <span className={`lk-admin-users__badge ${cls}`}>
      {value || "—"}
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

export default function AdminPartnerDetailPage() {
  const { partnerId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [partner, setPartner] = useState(null);
  const [pendingStatus, setPendingStatus] = useState(null);
  const [actionError, setActionError] = useState("");
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
      const res = await adminFetch(API_ENDPOINTS.adminPartnerDetail(partnerId), {
        credentials: "include",
        signal: controller.signal,
      });
      if (res.status === 404) {
        setNotFound(true);
        setPartner(null);
        return;
      }
      if (!res.ok) {
        setError(res.status === 403 ? "Недостаточно прав" : "Не удалось загрузить партнёра");
        setPartner(null);
        return;
      }
      const payload = await res.json().catch(() => null);
      setPartner(payload || null);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setError("Сетевая ошибка, попробуйте позже");
      setPartner(null);
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

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

  const handleSetStatus = useCallback(
    async (nextStatus) => {
      if (!partner) return;
      if (!ALLOWED_STATUSES.includes(nextStatus)) return;
      if (partner.status === nextStatus) return;

      const label = partner.user_email || partner.user_public_id || `#${partner.id}`;
      const confirmText = `Изменить статус партнёра ${label} на ${nextStatus}?`;
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        if (!window.confirm(confirmText)) return;
      }

      setPendingStatus(nextStatus);
      setActionError("");
      try {
        const res = await adminFetch(API_ENDPOINTS.adminPartnerSetStatus(partner.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status: nextStatus }),
        });
        let body = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        if (!res.ok) {
          if (body && body.code === "ADMIN_MFA_REQUIRED") {
            setActionError("Нужно заново подтвердить вход в админку");
          } else if (body && body.code === "ADMIN_PARTNER_STATUS_INVALID") {
            setActionError(body.detail || "Недопустимый статус");
          } else {
            setActionError((body && body.detail) || "Не удалось изменить статус");
          }
          return;
        }
        if (body && typeof body === "object") {
          setPartner(body);
        }
      } catch (_) {
        toast.error("Сеть недоступна. Попробуйте ещё раз.");
      } finally {
        setPendingStatus(null);
      }
    },
    [partner],
  );

  const backLink = (
    <Link to="/admin-console/partners" className="lk-admin-user-detail__back">
      <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>К списку партнёров</span>
    </Link>
  );

  if (loading) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-partner-detail-title"
      >
        {backLink}
        <p className="lk-admin-users__muted">Загрузка…</p>
      </section>
    );
  }

  if (notFound) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-partner-detail-title"
      >
        {backLink}
        <h1
          id="lk-admin-partner-detail-title"
          className="lk-admin-cabinet__title"
        >
          Партнёр не найден
        </h1>
        <p className="lk-admin-users__muted">
          Партнёрского профиля с идентификатором {partnerId} нет в системе.
        </p>
      </section>
    );
  }

  if (error || !partner) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-partner-detail-title"
      >
        {backLink}
        <div className="lk-admin-users__error" role="alert">
          {error || "Не удалось загрузить партнёра"}
        </div>
      </section>
    );
  }

  const heading = partner.user_email || `#${partner.id}`;

  return (
    <section
      className="lk-admin-user-detail"
      aria-labelledby="lk-admin-partner-detail-title"
    >
      {backLink}
      <header className="lk-admin-user-detail__header">
        <h1
          id="lk-admin-partner-detail-title"
          className="lk-admin-cabinet__title"
        >
          {heading}
        </h1>
      </header>

      <div className="lk-admin-user-detail__cards">
        <article className="lk-admin-user-detail__card" aria-label="Пользователь">
          <h2 className="lk-admin-user-detail__card-title">Пользователь</h2>
          <DetailRow label="Email">{partner.user_email || "—"}</DetailRow>
          <DetailRow label="public_id">{partner.user_public_id || "—"}</DetailRow>
          <DetailRow label="ФИО">{partner.user_fio || "—"}</DetailRow>
          <DetailRow label="Телефон">{partner.user_phone || "—"}</DetailRow>
          <DetailRow label="Тип аккаунта">{partner.account_type || "—"}</DetailRow>
        </article>

        <article
          className="lk-admin-user-detail__card"
          aria-label="Партнёрский профиль"
        >
          <h2 className="lk-admin-user-detail__card-title">Партнёрский профиль</h2>
          <DetailRow label="ID">{partner.id}</DetailRow>
          <DetailRow label="Статус">
            <PartnerStatusBadge value={partner.status} />
          </DetailRow>
          <DetailRow label="Создан">{formatDateTime(partner.created_at)}</DetailRow>
          <DetailRow label="Обновлён">{formatDateTime(partner.updated_at)}</DetailRow>
          <div
            className="lk-admin-partner-detail__status-actions"
            role="group"
            aria-label="Смена статуса партнёра"
          >
            {ALLOWED_STATUSES.map((opt) => {
              const isCurrent = partner.status === opt;
              const isBusy = pendingStatus === opt;
              const cls = isCurrent
                ? "lk-admin-partner-detail__status-btn lk-admin-partner-detail__status-btn--active"
                : "lk-admin-partner-detail__status-btn";
              return (
                <button
                  key={opt}
                  type="button"
                  className={cls}
                  onClick={() => handleSetStatus(opt)}
                  disabled={isCurrent || pendingStatus !== null}
                  aria-pressed={isCurrent}
                >
                  {isBusy ? "Сохраняем…" : opt}
                </button>
              );
            })}
          </div>
          {actionError ? (
            <p
              className="lk-admin-partner-detail__error"
              role="alert"
            >
              {actionError}
            </p>
          ) : null}
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Деньги">
          <h2 className="lk-admin-user-detail__card-title">Деньги</h2>
          <DetailRow label="Баланс доступный">
            {partner.balance_available ?? "—"}
          </DetailRow>
          <DetailRow label="Баланс суммарный">
            {partner.balance_total ?? "—"}
          </DetailRow>
          <DetailRow label="Комиссия, %">
            {partner.commission_percent ?? "—"}
          </DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Связи">
          <h2 className="lk-admin-user-detail__card-title">Связи</h2>
          <DetailRow label="Проектов во владении">
            {Number(partner.owned_projects_count) || 0}
          </DetailRow>
          <DetailRow label="Сайтов во владении">
            {Number(partner.owned_sites_count) || 0}
          </DetailRow>
          <DetailRow label="Комиссий">
            {Number(partner.commissions_count) || 0}
          </DetailRow>
          <DetailRow label="Заказов">
            {Number(partner.orders_count) || 0}
          </DetailRow>
        </article>
      </div>
    </section>
  );
}
