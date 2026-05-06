import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./owner-programs.css";

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function formatInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("ru-RU").format(Math.round(v));
}

function formatMoney(raw) {
  if (raw == null || raw === "") return "—";
  const v = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(v)) return String(raw);
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

function parseSeriesNumbers(rows, key) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const x = row?.[key];
    const n = typeof x === "number" ? x : Number(String(x ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  });
}

const CHART_VB_W = 640;
const CHART_VB_H = 306;
/** Plot insets; `left`/`right` are overridden in chart — equal gutters; left reserves a column for Y labels. */
const CHART_PAD = { top: 12, right: 52, bottom: 28, left: 52 };
/** Y-axis numbers: `text-anchor: start` at this x so they align with the plate title/subtitle. */
const CHART_Y_LABEL_X = 0;
const CHART_Y_TICKS = 6;
const CHART_X_MAX_TICKS = 8;

function normalizePad(pad) {
  if (typeof pad === "number") {
    return { top: pad, right: pad, bottom: pad, left: pad };
  }
  return {
    top: pad.top ?? 6,
    right: pad.right ?? 6,
    bottom: pad.bottom ?? 6,
    left: pad.left ?? 6,
  };
}

function pickDayTickIndices(n, maxTicks = CHART_X_MAX_TICKS) {
  if (n <= 0) return [];
  if (n === 1) return [0];
  if (n <= maxTicks) return Array.from({ length: n }, (_, i) => i);
  const raw = [];
  for (let k = 0; k < maxTicks; k++) {
    raw.push(Math.round((k / (maxTicks - 1)) * (n - 1)));
  }
  return [...new Set([0, n - 1, ...raw])].sort((a, b) => a - b);
}

function formatDayTick(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/** Короче при длинной серии — меньше налезаний на ось X. */
function formatDayTickBySeriesLength(iso, seriesLen) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  if (seriesLen > 14) {
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  }
  return formatDayTick(iso);
}

/** Подписи делений Y: при малом span не дублировать «0»/«1» из formatInt. */
function formatYAxisTickValue(value, span, fmt) {
  if (fmt === formatMoney) {
    if (span > 0 && span < 2) {
      return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    }
    return fmt(value);
  }
  if (span > 0 && span <= 2) {
    return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(value);
  }
  return fmt(value);
}

function formatDayTooltip(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

/** Padded Y domain so clustered values use vertical space (not stuck to 0..global max). */
function computeYDomain(values) {
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return { y0: 0, y1: 1 };
  if (maxV <= 0 && minV >= 0) return { y0: 0, y1: 1 };
  let dataLo = minV;
  let dataHi = maxV;
  if (dataHi === dataLo) {
    if (dataHi === 0) return { y0: 0, y1: 1 };
    const pad = Math.abs(dataHi) * 0.2 + 0.5;
    return { y0: Math.max(0, dataHi - pad), y1: dataHi + pad };
  }
  let span = dataHi - dataLo;
  const pad = span * 0.1 + dataHi * 0.02;
  let y0 = dataLo - pad;
  let y1 = dataHi + pad;
  if (dataLo >= 0) y0 = Math.max(0, y0);
  if (dataHi > 0 && span / dataHi < 0.22) {
    const mid = (dataLo + dataHi) / 2;
    const minSpan = Math.max(span * 3, dataHi * 0.12, span + dataHi * 0.04);
    y0 = dataLo >= 0 ? Math.max(0, mid - minSpan / 2) : mid - minSpan / 2;
    y1 = mid + minSpan / 2;
    if (y1 < dataHi + span * 0.04) y1 = dataHi + span * 0.04;
  }
  if (y1 <= y0) y1 = y0 + 1;
  return { y0, y1 };
}

/** Linear path — первая/последняя точки строго на внутренних границах сетки (как на референсе). */
function linearPathThroughPoints(pts) {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
  }
  return d;
}

/**
 * @returns {{
 *   linePathD: string,
 *   areaPathD: string,
 *   yTicks: { y: number; value: number }[],
 *   axisY: number,
 *   innerLeft: number,
 *   innerRight: number,
 *   innerTop: number,
 *   clipX: number,
 *   clipY: number,
 *   clipW: number,
 *   clipH: number,
 *   y0: number,
 *   y1: number,
 *   plotPts: { x: number; y: number; v: number; i: number }[],
 * } | null}
 */
