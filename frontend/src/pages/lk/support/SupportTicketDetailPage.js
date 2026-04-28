import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchSupportTicketById, patchSupportTicket } from "./supportTicketsApi";
import "./support.css";

function formatDetailDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });
}

function BackChevron() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M9.5 3.5L5 8l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function SupportTicketDetailPage() {
  const { ticketId } = useParams();
  const id = String(ticketId || "").trim();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const onCloseTicket = useCallback(async () => {
    if (!id || !ticket) return;
    setActionError("");
    setActionBusy(true);
    try {
      const res = await patchSupportTicket(id, { is_closed: true });
      if (!res.ok) {
        const d = res.ticket && typeof res.ticket.detail === "string" ? res.ticket.detail : "";
        setActionError(d || "Не удалось закрыть обращение.");
        return;
      }
      setTicket(res.ticket);
    } finally {
      setActionBusy(false);
    }
  }, [id, ticket]);

  const onReopenTicket = useCallback(async () => {
    if (!id) return;
    setActionError("");
    setActionBusy(true);
    try {
      const res = await patchSupportTicket(id, { is_closed: false });
      if (!res.ok) {
        const d = res.ticket && typeof res.ticket.detail === "string" ? res.ticket.detail : "";
        setActionError(d || "Не удалось открыть обращение.");
        return;
      }
      setTicket(res.ticket);
    } finally {
      setActionBusy(false);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) {
        setError("Обращение не найдено.");
        return;
      }
      setError("");
      setTicket(null);
      const res = await fetchSupportTicketById(id);
      if (cancelled) return;
      if (!res.ok) {
        if (res.status === 404) {
          setError("Обращение не найдено.");
        } else {
          setError("Не удалось загрузить обращение.");
        }
        return;
      }
      setTicket(res.ticket);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="lk-support-ticket-view" id="lk-support-ticket-view">
      <div className="lk-support-ticket__return">
        <Link className="tw-link link_primary link_s" to="/lk/support">
          <BackChevron />
          <span className="lk-support-ticket__return-label">К списку</span>
        </Link>
      </div>

      {error ? (
        <p className="lk-support-ticket-view__error" role="alert">
          {error}
        </p>
      ) : null}

      {!error && !ticket ? (
        <p className="lk-support-ticket-view__loading" aria-live="polite">
          Загрузка…
        </p>
      ) : null}

      {ticket ? (
        <div className="lk-support-ticket-view__card">
          <div className="lk-support-ticket-view__head">
            <h1 className="lk-support-ticket-view__h1">Обращение в поддержку</h1>
            <p className="lk-support-ticket-view__meta">
              <span>{ticket.type_title}</span>
              {ticket.target_label ? (
                <>
                  {" · "}
                  <span>{ticket.target_label}</span>
                </>
              ) : null}
            </p>
            <p className="lk-support-ticket-view__date">{formatDetailDate(ticket.created_at)}</p>
          </div>
          <div className="lk-support-ticket-view__body-wrap">
            <pre className="lk-support-ticket-view__body">{ticket.body}</pre>
          </div>
          {ticket.attachment_names ? (
            <p className="lk-support-ticket-view__attach">
              Вложения (имена файлов): {ticket.attachment_names}
            </p>
          ) : null}

          {ticket.is_closed === true ? (
            <p className="lk-support-ticket-view__closed-badge">Закрыто</p>
          ) : null}

          {actionError ? (
            <p className="lk-support-ticket-view__action-error" role="alert">
              {actionError}
            </p>
          ) : null}

          {ticket.is_closed !== true ? (
            <button
              type="button"
              className="lk-support-ticket-view__close-btn"
              onClick={onCloseTicket}
              disabled={actionBusy}
            >
              {actionBusy ? "Сохранение…" : "Закрыть обращение"}
            </button>
          ) : (
            <button type="button" className="lk-support-ticket-view__reopen-btn" onClick={onReopenTicket} disabled={actionBusy}>
              {actionBusy ? "Сохранение…" : "Открыть снова"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
