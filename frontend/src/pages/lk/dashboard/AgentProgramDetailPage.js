import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { LUMOREF_SITE_STATUS_CHANGED_EVENT } from "../lkProgramListsSync";
import { SiteFaviconAvatar } from "../owner-programs/SiteFaviconAvatar";
import { programLifecycleStatus } from "./programsCatalogModel";
import "../owner-programs/owner-programs.css";
import "./dashboard.css";

function formatJoinedAt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function programSiteLabel(program) {
  const originLabel = typeof program?.site_origin_label === "string" ? program.site_origin_label.trim() : "";
  if (originLabel) return originLabel;
  const displayLabel = typeof program?.site_display_label === "string" ? program.site_display_label.trim() : "";
  if (displayLabel) return displayLabel;
  return `Программа · ${program?.site_public_id || "—"}`;
}

function programSiteName(program) {
  const displayLabel = typeof program?.site_display_label === "string" ? program.site_display_label.trim() : "";
  return displayLabel || programSiteLabel(program);
}

function programSiteHref(program) {
  const label = programSiteLabel(program);
  if (!label || label.startsWith("Программа ·")) return "";
  try {
    const url = new URL(label.includes("://") ? label : `https://${label}`);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return "";
  }
  return "";
}

/** Ссылка для распространения: тот же origin, что у сайта в шапке карточки, + ?ref= */
function memberReferralShareUrl(program) {
  const ref = typeof program?.ref_code === "string" ? program.ref_code.trim() : "";
  if (!ref) {
    return typeof program?.referral_link === "string" ? program.referral_link.trim() : "";
  }
  const cardHref = programSiteHref(program);
  if (cardHref) {
    try {
      const u = new URL(cardHref);
      return `${u.origin}/?ref=${encodeURIComponent(ref)}`;
    } catch {
      /* fall through */
    }
  }
  return typeof program?.referral_link === "string" ? program.referral_link.trim() : "";
}

function programDescription(program) {
  const value = typeof program?.site_description === "string" ? program.site_description.trim() : "";
  return value || "Описание программы пока не добавлено.";
}

