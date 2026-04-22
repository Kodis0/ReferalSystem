import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
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

/** Warning codes from diagnostics API → Russian hints (keep in sync with widget-install). */
function warningDescription(code) {
  const map = {
    no_allowed_origins: "Не заданы разрешённые домены — браузер не сможет отправить события.",
    widget_disabled: "Виджет выключен.",
    publishable_key_missing: "Отсутствует ключ публикации.",
    observe_success_off: "Страница успеха может не отслеживаться (observe_success выключен в настройках).",
    report_observed_outcome_off: "Итог отправки формы может не попадать в систему (report_observed_outcome выключен).",
    no_leads_last_7_days: "За 7 дней нет сохранённых лидов — проверьте установку виджета и трафик.",
    high_not_observed_ratio_7d: "Много событий без итога — проверьте селекторы и страницу «спасибо».",
    no_outcome_reported_last_24h: "За сутки есть попытки отправки, но итог не зафиксирован.",
  };
  return map[code] || code;
}

function formatPartnerDomainLine(allowedOrigins) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    return "Домен пока не указан";
  }
  return formatDomainLine(null, allowedOrigins);
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
  const cfg = integration?.config_json && typeof integration.config_json === "object" ? integration.config_json : {};
  const projectTitle = formatSiteCardTitle(integration?.public_id, origins[0], cfg.display_name);
  const domainLine = formatPartnerDomainLine(origins);
  const w7 = diag?.windows?.["7d"];
  const lifecycleRu = siteLifecycleLabelRu(integration?.status);
  const connectionRu = diag?.integration_status ? integrationStatusLabel(diag.integration_status) : null;
  const attention =
    diag?.integration_status === "needs_attention" || diag?.integration_status === "incomplete";
  const warnings = Array.isArray(diag?.integration_warnings) ? diag.integration_warnings : [];
  const base = `/lk/partner/${sitePublicId}`;

  return (
    <div className="lk-dashboard lk-partner owner-programs__shell">
      {loading && <p className="lk-partner__muted">Загрузка…</p>}
      {!loading && error && <div className="owner-programs__error">{error}</div>}
      {!loading && !error && integration && (
        <>
          <header className="owner-programs__overview-head">
            <h2 className="owner-programs__overview-title">{projectTitle}</h2>
            <p className="owner-programs__overview-domain">
              <span className="owner-programs__overview-kicker">Сайт</span>
              {domainLine}
            </p>
            <div className="owner-programs__overview-pills" aria-label="Статусы">
              <span className="owner-programs__pill">{lifecycleRu}</span>
              {connectionRu ? <span className="owner-programs__pill">{connectionRu}</span> : null}
            </div>
            {attention ? (
              <p className="owner-programs__overview-hint">
                Рекомендуем открыть настройку виджета и при необходимости раздел «Техническая диагностика» ниже.
              </p>
            ) : null}
          </header>

          <div className="lk-partner__stats owner-programs__overview-stats">
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Участники</div>
              <div className="lk-partner__stat-value">{diag?.site_membership?.count ?? "—"}</div>
              <Link to={`${base}/members`} className="owner-programs__stat-cta">
                Участники и доступ
              </Link>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Лиды за 7 дней</div>
              <div className="lk-partner__stat-value">{w7?.submit_attempt_count ?? "—"}</div>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Платформа</div>
              <div className="lk-partner__stat-value">{integration.platform_preset || "—"}</div>
            </div>
          </div>

          {warnings.length > 0 ? (
            <details className="owner-programs__tech-details">
              <summary>Техническая диагностика</summary>
              <ul className="owner-programs__tech-details-list">
                {warnings.map((w) => (
                  <li key={w}>{warningDescription(w)}</li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="owner-programs__actions">
            <Link to={`${base}/widget`} className="owner-programs__btn" style={{ textDecoration: "none" }}>
              Настроить виджет
            </Link>
            <Link to={`${base}/widget`} className="owner-programs__btn_secondary" style={{ textDecoration: "none" }}>
              Проверить подключение
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
