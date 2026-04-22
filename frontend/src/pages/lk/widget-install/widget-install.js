import { useCallback, useEffect, useState } from "react";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./widget-install.css";

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function prettyJson(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

/** Human-readable integration_status for owner UI */
function integrationStatusLabel(status) {
  const map = {
    healthy: "В норме",
    needs_attention: "Нужна проверка",
    disabled: "Виджет выключен",
    incomplete: "Настройка не завершена",
  };
  return map[status] || status || "—";
}

/** Warning codes from API → short Russian hints */
function warningDescription(code) {
  const map = {
    no_allowed_origins: "Не заданы allowed_origins — браузер не сможет отправить события.",
    widget_disabled: "Виджет выключен (widget_enabled).",
    publishable_key_missing: "Отсутствует publishable_key.",
    observe_success_off: "В config_json выключен observe_success — страница успеха может не отслеживаться.",
    report_observed_outcome_off: "В config_json выключен report_observed_outcome — итог отправки может не попадать в систему.",
    no_leads_last_7_days: "За 7 дней нет ни одного сохранённого события лида (проверьте установку и трафик).",
    high_not_observed_ratio_7d: "Много событий с not_observed — проверьте селекторы / страницу «спасибо» (Tilda).",
    no_outcome_reported_last_24h: "За сутки есть попытки отправки, но клиент не сообщил итог (outcome пустой).",
  };
  return map[code] || code;
}

function lifecycleLabel(status) {
  const map = {
    draft: "Черновик",
    verified: "Проверен",
    active: "Активен",
  };
  return map[status] || status || "—";
}

function readSelectedSiteFromUrl() {
  try {
    return new URL(window.location.href).searchParams.get("site_public_id") || "";
  } catch {
    return "";
  }
}

function withSelectedSite(url, sitePublicId) {
  if (!sitePublicId) return url;
  const u = new URL(url, window.location.origin);
  u.searchParams.set("site_public_id", sitePublicId);
  return u.toString();
}

function syncSelectedSiteInUrl(sitePublicId) {
  try {
    const u = new URL(window.location.href);
    if (sitePublicId) {
      u.searchParams.set("site_public_id", sitePublicId);
    } else {
      u.searchParams.delete("site_public_id");
    }
    window.history.replaceState({}, "", u.toString());
  } catch {}
}

/**
 * @param {{ routeSitePublicId?: string }} [props]
 * When set (UUID), loads integration for that Site — used from `/lk/partner/:sitePublicId/widget`.
 */
function WidgetInstallScreen({ routeSitePublicId: routeSitePublicIdProp = "" } = {}) {
  const routeSitePublicIdRaw = (routeSitePublicIdProp || "").trim();
  const routeSitePublicId = isUuidString(routeSitePublicIdRaw) ? routeSitePublicIdRaw : "";
  const inProjectShell = Boolean(routeSitePublicId);
  const shellTitle = inProjectShell ? "Виджет" : "Виджет на сайт";
  const shellSubtitle = inProjectShell
    ? "Код установки, ключи и диагностика подключения"
    : "Код установки и параметры интеграции";

  const [loading, setLoading] = useState(true);
  const [siteMissing, setSiteMissing] = useState(false);
  const [siteSelectionRequired, setSiteSelectionRequired] = useState(false);
  const [siteOptions, setSiteOptions] = useState([]);
  const [selectedSitePublicId, setSelectedSitePublicId] = useState(() => readSelectedSiteFromUrl());
  const [createSiteLoading, setCreateSiteLoading] = useState(false);
  const [createSiteError, setCreateSiteError] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [activateLoading, setActivateLoading] = useState(false);
  const [error, setError] = useState("");
  const [saveHint, setSaveHint] = useState("");
  const [copyHint, setCopyHint] = useState("");
  const [data, setData] = useState(null);
  const [diag, setDiag] = useState(null);
  const [diagError, setDiagError] = useState("");
  const [allowedText, setAllowedText] = useState("[]");
  const [configText, setConfigText] = useState("{}");
  const [platformPreset, setPlatformPreset] = useState("tilda");
  const [widgetEnabled, setWidgetEnabled] = useState(true);

  const load = useCallback(async (sitePublicIdOverride) => {
    const effectiveSitePublicId =
      sitePublicIdOverride ?? (routeSitePublicId || selectedSitePublicId);
    setLoading(true);
    setSiteMissing(false);
    setSiteSelectionRequired(false);
    setCreateSiteError("");
    setError("");
    setSaveHint("");
    setCopyHint("");
    setDiagError("");
    try {
      const resInt = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, effectiveSitePublicId), {
        method: "GET",
        headers: authHeaders(),
        credentials: "include",
      });
      const intPayload = await resInt.json().catch(() => ({}));
      if (resInt.status === 404 && intPayload.detail === "site_missing") {
        setData(null);
        setDiag(null);
        setSiteOptions([]);
        setSiteMissing(true);
        return;
      }
      if (resInt.status === 409 && intPayload.detail === "site_selection_required") {
        setData(null);
        setDiag(null);
        setSiteOptions(Array.isArray(intPayload.sites) ? intPayload.sites : []);
        setSiteSelectionRequired(true);
        return;
      }
      if (!resInt.ok) {
        setData(null);
        setDiag(null);
        const d = intPayload.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setError(detailMsg || `Ошибка загрузки (${resInt.status})`);
        return;
      }
      setData(intPayload);
      setAllowedText(prettyJson(intPayload.allowed_origins));
      setConfigText(prettyJson(intPayload.config_json));
      setPlatformPreset(intPayload.platform_preset || "tilda");
      setWidgetEnabled(Boolean(intPayload.widget_enabled));
      if (intPayload.public_id) {
        setSelectedSitePublicId(intPayload.public_id);
        syncSelectedSiteInUrl(intPayload.public_id);
      }
      const resDiag = await fetch(
        withSelectedSite(API_ENDPOINTS.siteIntegrationDiagnostics, intPayload.public_id || effectiveSitePublicId),
        {
          method: "GET",
          headers: authHeaders(),
          credentials: "include",
        }
      );
      if (resDiag.ok) {
        const d = await resDiag.json().catch(() => null);
        setDiag(d);
      } else {
        setDiag(null);
        setDiagError("Не удалось загрузить диагностику. Обновите позже.");
      }
    } catch (e) {
      console.error(e);
      setData(null);
      setDiag(null);
      setError("network");
    } finally {
      setLoading(false);
    }
  }, [selectedSitePublicId, routeSitePublicId]);

  useEffect(() => {
    if (routeSitePublicId) {
      setSelectedSitePublicId(routeSitePublicId);
    }
  }, [routeSitePublicId]);

  useEffect(() => {
    load();
  }, [load]);

  const onCreateSite = async () => {
    setCreateSiteLoading(true);
    setCreateSiteError("");
    try {
      const res = await fetch(API_ENDPOINTS.siteBootstrap, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: "{}",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = payload.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setCreateSiteError(detailMsg || `Не удалось создать сайт (${res.status})`);
        return;
      }
      if (payload.public_id) {
        setSelectedSitePublicId(payload.public_id);
        syncSelectedSiteInUrl(payload.public_id);
      }
      await load(payload.public_id || "");
    } catch (e) {
      console.error(e);
      setCreateSiteError("Сетевая ошибка, попробуйте позже");
    } finally {
      setCreateSiteLoading(false);
    }
  };

  const onCopySnippet = async () => {
    const text = data?.widget_embed_snippet;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyHint("Скопировано");
      setTimeout(() => setCopyHint(""), 2000);
    } catch {
      setCopyHint("Не удалось скопировать");
    }
  };

  const onSave = async () => {
    setSaving(true);
    setSaveHint("");
    setError("");
    let allowed_origins;
    let config_json;
    try {
      allowed_origins = JSON.parse(allowedText);
      if (!Array.isArray(allowed_origins)) {
        throw new Error("allowed_not_array");
      }
      if (!allowed_origins.every((x) => typeof x === "string")) {
        throw new Error("allowed_not_strings");
      }
    } catch {
      setSaving(false);
      setSaveHint("allowed_origins: нужен JSON-массив строк, например [\"https://mysite.com\"]");
      return;
    }
    try {
      config_json = JSON.parse(configText || "{}");
    } catch {
      setSaving(false);
      setSaveHint("config_json: невалидный JSON");
      return;
    }
    try {
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, selectedSitePublicId), {
        method: "PATCH",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({
          site_public_id: selectedSitePublicId || undefined,
          allowed_origins,
          config_json,
          platform_preset: platformPreset,
          widget_enabled: widgetEnabled,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveHint(payload.detail ? String(payload.detail) : `Сохранение: ${res.status}`);
        return;
      }
      setData(payload);
      setSaveHint("Сохранено");
      setTimeout(() => setSaveHint(""), 2500);
      const resDiag = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegrationDiagnostics, selectedSitePublicId), {
        method: "GET",
        headers: authHeaders(),
        credentials: "include",
      });
      if (resDiag.ok) {
        setDiag(await resDiag.json().catch(() => null));
        setDiagError("");
      }
    } catch (e) {
      console.error(e);
      setSaveHint("Сетевая ошибка при сохранении");
    } finally {
      setSaving(false);
    }
  };

  const onPickSite = async (sitePublicId) => {
    setSelectedSitePublicId(sitePublicId);
    syncSelectedSiteInUrl(sitePublicId);
    await load(sitePublicId);
  };

  const onVerify = async () => {
    setVerifyLoading(true);
    setSaveHint("");
    try {
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegrationVerify, selectedSitePublicId), {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ site_public_id: selectedSitePublicId || undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveHint(payload.detail ? String(payload.detail) : `Проверка: ${res.status}`);
        return;
      }
      setData(payload);
      await load();
    } catch (e) {
      console.error(e);
      setSaveHint("Сетевая ошибка при проверке");
    } finally {
      setVerifyLoading(false);
    }
  };

  const onActivate = async () => {
    setActivateLoading(true);
    setSaveHint("");
    try {
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegrationActivate, selectedSitePublicId), {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ site_public_id: selectedSitePublicId || undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveHint(payload.detail ? String(payload.detail) : `Активация: ${res.status}`);
        return;
      }
      setData(payload);
      await load();
    } catch (e) {
      console.error(e);
      setSaveHint("Сетевая ошибка при активации");
    } finally {
      setActivateLoading(false);
    }
  };

  const statusClass =
    diag?.integration_status === "healthy"
      ? "lk-widget-install__status_ok"
      : diag?.integration_status === "needs_attention"
        ? "lk-widget-install__status_warn"
        : diag?.integration_status === "disabled" || diag?.integration_status === "incomplete"
          ? "lk-widget-install__status_bad"
          : "";

  if (loading) {
    return (
      <div className="lk-dashboard lk-partner">
        <h1 className="lk-dashboard__title">{shellTitle}</h1>
        <p className="lk-dashboard__subtitle">{shellSubtitle}</p>
        <p className="lk-partner__muted">Загрузка…</p>
      </div>
    );
  }

  if (siteMissing) {
    if (routeSitePublicId) {
      return (
        <div className="lk-dashboard lk-partner">
          <h1 className="lk-dashboard__title">{shellTitle}</h1>
          <p className="lk-dashboard__subtitle">{shellSubtitle}</p>
          <p className="lk-partner__muted" style={{ maxWidth: 560 }}>
            Проект не найден или недоступен для этого аккаунта. Вернитесь к списку проектов и откройте нужный.
          </p>
          <div className="lk-partner__link-row" style={{ marginTop: 16 }}>
            <a className="lk-widget-install__btn" href="/lk/partner">
              К проектам
            </a>
          </div>
        </div>
      );
    }
    return (
      <div className="lk-dashboard lk-partner">
        <h1 className="lk-dashboard__title">{shellTitle}</h1>
        <p className="lk-dashboard__subtitle">{shellSubtitle}</p>
        <p className="lk-partner__muted" style={{ maxWidth: 560 }}>
          Для вашего аккаунта ещё не подключён сайт для виджета. Создайте его здесь — после этого
          появятся ключи, сниппет и диагностика.
        </p>
        <div className="lk-partner__link-row" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="lk-widget-install__btn"
            disabled={createSiteLoading}
            onClick={onCreateSite}
          >
            {createSiteLoading ? "Создание…" : "Подключить сайт"}
          </button>
        </div>
        {createSiteError ? (
          <div className="lk-partner__error" style={{ marginTop: 12 }}>
            {createSiteError}
          </div>
        ) : null}
      </div>
    );
  }

  if (siteSelectionRequired && routeSitePublicId) {
    return (
      <div className="lk-dashboard lk-partner">
        <h1 className="lk-dashboard__title">{shellTitle}</h1>
        <p className="lk-dashboard__subtitle">{shellSubtitle}</p>
        <div className="lk-partner__error" style={{ maxWidth: 640 }}>
          Не удалось открыть настройки виджета для этого проекта. Вернитесь к списку проектов и выберите проект снова.
        </div>
        <div className="lk-partner__link-row" style={{ marginTop: 16 }}>
          <a className="lk-widget-install__btn" href="/lk/partner">
            К проектам
          </a>
        </div>
      </div>
    );
  }

  if (siteSelectionRequired) {
    return (
      <div className="lk-dashboard lk-partner">
        <h1 className="lk-dashboard__title">{shellTitle}</h1>
        <p className="lk-dashboard__subtitle">{shellSubtitle}</p>
        <p className="lk-partner__muted" style={{ maxWidth: 640 }}>
          Для этого аккаунта несколько проектов. Выберите нужный, чтобы открыть настройки и статус публикации.
        </p>
        <div className="lk-widget-install__card" style={{ marginTop: 16 }}>
          <h2 className="lk-partner__section-title">Выберите проект</h2>
          <div className="lk-widget-install__warn-list">
            {siteOptions.map((site) => (
              <button
                key={site.public_id}
                type="button"
                className="lk-widget-install__btn lk-widget-install__btn_secondary"
                style={{ marginRight: 8, marginBottom: 8 }}
                onClick={() => onPickSite(site.public_id)}
              >
                {site.public_id} · {lifecycleLabel(site.status)}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="lk-dashboard lk-partner">
        <h1 className="lk-dashboard__title">{shellTitle}</h1>
        <p className="lk-dashboard__subtitle">{shellSubtitle}</p>
        <div className="lk-partner__error">
          {error === "network" ? "Сетевая ошибка, попробуйте позже" : error}
        </div>
      </div>
    );
  }

  const w24 = diag?.windows?.["24h"];
  const w7 = diag?.windows?.["7d"];
  const wr = diag?.widget_runtime;
  const iq = diag?.ingest_quality;
  const iq24 = iq?.["24h"];
  const iq7 = iq?.["7d"];

  return (
    <div className="lk-dashboard lk-partner lk-widget-install">
      <h1 className="lk-dashboard__title">{shellTitle}</h1>
      <p className="lk-dashboard__subtitle">
        {inProjectShell ? (
          <>
            Ключ публикации, разрешённые домены, фрагмент <code className="lk-partner__muted">&lt;script&gt;</code> и
            диагностика подключения.
          </>
        ) : (
          <>
            Публичные идентификаторы, allowlist origin для браузера и готовый фрагмент{" "}
            <code className="lk-partner__muted">&lt;script&gt;</code>. Ниже — диагностика интеграции и
            последние лиды (операционный обзор).
          </>
        )}
      </p>

      {diagError ? <div className="lk-widget-install__diag-soft">{diagError}</div> : null}

      {diag ? (
        <div className="lk-widget-install__diag-grid" style={{ marginTop: 16 }}>
          <section className="lk-widget-install__card">
            <h2 className="lk-partner__section-title">Состояние интеграции</h2>
            <p className="lk-widget-install__status-line">
              <span className={`lk-widget-install__status-pill ${statusClass}`}>
                {integrationStatusLabel(diag.integration_status)}
              </span>
              <span className="lk-partner__muted" style={{ marginLeft: 10 }}>
                {diag.site_public_id}
              </span>
            </p>
            <p className="lk-partner__muted" style={{ marginTop: 8 }}>
              {inProjectShell ? "Статус публикации" : "Lifecycle"}:{" "}
              <strong>{lifecycleLabel(diag.site_status || data?.status)}</strong>
            </p>
            <div className="lk-partner__link-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="lk-widget-install__btn"
                disabled={verifyLoading}
                onClick={onVerify}
              >
                {verifyLoading ? "Проверка…" : "Подтвердить проверку"}
              </button>
              <button
                type="button"
                className="lk-widget-install__btn lk-widget-install__btn_secondary"
                disabled={activateLoading}
                onClick={onActivate}
              >
                {activateLoading ? "Активация…" : inProjectShell ? "Активировать проект" : "Активировать сайт"}
              </button>
            </div>
            <ul className="lk-widget-install__warn-list">
              {(diag.integration_warnings || []).map((w) => (
                <li key={w}>{warningDescription(w)}</li>
              ))}
              {(diag.integration_warnings || []).length === 0 ? (
                <li className="lk-partner__muted">Нет предупреждений по правилам диагностики.</li>
              ) : null}
            </ul>
            <div className="lk-widget-install__readiness">
              <div>
                <span className="lk-widget-install__readiness-k">Готово к embed</span>
                <span className="lk-widget-install__readiness-v">
                  {diag.embed_readiness?.origins_configured &&
                  diag.embed_readiness?.publishable_key_present &&
                  diag.embed_readiness?.public_id_present
                    ? "да"
                    : "нет"}
                </span>
              </div>
              <div>
                <span className="lk-widget-install__readiness-k">origins</span>
                <span className="lk-widget-install__readiness-v">
                  {diag.embed_readiness?.origins_configured ? "заданы" : "не заданы"}
                </span>
              </div>
              <div>
                <span className="lk-widget-install__readiness-k">виджет</span>
                <span className="lk-widget-install__readiness-v">
                  {diag.widget_enabled ? "включён" : "выключен"}
                </span>
              </div>
            </div>
          </section>

          <section className="lk-widget-install__card">
            <h2 className="lk-partner__section-title">Участники по CTA</h2>
            <p className="lk-partner__muted" style={{ marginBottom: 8 }}>
              {inProjectShell
                ? "Аккаунты, присоединившиеся к проекту через виджет (регистрация или вход)."
                : "Аккаунты, присоединившиеся к этому сайту через виджет (регистрация или вход)."}
            </p>
            <p className="lk-widget-install__status-line" style={{ marginTop: 0 }}>
              <span className="lk-widget-install__readiness-k">Всего</span>{" "}
              <strong>{diag.site_membership?.count ?? "—"}</strong>
            </p>
            {(diag.site_membership?.recent_joins || []).length ? (
              <ul className="lk-widget-install__kv" style={{ marginTop: 8 }}>
                {diag.site_membership.recent_joins.map((row, i) => (
                  <li key={`${row.joined_at ?? ""}-${i}`}>
                    {(row.joined_at || "").replace("T", " ").slice(0, 19) || "—"} ·{" "}
                    {row.identity_masked || "—"}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lk-partner__muted" style={{ marginTop: 8 }}>
                {inProjectShell
                  ? "Пока нет присоединений через CTA для этого проекта."
                  : "Пока нет присоединений через CTA для выбранного сайта."}
              </p>
            )}
          </section>

          <section className="lk-widget-install__card">
            <h2 className="lk-partner__section-title">Настройки виджета (runtime)</h2>
            <p className="lk-partner__muted" style={{ marginBottom: 8 }}>
              platform_preset: <strong>{diag.platform_preset}</strong>
            </p>
            {wr ? (
              <ul className="lk-widget-install__kv">
                <li>
                  observe_success:{" "}
                  <span className={wr.observe_success ? "lk-widget-install__on" : "lk-widget-install__off"}>
                    {wr.observe_success ? "вкл" : "выкл"}
                  </span>
                </li>
                <li>
                  report_observed_outcome:{" "}
                  <span
                    className={
                      wr.report_observed_outcome ? "lk-widget-install__on" : "lk-widget-install__off"
                    }
                  >
                    {wr.report_observed_outcome ? "вкл" : "выкл"}
                  </span>
                </li>
                <li>amount_selector: {wr.amount_selector || "—"}</li>
                <li>product_name_selector: {wr.product_name_selector || "—"}</li>
                <li>currency: {wr.currency || "—"}</li>
              </ul>
            ) : null}
            <p className="lk-partner__muted" style={{ marginTop: 8, fontSize: 12 }}>
              Флаги читаются из <code>config_json</code> (как и публичный widget-config).
            </p>
          </section>

          <section className="lk-widget-install__card lk-widget-install__card_wide">
            <h2 className="lk-partner__section-title">Наблюдаемые итоги (агрегаты)</h2>
            <p className="lk-partner__muted" style={{ marginBottom: 10 }}>
              Счётчики по каноническим строкам лида в БД. Дублирующие submit (duplicate_suppressed)
              смотрите в блоке «Качество публичного ingest» ниже.
            </p>
            <div className="lk-widget-install__windows">
              <div>
                <div className="lk-widget-install__windows-title">24 часа</div>
                <table className="lk-widget-install__mini-table">
                  <tbody>
                    <tr>
                      <td>submit (строки)</td>
                      <td>{w24?.submit_attempt_count ?? "—"}</td>
                    </tr>
                    <tr>
                      <td>success_observed</td>
                      <td>{w24?.success_observed_count ?? "—"}</td>
                    </tr>
                    <tr>
                      <td>failure_observed</td>
                      <td>{w24?.failure_observed_count ?? "—"}</td>
                    </tr>
                    <tr>
                      <td>not_observed</td>
                      <td>{w24?.not_observed_count ?? "—"}</td>
                    </tr>
                    <tr>
                      <td>итог не сообщён</td>
                      <td>{w24?.outcome_unset_count ?? "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div>
                <div className="lk-widget-install__windows-title">7 дней</div>
                <table className="lk-widget-install__mini-table">
                  <tbody>
                    <tr>
                      <td>submit (строки)</td>
                      <td>{w7?.submit_attempt_count ?? "—"}</td>
                    </tr>
                    <tr>
                      <td>success_observed</td>
                      <td>{w7?.success_observed_count ?? "—"}</td>
                    </tr>
                    <tr>
                      <td>failure_observed</td>
                      <td>{w7?.failure_observed_count ?? "—"}</td>
                    </tr>
                    <tr>
                      <td>not_observed</td>
                      <td>{w7?.not_observed_count ?? "—"}</td>
                    </tr>
                    <tr>
                      <td>итог не сообщён</td>
                      <td>{w7?.outcome_unset_count ?? "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {iq ? (
            <section className="lk-widget-install__card lk-widget-install__card_wide">
              <h2 className="lk-partner__section-title">Качество публичного ingest</h2>
              <p className="lk-partner__muted" style={{ marginBottom: 10 }}>
                Технический учёт POST <code>/public/v1/events/leads</code> (источник:{" "}
                <code>{iq.source}</code>): создано, дубли, отказы, троттлинг, обновления outcome.
              </p>
              <div className="lk-widget-install__windows">
                <div>
                  <div className="lk-widget-install__windows-title">24 часа</div>
                  <table className="lk-widget-install__mini-table">
                    <tbody>
                      <tr>
                        <td>Всего запросов</td>
                        <td>{iq24?.total_requests ?? 0}</td>
                      </tr>
                      <tr>
                        <td>created</td>
                        <td>{iq24?.created_count ?? 0}</td>
                      </tr>
                      <tr>
                        <td>duplicate_suppressed</td>
                        <td>{iq24?.duplicate_suppressed_count ?? 0}</td>
                      </tr>
                      <tr>
                        <td>outcome_updated</td>
                        <td>{iq24?.outcome_updated_count ?? 0}</td>
                      </tr>
                      <tr>
                        <td>outcome_unchanged</td>
                        <td>{iq24?.outcome_unchanged_count ?? 0}</td>
                      </tr>
                      <tr>
                        <td>rate_limited</td>
                        <td>{iq24?.rate_limited_count ?? 0}</td>
                      </tr>
                      <tr>
                        <td>rejected (прочие ошибки)</td>
                        <td>{iq24?.rejected_count ?? 0}</td>
                      </tr>
                      <tr>
                        <td>доля дублей (к created+dup)</td>
                        <td>
                          {iq24?.duplicate_ratio_lead_submitted != null
                            ? `${(iq24.duplicate_ratio_lead_submitted * 100).toFixed(0)}%`
                            : "—"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="lk-widget-install__windows-title">7 дней</div>
                  <table className="lk-widget-install__mini-table">
                    <tbody>
                      <tr>
                        <td>Всего запросов</td>
                        <td>{iq7?.total_requests ?? 0}</td>
                      </tr>
                      <tr>
                        <td>created</td>
                        <td>{iq7?.created_count ?? 0}</td>
                      </tr>
                      <tr>
                        <td>duplicate_suppressed</td>
                        <td>{iq7?.duplicate_suppressed_count ?? 0}</td>
                      </tr>
                      <tr>
                        <td>outcome_updated</td>
                        <td>{iq7?.outcome_updated_count ?? 0}</td>
                      </tr>
                      <tr>
                        <td>outcome_unchanged</td>
                        <td>{iq7?.outcome_unchanged_count ?? 0}</td>
                      </tr>
                      <tr>
                        <td>rate_limited</td>
                        <td>{iq7?.rate_limited_count ?? 0}</td>
                      </tr>
                      <tr>
                        <td>rejected</td>
                        <td>{iq7?.rejected_count ?? 0}</td>
                      </tr>
                      <tr>
                        <td>success_ratio</td>
                        <td>
                          {iq7?.success_ratio != null ? `${(iq7.success_ratio * 100).toFixed(0)}%` : "—"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      <div className="lk-widget-install__grid" style={{ marginTop: 20 }}>
        <section>
          <h2 className="lk-partner__section-title">Идентификаторы</h2>
          <div className="lk-widget-install__field-label">status</div>
          <div className="lk-widget-install__mono">{data.status}</div>
          <div className="lk-widget-install__field-label">public_id</div>
          <div className="lk-widget-install__mono">{data.public_id}</div>
          <div className="lk-widget-install__field-label" style={{ marginTop: 12 }}>
            publishable_key
          </div>
          <div className="lk-widget-install__mono">{data.publishable_key}</div>
        </section>

        <section>
          <h2 className="lk-partner__section-title">Сниппет установки</h2>
          <p className="lk-partner__muted" style={{ marginBottom: 8 }}>
            Вставьте перед закрывающим <code>&lt;/body&gt;</code> на страницах, где нужен сбор лидов.
            Адреса в сниппете берутся из настроек сервера (<code>FRONTEND_URL</code>, опционально{" "}
            <code>PUBLIC_API_BASE</code>).
          </p>
          <div className="lk-widget-install__snippet-wrap">
            <pre className="lk-widget-install__mono lk-widget-install__snippet">{data.widget_embed_snippet}</pre>
          </div>
          <div className="lk-partner__link-row" style={{ marginTop: 12 }}>
            <button type="button" className="lk-partner__copy-btn" onClick={onCopySnippet}>
              Копировать сниппет
            </button>
            {copyHint ? <span className="lk-partner__muted">{copyHint}</span> : null}
          </div>
        </section>

        <section>
          <h2 className="lk-partner__section-title">Настройки интеграции</h2>
          <div className="lk-widget-install__field-label">platform_preset</div>
          <select
            className="lk-widget-install__select"
            value={platformPreset}
            onChange={(e) => setPlatformPreset(e.target.value)}
            aria-label="platform_preset"
          >
            <option value="tilda">tilda</option>
            <option value="generic">generic</option>
          </select>

          <div className="lk-widget-install__field-label" style={{ marginTop: 14 }}>
            allowed_origins (JSON-массив строк)
          </div>
          <textarea
            className="lk-widget-install__textarea"
            value={allowedText}
            onChange={(e) => setAllowedText(e.target.value)}
            spellCheck={false}
            aria-label="allowed_origins JSON"
          />

          <div className="lk-widget-install__field-label" style={{ marginTop: 14 }}>
            config_json
          </div>
          <textarea
            className="lk-widget-install__textarea"
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            spellCheck={false}
            aria-label="config_json"
            style={{ minHeight: 160 }}
          />

          <div className="lk-widget-install__row" style={{ marginTop: 14 }}>
            <label className="lk-widget-install__field-label" style={{ marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={widgetEnabled}
                onChange={(e) => setWidgetEnabled(e.target.checked)}
              />{" "}
              widget_enabled
            </label>
          </div>

          <div className="lk-widget-install__actions">
            <button type="button" className="lk-widget-install__btn" disabled={saving} onClick={onSave}>
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
            <button
              type="button"
              className="lk-widget-install__btn lk-widget-install__btn_secondary"
              onClick={load}
            >
              Обновить с сервера
            </button>
          </div>
          {saveHint ? <p className="lk-widget-install__hint">{saveHint}</p> : null}
        </section>

        <section>
          <h2 className="lk-partner__section-title">Служебно</h2>
          <p className="lk-partner__muted">
            widget_script_base:{" "}
            <span className="lk-widget-install__mono" style={{ display: "inline", padding: "2px 6px" }}>
              {data.widget_script_base}
            </span>
          </p>
          <p className="lk-partner__muted" style={{ marginTop: 6 }}>
            public_api_base:{" "}
            <span className="lk-widget-install__mono" style={{ display: "inline", padding: "2px 6px" }}>
              {data.public_api_base}
            </span>
          </p>
        </section>
      </div>

      {diag && (
        <section className="lk-widget-install__card lk-widget-install__leads-section" style={{ marginTop: 24 }}>
          <h2 className="lk-partner__section-title">Последние лиды по сайту</h2>
          {!diag.has_recent_leads ? (
            <p className="lk-partner__muted">Пока нет сохранённых событий — отправьте тестовую заявку с сайта.</p>
          ) : (
            <div className="lk-widget-install__table-wrap">
              <table className="lk-widget-install__table">
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Страница</th>
                    <th>Форма</th>
                    <th>ref</th>
                    <th>Стадия</th>
                    <th>Итог (клиент)</th>
                    <th>Контакт</th>
                    <th>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {(diag.recent_leads || []).map((row) => (
                    <tr key={row.id}>
                      <td className="lk-widget-install__td-time">{row.created_at?.replace("T", " ").slice(0, 19)}</td>
                      <td title={row.page_key}>{row.page_path || row.page_key || "—"}</td>
                      <td>{row.form_id || "—"}</td>
                      <td className="lk-widget-install__mono">{row.ref_code || "—"}</td>
                      <td>
                        <span className={`lk-widget-install__badge lk-widget-install__badge_${row.submission_stage_badge}`}>
                          {row.submission_stage_label || row.submission_stage}
                        </span>
                      </td>
                      <td>
                        <span className={`lk-widget-install__badge lk-widget-install__badge_${row.client_outcome_badge}`}>
                          {row.client_outcome_label || row.client_observed_outcome || "—"}
                        </span>
                      </td>
                      <td className="lk-widget-install__mono">
                        {[row.customer_email_masked, row.customer_phone_masked].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td>
                        {row.amount != null ? `${row.amount} ${row.currency || ""}`.trim() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default WidgetInstallScreen;
