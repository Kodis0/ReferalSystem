import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./owner-programs.css";
import { formatDomainLine, siteLifecycleLabelRu } from "./siteDisplay";

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function withSelectedSite(url, sitePublicId) {
  if (!sitePublicId) return url;
  const u = new URL(url, window.location.origin);
  u.searchParams.set("site_public_id", sitePublicId);
  return u.toString();
}

/** Human-readable integration_status (aligned with widget-install). */
function integrationStatusLabel(status) {
  const map = {
    healthy: "В норме",
    needs_attention: "Нужна проверка",
    disabled: "Виджет выключен",
    incomplete: "Настройка не завершена",
  };
  return map[status] || status || "—";
}

export default function ProjectOverviewPage() {
  const { sitePublicId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [integration, setIntegration] = useState(null);
  const [diag, setDiag] = useState(null);

  const load = useCallback(async () => {
    if (!sitePublicId) return;
    setLoading(true);
    setError("");
    try {
      const resInt = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, sitePublicId), {
        method: "GET",
        headers: authHeaders(),
        credentials: "include",
      });
      const intPayload = await resInt.json().catch(() => ({}));
      if (!resInt.ok) {
        const d = intPayload.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setIntegration(null);
        setDiag(null);
        setError(detailMsg || `Ошибка (${resInt.status})`);
        return;
      }
      setIntegration(intPayload);
      const resDiag = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegrationDiagnostics, sitePublicId), {
        method: "GET",
        headers: authHeaders(),
        credentials: "include",
      });
      if (resDiag.ok) {
        setDiag(await resDiag.json().catch(() => null));
      } else {
        setDiag(null);
      }
    } catch (e) {
      console.error(e);
      setIntegration(null);
      setDiag(null);
      setError("Сетевая ошибка");
    } finally {
      setLoading(false);
    }
  }, [sitePublicId]);

  useEffect(() => {
    load();
  }, [load]);

  const origins = Array.isArray(integration?.allowed_origins) ? integration.allowed_origins : [];
  const domainLine = formatDomainLine(null, origins);
  const w7 = diag?.windows?.["7d"];

  return (
    <div className="lk-dashboard lk-partner owner-programs__shell">
      <h2 className="lk-partner__section-title">Обзор</h2>
      {loading && <p className="lk-partner__muted">Загрузка…</p>}
      {!loading && error && <div className="owner-programs__error">{error}</div>}
      {!loading && !error && integration && (
        <>
          <p className="owner-programs__muted" style={{ maxWidth: 640 }}>
            <strong>Домен / origin:</strong> {domainLine}
          </p>
          <p className="owner-programs__muted" style={{ marginTop: 8 }}>
            <strong>Lifecycle:</strong> {siteLifecycleLabelRu(integration.status)}
            {diag?.integration_status ? (
              <>
                {" "}
                · <strong>Интеграция:</strong> {integrationStatusLabel(diag.integration_status)}
              </>
            ) : null}
          </p>
          {diag?.integration_warnings?.length ? (
            <ul className="lk-widget-install__warn-list" style={{ marginTop: 12 }}>
              {diag.integration_warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div className="lk-partner__stats" style={{ marginTop: 20 }}>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Участники (CTA)</div>
              <div className="lk-partner__stat-value">{diag?.site_membership?.count ?? "—"}</div>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Лиды, 7 дн.</div>
              <div className="lk-partner__stat-value">{w7?.submit_attempt_count ?? "—"}</div>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Платформа</div>
              <div className="lk-partner__stat-value">{integration.platform_preset || "—"}</div>
            </div>
          </div>
          <div className="owner-programs__actions">
            <Link to={`/lk/partner/${sitePublicId}/widget`} className="owner-programs__btn" style={{ textDecoration: "none" }}>
              К виджету и установке
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
