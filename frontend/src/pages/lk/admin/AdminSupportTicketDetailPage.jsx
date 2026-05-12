import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
import { adminFetch } from "../../../components/adminAuth";
import { toast } from "../../../components/toast/toastBus";
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

function TicketStatusBadge({ isClosed }) {
  const cls = isClosed
    ? "lk-admin__badge--ticket-closed"
    : "lk-admin__badge--ticket-open";
  return (
    <span className={`lk-admin-users__badge ${cls}`}>
      {isClosed ? "Закрыто" : "Открыто"}
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

export default function AdminSupportTicketDetailPage() {
  const { ticketId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [togglingClosed, setTogglingClosed] = useState(false);
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
      const res = await adminFetch(API_ENDPOINTS.adminSupportTicketDetail(ticketId), {
        credentials: "include",
        signal: controller.signal,
      });
      if (res.status === 404) {
        setNotFound(true);
        setTicket(null);
        return;
      }
      if (!res.ok) {
        setError(res.status === 403 ? "Недостаточно прав" : "Не удалось загрузить обращение");
        setTicket(null);
        return;
      }
      const payload = await res.json().catch(() => null);
      setTicket(payload || null);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setError("Сетевая ошибка, попробуйте позже");
      setTicket(null);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

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

  const handleToggleClosed = useCallback(async () => {
    if (!ticket) return;
    const nextValue = !ticket.is_closed;
    const confirmText = nextValue ? "Закрыть обращение?" : "Открыть обращение?";
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      if (!window.confirm(confirmText)) return;
    }
    setTogglingClosed(true);
    setActionError("");
    try {
      const res = await adminFetch(API_ENDPOINTS.adminSupportTicketUpdate(ticket.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ is_closed: nextValue }),
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
        } else if (body && body.code === "ADMIN_TICKET_UPDATE_INVALID") {
          setActionError(body.detail || "Недопустимое значение");
        } else {
          setActionError((body && body.detail) || "Не удалось изменить статус");
        }
        return;
      }
      if (body && typeof body === "object") {
        setTicket(body);
      }
    } catch (_) {
      toast.error("Сеть недоступна. Попробуйте ещё раз.");
    } finally {
      setTogglingClosed(false);
    }
  }, [ticket]);

  const backLink = (
    <Link to="/admin-console/support" className="lk-admin-user-detail__back">
      <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>К списку обращений</span>
    </Link>
  );

  if (loading) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-support-detail-title"
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
        aria-labelledby="lk-admin-support-detail-title"
      >
        {backLink}
        <h1
          id="lk-admin-support-detail-title"
          className="lk-admin-cabinet__title"
        >
          Обращение не найдено
        </h1>
        <p className="lk-admin-users__muted">
          Обращения с идентификатором {ticketId} нет в системе.
        </p>
      </section>
    );
  }

  if (error || !ticket) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-support-detail-title"
      >
        {backLink}
        <div className="lk-admin-users__error" role="alert">
          {error || "Не удалось загрузить обращение"}
        </div>
      </section>
    );
  }

  const heading = ticket.target_label
    ? ticket.target_label
    : `Обращение #${String(ticket.id).slice(0, 8)}`;
  const toggleLabel = ticket.is_closed ? "Открыть обращение" : "Закрыть обращение";
  const toggleClass = ticket.is_closed
    ? "lk-admin-user-detail__btn lk-admin-user-detail__btn--primary"
    : "lk-admin-user-detail__btn lk-admin-user-detail__btn--danger";

  return (
    <section
      className="lk-admin-user-detail"
      aria-labelledby="lk-admin-support-detail-title"
    >
      {backLink}
      <header className="lk-admin-user-detail__header">
        <h1
          id="lk-admin-support-detail-title"
          className="lk-admin-cabinet__title"
        >
          {heading}
        </h1>
      </header>

      <div className="lk-admin-user-detail__cards">
        <article className="lk-admin-user-detail__card" aria-label="Пользователь">
          <h2 className="lk-admin-user-detail__card-title">Пользователь</h2>
          <DetailRow label="Email">{ticket.user_email || "—"}</DetailRow>
          <DetailRow label="ID">{ticket.user_id ?? "—"}</DetailRow>
          {ticket.user_public_id !== undefined && (
            <DetailRow label="public_id">{ticket.user_public_id || "—"}</DetailRow>
          )}
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Обращение">
          <h2 className="lk-admin-user-detail__card-title">Обращение</h2>
          <DetailRow label="ID">{ticket.id}</DetailRow>
          <DetailRow label="Тип">{ticket.type_slug || "—"}</DetailRow>
          <DetailRow label="Тема">{ticket.target_label || "—"}</DetailRow>
          <DetailRow label="Создано">{formatDateTime(ticket.created_at)}</DetailRow>
          {ticket.attachment_names ? (
            <DetailRow label="Вложения">{ticket.attachment_names}</DetailRow>
          ) : null}
          <div className="lk-admin-support-detail__body-wrap">
            <span className="lk-admin-user-detail__row-label">Сообщение</span>
            <pre className="lk-admin-support-detail__body">{ticket.body || ""}</pre>
          </div>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Статус">
          <h2 className="lk-admin-user-detail__card-title">Статус</h2>
          <DetailRow label="Текущий">
            <TicketStatusBadge isClosed={Boolean(ticket.is_closed)} />
          </DetailRow>
          <DetailRow label="Закрыто">{formatDateTime(ticket.closed_at)}</DetailRow>
          <div className="lk-admin-user-detail__access-actions">
            <button
              type="button"
              className={toggleClass}
              onClick={handleToggleClosed}
              disabled={togglingClosed}
            >
              {togglingClosed ? "Сохраняем…" : toggleLabel}
            </button>
          </div>
          {actionError ? (
            <p className="lk-admin-user-detail__access-error" role="alert">
              {actionError}
            </p>
          ) : null}
        </article>
      </div>
    </section>
  );
}
