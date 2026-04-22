import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./owner-programs.css";
import { formatDomainLine, formatSiteCardTitle, siteLifecycleLabelRu } from "./siteDisplay";

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function normalizeSitesFromIntegrationResponse(status, payload) {
  if (status === 409 && payload?.detail === "site_selection_required") {
    const sites = Array.isArray(payload.sites) ? payload.sites : [];
    return sites
      .filter((s) => s && isUuidString(s.public_id))
      .map((s) => ({
        public_id: s.public_id.trim(),
        status: s.status,
        widget_enabled: Boolean(s.widget_enabled),
        allowed_origins_count: typeof s.allowed_origins_count === "number" ? s.allowed_origins_count : 0,
        primary_origin: typeof s.primary_origin === "string" ? s.primary_origin : "",
        display_name: typeof s.display_name === "string" ? s.display_name.trim() : "",
      }));
  }
  if (status === 200 && payload?.public_id && isUuidString(payload.public_id)) {
    const origins = Array.isArray(payload.allowed_origins) ? payload.allowed_origins : [];
    const primary = typeof origins[0] === "string" ? origins[0] : "";
    const cfg = payload.config_json && typeof payload.config_json === "object" ? payload.config_json : {};
    const dn = typeof cfg.display_name === "string" ? cfg.display_name.trim() : "";
    return [
      {
        public_id: payload.public_id.trim(),
        status: payload.status,
        widget_enabled: Boolean(payload.widget_enabled),
        allowed_origins_count: origins.length,
        primary_origin: primary,
        display_name: dn,
      },
    ];
  }
  return [];
}

export default function OwnerSitesListPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [siteMissing, setSiteMissing] = useState(false);
  const [sites, setSites] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setSiteMissing(false);
    try {
      const res = await fetch(API_ENDPOINTS.siteIntegration, {
        method: "GET",
        headers: authHeaders(),
        credentials: "include",
      });
      const payload = await res.json().catch(() => ({}));
      if (res.status === 404 && payload.detail === "site_missing") {
        setSites([]);
        setSiteMissing(true);
        return;
      }
      if (!res.ok && !(res.status === 409 && payload.detail === "site_selection_required")) {
        const d = payload.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setSites([]);
        setError(detailMsg || `Ошибка загрузки (${res.status})`);
        return;
      }
      setSites(normalizeSitesFromIntegrationResponse(res.status, payload));
    } catch (e) {
      console.error(e);
      setSites([]);
      setError("Сетевая ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const goCreate = () => {
    navigate("/lk/partner/new");
  };

  return (
    <div className="lk-dashboard lk-partner">
      <h1 className="lk-dashboard__title">Проекты</h1>
      <p className="lk-dashboard__subtitle">
        Проекты вашего аккаунта (площадки с виджетом). Откройте карточку, чтобы перейти к обзору и
        установке виджета.
      </p>

      {loading && <p className="lk-partner__muted">Загрузка…</p>}
      {!loading && error && <div className="owner-programs__error">{error}</div>}

      {!loading && !error && siteMissing && (
        <>
          <p className="owner-programs__muted" style={{ maxWidth: 560 }}>
            У вас ещё нет ни одного проекта (сайта). Создайте первый — появятся ключи, сниппет виджета и
            диагностика.
          </p>
          <div className="owner-programs__actions">
            <button type="button" className="owner-programs__btn" onClick={goCreate}>
              Создать проект
            </button>
          </div>
        </>
      )}

      {!loading && !error && !siteMissing && sites.length === 0 && (
        <p className="owner-programs__muted">Не удалось разобрать список проектов. Обновите страницу.</p>
      )}

      {!loading && !error && !siteMissing && sites.length > 0 && (
        <>
          <div className="owner-programs__actions">
            <button type="button" className="owner-programs__btn" onClick={goCreate}>
              Создать проект
            </button>
          </div>
          <div className="owner-programs__grid">
            {sites.map((s) => {
              const domainLine = formatDomainLine(s.primary_origin, null);
              const title = formatSiteCardTitle(s.public_id, s.primary_origin, s.display_name);
              return (
                <Link key={s.public_id} to={`/lk/partner/${s.public_id}/overview`} className="owner-programs__card">
                  <h2 className="owner-programs__card-title">{title}</h2>
                  <p className="owner-programs__card-domain">{domainLine}</p>
                  <div className="owner-programs__card-meta">
                    <span className="owner-programs__pill">{siteLifecycleLabelRu(s.status)}</span>
                    <span className="lk-partner__muted">
                      Origins: <strong>{s.allowed_origins_count}</strong>
                      {s.widget_enabled ? "" : " · виджет выкл."}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
