import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
import { adminFetch } from "../../../components/adminAuth";
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

function DetailRow({ label, children }) {
  return (
    <div className="lk-admin-user-detail__row">
      <span className="lk-admin-user-detail__row-label">{label}</span>
      <span className="lk-admin-user-detail__row-value">{children}</span>
    </div>
  );
}

function formatPayload(value) {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function AdminLeadEventDetailPage() {
  const { leadEventId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [event, setEvent] = useState(null);
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
      const res = await adminFetch(API_ENDPOINTS.adminLeadEventDetail(leadEventId), {
        credentials: "include",
        signal: controller.signal,
      });
      if (res.status === 404) {
        setNotFound(true);
        setEvent(null);
        return;
      }
      if (!res.ok) {
        setError(res.status === 403 ? "Недостаточно прав" : "Не удалось загрузить лид");
        setEvent(null);
        return;
      }
      const payload = await res.json().catch(() => null);
      setEvent(payload || null);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setError("Сетевая ошибка, попробуйте позже");
      setEvent(null);
    } finally {
      setLoading(false);
    }
  }, [leadEventId]);

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

  const backLink = (
    <Link to="/admin-console/lead-events" className="lk-admin-user-detail__back">
      <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>К списку лидов</span>
    </Link>
  );

  if (loading) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-lead-event-detail-title"
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
        aria-labelledby="lk-admin-lead-event-detail-title"
      >
        {backLink}
        <h1
          id="lk-admin-lead-event-detail-title"
          className="lk-admin-cabinet__title"
        >
          Лид не найден
        </h1>
        <p className="lk-admin-users__muted">
          Лида с идентификатором {leadEventId} нет в системе.
        </p>
      </section>
    );
  }

  if (error || !event) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-lead-event-detail-title"
      >
        {backLink}
        <div className="lk-admin-users__error" role="alert">
          {error || "Не удалось загрузить лид"}
        </div>
      </section>
    );
  }

  const payloadText = formatPayload(event.raw_payload);

  return (
    <section
      className="lk-admin-user-detail"
      aria-labelledby="lk-admin-lead-event-detail-title"
    >
      {backLink}
      <header className="lk-admin-user-detail__header">
        <h1
          id="lk-admin-lead-event-detail-title"
          className="lk-admin-cabinet__title"
        >
          #{event.id}
        </h1>
      </header>

      <div className="lk-admin-user-detail__cards">
        <article className="lk-admin-user-detail__card" aria-label="Основное">
          <h2 className="lk-admin-user-detail__card-title">Основное</h2>
          <DetailRow label="ID">{event.id}</DetailRow>
          <DetailRow label="Тип">{event.event_type || "—"}</DetailRow>
          <DetailRow label="Стадия">{event.submission_stage || "—"}</DetailRow>
          <DetailRow label="Client outcome">
            {event.client_observed_outcome || "—"}
          </DetailRow>
          <DetailRow label="Outcome source">
            {event.client_outcome_source || "—"}
          </DetailRow>
          <DetailRow label="Outcome reason">
            {event.client_outcome_reason || "—"}
          </DetailRow>
          <DetailRow label="Outcome observed at">
            {formatDateTime(event.client_outcome_observed_at)}
          </DetailRow>
          <DetailRow label="Создан">
            {formatDateTime(event.created_at)}
          </DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Сайт и партнёр">
          <h2 className="lk-admin-user-detail__card-title">Сайт и партнёр</h2>
          <DetailRow label="Site ID">{event.site_id ?? "—"}</DetailRow>
          <DetailRow label="Site public_id">{event.site_public_id || "—"}</DetailRow>
          <DetailRow label="Partner ID">{event.partner_id ?? "—"}</DetailRow>
          <DetailRow label="Ref code">{event.ref_code || "—"}</DetailRow>
          <DetailRow label="Form ID">{event.form_id || "—"}</DetailRow>
          <DetailRow label="Page key">{event.page_key || "—"}</DetailRow>
          <DetailRow label="Page URL">{event.page_url || "—"}</DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Клиент">
          <h2 className="lk-admin-user-detail__card-title">Клиент</h2>
          <DetailRow label="Email">{event.customer_email || "—"}</DetailRow>
          <DetailRow label="Телефон">{event.customer_phone || "—"}</DetailRow>
          <DetailRow label="Имя">{event.customer_name || "—"}</DetailRow>
          <DetailRow label="Normalized email">
            {event.normalized_email || "—"}
          </DetailRow>
          <DetailRow label="Normalized phone">
            {event.normalized_phone || "—"}
          </DetailRow>
          <DetailRow label="Сумма">
            {event.amount != null
              ? `${event.amount} ${event.currency || ""}`.trim()
              : "—"}
          </DetailRow>
          <DetailRow label="Продукт">{event.product_name || "—"}</DetailRow>
          <DetailRow label="IP">{event.ip_address || "—"}</DetailRow>
        </article>

        {payloadText ? (
          <article
            className="lk-admin-user-detail__card"
            aria-label="Payload"
            style={{ gridColumn: "1 / -1" }}
          >
            <h2 className="lk-admin-user-detail__card-title">Payload</h2>
            <pre className="lk-admin__pre">{payloadText}</pre>
          </article>
        ) : null}
      </div>
    </section>
  );
}
