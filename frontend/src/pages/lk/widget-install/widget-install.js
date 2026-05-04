import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import SyntaxHighlighter from "react-syntax-highlighter/dist/cjs/light";
import xml from "react-syntax-highlighter/dist/cjs/languages/hljs/xml";
import { atomOneDarkReasonable, atomOneLight } from "react-syntax-highlighter/dist/cjs/styles/hljs";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "../owner-programs/owner-programs.css";
import "./widget-install.css";
import widgetInstallTildaEditHeadHtmlPng from "../../../static/images/widget-install-tilda-edit-head-html.png";
import widgetInstallTildaHeadEditorPng from "../../../static/images/widget-install-tilda-head-editor.png";
import widgetInstallTildaInsertCodePng from "../../../static/images/widget-install-tilda-insert-code.png";
import widgetInstallTildaPublishPng from "../../../static/images/widget-install-tilda-publish.png";
import widgetInstallTildaSiteSettingsPng from "../../../static/images/widget-install-tilda-site-settings.png";
import { dispatchLumorefSiteStatusChanged } from "../lkProgramListsSync";
import { siteLifecycleLabelRu } from "../owner-programs/siteDisplay";
import { emitSiteOwnerActivity } from "../owner-programs/siteOwnerActivityBus";

SyntaxHighlighter.registerLanguage("xml", xml);

function WidgetInstallScreenshotExpandable({ src, description, onOpen }) {
  return (
    <button
      type="button"
      className="lk-widget-install__step-screenshot-btn"
      onClick={() => onOpen({ src, alt: description })}
      aria-label={`Увеличить изображение. ${description}`}
    >
      <img src={src} alt="" className="lk-widget-install__step-screenshot" loading="lazy" decoding="async" aria-hidden />
    </button>
  );
}

function useLkDocumentTheme() {
  return useSyncExternalStore(
    (onChange) => {
      const el = document.documentElement;
      const mo = new MutationObserver(() => onChange());
      mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
      return () => mo.disconnect();
    },
    () => document.documentElement.getAttribute("data-theme") || "dark",
    () => "dark"
  );
}

