import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
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

function formatJson(value) {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function targetLink(type, id) {
  const raw = id == null ? "" : String(id).trim();
  if (!raw) return null;
  const isInt = /^\d+$/.test(raw);
  if (type === "user" && isInt) return `/admin-console/users/${raw}`;
  if (type === "support_ticket") return `/admin-console/support/${raw}`;
  if (type === "partner_profile" && isInt) return `/admin-console/partners/${raw}`;
  return null;
}

export default function AdminActivityDetailPage() {
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
      const token =
        typeof window !== "undefined"
          ? window.localStorage.getItem("access_token")
          : null;
      const res = await fetch(API_ENDPOINTS.adminActionAuditDetail(auditId), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        signal: controller.signal,
      });
      if (res.status === 404) {
        setNotFound(true);
        setAudit(null);
        return;
      }
      if (!res.ok) {
        setError(
          res.status === 403 ? "Недостаточно прав" : "Не удалось загрузить запись",
        );
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
    <Link to="/admin-console/activity" className="lk-admin-user-detail__back">
      <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>К списку активности</span>
    </Link>
  );

  if (loading) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-activity-detail-title"
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
        aria-labelledby="lk-admin-activity-detail-title"
      >
        {backLink}
        <h1
          id="lk-admin-activity-detail-title"
          className="lk-admin-cabinet__title"
        >
          Запись не найдена
        </h1>
        <p className="lk-admin-users__muted">
          Записи журнала с идентификатором {auditId} нет в системе.
        </p>
      </section>
    );
  }

  if (error || !audit) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-activity-detail-title"
      >
        {backLink}
        <div className="lk-admin-users__error" role="alert">
          {error || "Не удалось загрузить запись"}
        </div>
      </section>
    );
  }

  const targetHref = targetLink(audit.target_type, audit.target_id);
  const metadataText = formatJson(audit.metadata);

  return (
    <section
      className="lk-admin-user-detail"
      aria-labelledby="lk-admin-activity-detail-title"
    >
      {backLink}
      <header className="lk-admin-user-detail__header">
        <h1
          id="lk-admin-activity-detail-title"
          className="lk-admin-cabinet__title"
        >
          {audit.action || "—"} #{audit.id}
        </h1>
      </header>

      <div className="lk-admin-user-detail__cards">
        <article className="lk-admin-user-detail__card" aria-label="Actor">
          <h2 className="lk-admin-user-detail__card-title">Actor</h2>
          <DetailRow label="Email">{audit.actor_email || "—"}</DetailRow>
          <DetailRow label="ID">
            {audit.actor_id != null ? audit.actor_id : "—"}
          </DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Action">
          <h2 className="lk-admin-user-detail__card-title">Action</h2>
          <DetailRow label="Action">{audit.action || "—"}</DetailRow>
          <DetailRow label="Когда">{formatDateTime(audit.created_at)}</DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Target">
          <h2 className="lk-admin-user-detail__card-title">Target</h2>
          <DetailRow label="Type">{audit.target_type || "—"}</DetailRow>
          <DetailRow label="ID">
            {targetHref ? (
              <Link
                to={targetHref}
                className="lk-admin-users__email-link"
              >
                {audit.target_id}
              </Link>
            ) : (
              audit.target_id || "—"
            )}
          </DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Request">
          <h2 className="lk-admin-user-detail__card-title">Request</h2>
          <DetailRow label="IP">{audit.ip_address || "—"}</DetailRow>
          <div className="lk-admin-support-detail__body-wrap">
            <span className="lk-admin-user-detail__row-label">User agent</span>
            <pre className="lk-admin__pre">{audit.user_agent || ""}</pre>
          </div>
        </article>

        <article
          className="lk-admin-user-detail__card"
          aria-label="Metadata"
          style={{ gridColumn: "1 / -1" }}
        >
          <h2 className="lk-admin-user-detail__card-title">Metadata</h2>
          <pre className="lk-admin__pre">{metadataText || "{}"}</pre>
        </article>
      </div>
    </section>
  );
}