function buildLineGeometry(values, width, height, pad = CHART_PAD) {
  if (!values.length) return null;
  const { y0, y1 } = computeYDomain(values);
  const span = y1 - y0 || 1;
  const { top, right, bottom, left } = normalizePad(pad);
  const innerW = Math.max(1, width - left - right);
  const innerH = Math.max(1, height - top - bottom);
  const axisY = top + innerH;
  const scaleY = (v) => top + innerH - ((Math.min(y1, Math.max(y0, v)) - y0) / span) * innerH;
  const plotPts = values.map((v, i) => {
    const x = left + (values.length === 1 ? innerW / 2 : (i / (values.length - 1)) * innerW);
    const y = scaleY(v);
    return { x, y, v, i };
  });
  let linePathD = linearPathThroughPoints(plotPts);
  if (plotPts.length === 1) {
    const p = plotPts[0];
    linePathD = `M ${(p.x - 0.75).toFixed(2)} ${p.y.toFixed(2)} L ${(p.x + 0.75).toFixed(2)} ${p.y.toFixed(2)}`;
  }
  const first = plotPts[0];
  const last = plotPts[plotPts.length - 1];
  const areaPathD =
    plotPts.length === 1
      ? `M ${first.x.toFixed(2)} ${axisY.toFixed(2)} L ${first.x.toFixed(2)} ${first.y.toFixed(2)} L ${(first.x + 0.5).toFixed(2)} ${first.y.toFixed(2)} L ${(first.x + 0.5).toFixed(2)} ${axisY.toFixed(2)} Z`
      : `${linePathD} L ${last.x.toFixed(2)} ${axisY.toFixed(2)} L ${first.x.toFixed(2)} ${axisY.toFixed(2)} Z`;
  const yTicks = [];
  const nY = CHART_Y_TICKS;
  for (let i = 0; i < nY; i++) {
    const t = i / (nY - 1);
    const value = y0 + t * (y1 - y0);
    yTicks.push({ y: scaleY(value), value });
  }
  const clipW = width - left - right;
  const clipH = axisY - top;
  return {
    linePathD,
    areaPathD,
    yTicks,
    axisY,
    innerLeft: left,
    innerRight: width - right,
    innerTop: top,
    clipX: left,
    clipY: top,
    clipW,
    clipH,
    y0,
    y1,
    plotPts,
  };
}