function SnippetCopyIcon({ copied = false }) {
  if (copied) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d="M11.67 3.5 5.83 9.33 3.17 6.67"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M5.25 2.33h5.84a.58.58 0 0 1 .58.59v5.83"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.75 4.67H2.92a.58.58 0 0 0-.59.58v5.84c0 .32.26.58.59.58h5.83c.32 0 .58-.26.58-.58V5.25a.58.58 0 0 0-.58-.58Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

const REQUIRED_CAPTURE_FIELDS = [
  { key: "ref", label: "ref" },
  { key: "page_url", label: "URL страницы" },
  { key: "form_id", label: "ID формы" },
];

const OPTIONAL_CAPTURE_FIELDS = [
  { key: "name", label: "Имя" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Телефон" },
  { key: "amount", label: "Сумма" },
  { key: "currency", label: "Валюта" },
  { key: "product_name", label: "Товар / тариф" },
];

function normalizeCaptureConfig(value) {
  const hasExplicitEnabledList =
    value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "enabled_optional_fields") &&
    Array.isArray(value.enabled_optional_fields);
  const raw = hasExplicitEnabledList ? value.enabled_optional_fields : OPTIONAL_CAPTURE_FIELDS.map((field) => field.key);
  const allowed = new Set(OPTIONAL_CAPTURE_FIELDS.map((field) => field.key));
  const next = [];
  raw.forEach((item) => {
    const key = String(item || "").trim();
    if (allowed.has(key) && !next.includes(key)) {
      next.push(key);
    }
  });
  return { enabled_optional_fields: next };
}

/** Поля захвата: плита и строки с переключателями (вместо чекбоксов). */
function WidgetInstallCaptureFieldsPanel({ introClassName, introText, enabledOptionalFields, setCaptureConfig, children }) {
  return (
    <>
      <p className={introClassName} style={{ marginBottom: 14 }}>
        {introText}
      </p>
      <div className="lk-widget-install__capture-plate">
        <div className="lk-widget-install__capture-group">
          <div className="lk-widget-install__capture-plate-header">
            <p className="lk-widget-install__capture-plate-title">Системные поля</p>
          </div>
          <div className="lk-widget-install__capture-block-wrap" data-testid="capture-required-fields">
            {REQUIRED_CAPTURE_FIELDS.map((field) => (
              <div key={field.key} className="lk-widget-install__capture-notification-wrap">
                <label className="lk-widget-install__capture-simple-switch-label lk-widget-install__capture-row">
                  <span className="lk-widget-install__capture-row-text">
                    <span className="lk-widget-install__capture-field-name">{field.label}</span>
                  </span>
                  <span className="lk-widget-install__switch lk-widget-install__switch_size_m lk-widget-install__switch_end">
                    <input
                      type="checkbox"
                      className="lk-widget-install__switch-input"
                      checked
                      readOnly
                      disabled
                      tabIndex={-1}
                      aria-label={`${field.label} (всегда включено)`}
                    />
                    <span className="lk-widget-install__switch-slider" aria-hidden="true" />
                  </span>
                </label>
              </div>
            ))}
          </div>
        </div>

        <div className="lk-widget-install__capture-group lk-widget-install__capture-group_optional">
          <div className="lk-widget-install__capture-plate-header">
            <p className="lk-widget-install__capture-plate-title">Дополнительные поля</p>
          </div>
          <div className="lk-widget-install__capture-block-wrap" data-testid="capture-optional-fields">
            {OPTIONAL_CAPTURE_FIELDS.map((field) => {
              const checked = enabledOptionalFields.includes(field.key);
              return (
                <div key={field.key} className="lk-widget-install__capture-notification-wrap">
                  <label className="lk-widget-install__capture-simple-switch-label lk-widget-install__capture-row">
                    <span className="lk-widget-install__capture-row-text">
                      <span className="lk-widget-install__capture-field-name">{field.label}</span>
                    </span>
                    <span className="lk-widget-install__switch lk-widget-install__switch_size_m lk-widget-install__switch_end">
                      <input
                        type="checkbox"
                        className="lk-widget-install__switch-input"
                        checked={checked}
                        onChange={(event) => {
                          setCaptureConfig((current) => {
                            const currentEnabled = current.enabled_optional_fields || [];
                            const nextEnabled = event.target.checked
                              ? [...currentEnabled, field.key].filter((value, index, arr) => arr.indexOf(value) === index)
                              : currentEnabled.filter((value) => value !== field.key);
                            return { enabled_optional_fields: nextEnabled };
                          });
                        }}
                      />
                      <span className="lk-widget-install__switch-slider" aria-hidden="true" />
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {children}
    </>
  );
}

function buildAllowedOrigins(originValue) {
  const origin = String(originValue || "").trim();
  return origin ? [origin] : [];
}

/** Human-readable integration_status for owner UI */
function integrationStatusLabel(status) {
  const map = {
    healthy: "Подключение работает",
    needs_attention: "Нужно проверить",
    disabled: "Отключено",
    incomplete: "Не завершено",
  };
  return map[status] || status || "—";
}

/** Warning codes from API → short Russian hints */
function warningDescription(code) {
  const map = {
    no_allowed_origins: "Не указан домен сайта. Без этого браузер не сможет отправлять события.",
    widget_disabled: "Сбор заявок выключен. Включите его перед запуском.",
    publishable_key_missing: "Ключ публикации пока не готов. Обновите экран или сохраните настройки ещё раз.",
    observe_success_off: "Автопроверка страницы успеха выключена. Проверьте это, если хотите видеть итог отправки.",
    report_observed_outcome_off: "Сайт не отправляет итог заявки обратно в систему. Проверьте это перед запуском.",
    no_leads_last_7_days: "За последние 7 дней не было сохранённых заявок. Проверьте код установки и трафик.",
    high_not_observed_ratio_7d: "Много заявок без подтверждённого итога. Стоит проверить страницу «спасибо» и селекторы.",
    no_outcome_reported_last_24h: "Есть отправки, но сайт не сообщил итог заявки. Проверьте клиентскую интеграцию.",
  };
  return map[code] || "Есть техническое предупреждение. Откройте диагностику для деталей.";
}

function lifecycleLabel(status) {
  const map = {
    draft: "Черновик",
    verified: "Проверено",
    active: "Активно",
  };
  return map[status] || status || "—";
}

function setupStatusDescription(diag, lifecycleStatus) {
  if (diag?.integration_status === "healthy" && lifecycleStatus === "active") {
    return "Сайт подключён и уже активен.";
  }
  if (diag?.integration_status === "healthy") {
    return "Подключение выглядит корректно. Можно переходить к активации.";
  }
  if (diag?.integration_status === "needs_attention") {
    return "Подключение почти готово, но перед запуском стоит проверить замечания ниже.";
  }
  if (diag?.integration_status === "disabled") {
    return "Подключение сохранено, но сбор заявок сейчас выключен.";
  }
  if (lifecycleStatus === "verified") {
    return "Проверка уже пройдена. Осталось активировать сайт.";
  }
  return "Сначала сохраните настройки, затем проверьте подключение и активируйте сайт.";
}

function readSelectedSiteFromSearch(search) {
  try {
    return new URLSearchParams(search || "").get("site_public_id") || "";
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

function siteDiagnosticsFetchUrl(url, sitePublicId, activityRefresh) {
  const u = new URL(withSelectedSite(url, sitePublicId), window.location.origin);
  if (activityRefresh) u.searchParams.set("owner_activity_refresh", "1");
  return u.toString();
}

/** Machine error key from API: prefers `code`, falls back to legacy `detail` string. */
function apiErrorCode(payload) {
  return payload?.code ?? payload?.detail;
}

/** Human-readable / joinable body for owner hints (same string/array rules as legacy `detail`). */
function apiErrorDisplayText(payload) {
  const raw = apiErrorCode(payload);
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.join("\n");
  if (raw != null) return String(raw);
  return "";
}

function syncSelectedSiteInUrl(sitePublicId, { skip = false } = {}) {
  // When the screen is rendered under a canonical site route (skip=true), the URL
  // path is the only source of truth for site identity. Adding ?site_public_id=
  // to the URL would create a second, conflicting source.
  if (skip) return;
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

/** Canonical «Виджет» tab for a site inside the project shell. */
function buildProjectSiteWidgetPath(integrationPayload, selectedSitePublicId, projectBasePathState, projectIdFromRoute) {
  const siteId = String(integrationPayload?.public_id || selectedSitePublicId || "").trim();
  if (!siteId) return "";
  const fromPayload =
    integrationPayload?.project && typeof integrationPayload.project.id === "number"
      ? `/lk/partner/project/${integrationPayload.project.id}`
      : "";
  const base =
    fromPayload ||
    (projectBasePathState && String(projectBasePathState).trim()) ||
    (projectIdFromRoute ? `/lk/partner/project/${projectIdFromRoute}` : "");
  if (!base) return "";
  return `${base}/sites/${encodeURIComponent(siteId)}/widget`;
}

function WidgetInstallSnippetCard({
  title,
  subtitle = "",
  snippet,
  onCopy,
  copyHint,
  steps = null,
  compact = false,
  snippetOnly = false,
}) {
  const snippetHlStyle = atomOneLight;
  const copied = copyHint === "Скопировано";
  const sectionClass = compact
    ? "lk-widget-install__card owner-programs__site-snippet-card"
    : "lk-widget-install__card lk-widget-install__install-hero";

  const snippetBlock = (
    <div className="lk-widget-install__snippet-card">
        <div className="lk-widget-install__snippet-card-head">
          <span className="lk-widget-install__snippet-card-label">HTML</span>
          <button
            type="button"
            aria-label={copied ? "Код скопирован" : "Скопировать код"}
            className={`lk-widget-install__btn lk-widget-install__install-copy-btn${
              copied ? " lk-widget-install__install-copy-btn_success" : ""
            }`}
            onClick={onCopy}
          >
            <SnippetCopyIcon copied={copied} />
          </button>
        </div>

        <div className="lk-widget-install__snippet-card-code">
          <SyntaxHighlighter
            language="xml"
            style={snippetHlStyle}
            wrapLongLines
            customStyle={{
              margin: 0,
              padding: compact ? "16px 18px" : "18px 20px",
              background: "transparent",
              fontSize: "14px",
              lineHeight: "1.65",
            }}
            codeTagProps={{ style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" } }}
          >
            {snippet || ""}
          </SyntaxHighlighter>
        </div>
      </div>
  );

  if (snippetOnly) {
    if (compact) {
      return (
        <section
          className="lk-widget-install__card owner-programs__site-snippet-card"
          data-testid="widget-install-snippet-block"
        >
          {snippetBlock}
        </section>
      );
    }
    return <div data-testid="widget-install-snippet-block">{snippetBlock}</div>;
  }

  return (
    <section className={sectionClass} data-testid="widget-install-snippet-block">
      <div className={compact ? "owner-programs__site-snippet-head" : "lk-widget-install__install-copy"}>
        <h2 className={`lk-partner__section-title${compact ? "" : " lk-widget-install__install-title"}`}>{title}</h2>
        {subtitle ? (
          <p className={compact ? "owner-programs__muted owner-programs__site-snippet-sub" : "lk-widget-install__install-subtitle"}>
            {subtitle}
          </p>
        ) : null}
      </div>

      {snippetBlock}

      {steps ? (
        <div className="lk-widget-install__install-steps-block">
          <h3 className="lk-widget-install__install-steps-title">Что сделать дальше</h3>
          <ol className="lk-widget-install__install-steps">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

const VERIFY_POLL_INTERVAL_MS = 3000;
const VERIFY_MAX_WAIT_MS = 90_000;

const VERIFY_POLL_STEPS_RU = [
  "Открываем сайт",
  "Проверяем установленный код",
  "Ждём запуск виджета",
];

function pickIntegrationVerificationSnapshot(src) {
  if (!src || typeof src !== "object") return {};
  const keys = [
    "verification_status",
    "last_verification_at",
    "last_verification_error",
    "last_widget_seen_at",
    "last_widget_seen_origin",
    "status",
    "verified_at",
    "activated_at",
  ];
  const out = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
  }
  return out;
}

/** Кнопка основной проверки: после исхода «успех/ошибка» — «Проверить ещё раз». */
function verifyPrimaryButtonLabel(verifyLoading, connectionCheckStatus) {
  if (verifyLoading) return "Проверяем...";
  if (connectionCheckStatus === "found" || connectionCheckStatus === "verify_incomplete" || connectionCheckStatus === "not_found") {
    return "Проверить ещё раз";
  }
  return "Проверить подключение";
}

function connectionCheckPresentation(localState, persistedCheck, opts = {}) {
  const verifyFromToolbar = Boolean(opts.verifyFromToolbar);
  const persistedFound = persistedCheck?.status === "found";
  const persistedOrigin = String(persistedCheck?.last_seen_origin || "").trim();

  if (localState.status === "polling" || localState.status === "checking") {
    return {
      tone: "pending",
      title: "Проверяем подключение...",
      message: "Открываем сайт, проверяем код и ждём запуск виджета.",
      steps: VERIFY_POLL_STEPS_RU,
    };
  }
  if (localState.status === "found") {
    return {
      tone: "ok",
      title: "Код найден",
      message: "Виджет успешно запустился на сайте.",
    };
  }
  if (localState.status === "not_found") {
    return {
      tone: "bad",
      title: "Не удалось проверить подключение",
      message:
        localState.message ||
        (verifyFromToolbar
          ? "Проверьте установку кода и публикацию страницы, затем снова запустите проверку вверху."
          : "Проверьте, что код вставлен в header сайта и сайт опубликован."),
    };
  }
  if (localState.status === "verify_incomplete") {
    return {
      tone: "bad",
      title: "Не удалось проверить подключение",
      message: "Проверьте, что код вставлен в header сайта и сайт опубликован.",
    };
  }
  if (persistedFound) {
    return {
      tone: "ok",
      title: "Код найден",
      message: persistedOrigin
        ? `Сигнал от установленного кода уже получен с ${persistedOrigin}.`
        : "Сайт уже связался с системой.",
    };
  }
  return {
    tone: "idle",
    title: "Ещё не проверяли",
    message: verifyFromToolbar
      ? "Опубликуйте сайт с кодом в header, затем запустите проверку кнопкой у названия сайта вверху."
      : "Опубликуйте сайт с кодом в header и нажмите «Проверить подключение».",
  };
}

const VERIFICATION_STATUS_LABEL_RU = {
  not_started: "Ожидает проверки",
  pending: "Проверяем",
  html_found: "Код найден, но виджет не запустился",
  widget_seen: "Виджет успешно запустился",
  failed: "Ошибка проверки",
};

function formatVerificationInstant(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

function WidgetInstallVerifyPrimaryInstructions({ compact = false }) {
  const cls = compact ? "owner-programs__muted" : "lk-partner__muted";
  return (
    <p className={cls} style={{ marginTop: 0, marginBottom: 10 }} data-testid="widget-verify-primary-copy">
      Скопируйте код и вставьте его в header сайта. После публикации сайта нажмите «Проверить подключение».
    </p>
  );
}

function WidgetInstallVerifyStatusMeta({ verificationStatus, lastVerificationAt, lastWidgetSeenAt, lastWidgetSeenOrigin, verifyLoading = false }) {
  const vs = verificationStatus || "not_started";
  const statusLine = VERIFICATION_STATUS_LABEL_RU[vs] || VERIFICATION_STATUS_LABEL_RU.not_started;
  const wrapClass = [
    "lk-widget-install__verify-status-wrap",
    verifyLoading ? "lk-widget-install__verify-status-wrap_is-checking" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={wrapClass} data-testid="widget-verify-status-block">
      <div className="lk-widget-install__verify-status" data-testid="widget-verify-status-line">
        <span className="lk-widget-install__verify-status-label">Статус проверки:</span>{" "}
        <span className="lk-widget-install__verify-status-value">{statusLine}</span>
      </div>
      <div className="lk-widget-install__verify-meta lk-partner__muted" style={{ marginTop: 8, fontSize: 13 }}>
        {lastVerificationAt ? (
          <div data-testid="widget-verify-last-run">
            Последняя проверка: {formatVerificationInstant(lastVerificationAt)}
          </div>
        ) : null}
        {lastWidgetSeenAt ? (
          <div data-testid="widget-verify-last-widget-seen">
            Сигнал виджета: {formatVerificationInstant(lastWidgetSeenAt)}
            {lastWidgetSeenOrigin ? ` (${lastWidgetSeenOrigin})` : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WidgetInstallVerifyAdvancedOptions({
  open,
  onOpenChange,
  verificationUrlInput,
  setVerificationUrlInput,
  onVerifyThisPage,
  verifyLoading,
  saving,
  compact = false,
}) {
  const mutedClass = compact ? "owner-programs__muted" : "lk-partner__muted";
  return (
    <details
      className="lk-widget-install__verify-advanced-details lk-widget-install__verify-advanced-details_secondary"
      data-testid="widget-verify-advanced-details"
      open={open}
      onToggle={(e) => {
        onOpenChange(e.currentTarget.open);
      }}
    >
      <summary className="lk-widget-install__verify-advanced-summary lk-widget-install__verify-advanced-summary_link">
        Проверить другую страницу
      </summary>
      <div className="lk-widget-install__verify-advanced-body">
        <p className="lk-widget-install__verify-advanced-fallback-title" id="widget-verify-fallback-title">
          Код установлен не на всех страницах?
        </p>
        <p className={mutedClass} style={{ marginTop: 8 }}>
          Если вы вставили код не в общий header сайта, укажите ссылку на страницу, где точно установлен код.
        </p>
        <label className="lk-widget-install__field-label" htmlFor="widget-verify-advanced-url-input">
          Ссылка на страницу с кодом
        </label>
        <input
          id="widget-verify-advanced-url-input"
          data-testid="widget-verify-advanced-url-input"
          type="url"
          className="lk-widget-install__select"
          value={verificationUrlInput}
          onChange={(e) => setVerificationUrlInput(e.target.value)}
          placeholder="https://mysite.example/page-with-widget"
          autoComplete="off"
        />
        <div className="lk-widget-install__verify-persist-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="lk-widget-install__btn"
            disabled={verifyLoading || saving}
            onClick={() => void onVerifyThisPage()}
            data-testid="widget-verify-this-page-btn"
          >
            {saving ? "Сохраняем…" : "Проверить эту страницу"}
          </button>
        </div>
      </div>
    </details>
  );
}

function WidgetInstallConnectionCheckCard({
  verifyLoading,
  refreshBusy = false,
  onVerify,
  onRefreshStatus,
  statusView,
  showVerifyButton = true,
  hideIntro = false,
  hideSectionTitle = false,
}) {
  const actionBusy = verifyLoading || refreshBusy;
  return (
    <section className="lk-widget-install__card lk-widget-install__connection-check" data-testid="site-connection-check-card">
      {!hideSectionTitle ? <h2 className="lk-partner__section-title">Проверка подключения</h2> : null}
      {!hideIntro ? (
        <p className="lk-partner__muted">
          {showVerifyButton
            ? "Скопируйте код в header сайта, опубликуйте сайт и нажмите кнопку ниже."
            : "После установки кода опубликуйте сайт. Проверку можно запустить кнопкой на панели действий у названия сайта."}
        </p>
      ) : null}
      {showVerifyButton || onRefreshStatus ? (
        <div className="lk-widget-install__connection-check-actions">
          {showVerifyButton ? (
            <button type="button" className="lk-widget-install__btn" disabled={actionBusy} onClick={onVerify}>
              {verifyLoading ? "Проверяем…" : "Проверить подключение"}
            </button>
          ) : null}
          {onRefreshStatus ? (
            <button
              type="button"
              className="lk-widget-install__btn lk-widget-install__btn_secondary"
              disabled={actionBusy}
              onClick={() => void onRefreshStatus()}
            >
              {refreshBusy ? "Обновляем…" : "Обновить статус"}
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        className={`lk-widget-install__connection-check-status lk-widget-install__connection-check-status_${statusView.tone}`}
        role="status"
        aria-live="polite"
      >
        <strong className="lk-widget-install__connection-check-title">{statusView.title}</strong>
        <p className="lk-widget-install__connection-check-copy">{statusView.message}</p>
      </div>
    </section>
  );
}

/**
 * @param {{ routeSitePublicId?: string, focused?: boolean, presentation?: "default" | "project-site", cleanupDraftOnExit?: boolean }} [props]
 * When set (UUID), loads integration for that Site — used from `/lk/partner/:sitePublicId/widget`.
 */
function WidgetInstallScreen({
  routeSitePublicId: routeSitePublicIdProp = "",
  focused = false,
  presentation = "default",
  cleanupDraftOnExit = false,
} = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const routeSitePublicIdRaw = (routeSitePublicIdProp || "").trim();
  const routeSitePublicId = isUuidString(routeSitePublicIdRaw) ? routeSitePublicIdRaw : "";
  const inProjectShell = Boolean(routeSitePublicId);
  const projectSitePresentation = inProjectShell && presentation === "project-site";
  const focusedConnectView = inProjectShell && focused && !projectSitePresentation;
  const focusedConnectViewRef = useRef(focusedConnectView);
  focusedConnectViewRef.current = focusedConnectView;
  const cleanupDraftOnExitRef = useRef(Boolean(cleanupDraftOnExit));
  cleanupDraftOnExitRef.current = Boolean(cleanupDraftOnExit);
  const skipDraftCleanupRef = useRef(false);
  const connectSiteIntroRu =
    "Скопируйте код, вставьте его в header сайта и опубликуйте сайт. После этого мы автоматически проверим подключение.";
  const shellTitle = focusedConnectView ? "Подключите сайт" : inProjectShell ? "Виджет" : "Виджет на сайт";
  const shellSubtitle = focusedConnectView
    ? ""
    : "Подключите сайт: вставьте код, выберите данные для отправки, проверьте и активируйте интеграцию.";
  const howToStepsTotal = 7;

  const [loading, setLoading] = useState(true);
  const [siteMissing, setSiteMissing] = useState(false);
  const [siteSelectionRequired, setSiteSelectionRequired] = useState(false);
  const [siteOptions, setSiteOptions] = useState([]);
  const [selectedSitePublicId, setSelectedSitePublicId] = useState(() =>
    routeSitePublicId || readSelectedSiteFromSearch(location.search),
  );
  const [createSiteLoading, setCreateSiteLoading] = useState(false);
  const [createSiteError, setCreateSiteError] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [activateLoading, setActivateLoading] = useState(false);
  const [error, setError] = useState("");
  const [saveHint, setSaveHint] = useState("");
  const [copyHint, setCopyHint] = useState("");
  const [data, setData] = useState(null);
  const [diag, setDiag] = useState(null);
  const [diagError, setDiagError] = useState("");
  const [howToStepIndex, setHowToStepIndex] = useState(0);
  const [originInput, setOriginInput] = useState("");
  const [verificationUrlInput, setVerificationUrlInput] = useState("");
  const [configText, setConfigText] = useState("{}");
  const [platformPreset, setPlatformPreset] = useState("tilda");
  const [widgetEnabled, setWidgetEnabled] = useState(true);
  const [captureConfig, setCaptureConfig] = useState(() => normalizeCaptureConfig(null));
  const [projectBasePath, setProjectBasePath] = useState("");
  const [connectionCheckUi, setConnectionCheckUi] = useState({ status: "idle", message: "" });
  const loadGenerationRef = useRef(0);
  const [otherPageVerifyOpen, setOtherPageVerifyOpen] = useState(false);
  const [screenshotLightbox, setScreenshotLightbox] = useState(null);
  const verifyPollIntervalRef = useRef(null);
  const verifySessionRef = useRef(0);
  const verifyPostInFlightRef = useRef(false);
  const selectedSitePublicIdRef = useRef(selectedSitePublicId);
  const locationRef = useRef(location);
  locationRef.current = location;
  selectedSitePublicIdRef.current = selectedSitePublicId;

  const projectIdFromRoute = useMemo(() => {
    const raw = String(params?.projectId ?? "").trim();
    if (/^\d+$/.test(raw)) return raw;
    const fromPath = String(location.pathname || "").match(/\/project\/(\d+)(?:\/|$)/);
    return fromPath ? fromPath[1] : "";
  }, [location.pathname, params?.projectId]);

  /** API may omit numeric `project.id`; under `/lk/partner/project/:projectId/...` the path is authoritative. */
  const effectiveProjectBasePath = useMemo(() => {
    if (projectBasePath) return projectBasePath;
    if (projectIdFromRoute) return `/lk/partner/project/${projectIdFromRoute}`;
    return "";
  }, [projectBasePath, projectIdFromRoute]);
  const effectiveProjectBasePathRef = useRef(effectiveProjectBasePath);
  effectiveProjectBasePathRef.current = effectiveProjectBasePath;
  const projectIdFromRouteRef = useRef(projectIdFromRoute);
  projectIdFromRouteRef.current = projectIdFromRoute;

  const stopVerifyPolling = useCallback(() => {
    if (verifyPollIntervalRef.current != null) {
      clearInterval(verifyPollIntervalRef.current);
      verifyPollIntervalRef.current = null;
    }
  }, []);

  const cleanupDraftSiteOnExit = useCallback(() => {
    const projectId = projectIdFromRouteRef.current;
    const sitePublicId = routeSitePublicId || selectedSitePublicIdRef.current;
    if (
      !cleanupDraftOnExitRef.current ||
      skipDraftCleanupRef.current ||
      !projectId ||
      !isUuidString(sitePublicId)
    ) {
      return;
    }
    skipDraftCleanupRef.current = true;
    window.dispatchEvent(
      new CustomEvent("lk-project-site-deleted", {
        detail: { projectId: Number(projectId), sitePublicId },
      }),
    );
    fetch(API_ENDPOINTS.projectSiteDelete(projectId), {
      method: "DELETE",
      headers: authHeaders(),
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({ site_public_id: sitePublicId }),
    })
      .then((res) => {
        if (res.ok) {
          window.dispatchEvent(new Event("lk-owner-projects-updated"));
        }
      })
      .catch(() => {});
  }, [routeSitePublicId]);

  const refreshIntegrationSnapshotForPoll = useCallback(
    async (signal) => {
      const effectiveSitePublicId = routeSitePublicId || selectedSitePublicIdRef.current;
      if (!effectiveSitePublicId) return null;
      const fetchOpts = signal ? { signal } : {};
      try {
        const resInt = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, effectiveSitePublicId), {
          method: "GET",
          headers: authHeaders(),
          credentials: "include",
          ...fetchOpts,
        });
        const intPayload = await resInt.json().catch(() => ({}));
        if (!resInt.ok) return null;
        setData((prev) =>
          prev && prev.public_id && intPayload.public_id && prev.public_id === intPayload.public_id
            ? { ...prev, ...pickIntegrationVerificationSnapshot(intPayload) }
            : intPayload,
        );
        const resDiag = await fetch(
          siteDiagnosticsFetchUrl(
            API_ENDPOINTS.siteIntegrationDiagnostics,
            intPayload.public_id || effectiveSitePublicId,
            false,
          ),
          {
            method: "GET",
            headers: authHeaders(),
            credentials: "include",
            ...fetchOpts,
          },
        );
        if (resDiag.ok) {
          const d = await resDiag.json().catch(() => null);
          setDiag(d);
          setDiagError("");
        }
        return intPayload;
      } catch (e) {
        if (e?.name === "AbortError") return null;
        console.error(e);
        return null;
      }
    },
    [routeSitePublicId],
  );

  const load = useCallback(async (sitePublicIdOverride, options = {}) => {
    const { quiet = false, activityRefresh = false } = options;
    const generation = ++loadGenerationRef.current;
    // When mounted under a canonical site route, the path is the only source of
    // truth — never fall back to ?site_public_id= or local state.
    const searchResolvedId = routeSitePublicId
      ? ""
      : readSelectedSiteFromSearch(locationRef.current.search);
    const effectiveSitePublicId = routeSitePublicId
      ? routeSitePublicId
      : sitePublicIdOverride ?? (searchResolvedId || selectedSitePublicId);
    if (!quiet) {
      setLoading(true);
      setSiteMissing(false);
      setSiteSelectionRequired(false);
      setCreateSiteError("");
      setError("");
      setSaveHint("");
      setCopyHint("");
      setDiagError("");
      setConnectionCheckUi({ status: "idle", message: "" });
    } else {
      setConnectionCheckUi({ status: "idle", message: "" });
      setDiagError("");
    }
    try {
      const resInt = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, effectiveSitePublicId), {
        method: "GET",
        headers: authHeaders(),
        credentials: "include",
      });
      const intPayload = await resInt.json().catch(() => ({}));
      if (generation !== loadGenerationRef.current) return;
      const intErrorCode = apiErrorCode(intPayload);
      if (resInt.status === 404 && intErrorCode === "site_missing") {
        setData(null);
        setDiag(null);
        setSiteOptions([]);
        setSiteMissing(true);
        return;
      }
      if (resInt.status === 409 && intErrorCode === "site_selection_required") {
        setData(null);
        setDiag(null);
        setSiteOptions(Array.isArray(intPayload.sites) ? intPayload.sites : []);
        setSiteSelectionRequired(true);
        return;
      }
      if (!resInt.ok) {
        setData(null);
        setDiag(null);
        const detailMsg = apiErrorDisplayText(intPayload);
        setError(detailMsg || `Ошибка загрузки (${resInt.status})`);
        return;
      }
      if (generation !== loadGenerationRef.current) return;
      setData(intPayload);
      setOriginInput(Array.isArray(intPayload.allowed_origins) ? intPayload.allowed_origins[0] || "" : "");
      setVerificationUrlInput(String(intPayload.verification_url || "").trim());
      setConfigText(prettyJson(intPayload.config_json));
      setPlatformPreset(intPayload.platform_preset || "tilda");
      setWidgetEnabled(Boolean(intPayload.widget_enabled));
      setCaptureConfig(normalizeCaptureConfig(intPayload.capture_config || intPayload.config_json?.capture_config));
      const nextProjectId = intPayload?.project && typeof intPayload.project.id === "number" ? intPayload.project.id : null;
      setProjectBasePath(nextProjectId ? `/lk/partner/project/${nextProjectId}` : "");
      if (intPayload.public_id) {
        setSelectedSitePublicId(intPayload.public_id);
        syncSelectedSiteInUrl(intPayload.public_id, { skip: Boolean(routeSitePublicId) });
      }
      const resDiag = await fetch(
        siteDiagnosticsFetchUrl(
          API_ENDPOINTS.siteIntegrationDiagnostics,
          intPayload.public_id || effectiveSitePublicId,
          activityRefresh,
        ),
        {
          method: "GET",
          headers: authHeaders(),
          credentials: "include",
        },
      );
      if (resDiag.ok) {
        const d = await resDiag.json().catch(() => null);
        if (generation !== loadGenerationRef.current) return;
        setDiag(d);
      } else {
        if (generation !== loadGenerationRef.current) return;
        setDiag(null);
        setDiagError("Не удалось загрузить диагностику. Обновите позже.");
      }
    } catch (e) {
      console.error(e);
      if (generation !== loadGenerationRef.current) return;
      setData(null);
      setDiag(null);
      setError("network");
    } finally {
      if (generation === loadGenerationRef.current && !quiet) {
        setLoading(false);
      }
    }
  }, [selectedSitePublicId, routeSitePublicId]);

  useEffect(() => {
    if (routeSitePublicId) {
      setSelectedSitePublicId(routeSitePublicId);
    }
  }, [routeSitePublicId]);

  useEffect(() => {
    if (routeSitePublicId) return;
    const nextSitePublicId = readSelectedSiteFromSearch(location.search);
    if (!nextSitePublicId || nextSitePublicId === selectedSitePublicId) return;
    setSelectedSitePublicId(nextSitePublicId);
  }, [location.search, routeSitePublicId, selectedSitePublicId]);

  useEffect(() => {
    load();
  }, [load, location.search]);

  useEffect(() => {
    const st = data?.verification_status;
    if (st === "failed" || st === "html_found") {
      setOtherPageVerifyOpen(true);
    }
  }, [data?.verification_status]);

  useEffect(() => {
    if (!screenshotLightbox) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setScreenshotLightbox(null);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [screenshotLightbox]);

  useEffect(
    () => () => {
      stopVerifyPolling();
    },
    [stopVerifyPolling],
  );

  useEffect(
    () => () => {
      cleanupDraftSiteOnExit();
    },
    [cleanupDraftSiteOnExit],
  );

  const siteManagementPath = useMemo(() => {
    if (!effectiveProjectBasePath || !selectedSitePublicId) return "";
    return `${effectiveProjectBasePath}/sites/${encodeURIComponent(selectedSitePublicId)}/widget`;
  }, [effectiveProjectBasePath, selectedSitePublicId]);

  useEffect(() => {
    if (!focusedConnectView || loading || !data || !siteManagementPath) return;
    const cc = diag?.connection_check;
    if (cc?.status === "found") {
      skipDraftCleanupRef.current = true;
      navigate(siteManagementPath, { replace: true });
    }
  }, [focusedConnectView, loading, data, diag, siteManagementPath, navigate]);

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
        const detailMsg = apiErrorDisplayText(payload);
        setCreateSiteError(detailMsg || `Не удалось создать сайт (${res.status})`);
        return;
      }
      if (payload.public_id) {
        setSelectedSitePublicId(payload.public_id);
        syncSelectedSiteInUrl(payload.public_id, { skip: Boolean(routeSitePublicId) });
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

  const onSave = async (fieldOverrides = {}) => {
    setSaving(true);
    setSaveHint("");
    setError("");
    const allowed_origins = buildAllowedOrigins(originInput);
    let config_json;
    try {
      config_json = JSON.parse(configText || "{}");
      if (!config_json || typeof config_json !== "object" || Array.isArray(config_json)) {
        throw new Error("config_not_object");
      }
      delete config_json.capture_config;
    } catch {
      setSaving(false);
      setSaveHint("config_json: невалидный JSON");
      return;
    }
    const nextWidgetEnabled =
      typeof fieldOverrides.widget_enabled === "boolean" ? fieldOverrides.widget_enabled : widgetEnabled;
    try {
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, selectedSitePublicId), {
        method: "PATCH",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({
          site_public_id: selectedSitePublicId || undefined,
          allowed_origins,
          config_json,
          capture_config: captureConfig,
          platform_preset: platformPreset,
          widget_enabled: nextWidgetEnabled,
          verification_url: String(verificationUrlInput || "").trim(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const hint = apiErrorDisplayText(payload);
        setSaveHint(hint || `Сохранение: ${res.status}`);
        return;
      }
      setData(payload);
      if (typeof payload?.widget_enabled === "boolean") {
        setWidgetEnabled(Boolean(payload.widget_enabled));
      }
      setSaveHint("Сохранено");
      setTimeout(() => setSaveHint(""), 2500);
      emitSiteOwnerActivity(String(payload?.public_id || selectedSitePublicId || "").trim());
      dispatchLumorefSiteStatusChanged(payload);
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

  const onVerifyThisPage = async () => {
    if (!String(verificationUrlInput || "").trim()) {
      setSaveHint("Введите ссылку на страницу.");
      return;
    }
    setSaveHint("");
    setConnectionCheckUi({ status: "idle", message: "" });
    try {
      await onSave();
      await onVerify();
    } catch (e) {
      console.error(e);
      setSaveHint("Не удалось выполнить проверку.");
    }
  };

  const onPickSite = async (sitePublicId) => {
    // Site picker is only used in legacy/standalone mode (no canonical route).
    // When a canonical route is active, this branch is unreachable, but we still
    // gate the URL sync to keep the path as the single source of truth.
    setSelectedSitePublicId(sitePublicId);
    syncSelectedSiteInUrl(sitePublicId, { skip: Boolean(routeSitePublicId) });
    await load(sitePublicId);
  };

  const onVerify = async () => {
    const session = ++verifySessionRef.current;
    stopVerifyPolling();
    setVerifyLoading(true);
    setSaveHint("");
    setConnectionCheckUi({ status: "polling", message: "" });

    const verifyStartedAt = Date.now();
    const abortController = new AbortController();
    const postAbortTimer = window.setTimeout(() => {
      abortController.abort();
    }, VERIFY_MAX_WAIT_MS);

    const clearPostAbortTimer = () => {
      window.clearTimeout(postAbortTimer);
    };

    const applyPollTerminalSuccess = (intPayload) => {
      if (verifySessionRef.current !== session) return;
      stopVerifyPolling();
      setVerifyLoading(false);
      setConnectionCheckUi({ status: "found" });
      setOtherPageVerifyOpen(false);
      emitSiteOwnerActivity(String(intPayload?.public_id || selectedSitePublicIdRef.current || "").trim());
      dispatchLumorefSiteStatusChanged(intPayload);
      if (focusedConnectViewRef.current) {
        const widgetPath = buildProjectSiteWidgetPath(
          intPayload,
          selectedSitePublicIdRef.current,
          effectiveProjectBasePathRef.current,
          projectIdFromRouteRef.current,
        );
        if (widgetPath) {
          skipDraftCleanupRef.current = true;
          navigate(widgetPath, { replace: true });
        }
      }
    };

    const applyPollTerminalFailure = (intPayload) => {
      if (verifySessionRef.current !== session) return;
      stopVerifyPolling();
      setVerifyLoading(false);
      setConnectionCheckUi({
        status: "verify_incomplete",
        message: String(intPayload?.last_verification_error || "").trim() || undefined,
      });
    };

    const runPollTick = async () => {
      if (verifySessionRef.current !== session) return;
      if (Date.now() - verifyStartedAt > VERIFY_MAX_WAIT_MS) {
        stopVerifyPolling();
        setVerifyLoading(false);
        setConnectionCheckUi({ status: "idle", message: "" });
        setSaveHint("Превышено время ожидания проверки. Попробуйте ещё раз.");
        return;
      }
      const intPayload = await refreshIntegrationSnapshotForPoll();
      if (!intPayload || verifySessionRef.current !== session) return;
      if (verifyPostInFlightRef.current) return;
      const vs = intPayload.verification_status;
      if (vs === "widget_seen") {
        applyPollTerminalSuccess(intPayload);
        return;
      }
      if (vs === "failed" || vs === "html_found") {
        applyPollTerminalFailure(intPayload);
      }
    };

    verifyPollIntervalRef.current = window.setInterval(() => {
      void runPollTick();
    }, VERIFY_POLL_INTERVAL_MS);

    try {
      verifyPostInFlightRef.current = true;
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegrationVerify, selectedSitePublicId), {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ site_public_id: selectedSitePublicId || undefined }),
        signal: abortController.signal,
      });
      const payload = await res.json().catch(() => ({}));
      verifyPostInFlightRef.current = false;

      if (verifySessionRef.current !== session) return;

      if (!res.ok) {
        stopVerifyPolling();
        setVerifyLoading(false);
        const verifyErrorCode = apiErrorCode(payload);
        if (verifyErrorCode === "site_connection_not_found") {
          const nextMessage =
            "Подключение не найдено. Проверьте установку, публикацию сайта и откройте страницу ещё раз.";
          setConnectionCheckUi({ status: "not_found", message: nextMessage });
          if (!focusedConnectView) setSaveHint(nextMessage);
          return;
        }
        if (verifyErrorCode === "site_widget_verify_incomplete") {
          const msg = String(payload.last_verification_error || payload.detail || "").trim();
          setConnectionCheckUi({
            status: "verify_incomplete",
            message:
              msg ||
              "Мы открыли страницу, но виджет не запросил настройки. Проверьте, что код вставлен именно на эту страницу, страница опубликована, домен сайта указан в настройках и скрипт не заблокирован.",
          });
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  verification_status: payload.verification_status ?? prev.verification_status,
                  last_verification_error: payload.last_verification_error ?? prev.last_verification_error,
                  last_verification_at: payload.last_verification_at ?? prev.last_verification_at,
                }
              : prev,
          );
          if (!focusedConnectView) setSaveHint(msg || "Проверка не завершена.");
          return;
        }
        if (verifyErrorCode === "widget_verify_rate_limited") {
          setConnectionCheckUi({ status: "idle", message: "" });
          setSaveHint(String(payload.detail || "").trim() || "Подождите перед следующей проверкой.");
          return;
        }
        if (verifyErrorCode === "site_verification_url_invalid") {
          setConnectionCheckUi({ status: "idle", message: "" });
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  verification_status: payload.verification_status ?? prev.verification_status,
                  last_verification_error: payload.last_verification_error ?? prev.last_verification_error,
                  last_verification_at: prev.last_verification_at,
                }
              : prev,
          );
          setSaveHint(String(payload.detail || "").trim() || "Некорректный URL для проверки.");
          return;
        }
        if (verifyErrorCode === "site_verification_home_url_missing") {
          setConnectionCheckUi({ status: "idle", message: "" });
          setSaveHint(String(payload.detail || "").trim() || "Не удалось определить адрес сайта для проверки.");
          return;
        }
        setConnectionCheckUi({ status: "idle", message: "" });
        const verifyHint = apiErrorDisplayText(payload);
        setSaveHint(verifyHint || `Проверка: ${res.status}`);
        return;
      }

      if (payload.verification_status === "pending") {
        setData(payload);
        return;
      }

      stopVerifyPolling();
      setVerifyLoading(false);
      setData(payload);
      setConnectionCheckUi({ status: "found" });
      setOtherPageVerifyOpen(false);
      emitSiteOwnerActivity(String(selectedSitePublicId || payload?.public_id || "").trim());
      dispatchLumorefSiteStatusChanged(payload);
      const resDiag = await fetch(
        siteDiagnosticsFetchUrl(API_ENDPOINTS.siteIntegrationDiagnostics, selectedSitePublicId, false),
        {
          method: "GET",
          headers: authHeaders(),
          credentials: "include",
        },
      );
      if (resDiag.ok) {
        setDiag(await resDiag.json().catch(() => null));
        setDiagError("");
      }
      if (focusedConnectView) {
        const widgetPath = buildProjectSiteWidgetPath(
          payload,
          selectedSitePublicId,
          effectiveProjectBasePath,
          projectIdFromRoute,
        );
        if (widgetPath) {
          skipDraftCleanupRef.current = true;
          navigate(widgetPath, { replace: true });
        }
      }
    } catch (e) {
      if (verifySessionRef.current !== session) return;
      verifyPostInFlightRef.current = false;
      stopVerifyPolling();
      setVerifyLoading(false);
      if (e?.name === "AbortError") {
        setConnectionCheckUi({ status: "idle", message: "" });
        setSaveHint("Превышено время ожидания проверки. Попробуйте ещё раз.");
      } else {
        console.error(e);
        setConnectionCheckUi({ status: "idle", message: "" });
        setSaveHint("Сетевая ошибка при проверке");
      }
    } finally {
      clearPostAbortTimer();
      verifyPostInFlightRef.current = false;
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
        const activateHint = apiErrorDisplayText(payload);
        setSaveHint(activateHint || `Активация: ${res.status}`);
        return;
      }
      setData(payload);
      emitSiteOwnerActivity(String(selectedSitePublicId || payload?.public_id || "").trim());
      dispatchLumorefSiteStatusChanged(payload);
      await load();
      if (focusedConnectView) {
        const widgetPath = buildProjectSiteWidgetPath(
          payload,
          selectedSitePublicId,
          effectiveProjectBasePath,
          projectIdFromRoute,
        );
        if (widgetPath) {
          skipDraftCleanupRef.current = true;
          navigate(widgetPath, { replace: true });
        }
      }
    } catch (e) {
      console.error(e);
      setSaveHint("Сетевая ошибка при активации");
    } finally {
      setActivateLoading(false);
    }
  };

  const onRefreshStatus = useCallback(async () => {
    setRefreshBusy(true);
    try {
      await load(undefined, { quiet: true, activityRefresh: true });
      emitSiteOwnerActivity(String(selectedSitePublicId || "").trim());
    } finally {
      setRefreshBusy(false);
    }
  }, [load, selectedSitePublicId]);

  const statusClass =
    diag?.integration_status === "healthy"
      ? "lk-widget-install__status_ok"
      : diag?.integration_status === "needs_attention"
        ? "lk-widget-install__status_warn"
        : diag?.integration_status === "disabled" || diag?.integration_status === "incomplete"
          ? "lk-widget-install__status_bad"
          : "";

  if (loading) {
    if (projectSitePresentation) {
      return (
        <div className="owner-programs__page owner-programs__site-page" aria-busy="true" role="status" aria-label="Загрузка">
          <div className="owner-programs__widget-site-skel">
            <span className="owner-programs__skel owner-programs__widget-site-skel-snippet" aria-hidden />
            <span className="owner-programs__skel owner-programs__widget-site-skel-section" aria-hidden />
          </div>
        </div>
      );
    }
    return (
      <div className="lk-dashboard lk-partner">
        <h1 className="lk-dashboard__title">{shellTitle}</h1>
        {shellSubtitle ? <p className="lk-dashboard__subtitle">{shellSubtitle}</p> : null}
        <p className="lk-partner__muted">Загрузка…</p>
      </div>
    );
  }

  if (siteMissing) {
    if (routeSitePublicId) {
      return (
        <div className="lk-dashboard lk-partner">
          <h1 className="lk-dashboard__title">{shellTitle}</h1>
          {shellSubtitle ? <p className="lk-dashboard__subtitle">{shellSubtitle}</p> : null}
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
        {shellSubtitle ? <p className="lk-dashboard__subtitle">{shellSubtitle}</p> : null}
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
        {shellSubtitle ? <p className="lk-dashboard__subtitle">{shellSubtitle}</p> : null}
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
        {shellSubtitle ? <p className="lk-dashboard__subtitle">{shellSubtitle}</p> : null}
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
        {shellSubtitle ? <p className="lk-dashboard__subtitle">{shellSubtitle}</p> : null}
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
  const lifecycleStatus = diag?.site_status || data?.status;
  const connectionCheckView = connectionCheckPresentation(connectionCheckUi, diag?.connection_check, {
    verifyFromToolbar: projectSitePresentation,
  });
  const verifyPrimaryLabel = verifyPrimaryButtonLabel(verifyLoading, connectionCheckUi.status);
  const showVerifyOtherPageLink =
    !verifyLoading && (connectionCheckUi.status === "verify_incomplete" || connectionCheckUi.status === "not_found");
  const lastVerifyErr = String(data?.last_verification_error || "").trim();
  const enabledOptionalFields = captureConfig.enabled_optional_fields;
  const siteName =
    (typeof data?.site_display_name === "string" && data.site_display_name.trim()) ||
    (typeof data?.config_json?.site_display_name === "string" && data.config_json.site_display_name.trim()) ||
    (typeof data?.config_json?.display_name === "string" && data.config_json.display_name.trim()) ||
    "Сайт без названия";
  const primaryOrigin = String(originInput || data?.allowed_origins?.[0] || diag?.allowed_origins?.[0] || "").trim();
  const integrationWarnings = (diag?.integration_warnings || []).map((item) => warningDescription(item));
  const setupStatusText = setupStatusDescription(diag, lifecycleStatus);
  const installSteps = [
    "Скопируйте HTML-код из блока выше.",
    "Откройте настройки сайта, к которому хотите подключить реферальную программу.",
    "В левом меню настроек выберите раздел «Вставка кода».",
    "В блоке «HTML-код для вставки внутрь HEAD» нажмите «Редактировать код».",
    "Вставьте код в раздел для HTML-кода внутри HEAD.",
    "Опубликуйте сайт, чтобы изменения появились для посетителей.",
    "Нажмите «Проверить подключение» на этой странице.",
  ];
  const readinessItems = [
    {
      label: "Домен сайта",
      value: primaryOrigin || "Не указан",
      ok: Boolean(primaryOrigin),
    },
    {
      label: "Проверка подключения",
      value: lifecycleStatus === "verified" || lifecycleStatus === "active" ? "Пройдена" : "Ещё не запускали",
      ok: lifecycleStatus === "verified" || lifecycleStatus === "active",
    },
    {
      label: "Статус запуска",
      value: lifecycleStatus === "active" ? "Сайт активен" : "Ещё не активирован",
      ok: lifecycleStatus === "active",
    },
  ];

  if (projectSitePresentation) {
    return (
      <div
        className="owner-programs__page owner-programs__site-page"
        data-testid="project-site-management-page"
        data-site-label={siteName}
      >
        {diagError ? <div className="owner-programs__error">{diagError}</div> : null}

        <div className="owner-programs__site-stack">
          <WidgetInstallSnippetCard
            compact
            title="Код для вставки на сайт"
            snippet={data.widget_embed_snippet}
            onCopy={onCopySnippet}
            copyHint={copyHint}
          />

          <section className="owner-programs__site-section owner-programs__site-section_plain">
            <h3 className="owner-programs__site-section-title">Какие данные отправлять</h3>
            <WidgetInstallCaptureFieldsPanel
              introClassName="owner-programs__muted"
              introText="Системные поля передаются всегда. Дополнительные поля можно включить для этого сайта."
              enabledOptionalFields={enabledOptionalFields}
              setCaptureConfig={setCaptureConfig}
            >
              <div className="owner-programs__site-actions">
                <button type="button" className="lk-widget-install__btn" disabled={saving} onClick={() => onSave()}>
                  {saving ? "Сохраняем…" : "Сохранить настройки данных"}
                </button>
              </div>
              {saveHint ? <p className="lk-widget-install__hint">{saveHint}</p> : null}
            </WidgetInstallCaptureFieldsPanel>
          </section>
        </div>
      </div>
    );
  }

  if (focusedConnectView) {
    return (
      <div className="lk-dashboard lk-partner lk-widget-install lk-widget-install_focused" data-testid="project-site-connect-page">
        <div className="page__returnButton">
          <Link
            className="tw-link link_primary link_s lk-widget-install__back-link"
            to={projectBasePath || "/lk/partner"}
            data-testid="project-site-connect-back"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="7" height="13" fill="none" viewBox="0 0 7 13" aria-hidden="true">
              <path
                fill="currentColor"
                d="M1 6.99a1 1 0 0 1 .23-.64l4-5a1 1 0 0 1 1.54 1.29L3.29 6.99l3.32 4.35a1 1 0 0 1-.15 1.4A1 1 0 0 1 5 12.62l-3.83-5A1 1 0 0 1 1 7Z"
              />
            </svg>
            Назад
          </Link>
        </div>
        <h1 className="lk-dashboard__title">{shellTitle}</h1>
        {shellSubtitle ? <p className="lk-dashboard__subtitle">{shellSubtitle}</p> : null}
        {diagError ? <div className="lk-widget-install__diag-soft">{diagError}</div> : null}

        <section className="lk-widget-install__card lk-widget-install__how-to-card">
          <div className="lk-widget-install__how-to-slider-head">
            <div>
              <p className="lk-widget-install__how-to-kicker">
                Шаг {howToStepIndex + 1} из {howToStepsTotal}
              </p>
              <h2 className="lk-widget-install__how-to-title">Установка виджета</h2>
            </div>
            <div className="lk-widget-install__how-to-dots" aria-label="Шаги установки">
              {Array.from({ length: howToStepsTotal }).map((_, index) => (
                <button
                  key={index}
                  type="button"
                  className={`lk-widget-install__how-to-dot${index === howToStepIndex ? " lk-widget-install__how-to-dot_active" : ""}`}
                  onClick={() => setHowToStepIndex(index)}
                  aria-label={`Открыть шаг ${index + 1}`}
                  aria-current={index === howToStepIndex ? "step" : undefined}
                />
              ))}
            </div>
          </div>

          {howToStepIndex === 0 ? (
          <div className="lk-widget-install__step-block">
            <h3 className="lk-widget-install__step-title">Шаг 1. Скопируйте код</h3>
            <p className="lk-widget-install__step-text lk-partner__muted">
              Скопируйте HTML-код ниже. Он подключает реферальный виджет к вашему сайту.
            </p>
            <WidgetInstallSnippetCard
              snippetOnly
              compact
              snippet={data.widget_embed_snippet}
              onCopy={onCopySnippet}
              copyHint={copyHint}
            />
          </div>
          ) : null}

          {howToStepIndex === 1 ? (
          <div className="lk-widget-install__step-block">
            <h3 className="lk-widget-install__step-title">Шаг 2. Откройте настройки сайта</h3>
            <p className="lk-widget-install__step-text lk-partner__muted">
              Откройте настройки сайта, к которому хотите подключить реферальную программу.
            </p>
            <WidgetInstallScreenshotExpandable
              src={widgetInstallTildaSiteSettingsPng}
              description="В конструкторе Tilda нажмите «Настройки сайта» рядом с названием сайта"
              onOpen={setScreenshotLightbox}
            />
          </div>
          ) : null}

          {howToStepIndex === 2 ? (
          <div className="lk-widget-install__step-block">
            <h3 className="lk-widget-install__step-title">Шаг 3. Перейдите в «Вставка кода»</h3>
            <p className="lk-widget-install__step-text lk-partner__muted">
              В левом меню настроек сайта выберите раздел «Вставка кода». В этом разделе можно добавить HTML-код, который будет загружаться на сайте.
            </p>
            <WidgetInstallScreenshotExpandable
              src={widgetInstallTildaInsertCodePng}
              description="В настройках сайта Tilda в левом меню выберите пункт «Вставка кода»"
              onOpen={setScreenshotLightbox}
            />
          </div>
          ) : null}

          {howToStepIndex === 3 ? (
          <div className="lk-widget-install__step-block">
            <h3 className="lk-widget-install__step-title">Шаг 4. Откройте редактор HTML-кода</h3>
            <p className="lk-widget-install__step-text lk-partner__muted">
              В блоке «HTML-код для вставки внутрь HEAD» нажмите «Редактировать код».
            </p>
            <WidgetInstallScreenshotExpandable
              src={widgetInstallTildaEditHeadHtmlPng}
              description="В разделе «Вставка кода» в блоке HTML для HEAD нажмите кнопку «Редактировать код»"
              onOpen={setScreenshotLightbox}
            />
          </div>
          ) : null}

          {howToStepIndex === 4 ? (
          <div className="lk-widget-install__step-block">
            <h3 className="lk-widget-install__step-title">Шаг 5. Вставьте код в HEAD</h3>
            <p className="lk-widget-install__step-text lk-partner__muted">
              Вставьте код в раздел для HTML-кода внутри HEAD. Так виджет будет загружаться на всех страницах сайта.
            </p>
            <WidgetInstallScreenshotExpandable
              src={widgetInstallTildaHeadEditorPng}
              description="В редакторе «Вставка кода в HEAD» вставьте скопированный скрипт и нажмите «Сохранить»"
              onOpen={setScreenshotLightbox}
            />
          </div>
          ) : null}

          {howToStepIndex === 5 ? (
          <div className="lk-widget-install__step-block">
            <h3 className="lk-widget-install__step-title">Шаг 6. Опубликуйте сайт</h3>
            <p className="lk-widget-install__step-text lk-partner__muted">
              Опубликуйте сайт, чтобы изменения появились для посетителей.
            </p>
            <WidgetInstallScreenshotExpandable
              src={widgetInstallTildaPublishPng}
              description="На странице со списком страниц сайта в Tilda нажмите «Опубликовать все страницы»"
              onOpen={setScreenshotLightbox}
            />
          </div>
          ) : null}

          {howToStepIndex === 6 ? (
          <div className="lk-widget-install__step-block lk-widget-install__step-block_last">
            <h3 className="lk-widget-install__step-title" data-testid="project-site-connect-step-verify-title">
              Шаг 7. Проверьте подключение
            </h3>
            <p className="lk-widget-install__step-text lk-partner__muted">
              Вернитесь сюда и нажмите «Проверить подключение». Мы автоматически проверим, что код установлен и виджет работает.
            </p>
            <div
              className="lk-widget-install__step-verify-actions"
              data-testid="site-connection-check-card"
              data-verify-active={verifyLoading ? "true" : "false"}
              data-connection-check-tone={connectionCheckView.tone}
            >
              <WidgetInstallVerifyStatusMeta
                verificationStatus={data?.verification_status}
                lastVerificationAt={data?.last_verification_at}
                lastWidgetSeenAt={data?.last_widget_seen_at}
                lastWidgetSeenOrigin={data?.last_widget_seen_origin}
                verifyLoading={verifyLoading}
              />
              <div
                className={`lk-widget-install__connection-check-status lk-widget-install__connection-check-status_${connectionCheckView.tone}`}
                role="status"
                aria-live="polite"
              >
                <div key={connectionCheckView.tone} className="lk-widget-install__connection-check-status-inner">
                  <strong className="lk-widget-install__connection-check-title">{connectionCheckView.title}</strong>
                  <p className="lk-widget-install__connection-check-copy">{connectionCheckView.message}</p>
                  {connectionCheckView.steps?.length ? (
                    <ul className="lk-widget-install__verify-poll-steps" data-testid="widget-verify-poll-steps">
                      {connectionCheckView.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
              {showVerifyOtherPageLink ? (
                <button
                  type="button"
                  className="lk-widget-install__verify-other-page-link"
                  data-testid="widget-verify-open-other-page"
                  onClick={() => setOtherPageVerifyOpen(true)}
                >
                  Проверить другую страницу
                </button>
              ) : null}
              {lastVerifyErr && lastVerifyErr !== connectionCheckView.message ? (
                <p className="lk-widget-install__verify-last-error lk-partner__muted" data-testid="widget-verify-last-error">
                  {lastVerifyErr}
                </p>
              ) : null}
              {saveHint ? <p className="lk-widget-install__hint">{saveHint}</p> : null}
              <div className="lk-widget-install__connection-check-actions">
                <button type="button" className="lk-widget-install__btn" disabled={verifyLoading || refreshBusy} onClick={onVerify}>
                  {verifyPrimaryLabel}
                </button>
              </div>
            </div>
            <WidgetInstallVerifyAdvancedOptions
              open={otherPageVerifyOpen}
              onOpenChange={setOtherPageVerifyOpen}
              verificationUrlInput={verificationUrlInput}
              setVerificationUrlInput={setVerificationUrlInput}
              onVerifyThisPage={onVerifyThisPage}
              verifyLoading={verifyLoading}
              saving={saving}
              compact
            />
          </div>
          ) : null}

          <div className="lk-widget-install__how-to-nav">
            <button
              type="button"
              className="lk-widget-install__how-to-nav-btn"
              onClick={() => setHowToStepIndex((index) => Math.max(0, index - 1))}
              disabled={howToStepIndex === 0}
            >
              Назад
            </button>
            <button
              type="button"
              className="lk-widget-install__how-to-nav-btn lk-widget-install__how-to-nav-btn_primary"
              onClick={() => setHowToStepIndex((index) => Math.min(howToStepsTotal - 1, index + 1))}
              disabled={howToStepIndex === howToStepsTotal - 1}
            >
              Далее
            </button>
          </div>
        </section>
        {screenshotLightbox ? (
          <div
            className="lk-widget-install__lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={screenshotLightbox.alt}
            onClick={() => setScreenshotLightbox(null)}
          >
            <button
              type="button"
              className="lk-widget-install__lightbox-close"
              aria-label="Закрыть"
              onClick={(e) => {
                e.stopPropagation();
                setScreenshotLightbox(null);
              }}
            >
              ×
            </button>
            <img
              src={screenshotLightbox.src}
              alt={screenshotLightbox.alt}
              className="lk-widget-install__lightbox-img"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="lk-dashboard lk-partner lk-widget-install">
      <h1 className="lk-dashboard__title">{shellTitle}</h1>
      {shellSubtitle ? <p className="lk-dashboard__subtitle">{shellSubtitle}</p> : null}

      {diagError ? <div className="lk-widget-install__diag-soft">{diagError}</div> : null}

      <WidgetInstallSnippetCard
        title="Как подключить сайт"
        subtitle={connectSiteIntroRu}
        snippet={data.widget_embed_snippet}
        onCopy={onCopySnippet}
        copyHint={copyHint}
        steps={installSteps}
      />

      <div className="lk-widget-install__grid lk-widget-install__grid_main" style={{ marginTop: 20 }}>
        <section className="lk-widget-install__card">
          <h2 className="lk-partner__section-title">Что подключается</h2>
          <div className="lk-widget-install__field-label">Сайт</div>
          <div className="lk-widget-install__summary-value">{siteName}</div>
          <div className="lk-widget-install__field-label" style={{ marginTop: 12 }}>
            Домен / origin
          </div>
          <div className="lk-widget-install__mono">{primaryOrigin || "Пока не указан"}</div>
          <div className="lk-widget-install__field-label" style={{ marginTop: 12 }}>
            Статус подключения
          </div>
          <p className="lk-widget-install__status-line">
            <span className={`lk-widget-install__status-pill ${statusClass}`}>
              {integrationStatusLabel(diag?.integration_status)}
            </span>
            <span className="lk-partner__muted">
              {lifecycleLabel(lifecycleStatus)}
            </span>
          </p>
          <p className="lk-widget-install__hint" style={{ marginTop: 0 }}>{setupStatusText}</p>
        </section>

        <section className="lk-widget-install__card">
          <h2 className="lk-partner__section-title">Какие данные отправлять</h2>
          <WidgetInstallCaptureFieldsPanel
            introClassName="lk-partner__muted"
            introText="Системные поля передаются всегда. Дополнительные поля можно включить для этого сайта без изменения публичного контракта."
            enabledOptionalFields={enabledOptionalFields}
            setCaptureConfig={setCaptureConfig}
          />
        </section>

        <section className="lk-widget-install__card">
          <h2 className="lk-partner__section-title">Проверка и запуск</h2>
          <WidgetInstallVerifyPrimaryInstructions />
          <WidgetInstallVerifyStatusMeta
            verificationStatus={data?.verification_status}
            lastVerificationAt={data?.last_verification_at}
            lastWidgetSeenAt={data?.last_widget_seen_at}
            lastWidgetSeenOrigin={data?.last_widget_seen_origin}
            verifyLoading={verifyLoading}
          />
          <WidgetInstallVerifyAdvancedOptions
            open={otherPageVerifyOpen}
            onOpenChange={setOtherPageVerifyOpen}
            verificationUrlInput={verificationUrlInput}
            setVerificationUrlInput={setVerificationUrlInput}
            onVerifyThisPage={onVerifyThisPage}
            verifyLoading={verifyLoading}
            saving={saving}
          />
          <p className="lk-partner__muted" style={{ marginBottom: 10, marginTop: 12 }}>
            Сохраните настройки данных при необходимости, затем активируйте сайт.
          </p>
          <div className="lk-widget-install__readiness">
            {readinessItems.map((item) => (
              <div key={item.label} className="lk-widget-install__readiness-row">
                <span className="lk-widget-install__readiness-k">{item.label}</span>
                <span className={item.ok ? "lk-widget-install__on" : "lk-widget-install__off"}>{item.value}</span>
              </div>
            ))}
          </div>
          <div className="lk-partner__link-row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="lk-widget-install__btn"
              disabled={verifyLoading || refreshBusy}
              onClick={onVerify}
            >
              {verifyPrimaryLabel}
            </button>
            <button
              type="button"
              className="lk-widget-install__btn lk-widget-install__btn_secondary"
              disabled={activateLoading || refreshBusy}
              onClick={onActivate}
            >
              {activateLoading ? "Активируем…" : inProjectShell ? "Активировать проект" : "Активировать сайт"}
            </button>
          </div>
          {saveHint ? <p className="lk-widget-install__hint">{saveHint}</p> : null}
          <div
            className={`lk-widget-install__connection-check-status lk-widget-install__connection-check-status_${connectionCheckView.tone}`}
            role="status"
            aria-live="polite"
            data-testid="widget-main-connection-check"
            data-verify-active={verifyLoading ? "true" : "false"}
            data-connection-check-tone={connectionCheckView.tone}
            style={{ marginTop: 12 }}
          >
            <div key={connectionCheckView.tone} className="lk-widget-install__connection-check-status-inner">
              <strong className="lk-widget-install__connection-check-title">{connectionCheckView.title}</strong>
              <p className="lk-widget-install__connection-check-copy">{connectionCheckView.message}</p>
              {connectionCheckView.steps?.length ? (
                <ul className="lk-widget-install__verify-poll-steps" data-testid="widget-verify-poll-steps">
                  {connectionCheckView.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
          {showVerifyOtherPageLink ? (
            <button
              type="button"
              className="lk-widget-install__verify-other-page-link"
              data-testid="widget-verify-open-other-page"
              onClick={() => setOtherPageVerifyOpen(true)}
            >
              Проверить другую страницу
            </button>
          ) : null}
          {lastVerifyErr && lastVerifyErr !== connectionCheckView.message ? (
            <p className="lk-widget-install__verify-last-error lk-partner__muted" data-testid="widget-verify-last-error">
              {lastVerifyErr}
            </p>
          ) : null}
          <div className="lk-widget-install__message-block" style={{ marginTop: 12 }}>
            {integrationWarnings.length ? (
              <>
                <div className="lk-widget-install__field-label">Что стоит проверить перед запуском</div>
                <ul className="lk-widget-install__warn-list" style={{ marginBottom: 0 }}>
                  {integrationWarnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="lk-partner__muted" style={{ margin: 0 }}>
                Подключение выглядит готовым: можно отправить тестовую заявку и активировать сайт.
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="lk-widget-install__card" style={{ marginTop: 20 }}>
        <details className="lk-widget-install__details">
          <summary className="lk-widget-install__details-summary">Расширенные настройки</summary>
          <div className="lk-widget-install__details-body">
            <p className="lk-partner__muted" style={{ marginBottom: 8 }}>
              Здесь можно скорректировать платформу, домен сайта и служебные параметры без изменения
              публичных контрактов.
            </p>
            <div className="lk-widget-install__field-label">Платформа сайта</div>
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
              Домен / origin сайта
            </div>
            <input
              className="lk-widget-install__select"
              value={originInput}
              onChange={(e) => setOriginInput(e.target.value)}
              aria-label="origin"
              placeholder="https://mysite.tilda.ws"
            />

            <div className="lk-widget-install__row" style={{ marginTop: 14 }}>
              <label className="lk-widget-install__field-label" style={{ marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={widgetEnabled}
                  onChange={(e) => setWidgetEnabled(e.target.checked)}
                />{" "}
                Включить сбор заявок на сайте
              </label>
            </div>

            <details className="lk-widget-install__details lk-widget-install__details_nested">
              <summary className="lk-widget-install__details-summary">Raw config_json</summary>
              <div className="lk-widget-install__details-body">
                <p className="lk-partner__muted" style={{ marginBottom: 8 }}>
                  Оставили редактор как advanced-опцию, чтобы не ломать существующую настройку runtime.
                </p>
                <textarea
                  className="lk-widget-install__textarea"
                  value={configText}
                  onChange={(e) => setConfigText(e.target.value)}
                  spellCheck={false}
                  aria-label="config_json"
                  style={{ minHeight: 160 }}
                />
              </div>
            </details>

            <details className="lk-widget-install__details lk-widget-install__details_nested">
              <summary className="lk-widget-install__details-summary">Идентификаторы и служебные адреса</summary>
              <div className="lk-widget-install__details-body">
                <div className="lk-widget-install__field-label">Статус записи</div>
                <div className="lk-widget-install__mono">{data.status}</div>
                <div className="lk-widget-install__field-label" style={{ marginTop: 12 }}>
                  public_id
                </div>
                <div className="lk-widget-install__mono">{data.public_id}</div>
                <div className="lk-widget-install__field-label" style={{ marginTop: 12 }}>
                  publishable_key
                </div>
                <div className="lk-widget-install__mono">{data.publishable_key}</div>
                <div className="lk-widget-install__field-label" style={{ marginTop: 12 }}>
                  widget_script_base
                </div>
                <div className="lk-widget-install__mono">{data.widget_script_base}</div>
                <div className="lk-widget-install__field-label" style={{ marginTop: 12 }}>
                  public_api_base
                </div>
                <div className="lk-widget-install__mono">{data.public_api_base}</div>
              </div>
            </details>

            <div className="lk-widget-install__actions">
              <button type="button" className="lk-widget-install__btn" disabled={saving} onClick={onSave}>
                {saving ? "Сохраняем…" : "Сохранить настройки"}
              </button>
              <button
                type="button"
                className="lk-widget-install__btn lk-widget-install__btn_secondary"
                disabled={refreshBusy || saving}
                onClick={() => void onRefreshStatus()}
              >
                {refreshBusy ? "Обновляем…" : "Обновить данные"}
              </button>
            </div>
          </div>
        </details>
      </section>

      {diag ? (
        <section className="lk-widget-install__card" style={{ marginTop: 20 }}>
          <details className="lk-widget-install__details">
            <summary className="lk-widget-install__details-summary">Техническая диагностика</summary>
            <div className="lk-widget-install__details-body">
              <div className="lk-widget-install__diag-grid">
                <section className="lk-widget-install__card">
                  <h2 className="lk-partner__section-title">Состояние интеграции</h2>
                  <p className="lk-widget-install__status-line">
                    <span className={`lk-widget-install__status-pill ${statusClass}`}>
                      {integrationStatusLabel(diag.integration_status)}
                    </span>
                    <span className="lk-partner__muted">{diag.site_public_id}</span>
                  </p>
                  <p className="lk-partner__muted" style={{ marginTop: 8 }}>
                    Статус сайта: <strong>{lifecycleLabel(lifecycleStatus)}</strong>
                  </p>
                  <div className="lk-widget-install__readiness" style={{ marginTop: 12 }}>
                    <div className="lk-widget-install__readiness-row">
                      <span className="lk-widget-install__readiness-k">Готовность к установке</span>
                      <span className="lk-widget-install__readiness-v">
                        {diag.embed_readiness?.origins_configured &&
                        diag.embed_readiness?.publishable_key_present &&
                        diag.embed_readiness?.public_id_present
                          ? "Да"
                          : "Нет"}
                      </span>
                    </div>
                    <div className="lk-widget-install__readiness-row">
                      <span className="lk-widget-install__readiness-k">Домен указан</span>
                      <span className="lk-widget-install__readiness-v">
                        {diag.embed_readiness?.origins_configured ? "Да" : "Нет"}
                      </span>
                    </div>
                    <div className="lk-widget-install__readiness-row">
                      <span className="lk-widget-install__readiness-k">Сбор заявок</span>
                      <span className="lk-widget-install__readiness-v">
                        {diag.widget_enabled ? "Включён" : "Выключен"}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="lk-widget-install__card">
                  <h2 className="lk-partner__section-title">Участники по CTA</h2>
                  <p className="lk-partner__muted" style={{ marginBottom: 8 }}>
                    {inProjectShell
                      ? "Аккаунты, присоединившиеся к проекту через виджет."
                      : "Аккаунты, присоединившиеся к этому сайту через виджет."}
                  </p>
                  <p className="lk-widget-install__status-line" style={{ marginTop: 0 }}>
                    <span className="lk-widget-install__readiness-k">Всего</span>
                    <strong>{diag.site_membership?.count ?? "—"}</strong>
                  </p>
                  {(diag.site_membership?.recent_joins || []).length ? (
                    <ul className="lk-widget-install__kv" style={{ marginTop: 8 }}>
                      {diag.site_membership.recent_joins.map((row, i) => (
                        <li key={`${row.joined_at ?? ""}-${i}`}>
                          {(row.joined_at || "").replace("T", " ").slice(0, 19) || "—"} · {row.identity_masked || "—"}
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
                  <h2 className="lk-partner__section-title">Runtime и platform preset</h2>
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
                          className={wr.report_observed_outcome ? "lk-widget-install__on" : "lk-widget-install__off"}
                        >
                          {wr.report_observed_outcome ? "вкл" : "выкл"}
                        </span>
                      </li>
                      <li>amount_selector: {wr.amount_selector || "—"}</li>
                      <li>product_name_selector: {wr.product_name_selector || "—"}</li>
                      <li>currency: {wr.currency || "—"}</li>
                    </ul>
                  ) : null}
                </section>
              </div>
            </div>
          </details>
        </section>
      ) : null}

      {diag ? (
        <section className="lk-widget-install__card" style={{ marginTop: 20 }}>
          <details className="lk-widget-install__details">
            <summary className="lk-widget-install__details-summary">Технические метрики</summary>
            <div className="lk-widget-install__details-body">
              <div className="lk-widget-install__diag-grid">
                <section className="lk-widget-install__card lk-widget-install__card_wide">
                  <h2 className="lk-partner__section-title">Наблюдаемые итоги</h2>
                  <div className="lk-widget-install__windows">
                    <div>
                      <div className="lk-widget-install__windows-title">24 часа</div>
                      <table className="lk-widget-install__mini-table">
                        <tbody>
                          <tr>
                            <td>submit</td>
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
                            <td>outcome unset</td>
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
                            <td>submit</td>
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
                            <td>outcome unset</td>
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
                      Источник: <code>{iq.source}</code>
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
                              <td>rejected</td>
                              <td>{iq24?.rejected_count ?? 0}</td>
                            </tr>
                            <tr>
                              <td>Доля дублей</td>
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
            </div>
          </details>
        </section>
      ) : null}

      {diag && (
        <section className="lk-widget-install__card" style={{ marginTop: 20 }}>
          <details className="lk-widget-install__details">
            <summary className="lk-widget-install__details-summary">Последние лиды</summary>
            <div className="lk-widget-install__details-body">
              {!diag.has_recent_leads ? (
                <p className="lk-partner__muted">Пока нет сохранённых событий. Отправьте тестовую заявку с сайта.</p>
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
            </div>
          </details>
        </section>
      )}
    </div>
  );
}

export default WidgetInstallScreen;
