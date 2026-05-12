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

function ArchivedBadge({ archivedAt }) {
  if (archivedAt) {
    return (
      <span className="lk-admin-users__badge lk-admin__badge--archived">Архив</span>
    );
  }
  return (
    <span className="lk-admin-users__badge lk-admin__badge--active">Активен</span>
  );
}

function renderAllowedOrigins(origins) {
  if (origins == null) return null;
  let pretty;
  try {
    pretty = JSON.stringify(origins, null, 2);
  } catch {
    pretty = String(origins);
  }
  return (
    <pre className="lk-admin-site-detail__origins" aria-label="allowed_origins">
      {pretty}
    </pre>
  );
}

export default function AdminSiteDetailPage() {
  const { siteId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [site, setSite] = useState(null);
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
      const res = await fetch(API_ENDPOINTS.adminSiteDetail(siteId), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        signal: controller.signal,
      });
      if (res.status === 404) {
        setNotFound(true);
        setSite(null);
        return;
      }
      if (!res.ok) {
        setError(res.status === 403 ? "Недостаточно прав" : "Не удалось загрузить сайт");
        setSite(null);
        return;
      }
      const payload = await res.json().catch(() => null);
      setSite(payload || null);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setError("Сетевая ошибка, попробуйте позже");
      setSite(null);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

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
    <Link to="/admin-console/sites" className="lk-admin-user-detail__back">
      <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>К списку сайтов</span>
    </Link>
  );

  if (loading) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-site-detail-title"
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
        aria-labelledby="lk-admin-site-detail-title"
      >
        {backLink}
        <h1
          id="lk-admin-site-detail-title"
          className="lk-admin-cabinet__title"
        >
          Сайт не найден
        </h1>
        <p className="lk-admin-users__muted">
          Сайта с идентификатором {siteId} нет в системе.
        </p>
      </section>
    );
  }

  if (error || !site) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-site-detail-title"
      >
        {backLink}
        <div className="lk-admin-users__error" role="alert">
          {error || "Не удалось загрузить сайт"}
        </div>
      </section>
    );
  }

  const heading = site.public_id || `#${site.id}`;

  return (
    <section
      className="lk-admin-user-detail"
      aria-labelledby="lk-admin-site-detail-title"
    >
      {backLink}
      <header className="lk-admin-user-detail__header">
        <h1
          id="lk-admin-site-detail-title"
          className="lk-admin-cabinet__title"
        >
          {heading}
        </h1>
      </header>

      <div className="lk-admin-user-detail__cards">
        <article className="lk-admin-user-detail__card" aria-label="Основное">
          <h2 className="lk-admin-user-detail__card-title">Основное</h2>
          <DetailRow label="ID">{site.id}</DetailRow>
          <DetailRow label="public_id">{site.public_id || "—"}</DetailRow>
          <DetailRow label="Статус">{site.status || "—"}</DetailRow>
          <DetailRow label="Платформа">{site.platform_preset || "—"}</DetailRow>
          <DetailRow label="Архив">
            <ArchivedBadge archivedAt={site.archived_at} />
          </DetailRow>
          <DetailRow label="archived_at">
            {formatDateTime(site.archived_at)}
          </DetailRow>
          <DetailRow label="Создан">{formatDateTime(site.created_at)}</DetailRow>
          <DetailRow label="Обновлён">{formatDateTime(site.updated_at)}</DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Владелец">
          <h2 className="lk-admin-user-detail__card-title">Владелец</h2>
          <DetailRow label="Email">{site.owner_email || "—"}</DetailRow>
          <DetailRow label="public_id">{site.owner_public_id || "—"}</DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Проект">
          <h2 className="lk-admin-user-detail__card-title">Проект</h2>
          <DetailRow label="ID">{site.project_id ?? "—"}</DetailRow>
          <DetailRow label="Название">{site.project_name || "—"}</DetailRow>
          <DetailRow label="public_id">
            {site.project_public_id || "—"}
          </DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Метрики">
          <h2 className="lk-admin-user-detail__card-title">Метрики</h2>
          <DetailRow label="Визитов">
            {Number(site.visits_count) || 0}
          </DetailRow>
          <DetailRow label="Лидов">
            {Number(site.leads_count) || 0}
          </DetailRow>
          <DetailRow label="Заказов">
            {Number(site.orders_count) || 0}
          </DetailRow>
          <DetailRow label="Комиссий">
            {Number(site.commissions_count) || 0}
          </DetailRow>
        </article>

        {site.allowed_origins !== undefined && (
          <article
            className="lk-admin-user-detail__card"
            aria-label="Конфигурация"
          >
            <h2 className="lk-admin-user-detail__card-title">Конфигурация</h2>
            <DetailRow label="allowed_origins">
              {renderAllowedOrigins(site.allowed_origins)}
            </DetailRow>
          </article>
        )}
      </div>
    </section>
  );
}