function DaySeriesChart({ byDay, values, gradId, formatY, ariaLabel, tooltipMetricLabel }) {
  const fmt = formatY ?? formatInt;
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);
  const chartPad = useMemo(() => {
    const gutter = fmt === formatMoney ? 58 : 38;
    return { ...CHART_PAD, left: gutter, right: gutter };
  }, [fmt]);
  const geom = useMemo(() => buildLineGeometry(values, CHART_VB_W, CHART_VB_H, chartPad), [values, chartPad]);
  const ticks = useMemo(() => {
    if (!byDay.length) return null;
    const n = byDay.length;
    const maxXTicks = n > 18 ? 6 : CHART_X_MAX_TICKS;
    const idxs = pickDayTickIndices(n, maxXTicks);
    return idxs.map((idx) => ({
      idx,
      label: formatDayTickBySeriesLength(byDay[idx]?.date, n),
    }));
  }, [byDay]);

  const metricTitle = tooltipMetricLabel ?? "Значение";

  const nearestIndex = useCallback(
    (svgX) => {
      if (!geom?.plotPts?.length) return 0;
      const pts = geom.plotPts;
      if (pts.length === 1) return 0;
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < pts.length; k++) {
        const d = Math.abs(pts[k].x - svgX);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      return best;
    },
    [geom],
  );

  const onSvgPointer = useCallback(
    (e) => {
      const svg = svgRef.current;
      const wrap = wrapRef.current;
      if (!svg || !wrap || !geom) return;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const p = pt.matrixTransform(ctm.inverse());
      const idx = nearestIndex(p.x);
      const rect = wrap.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      setHover({
        idx,
        left: Math.min(Math.max(relX, 48), rect.width - 48),
        top: Math.min(Math.max(relY, 24), rect.height - 24),
        placeBelow: relY < rect.height * 0.38,
      });
    },
    [geom, nearestIndex],
  );

  const clearHover = useCallback(() => setHover(null), []);

  if (!geom) {
    return <p className="owner-programs__site-dash-empty">Нет данных за выбранный период.</p>;
  }

  const xAt = (idx) => {
    const n = values.length;
    const { innerLeft, innerRight } = geom;
    const innerW = innerRight - innerLeft;
    if (n <= 1) return innerLeft + innerW / 2;
    return innerLeft + (idx / (n - 1)) * innerW;
  };

  const vbW = CHART_VB_W;
  const vbH = CHART_VB_H;
  const hi = hover?.idx != null ? geom.plotPts[hover.idx] : null;
  const dateStr = hi != null ? formatDayTooltip(byDay[hi.i]?.date) : "";

  return (
    <div
      className="owner-programs__site-dash-line-wrap"
      style={{ aspectRatio: `${vbW} / ${vbH}` }}
      ref={wrapRef}
      onPointerLeave={clearHover}
      onBlur={clearHover}
    >
      <svg
        ref={svgRef}
        className="owner-programs__site-dash-line-svg"
        width="100%"
        height="100%"
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onSvgPointer}
        onPointerDown={onSvgPointer}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="owner-programs__site-dash-grad-line-a" />
            <stop offset="100%" className="owner-programs__site-dash-grad-line-b" />
          </linearGradient>
          <clipPath id={`${gradId}-plot-clip`}>
            <rect
              x={geom.clipX}
              y={geom.clipY}
              width={geom.clipW}
              height={geom.clipH}
            />
          </clipPath>
        </defs>
        {ticks
          ? ticks.map((t, i) => (
              <line
                key={`vx-${t.idx}-${i}`}
                x1={xAt(t.idx)}
                y1={geom.innerTop}
                x2={xAt(t.idx)}
                y2={geom.axisY}
                className="owner-programs__site-dash-svg-grid owner-programs__site-dash-svg-grid_vert"
              />
            ))
          : null}
        {geom.yTicks.map((row, i) => (
          <line
            key={`hy-${i}`}
            x1={geom.innerLeft}
            y1={row.y}
            x2={geom.innerRight}
            y2={row.y}
            className="owner-programs__site-dash-svg-grid"
          />
        ))}
        <g clipPath={`url(#${gradId}-plot-clip)`}>
          <path d={geom.areaPathD} className="owner-programs__site-dash-svg-area owner-programs__site-dash-svg-area_main" fill={`url(#${gradId})`} />
          <path
            d={geom.linePathD}
            className="owner-programs__site-dash-svg-line owner-programs__site-dash-svg-line_main"
            fill="none"
          />
        </g>
        <line
          x1={geom.innerLeft}
          y1={geom.axisY}
          x2={geom.innerRight}
          y2={geom.axisY}
          className="owner-programs__site-dash-svg-x-axis"
          aria-hidden
        />
        {hi ? (
          <g className="owner-programs__site-dash-svg-hover" clipPath={`url(#${gradId}-plot-clip)`} aria-hidden>
            <line
              x1={hi.x}
              y1={geom.innerTop}
              x2={hi.x}
              y2={geom.axisY}
              className="owner-programs__site-dash-svg-hover-line"
            />
            <circle cx={hi.x} cy={hi.y} r="5" className="owner-programs__site-dash-svg-hover-dot" />
          </g>
        ) : null}
        <g className="owner-programs__site-dash-svg-ylabels owner-programs__site-dash-svg-axis-ticks" aria-hidden>
          {geom.yTicks.map((row, i) => (
            <text
              key={`yl-${i}`}
              x={CHART_Y_LABEL_X}
              y={row.y}
              textAnchor="start"
              dominantBaseline="middle"
            >
              {formatYAxisTickValue(row.value, geom.y1 - geom.y0, fmt)}
            </text>
          ))}
        </g>
        {ticks ? (
          <g className="owner-programs__site-dash-svg-xlabels owner-programs__site-dash-svg-axis-ticks" aria-hidden>
            {ticks.map((t, i) => (
              <text
                key={`${t.idx}-${i}`}
                x={xAt(t.idx)}
                y={vbH - 6}
                textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
                dominantBaseline="auto"
              >
                {t.label}
              </text>
            ))}
          </g>
        ) : null}
      </svg>
      {hover && hi ? (
        <div
          className={`owner-programs__site-dash-tooltip${hover.placeBelow ? " owner-programs__site-dash-tooltip_below" : ""}`}
          style={{ left: `${hover.left}px`, top: `${hover.top}px` }}
          role="status"
        >
          <div className="owner-programs__site-dash-tooltip-date">{dateStr}</div>
          <div className="owner-programs__site-dash-tooltip-metric">{metricTitle}</div>
          <div className="owner-programs__site-dash-tooltip-value">{fmt(hi.v)}</div>
        </div>
      ) : null}
    </div>
  );
}