function formatCommissionPercent(value) {
  if (value === null || value === undefined || value === "") return "—";
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  return `${numberValue.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

function formatReferralLockDays(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return "—";
  return `${numberValue.toLocaleString("ru-RU")} дн.`;
}

function formatParticipantsCount(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return "—";
  return numberValue.toLocaleString("ru-RU");
}

/** API may send decimal as string or number. */
function formatReferrerMoneyRub(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return String(value);
  return `${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

function parseMoneyNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatOrderDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).replace("T", " ").slice(0, 19);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatOrderStatus(status) {
  if (status === "paid") return "Оплачен";
  if (status === "pending") return "Ожидает";
  if (status === "cancelled" || status === "canceled") return "Отменён";
  return status || "—";
}

const EARNINGS_CHART_VB_W = 640;
const EARNINGS_CHART_VB_H = 306;
const EARNINGS_CHART_PAD = { top: 12, right: 58, bottom: 28, left: 58 };
const CHART_X_MAX_TICKS = 8;

function pickDayTickIndices(n, maxTicks = CHART_X_MAX_TICKS) {
  if (n <= 0) return [];
  if (n === 1) return [0];
  if (n <= maxTicks) return Array.from({ length: n }, (_, i) => i);
  const raw = [];
  for (let k = 0; k < maxTicks; k += 1) {
    raw.push(Math.round((k / (maxTicks - 1)) * (n - 1)));
  }
  return [...new Set([0, n - 1, ...raw])].sort((a, b) => a - b);
}

function formatDayTooltip(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

const PERIODS = [
  { id: "7d", label: "7 дней" },
  { id: "30d", label: "30 дней" },
  { id: "3m", label: "3 месяца" },
  { id: "6m", label: "Полгода" },
  { id: "1y", label: "Год" },
  { id: "all", label: "Всё время" },
];

function startOfUtcDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatDayTick(iso, seriesLen) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  if (seriesLen > 14) {
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  }
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function formatYAxisMoneyTick(value) {
  if (value > 0 && value < 2) {
    return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function linearPathThroughPoints(points) {
  if (!points.length) return "";
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  return d;
}

function buildEarningsChartSeries(recentOrders, commissionTotal, salesTotal, period) {
  const today = startOfUtcDay(new Date());
  const byKey = new Map();
  const ratio = salesTotal > 0 ? commissionTotal / salesTotal : 0;

  const addEmptyDay = (day) => {
    const sd = startOfUtcDay(day);
    const key = sd.toISOString().slice(0, 10);
    if (!byKey.has(key)) {
      byKey.set(key, { date: sd.toISOString(), sales: 0, commission: 0 });
    }
  };

  if (period === "all") {
    let earliestOrderDay = null;
    for (const order of recentOrders) {
      const d = new Date(order?.created_at);
      if (Number.isNaN(d.getTime())) continue;
      const sd = startOfUtcDay(d);
      if (!earliestOrderDay || sd < earliestOrderDay) earliestOrderDay = sd;
    }
    const capStart = new Date(today);
    capStart.setDate(capStart.getDate() - 364);
    const fallbackStart = new Date(today);
    fallbackStart.setDate(fallbackStart.getDate() - 29);
    const rawStart = earliestOrderDay || fallbackStart;
    const start = new Date(Math.max(rawStart.getTime(), capStart.getTime()));
    const cursor = new Date(Math.min(start.getTime(), today.getTime()));
    while (cursor <= today) {
      addEmptyDay(cursor);
      cursor.setDate(cursor.getDate() + 1);
    }
  } else {
    const mapDays = { "7d": 7, "30d": 30, "3m": 90, "6m": 180, "1y": 365 };
    const n = mapDays[period] ?? 7;
    for (let i = n - 1; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      addEmptyDay(d);
    }
  }

  const keys = Array.from(byKey.keys()).sort();
  for (const order of recentOrders) {
    const d = new Date(order?.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = startOfUtcDay(d).toISOString().slice(0, 10);
    const row = byKey.get(key);
    if (!row) continue;
    const amount = parseMoneyNumber(order?.amount);
    row.sales += amount;
    row.commission += amount * ratio;
  }

  return keys.map((k) => byKey.get(k));
}

/** Y-scale и линия только по доходу реферала (комиссии по дням), без суммы продаж на том же масштабе. */
function buildCommissionLineGeometry(series) {
  const values = series.map((row) => row.commission);
  const maxValue = Math.max(...values, 1);
  const y0 = 0;
  const y1 = maxValue;
  const span = y1 - y0 || 1;
  const { top, right, bottom, left } = EARNINGS_CHART_PAD;
  const innerW = EARNINGS_CHART_VB_W - left - right;
  const innerH = EARNINGS_CHART_VB_H - top - bottom;
  const axisY = top + innerH;
  const scaleY = (v) => top + innerH - ((Math.min(y1, Math.max(y0, v)) - y0) / span) * innerH;
  const pointFor = (value, i) => ({
    x: left + (series.length <= 1 ? innerW / 2 : (i / (series.length - 1)) * innerW),
    y: scaleY(value),
  });
  const commissionPoints = series.map((row, i) => pointFor(row.commission, i));
  const yTicks = Array.from({ length: 6 }, (_, i) => {
    const t = i / 5;
    const value = y0 + t * span;
    return { y: scaleY(value), value };
  });
  const clipW = innerW;
  const clipH = axisY - top;
  return {
    axisY,
    innerLeft: left,
    innerRight: EARNINGS_CHART_VB_W - right,
    innerTop: top,
    clipX: left,
    clipY: top,
    clipW,
    clipH,
    commissionPoints,
    commissionPathD: linearPathThroughPoints(commissionPoints),
    yTicks,
  };
}

function programAvatarLetter(label) {
  const value = typeof label === "string" ? label.trim() : "";
  return value.slice(0, 1).toUpperCase() || "P";
}

function AgentProgramEarningsKpiCard({ label, value, subtitle, valueClassName, hint, helpText }) {
  const fullHelpText = [hint, helpText].filter(Boolean).join(". ");
  return (
    <div className="owner-programs__site-dash-kpi lk-dashboard__program-earnings-card">
      {fullHelpText ? (
        <div className="owner-programs__site-dash-kpi-help-anchor">
          <button
            type="button"
            className="owner-programs__site-dash-kpi-help"
            aria-label={`${label}: ${fullHelpText}`}
          >
            ?
          </button>
          <span className="owner-programs__site-dash-kpi-help-tooltip" role="tooltip">
            {fullHelpText}
          </span>
        </div>
      ) : null}
      <span className="owner-programs__site-dash-kpi-label lk-dashboard__program-earnings-label">{label}</span>
      <strong className={`owner-programs__site-dash-kpi-value ${valueClassName}`}>{value}</strong>
      {subtitle ? (
        <span className="owner-programs__site-dash-kpi-hint lk-dashboard__program-earnings-kpi-sub">{subtitle}</span>
      ) : null}
    </div>
  );
}

/**
 * Member-facing detail for one agent program (SiteMembership) by site public_id.
 */
export default function AgentProgramDetailPage() {
  const { sitePublicId } = useParams();
  const location = useLocation();
  const earningsSvgRef = useRef(null);
  const earningsLineWrapRef = useRef(null);
  const periodSelectRef = useRef(null);
  const [period, setPeriod] = useState("7d");
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false);
  const [program, setProgram] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState(null);
  const [copyHint, setCopyHint] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [activeJoinedTab, setActiveJoinedTab] = useState("dashboard");
  const [earningsHover, setEarningsHover] = useState(null);

  const loadProgram = useCallback(
    async ({ cancelled, softRefresh } = {}) => {
      const token = localStorage.getItem("access_token");
      if (!token || !sitePublicId) {
        setProgram(null);
        setLoading(false);
        setErrorKind(!token ? "auth" : "not_found");
        return;
      }
      const soft = Boolean(softRefresh);
      if (!soft) {
        setLoading(true);
        setErrorKind(null);
        setProgram(null);
        setCopyHint("");
        setJoinError("");
      }

      try {
        const res = await fetch(API_ENDPOINTS.programDetail(sitePublicId), {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (res.status === 404) {
          if (cancelled?.()) return;
          setErrorKind("not_found");
          setProgram(null);
          return;
        }
        if (!res.ok) throw new Error("fetch_failed");
        const data = await res.json();
        if (cancelled?.()) return;
        const p = data && data.program;
        if (!p || !p.site_public_id) {
          setErrorKind("not_found");
          setProgram(null);
          return;
        }
        setProgram(p);
        if (soft) setErrorKind(null);
      } catch {
        if (!cancelled?.() && !soft) setErrorKind("network");
      } finally {
        if (!cancelled?.()) setLoading(false);
      }
    },
    [sitePublicId]
  );

  useEffect(() => {
    let isCancelled = false;
    loadProgram({ cancelled: () => isCancelled, softRefresh: false });
    return () => {
      isCancelled = true;
    };
  }, [loadProgram]);

  /** Подтягиваем program_active после действий владельца (виджет вкл/выкл / activate). */
  useEffect(() => {
    if (errorKind === "not_found") return undefined;
    let isCancelled = false;
    const tick = () => {
      void loadProgram({ cancelled: () => isCancelled, softRefresh: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    const onSiteStatusChanged = (event) => {
      const changedSiteId = event?.detail?.site_public_id || "";
      if (!changedSiteId || changedSiteId === sitePublicId) tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", tick);
    window.addEventListener(LUMOREF_SITE_STATUS_CHANGED_EVENT, onSiteStatusChanged);
    return () => {
      isCancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", tick);
      window.removeEventListener(LUMOREF_SITE_STATUS_CHANGED_EVENT, onSiteStatusChanged);
    };
  }, [loadProgram, sitePublicId, errorKind]);

  useEffect(() => {
    if (!periodMenuOpen) return undefined;
    const onDocDown = (e) => {
      if (periodSelectRef.current && !periodSelectRef.current.contains(e.target)) {
        setPeriodMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setPeriodMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [periodMenuOpen]);

  useEffect(() => {
    setEarningsHover(null);
  }, [period]);

  const referralShareUrl = program ? memberReferralShareUrl(program) : "";

  const onCopyReferralLink = async () => {
    if (!referralShareUrl) return;
    try {
      await navigator.clipboard.writeText(referralShareUrl);
      setCopyHint("Скопировано");
      setTimeout(() => setCopyHint(""), 2000);
    } catch {
      setCopyHint("Не удалось скопировать");
    }
  };

  const onJoinProgram = async () => {
    const token = localStorage.getItem("access_token");
    if (!token || !sitePublicId || joining) return;
    setJoining(true);
    setJoinError("");
    try {
      const res = await fetch(API_ENDPOINTS.siteCtaJoin, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ site_public_id: sitePublicId }),
      });
      if (!res.ok) throw new Error("program_join_failed");
      await loadProgram({ softRefresh: true });
    } catch {
      setJoinError("Не удалось присоединиться к программе. Попробуйте позже.");
    } finally {
      setJoining(false);
    }
  };

  const backTo = location.state?.from === "/lk/my-programs" ? "/lk/my-programs" : "/lk/programs";
  const lifecycle = programLifecycleStatus(program);
  const canJoinProgram = lifecycle.tone === "success";
  const joined = Boolean(program?.joined);
  const isOwnProgram = Boolean(program?.is_owner);
  const recentOrders = Array.isArray(program?.recent_orders) ? program.recent_orders : [];
  const referrerCommissionValue = parseMoneyNumber(program?.referrer_commission_total);
  const referrerSalesValue = parseMoneyNumber(program?.referrer_sales_total);
  const periodLabel = PERIODS.find((p) => p.id === period)?.label ?? "7 дней";
  const earningsChartSeries = useMemo(
    () => buildEarningsChartSeries(recentOrders, referrerCommissionValue, referrerSalesValue, period),
    [recentOrders, referrerCommissionValue, referrerSalesValue, period]
  );
  const earningsChartGeom = useMemo(() => buildCommissionLineGeometry(earningsChartSeries), [earningsChartSeries]);

  const earningsClipId = useMemo(
    () => `agent-earnings-clip-${String(sitePublicId || "").replace(/[^a-zA-Z0-9_-]/g, "") || "chart"}`,
    [sitePublicId]
  );

  const earningsXTicks = useMemo(() => {
    const n = earningsChartSeries.length;
    if (n <= 0) return [];
    const maxXTicks = n > 18 ? 6 : CHART_X_MAX_TICKS;
    const idxs = pickDayTickIndices(n, maxXTicks);
    return idxs.map((idx) => ({
      idx,
      label: formatDayTick(earningsChartSeries[idx]?.date, n),
    }));
  }, [earningsChartSeries]);

  const xAt = useCallback(
    (idx) => {
      const n = earningsChartSeries.length;
      const { innerLeft, innerRight } = earningsChartGeom;
      const innerW = innerRight - innerLeft;
      if (n <= 1) return innerLeft + innerW / 2;
      return innerLeft + (idx / (n - 1)) * innerW;
    },
    [earningsChartSeries.length, earningsChartGeom.innerLeft, earningsChartGeom.innerRight]
  );

  const earningsHoverIdx = earningsHover?.idx ?? null;
  const earningsHoverX =
    earningsHoverIdx != null ? earningsChartGeom.commissionPoints[earningsHoverIdx]?.x : null;
  const earningsHoverCommissionPoint =
    earningsHoverIdx != null ? earningsChartGeom.commissionPoints[earningsHoverIdx] : null;

  const onEarningsSvgPointer = useCallback(
    (event) => {
      const svg = earningsSvgRef.current;
      if (!svg || !earningsChartGeom?.commissionPoints?.length) return;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const pt = svg.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      const local = pt.matrixTransform(ctm.inverse());
      let best = 0;
      let bestDistance = Infinity;
      earningsChartGeom.commissionPoints.forEach((point, idx) => {
        const distance = Math.abs(point.x - local.x);
        if (distance < bestDistance) {
          best = idx;
          bestDistance = distance;
        }
      });
      const wrap = earningsLineWrapRef.current;
      if (!wrap) {
        setEarningsHover({ idx: best, left: 0, top: 0, placeBelow: false });
        return;
      }
      const rect = wrap.getBoundingClientRect();
      const relX = event.clientX - rect.left;
      const relY = event.clientY - rect.top;
      setEarningsHover({
        idx: best,
        left: Math.min(Math.max(relX, 48), rect.width - 48),
        top: Math.min(Math.max(relY, 24), rect.height - 24),
        placeBelow: relY < rect.height * 0.38,
      });
    },
    [earningsChartGeom]
  );

  const clearEarningsHover = useCallback(() => {
    setEarningsHover(null);
  }, []);

  return (
    <div
      className={`lk-dashboard lk-dashboard__program-detail${joined ? " lk-dashboard__program-detail_joined lk-partner" : ""}`}
      data-testid="agent-program-detail"
    >
      <div className="page__returnButton lk-dashboard__program-detail-back">
        <Link to={backTo} className="tw-link link_primary link_s">
          <svg xmlns="http://www.w3.org/2000/svg" width="7" height="13" fill="none" viewBox="0 0 7 13" aria-hidden="true">
            <path
              fill="currentColor"
              d="M1 6.99a1 1 0 0 1 .23-.64l4-5a1 1 0 0 1 1.54 1.29L3.29 6.99l3.32 4.35a1 1 0 0 1-.15 1.4A1 1 0 0 1 5 12.62l-3.83-5A1 1 0 0 1 1 7Z"
            />
          </svg>
          Назад
        </Link>
      </div>

      {loading && <p className="lk-dashboard__programs-muted">Загрузка…</p>}

      {!loading && errorKind === "auth" && (
        <p className="lk-dashboard__programs-muted">Войдите, чтобы открыть карточку программы.</p>
      )}

      {!loading && errorKind === "not_found" && (
        <p className="lk-dashboard__programs-muted" data-testid="agent-program-not-found">
          Программа не найдена или у вас нет к ней доступа.
        </p>
      )}

      {!loading && errorKind === "network" && (
        <p className="lk-dashboard__programs-muted" data-testid="agent-program-error">
          Не удалось загрузить данные программы. Обновите страницу или попробуйте позже.
        </p>
      )}

      {!loading && program && (
        <>
          <section className="lk-dashboard__program-card" data-testid="agent-program-card">
            <div className="lk-dashboard__program-card-head">
              <div className="lk-dashboard__program-card-avatar" aria-hidden="true">
                <SiteFaviconAvatar
                  manualUrl={
                    typeof program.site_avatar_data_url === "string" ? program.site_avatar_data_url.trim() : ""
                  }
                  siteLike={program}
                  letter={programAvatarLetter(programSiteLabel(program))}
                  imgClassName="lk-dashboard__program-card-avatar-img"
                  useExternalFavicon={false}
                />
              </div>
              <div className="lk-dashboard__program-card-copy">
                <h1 className="lk-dashboard__program-card-title" data-testid="agent-program-title">
                  {programSiteName(program)}
                </h1>
                {programSiteHref(program) ? (
                  <a
                    className="lk-dashboard__program-card-name"
                    href={programSiteHref(program)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {programSiteLabel(program)}
                  </a>
                ) : (
                  <p className="lk-dashboard__program-card-name">{programSiteLabel(program)}</p>
                )}
              </div>
            </div>

            <div className="lk-dashboard__program-card-description">
              <span>Описание</span>
              <p>{programDescription(program)}</p>
            </div>

            {program.joined ? (
              <nav
                className="owner-programs__tabs lk-dashboard__program-detail-shell-tabs"
                aria-label="Дашборд программы"
                role="tablist"
                data-testid="agent-program-shell-tabs"
              >
                <button
                  type="button"
                  className={`owner-programs__tab${activeJoinedTab === "dashboard" ? " owner-programs__tab_active" : ""}`}
                  role="tab"
                  aria-selected={activeJoinedTab === "dashboard" ? "true" : "false"}
                  onClick={() => setActiveJoinedTab("dashboard")}
                >
                  Дашборд
                </button>
                <button
                  type="button"
                  className={`owner-programs__tab${activeJoinedTab === "orders" ? " owner-programs__tab_active" : ""}`}
                  role="tab"
                  aria-selected={activeJoinedTab === "orders" ? "true" : "false"}
                  onClick={() => setActiveJoinedTab("orders")}
                >
                  История заказов
                </button>
              </nav>
            ) : null}

            {program.joined && activeJoinedTab === "dashboard" ? (
              <>
                <div className="owner-programs__site-dash-stat-toolbar lk-dashboard__program-stat-toolbar">
                  <div className="owner-programs__site-dash-charts-header">
                    <h2 className="owner-programs__site-dash-charts-h2">
                      <span className="owner-programs__site-dash-charts-h2-prefix">Статистика за</span>{" "}
                      <span className="owner-programs__site-dash-stat-select-wrap" ref={periodSelectRef}>
                        <input type="hidden" name="agent_program_dash_period" value={period} aria-hidden />
                        <button
                          type="button"
                          className="owner-programs__site-dash-stat-select-trigger"
                          data-test-id="stat-period-select"
                          aria-haspopup="listbox"
                          aria-expanded={periodMenuOpen}
                          aria-controls="agent-program-stat-period-listbox"
                          id="agent-program-stat-period-trigger"
                          onClick={() => setPeriodMenuOpen((o) => !o)}
                        >
                          <span className="owner-programs__site-dash-stat-select-value">{periodLabel}</span>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            fill="none"
                            viewBox="0 0 24 24"
                            className={`owner-programs__site-dash-stat-select-arrow${periodMenuOpen ? " owner-programs__site-dash-stat-select-arrow_open" : ""}`}
                            aria-hidden
                          >
                            <path
                              fill="currentColor"
                              d="M12 16a1 1 0 0 1-.64-.23l-5-4a1 1 0 0 1 1.28-1.54L12 13.71l4.36-3.32a1 1 0 0 1 1.41.15 1 1 0 0 1-.14 1.46l-5 3.83A1 1 0 0 1 12 16Z"
                            />
                          </svg>
                        </button>
                        {periodMenuOpen ? (
                          <ul
                            className="owner-programs__site-dash-stat-select-list"
                            id="agent-program-stat-period-listbox"
                            role="listbox"
                            aria-labelledby="agent-program-stat-period-trigger"
                          >
                            {PERIODS.map((p) => (
                              <li key={p.id} role="presentation">
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={period === p.id}
                                  className={`owner-programs__site-dash-stat-select-option${period === p.id ? " owner-programs__site-dash-stat-select-option_active" : ""}`}
                                  onClick={() => {
                                    setPeriod(p.id);
                                    setPeriodMenuOpen(false);
                                  }}
                                >
                                  {p.label}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </span>
                    </h2>
                  </div>
                </div>
                <div className="owner-programs__site-dash-analytics-row lk-dashboard__program-earnings-layout">
                  <article className="owner-programs__site-dash-chart-block" aria-labelledby="agent-program-earnings-chart-title">
                  <div
                    className="owner-programs__site-dash-chart-plate owner-programs__site-dash-surface lk-dashboard__program-earnings-chart"
                    data-testid="agent-program-earnings-chart"
                    style={{ backgroundColor: "#242F3D" }}
                  >
                    <header className="owner-programs__site-dash-chart-plate-head">
                      <div className="owner-programs__site-dash-chart-plate-titles">
                        <h2 id="agent-program-earnings-chart-title" className="owner-programs__site-dash-chart-plate-title">
                          Доход за период
                        </h2>
                        <p className="owner-programs__site-dash-chart-plate-sub">
                          Показывает, сколько вы заработали по своей ссылке
                        </p>
                      </div>
                    </header>
                    <div className="owner-programs__site-dash-chart-plate-body owner-programs__site-dash-chart-plate-body_line lk-dashboard__program-earnings-line">
                      <div
                        ref={earningsLineWrapRef}
                        className="owner-programs__site-dash-line-wrap"
                        style={{ aspectRatio: `${EARNINGS_CHART_VB_W} / ${EARNINGS_CHART_VB_H}` }}
                        onPointerLeave={clearEarningsHover}
                        onBlur={clearEarningsHover}
                      >
                        <svg
                          ref={earningsSvgRef}
                          className="owner-programs__site-dash-line-svg"
                          width="100%"
                          height="100%"
                          viewBox={`0 0 ${EARNINGS_CHART_VB_W} ${EARNINGS_CHART_VB_H}`}
                          preserveAspectRatio="xMinYMid meet"
                          role="img"
                          aria-label="График вашего дохода по дням"
                          onPointerMove={onEarningsSvgPointer}
                          onPointerDown={onEarningsSvgPointer}
                        >
                          <defs>
                            <clipPath id={earningsClipId}>
                              <rect
                                x={earningsChartGeom.clipX}
                                y={earningsChartGeom.clipY}
                                width={earningsChartGeom.clipW}
                                height={earningsChartGeom.clipH}
                              />
                            </clipPath>
                          </defs>
                          {earningsXTicks.map((t, vi) => (
                            <line
                              key={`vx-${t.idx}-${vi}`}
                              x1={xAt(t.idx)}
                              y1={earningsChartGeom.innerTop}
                              x2={xAt(t.idx)}
                              y2={earningsChartGeom.axisY}
                              className="owner-programs__site-dash-svg-grid owner-programs__site-dash-svg-grid_vert"
                            />
                          ))}
                          {earningsChartGeom.yTicks.map((row, i) => (
                            <line
                              key={`hy-${i}`}
                              x1={earningsChartGeom.innerLeft}
                              y1={row.y}
                              x2={earningsChartGeom.innerRight}
                              y2={row.y}
                              className="owner-programs__site-dash-svg-grid"
                            />
                          ))}
                          <g clipPath={`url(#${earningsClipId})`}>
                            <path
                              d={earningsChartGeom.commissionPathD}
                              className="owner-programs__site-dash-svg-line owner-programs__site-dash-svg-line_main lk-dashboard__program-earnings-chart-line_commission"
                              fill="none"
                            />
                          </g>
                          <line
                            x1={earningsChartGeom.innerLeft}
                            y1={earningsChartGeom.axisY}
                            x2={earningsChartGeom.innerRight}
                            y2={earningsChartGeom.axisY}
                            className="owner-programs__site-dash-svg-x-axis"
                            aria-hidden
                          />
                          {earningsHoverX != null && earningsHoverCommissionPoint ? (
                            <g
                              className="owner-programs__site-dash-svg-hover"
                              clipPath={`url(#${earningsClipId})`}
                              aria-hidden
                            >
                              <line
                                x1={earningsHoverX}
                                y1={earningsChartGeom.innerTop}
                                x2={earningsHoverX}
                                y2={earningsChartGeom.axisY}
                                className="owner-programs__site-dash-svg-hover-line"
                              />
                              <circle
                                cx={earningsHoverCommissionPoint.x}
                                cy={earningsHoverCommissionPoint.y}
                                r="5"
                                className="owner-programs__site-dash-svg-hover-dot"
                              />
                            </g>
                          ) : null}
                          <g className="owner-programs__site-dash-svg-ylabels owner-programs__site-dash-svg-axis-ticks" aria-hidden>
                            {earningsChartGeom.yTicks.map((row, i) => (
                              <text key={`yl-${i}`} x={0} y={row.y} textAnchor="start" dominantBaseline="middle">
                                {formatYAxisMoneyTick(row.value)}
                              </text>
                            ))}
                          </g>
                          <g className="owner-programs__site-dash-svg-xlabels owner-programs__site-dash-svg-axis-ticks" aria-hidden>
                            {earningsXTicks.map((t, i) => (
                              <text
                                key={`${t.idx}-${i}`}
                                x={xAt(t.idx)}
                                y={EARNINGS_CHART_VB_H - 6}
                                textAnchor={i === 0 ? "start" : i === earningsXTicks.length - 1 ? "end" : "middle"}
                                dominantBaseline="auto"
                              >
                                {t.label}
                              </text>
                            ))}
                          </g>
                        </svg>
                        {earningsHover != null && earningsHoverIdx != null && earningsChartSeries[earningsHoverIdx] ? (
                          <div
                            className={`owner-programs__site-dash-tooltip lk-dashboard__program-earnings-tooltip${earningsHover.placeBelow ? " owner-programs__site-dash-tooltip_below" : ""}`}
                            style={{ left: `${earningsHover.left}px`, top: `${earningsHover.top}px` }}
                            role="status"
                          >
                            <div className="owner-programs__site-dash-tooltip-date">
                              {formatDayTooltip(earningsChartSeries[earningsHoverIdx].date)}
                            </div>
                            <div className="owner-programs__site-dash-tooltip-metric">Ваш доход</div>
                            <div className="owner-programs__site-dash-tooltip-value">
                              {formatReferrerMoneyRub(earningsChartSeries[earningsHoverIdx].commission)}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="lk-dashboard__program-earnings-line-legend">
                        <span className="lk-dashboard__program-earnings-line-legend-item">
                          <i className="lk-dashboard__program-earnings-line-legend-mark lk-dashboard__program-earnings-line-legend-mark_commission" aria-hidden="true" />
                          Ваш доход {formatReferrerMoneyRub(program.referrer_commission_total)}
                        </span>
                      </div>
                    </div>
                  </div>
                  </article>
                  <div className="owner-programs__site-dash-row-kpis lk-dashboard__program-earnings" data-testid="agent-program-referrer-money" aria-label="Доходы по программе">
                    <AgentProgramEarningsKpiCard
                      label="Ваш доход"
                      subtitle="Начислено за оплаченные заказы"
                      value={formatReferrerMoneyRub(program.referrer_commission_total)}
                      valueClassName="lk-dashboard__program-earnings-commission"
                      helpText="Ваше вознаграждение за оплаченные заказы клиентов, пришедших по вашей ссылке."
                    />
                    <AgentProgramEarningsKpiCard
                      label="Продажи по вашей ссылке"
                      subtitle="Сумма заказов клиентов, которых вы привели"
                      value={formatReferrerMoneyRub(program.referrer_sales_total)}
                      valueClassName="lk-dashboard__program-earnings-sales-total"
                      helpText="Общая сумма заказов клиентов, которых вы привели по реферальной ссылке."
                    />
                  </div>
                </div>
              </>
            ) : null}

            {program.joined && activeJoinedTab === "orders" ? (
              <section className="owner-programs__history lk-dashboard__program-orders" data-testid="agent-program-orders-history">
                <h2 className="owner-programs__history-title">История заказов</h2>
                <div className="owner-programs__history-tableWrap">
                  <div className="owner-programs__histTable owner-programs__histTable_showHeaderMobile lk-dashboard__program-orders-histTable">
                    <div className="owner-programs__histRow owner-programs__histRow_head owner-programs__histRow_head_filters">
                      <div className="owner-programs__histCell owner-programs__histCell_date owner-programs__histCell_headerCell">
                        <span className="owner-programs__histText owner-programs__histText_s owner-programs__histText_grey owner-programs__histText_alignLeft">
                          Дата
                        </span>
                      </div>
                      <div className="owner-programs__histCell owner-programs__histCell_event owner-programs__histCell_headerCell">
                        <span className="owner-programs__histText owner-programs__histText_s owner-programs__histText_grey owner-programs__histText_alignLeft">
                          Заказ
                        </span>
                      </div>
                      <div className="owner-programs__histCell owner-programs__histCell_user owner-programs__histCell_headerCell">
                        <span className="owner-programs__histText owner-programs__histText_s owner-programs__histText_grey owner-programs__histText_alignLeft">
                          Статус
                        </span>
                      </div>
                    </div>

                    {recentOrders.length === 0 ? (
                      <div className="owner-programs__histRow owner-programs__histRow_body">
                        <div className="owner-programs__histCell owner-programs__histCell_full">
                          <p className="owner-programs__histText owner-programs__histText_muted">Пока нет заказов по вашей ссылке.</p>
                        </div>
                      </div>
                    ) : (
                      recentOrders.map((row) => (
                        <div key={row.id} className="owner-programs__histBlock">
                          <div className="owner-programs__histRow owner-programs__histRow_body">
                            <div className="owner-programs__histCell owner-programs__histCell_date">
                              <p className="owner-programs__histText owner-programs__histText_date">{formatOrderDate(row.created_at)}</p>
                            </div>
                            <div className="owner-programs__histCell owner-programs__histCell_event">
                              <div className="owner-programs__histEventRow">
                                <p className="owner-programs__histText owner-programs__histText_body">
                                  Продажа {formatReferrerMoneyRub(row.amount)}
                                  {row.currency ? ` · ${row.currency}` : ""}
                                </p>
                              </div>
                            </div>
                            <div className="owner-programs__histCell owner-programs__histCell_user">
                              <p className="owner-programs__histText owner-programs__histText_body">{formatOrderStatus(row.status)}</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            ) : null}

            {activeJoinedTab !== "orders" ? (
              <div className="lk-dashboard__program-metrics">
                <div className="lk-dashboard__program-metric">
                  <span>Вознаграждение</span>
                  <strong>{formatCommissionPercent(program.commission_percent)}</strong>
                </div>
                <div className="lk-dashboard__program-metric">
                  <span>Срок закрепления</span>
                  <strong>{formatReferralLockDays(program.referral_lock_days)}</strong>
                </div>
                <div className="lk-dashboard__program-metric">
                  <span>Количество участников</span>
                  <strong>{formatParticipantsCount(program.participants_count)}</strong>
                </div>
                <div className="lk-dashboard__program-metric">
                  <span>Статус программы</span>
                  <strong>{lifecycle.label}</strong>
                </div>
              </div>
            ) : null}

            {lifecycle.tone !== "success" && !program.joined ? (
              <p className="lk-dashboard__program-card-joined" role="status">
                {lifecycle.description}
              </p>
            ) : null}

            {activeJoinedTab === "orders" ? null : program.joined ? (
              <div className="lk-dashboard__program-member" data-testid="agent-program-joined-state">
                <p className="lk-dashboard__program-card-joined">
                  Вы участвуете в программе
                  <br />
                  Дата подключения: {formatJoinedAt(program.joined_at)}
                </p>
                {program.ref_code ? (
                  <p className="lk-dashboard__program-card-joined">Реферальный код: {program.ref_code}</p>
                ) : null}
                {referralShareUrl ? (
                  <div className="lk-dashboard__program-referral-link">
                    <input
                      className="lk-dashboard__program-referral-input"
                      readOnly
                      value={referralShareUrl}
                      aria-label="Реферальная ссылка"
                    />
                    <button type="button" className="lk-dashboard__program-copy-btn" onClick={onCopyReferralLink}>
                      Скопировать ссылку
                    </button>
                  </div>
                ) : null}
                {copyHint ? <p className="lk-dashboard__program-card-joined">{copyHint}</p> : null}
              </div>
            ) : isOwnProgram ? (
              <div
                className="lk-dashboard__my-programs-catalog-banner lk-dashboard__programs-catalog-hero lk-dashboard__program-owner-notice"
                role="status"
                data-testid="agent-program-owner-notice"
              >
                <div className="lk-dashboard__my-programs-catalog-banner-inner">
                  <div className="lk-dashboard__my-programs-catalog-banner-copy">
                    <p className="lk-dashboard__my-programs-catalog-banner-title">Это ваша программа</p>
                    <p className="lk-dashboard__my-programs-catalog-banner-sub">
                      Вы не можете участвовать в собственной реферальной программе как партнёр. Для проверки заявок и продаж используйте кабинет владельца сайта.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="lk-dashboard__program-member" data-testid="agent-program-unjoined-state">
                <button
                  type="button"
                  className="owner-programs__projects-create-btn"
                  onClick={onJoinProgram}
                  disabled={joining || !canJoinProgram}
                  data-testid="agent-program-join-btn"
                >
                  {joining ? "Вступаем…" : canJoinProgram ? "Вступить в программу" : "Программа временно недоступна"}
                </button>
                {joinError ? <p className="lk-dashboard__program-card-joined">{joinError}</p> : null}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
