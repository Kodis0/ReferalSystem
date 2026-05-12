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

export default function AdminIngestAuditDetailPage() {
  const { auditId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [audit, setAudit] = useState(null);
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
      const res = await adminFetch(API_ENDPOINTS.adminIngestAuditDetail(auditId), {
        credentials: "include",
        signal: controller.signal,
      });
      if (res.status === 404) {
        setNotFound(true);
        setAudit(null);
        return;
      }
      if (!res.ok) {
        setError(res.status === 403 ? "Недостаточно прав" : "Не удалось загрузить запись");
        setAudit(null);
        return;
      }
      const payload = await res.json().catch(() => null);
      setAudit(payload || null);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setError("Сетевая ошибка, попробуйте позже");
      setAudit(null);
    } finally {
      setLoading(false);
    }
  }, [auditId]);

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
    <Link to="/admin-console/ingest-audits" className="lk-admin-user-detail__back">
      <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>К списку ingest audits</span>
    </Link>
  );

  if (loading) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-ingest-audit-detail-title"
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
        aria-labelledby="lk-admin-ingest-audit-detail-title"
      >
        {backLink}
        <h1
          id="lk-admin-ingest-audit-detail-title"
          className="lk-admin-cabinet__title"
        >
          Запись не найдена
        </h1>
        <p className="lk-admin-users__muted">
          Audit с идентификатором {auditId} нет в системе.
        </p>
      </section>
    );
  }

  if (error || !audit) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-ingest-audit-detail-title"
      >
        {backLink}
        <div className="lk-admin-users__error" role="alert">
          {error || "Не удалось загрузить запись"}
        </div>
      </section>
    );
  }

  return (
    <section
      className="lk-admin-user-detail"
      aria-labelledby="lk-admin-ingest-audit-detail-title"
    >
      {backLink}
      <header className="lk-admin-user-detail__header">
        <h1
          id="lk-admin-ingest-audit-detail-title"
          className="lk-admin-cabinet__title"
        >
          #{audit.id}
        </h1>
      </header>

      <div className="lk-admin-user-detail__cards">
        <article className="lk-admin-user-detail__card" aria-label="Основное">
          <h2 className="lk-admin-user-detail__card-title">Основное</h2>
          <DetailRow label="ID">{audit.id}</DetailRow>
          <DetailRow label="Event name">{audit.event_name || "—"}</DetailRow>
          <DetailRow label="HTTP">{audit.http_status ?? "—"}</DetailRow>
          <DetailRow label="Throttle scope">
            {audit.throttle_scope || "—"}
          </DetailRow>
          <DetailRow label="Создан">{formatDateTime(audit.created_at)}</DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Сайт и связи">
          <h2 className="lk-admin-user-detail__card-title">Сайт и связи</h2>
          <DetailRow label="Site ID">{audit.site_id ?? "—"}</DetailRow>
          <DetailRow label="Site public_id">
            {audit.site_public_id || "—"}
          </DetailRow>
          <DetailRow label="Lead event">
            {audit.lead_event_id != null ? (
              <Link
                to={`/admin-console/lead-events/${audit.lead_event_id}`}
                className="lk-admin-users__email-link"
              >
                #{audit.lead_event_id}
              </Link>
            ) : (
              "—"
            )}
          </DetailRow>
          <DetailRow label="Form ID">{audit.form_id || "—"}</DetailRow>
          <DetailRow label="Page key">{audit.page_key || "—"}</DetailRow>
          <DetailRow label="Origin present">
            {audit.origin_present ? "да" : "нет"}
          </DetailRow>
          <DetailRow label="Origin prefix">
            {audit.origin_header_prefix || "—"}
          </DetailRow>
          <DetailRow label="Client IP">{audit.client_ip || "—"}</DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Ошибка">
          <h2 className="lk-admin-user-detail__card-title">Ошибка</h2>
          <DetailRow label="Public code">{audit.public_code || "—"}</DetailRow>
          <DetailRow label="Internal reason">
            {audit.internal_reason || "—"}
          </DetailRow>
          <DetailRow label="Submission stage snapshot">
            {audit.submission_stage_snapshot || "—"}
          </DetailRow>
          <DetailRow label="Client outcome snapshot">
            {audit.client_observed_outcome_snapshot || "—"}
          </DetailRow>
          <DetailRow label="Has email">
            {audit.has_email ? "да" : "нет"}
          </DetailRow>
          <DetailRow label="Has phone">
            {audit.has_phone ? "да" : "нет"}
          </DetailRow>
        </article>
      </div>
    </section>
  );
}