const PERIODS = [
  { id: "7d", label: "7 дней" },
  { id: "30d", label: "30 дней" },
  { id: "all", label: "Всё время" },
];

function SiteDashKpiCard({ label, value, hint }) {
  return (
    <div className="owner-programs__site-dash-kpi">
      <span className="owner-programs__site-dash-kpi-label">{label}</span>
      <span className="owner-programs__site-dash-kpi-value">{value}</span>
      <span className="owner-programs__site-dash-kpi-hint">{hint}</span>
    </div>
  );
}

export default function SiteDashboardPage() {
  const { sitePublicId: sitePublicIdParam } = useParams();
  const sitePublicId = typeof sitePublicIdParam === "string" ? sitePublicIdParam.trim() : "";
  const siteId = isUuidString(sitePublicId) ? sitePublicId : "";

  const [period, setPeriod] = useState("7d");
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false);
  const periodSelectRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    if (!periodMenuOpen) return;
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

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setError("");
    try {
      const u = new URL(API_ENDPOINTS.siteIntegrationAnalytics, window.location.origin);
      u.searchParams.set("site_public_id", siteId);
      u.searchParams.set("period", period);
      const res = await fetch(u.toString(), { method: "GET", headers: authHeaders(), credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = body?.detail ?? body?.code;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setPayload(null);
        setError(detailMsg || `Не удалось загрузить аналитику (${res.status})`);
        return;
      }
      setPayload(body);
    } catch (e) {
      console.error(e);
      setPayload(null);
      setError("Сетевая ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  }, [period, siteId]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => (Array.isArray(payload?.series?.by_day) ? payload.series.by_day : []), [payload]);
  const salesSeries = useMemo(() => parseSeriesNumbers(byDay, "sales_count"), [byDay]);
  const commissionsSeries = useMemo(() => parseSeriesNumbers(byDay, "commissions"), [byDay]);
  const activitySeries = useMemo(() => {
    if (!byDay.length) return [];
    return byDay.map((row) => {
      const a = Number(row?.leads ?? 0);
      const b = Number(row?.visits ?? 0);
      const c = Number(row?.sales_count ?? 0);
      return (
        (Number.isFinite(a) ? a : 0) +
        (Number.isFinite(b) ? b : 0) +
        (Number.isFinite(c) ? c : 0)
      );
    });
  }, [byDay]);

  const kpis = payload?.kpis && typeof payload.kpis === "object" ? payload.kpis : {};

  const recentSales = Array.isArray(payload?.recent_sales) ? payload.recent_sales : [];
  const periodLabel = PERIODS.find((p) => p.id === period)?.label ?? "7 дней";

  if (!siteId) {
    return (
      <div className="lk-dashboard lk-partner owner-programs__site-dash">
        <p className="lk-partner__error">Некорректный идентификатор сайта.</p>
      </div>
    );
  }

  return (
    <div className="lk-dashboard lk-partner owner-programs__site-dash">
      {loading ? (
        <>
          <div className="owner-programs__site-dash-stat-toolbar owner-programs__site-dash-skeleton-toolbar">
            <span className="owner-programs__skel owner-programs__site-dash-skeleton-toolbar-line" aria-hidden />
          </div>
          <div
            className="owner-programs__site-dash-skeleton-analytics"
            role="status"
            aria-live="polite"
            aria-label="Загрузка статистики"
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="owner-programs__site-dash-skeleton-row">
                <div className="owner-programs__site-dash-skeleton-chart">
                  <div className="owner-programs__site-dash-skeleton-chart-lines">
                    <span className="owner-programs__skel" />
                    <span className="owner-programs__skel" />
                  </div>
                  <span className="owner-programs__skel owner-programs__site-dash-skeleton-chart-body" aria-hidden />
                </div>
                <div className="owner-programs__site-dash-skeleton-kpis">
                  <span className="owner-programs__skel" aria-hidden />
                  <span className="owner-programs__skel" aria-hidden />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="owner-programs__site-dash-stat-toolbar">
            <div className="owner-programs__site-dash-charts-header">
              <h2 className="owner-programs__site-dash-charts-h2">
                <span className="owner-programs__site-dash-charts-h2-prefix">Статистика за</span>
                <span className="owner-programs__site-dash-stat-select-wrap" ref={periodSelectRef}>
                  <input type="hidden" name="site_dash_period" value={period} aria-hidden />
                  <button
                    type="button"
                    className="owner-programs__site-dash-stat-select-trigger"
                    data-test-id="stat-period-select"
                    aria-haspopup="listbox"
                    aria-expanded={periodMenuOpen}
                    aria-controls="site-dash-stat-period-listbox"
                    id="site-dash-stat-period-trigger"
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
                      id="site-dash-stat-period-listbox"
                      role="listbox"
                      aria-labelledby="site-dash-stat-period-trigger"
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

          {error ? <div className="lk-partner__error">{error}</div> : null}

          {!error && payload ? (
            <div className="owner-programs__site-dash-data">
          <section className="owner-programs__site-dash-analytics" aria-label="Аналитика за период">
            <div className="owner-programs__site-dash-charts-grid">
              <div className="owner-programs__site-dash-analytics-row">
                <article className="owner-programs__site-dash-chart-block" aria-labelledby="site-dash-activity-title">
                  <div className="owner-programs__site-dash-chart-plate">
                    <header className="owner-programs__site-dash-chart-plate-head">
                      <div className="owner-programs__site-dash-chart-plate-titles">
                        <h2 id="site-dash-activity-title" className="owner-programs__site-dash-chart-plate-title">
                          Активность по дням
                        </h2>
                        <p className="owner-programs__site-dash-chart-plate-sub">
                          Заявки с виджета (по реферальной ссылке), переходы и оплаченные заказы по дням
                        </p>
                      </div>
                    </header>
                    <div className="owner-programs__site-dash-chart-plate-body owner-programs__site-dash-chart-plate-body_line">
                      {byDay.length === 0 ? (
                        <p className="owner-programs__site-dash-empty">Нет данных за выбранный период.</p>
                      ) : (
                        <DaySeriesChart
                          byDay={byDay}
                          values={activitySeries}
                          gradId="site-dash-grad-activity"
                          formatY={formatInt}
                          tooltipMetricLabel="Активность"
                          ariaLabel="График активности по дням"
                        />
                      )}
                    </div>
                  </div>
                </article>
                <div className="owner-programs__site-dash-row-kpis" aria-label="Переходы и заявки за период">
                  <SiteDashKpiCard
                    label="Переходов"
                    value={formatInt(kpis.visits_count)}
                    hint="По ссылкам участников"
                  />
                  <SiteDashKpiCard label="Заявок" value={formatInt(kpis.leads_count)} hint="Отправки с виджета" />
                </div>
              </div>

              <div className="owner-programs__site-dash-analytics-row">
                <article className="owner-programs__site-dash-chart-block" aria-labelledby="site-dash-sales-title">
                  <div className="owner-programs__site-dash-chart-plate">
                    <header className="owner-programs__site-dash-chart-plate-head">
                      <div className="owner-programs__site-dash-chart-plate-titles">
                        <h2 id="site-dash-sales-title" className="owner-programs__site-dash-chart-plate-title">
                          Продажи по дням
                        </h2>
                        <p className="owner-programs__site-dash-chart-plate-sub">Число оплаченных заказов участников программы</p>
                      </div>
                    </header>
                    <div className="owner-programs__site-dash-chart-plate-body owner-programs__site-dash-chart-plate-body_line">
                      {byDay.length === 0 ? (
                        <p className="owner-programs__site-dash-empty">Нет данных за выбранный период.</p>
                      ) : (
                        <DaySeriesChart
                          byDay={byDay}
                          values={salesSeries}
                          gradId="site-dash-grad-sales"
                          formatY={formatInt}
                          tooltipMetricLabel="Продажи, шт."
                          ariaLabel="График продаж по дням"
                        />
                      )}
                    </div>
                  </div>
                </article>
                <div className="owner-programs__site-dash-row-kpis" aria-label="Продажи за период">
                  <SiteDashKpiCard label="Продаж" value={formatInt(kpis.sales_count)} hint="Оплаченные заказы" />
                  <SiteDashKpiCard label="Сумма продаж" value={formatMoney(kpis.sales_amount)} hint="Оплаченные, сумма" />
                </div>
              </div>

              <div className="owner-programs__site-dash-analytics-row">
                <article className="owner-programs__site-dash-chart-block" aria-labelledby="site-dash-comm-title">
                  <div className="owner-programs__site-dash-chart-plate">
                    <header className="owner-programs__site-dash-chart-plate-head">
                      <div className="owner-programs__site-dash-chart-plate-titles">
                        <h2 id="site-dash-comm-title" className="owner-programs__site-dash-chart-plate-title">
                          Начисления по дням
                        </h2>
                        <p className="owner-programs__site-dash-chart-plate-sub">Сумма комиссий по дате начисления</p>
                      </div>
                    </header>
                    <div className="owner-programs__site-dash-chart-plate-body owner-programs__site-dash-chart-plate-body_line">
                      {byDay.length === 0 ? (
                        <p className="owner-programs__site-dash-empty">Нет данных за выбранный период.</p>
                      ) : (
                        <DaySeriesChart
                          byDay={byDay}
                          values={commissionsSeries}
                          gradId="site-dash-grad-comm"
                          formatY={formatMoney}
                          tooltipMetricLabel="Начисления"
                          ariaLabel="График начислений по дням"
                        />
                      )}
                    </div>
                  </div>
                </article>
                <div className="owner-programs__site-dash-row-kpis" aria-label="Начисления и рефералы за период">
                  <SiteDashKpiCard
                    label="Начислено"
                    value={formatMoney(kpis.commissions_total)}
                    hint="Комиссии участникам"
                  />
                  <SiteDashKpiCard
                    label="Рефералов"
                    value={formatInt(kpis.referrals_count)}
                    hint="Новые участники за период"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="owner-programs__site-dash-card owner-programs__site-dash-card_table" aria-labelledby="site-dash-sales-table-title">
            <h2 id="site-dash-sales-table-title" className="owner-programs__site-dash-card-title">
              Последние продажи
            </h2>
            {recentSales.length === 0 ? (
              <div className="owner-programs__site-dash-empty-block">
                <p className="owner-programs__site-dash-empty-title">Пока нет оплаченных заказов</p>
                <p className="owner-programs__site-dash-empty-text">
                  Когда клиенты оплатят заказы по реферальным ссылкам участников, они появятся здесь.
                </p>
              </div>
            ) : (
              <div className="lk-partner__table-wrap owner-programs__site-dash-table-wrap">
                <table className="lk-partner__table owner-programs__site-dash-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Сумма</th>
                      <th>Код</th>
                      <th>Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSales.map((row) => (
                      <tr key={row.id}>
                        <td>{row.at ? new Date(row.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
                        <td>
                          {formatMoney(row.amount)}
                          {row.currency ? ` ${row.currency}` : ""}
                        </td>
                        <td>{row.ref_code || "—"}</td>
                        <td>{row.customer_email_masked || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
