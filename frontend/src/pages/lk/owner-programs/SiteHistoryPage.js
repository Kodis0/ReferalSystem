import { forwardRef, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import { PersonalDatePicker } from "../settings/AccountPersonalDataPage";
import "react-datepicker/dist/react-datepicker.css";
import "../settings/settings.css";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./owner-programs.css";
import { SITE_OWNER_ACTIVITY_EVENT } from "./siteOwnerActivityBus";

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function withSitePublicIdQuery(url, sitePublicId) {
  if (!sitePublicId) return url;
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set("site_public_id", sitePublicId);
    return u.toString();
  } catch {
    return url;
  }
}

function formatHistoryAt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(d);
}

function hasExpandableDetails(details) {
  return details && typeof details === "object" && Object.keys(details).length > 0;
}

const SiteHistoryDateFilterTrigger = forwardRef(function SiteHistoryDateFilterTrigger(
  {
    value,
    onClick,
    disabled,
    id,
    name,
    className: classNameFromPicker,
    placeholder: _ignoredPlaceholder,
    ...rest
  },
  ref,
) {
  const hasValue = typeof value === "string" && value.trim() !== "";
  const className = ["owner-programs__histSort", "owner-programs__histDateTrigger", classNameFromPicker]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      ref={ref}
      id={id}
      name={name}
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-label={hasValue ? `Фильтр по дате, выбрано ${value}` : "Фильтр по дате, открыть календарь"}
      {...rest}
    >
      <span className="owner-programs__histDateTrigger__labelWithArrow">
        <span className="owner-programs__histText owner-programs__histText_s owner-programs__histText_grey owner-programs__histText_alignLeft">
          Дата
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="8"
          height="4"
          fill="none"
          viewBox="0 0 8 4"
          className="owner-programs__histSortArrow"
          aria-hidden="true"
        >
          <path fill="currentColor" d="m4 4 4-4H0l4 4Z" />
        </svg>
      </span>
      {hasValue ? (
        <span className="owner-programs__histDateTrigger__value owner-programs__histText owner-programs__histText_s" aria-hidden="true">
          {value}
        </span>
      ) : null}
    </button>
  );
});
SiteHistoryDateFilterTrigger.displayName = "SiteHistoryDateFilterTrigger";

export default function SiteHistoryPage() {
  const { sitePublicId: sitePublicIdParam } = useParams();
  const sitePublicId = isUuidString(sitePublicIdParam) ? sitePublicIdParam.trim() : "";
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [expandedId, setExpandedId] = useState(null);
  const [filterDateYmd, setFilterDateYmd] = useState("");

  const baseUrl = useMemo(
    () => withSitePublicIdQuery(API_ENDPOINTS.siteIntegrationActivity, sitePublicId),
    [sitePublicId],
  );

  const load = useCallback(async () => {
    if (!sitePublicId) {
      setLoading(false);
      setRows([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const u = new URL(baseUrl, window.location.origin);
      u.searchParams.set("page", String(page));
      u.searchParams.set("page_size", String(pageSize));
      if (filterDateYmd) u.searchParams.set("date", filterDateYmd);
      const res = await fetch(u.toString(), { headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.detail === "string" ? body.detail : "Не удалось загрузить историю");
        setRows([]);
        setCount(0);
        setNumPages(1);
        return;
      }
      setRows(Array.isArray(body.results) ? body.results : []);
      setCount(typeof body.count === "number" ? body.count : 0);
      setNumPages(typeof body.num_pages === "number" ? Math.max(1, body.num_pages) : 1);
    } catch (e) {
      console.error(e);
      setError("Не удалось загрузить историю");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, filterDateYmd, page, pageSize, sitePublicId]);

  useEffect(() => {
    load();
  }, [load]);

  const onFilterDateChange = useCallback((ymd) => {
    setFilterDateYmd(ymd);
    setPage(1);
  }, []);

  useEffect(() => {
    if (!sitePublicId) return undefined;

    const maybeReload = () => {
      if (document.visibilityState !== "visible") return;
      void load();
    };

    const onOwnerActivity = (ev) => {
      const sid = ev?.detail?.sitePublicId;
      if (sid && sid === sitePublicId) {
        void load();
      }
    };

    window.addEventListener(SITE_OWNER_ACTIVITY_EVENT, onOwnerActivity);
    document.addEventListener("visibilitychange", maybeReload);
    const pollMs = 45000;
    const pollId = window.setInterval(maybeReload, pollMs);

    return () => {
      window.removeEventListener(SITE_OWNER_ACTIVITY_EVENT, onOwnerActivity);
      document.removeEventListener("visibilitychange", maybeReload);
      window.clearInterval(pollId);
    };
  }, [load, sitePublicId]);

  if (!sitePublicId) {
    return (
      <div className="owner-programs__page owner-programs__site-page">
        <p className="owner-programs__muted">Укажите сайт в адресе страницы.</p>
      </div>
    );
  }

  return (
    <div className="owner-programs__page owner-programs__site-page">
      <div className="owner-programs__history">
        <h2 className="owner-programs__history-title">История</h2>
        <div
          id="owner-programs-site-history-datepicker-portal"
          className="owner-programs__history-datepicker-portal"
          aria-hidden="true"
        />

        {error ? (
          <p className="owner-programs__history-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="owner-programs__history-mobileDateBar">
          <div className="lk-settings-personal-page__date-wrap owner-programs__histHeaderDateFilter__pickerWrap">
            <PersonalDatePicker
              id="site-history-date-filter-mobile"
              name="site_history_filter_date"
              value={filterDateYmd}
              onChange={onFilterDateChange}
              maxDate={new Date()}
              placeholderText="дд.мм.гггг"
              portalId="owner-programs-site-history-datepicker-portal"
              customInput={<SiteHistoryDateFilterTrigger />}
              isClearable
            />
          </div>
        </div>

        <div className="owner-programs__history-tableWrap">
          <div className="owner-programs__histTable owner-programs__histTable_showHeaderMobile">
            <div className="owner-programs__histRow owner-programs__histRow_head owner-programs__histRow_head_filters">
              <div className="owner-programs__histCell owner-programs__histCell_date owner-programs__histCell_headerCell">
                <div className="owner-programs__histHeaderDateFilter">
                  <div className="lk-settings-personal-page__date-wrap owner-programs__histHeaderDateFilter__pickerWrap">
                    <PersonalDatePicker
                      id="site-history-date-filter"
                      name="site_history_filter_date"
                      value={filterDateYmd}
                      onChange={onFilterDateChange}
                      maxDate={new Date()}
                      placeholderText="дд.мм.гггг"
                      portalId="owner-programs-site-history-datepicker-portal"
                      customInput={<SiteHistoryDateFilterTrigger />}
                      isClearable
                    />
                  </div>
                </div>
              </div>
              <div className="owner-programs__histCell owner-programs__histCell_event owner-programs__histCell_headerCell">
                <span className="owner-programs__histText owner-programs__histText_s owner-programs__histText_grey owner-programs__histText_alignLeft">
                  Событие
                </span>
              </div>
              <div className="owner-programs__histCell owner-programs__histCell_user owner-programs__histCell_headerCell">
                <span className="owner-programs__histText owner-programs__histText_s owner-programs__histText_grey owner-programs__histText_alignLeft">
                  Пользователь
                </span>
              </div>
            </div>

            {loading ? (
              <div className="owner-programs__histRow owner-programs__histRow_body">
                <div className="owner-programs__histCell owner-programs__histCell_full">
                  <p className="owner-programs__histText owner-programs__histText_muted">Загрузка…</p>
                </div>
              </div>
            ) : rows.length === 0 ? (
              <div className="owner-programs__histRow owner-programs__histRow_body">
                <div className="owner-programs__histCell owner-programs__histCell_full">
                  <p className="owner-programs__histText owner-programs__histText_muted">Пока нет записей.</p>
                </div>
              </div>
            ) : (
              rows.map((row) => {
                const open = expandedId === row.id;
                const expandable = hasExpandableDetails(row.details);
                return (
                  <div key={row.id} className="owner-programs__histBlock">
                    <div className="owner-programs__histRow owner-programs__histRow_body">
                      <div className="owner-programs__histCell owner-programs__histCell_date">
                        <p className="owner-programs__histText owner-programs__histText_date">{formatHistoryAt(row.at)}</p>
                      </div>
                      <div className="owner-programs__histCell owner-programs__histCell_event">
                        <div className="owner-programs__histEventRow">
                          <p
                            className="owner-programs__histText owner-programs__histText_body"
                            title={row.message || undefined}
                          >
                            {row.message || "—"}
                          </p>
                          {expandable ? (
                            <button
                              type="button"
                              className={`owner-programs__histInlineExpand${open ? " owner-programs__histInlineExpand_open" : ""}`}
                              aria-expanded={open}
                              aria-label={open ? "Скрыть детали" : "Показать детали"}
                              onClick={() => setExpandedId(open ? null : row.id)}
                            >
                              <ChevronDown size={14} strokeWidth={2.25} className="owner-programs__histInlineExpandIcon" aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="owner-programs__histCell owner-programs__histCell_user">
                        <p className="owner-programs__histText owner-programs__histText_body">{row.actor_display || "—"}</p>
                      </div>
                    </div>
                    {open && expandable ? (
                      <pre className="owner-programs__histDetails">{JSON.stringify(row.details, null, 2)}</pre>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {!loading && count > 0 ? (
          <div className="owner-programs__history-pagination">
            <button
              type="button"
              className="owner-programs__history-pageBtn"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M17 11H9.41l3.3-3.29a1 1 0 0 0-1.42-1.42l-5 5a1 1 0 0 0-.21.33 1 1 0 0 0 0 .76 1 1 0 0 0 .21.33l5 5a1 1 0 1 0 1.42-1.42L9.41 13H17a1 1 0 0 0 0-2Z"
                />
              </svg>
              Назад
            </button>
            <div className="owner-programs__history-pageNums" aria-live="polite">
              {Array.from({ length: numPages }, (_, i) => i + 1)
                .filter((n) => numPages <= 7 || n === 1 || n === numPages || Math.abs(n - page) <= 1)
                .map((n, idx, arr) => {
                  const prev = arr[idx - 1];
                  const showEllipsis = idx > 0 && prev != null && n - prev > 1;
                  return (
                    <span key={n} className="owner-programs__history-pageNumWrap">
                      {showEllipsis ? <span className="owner-programs__history-pageEllipsis">…</span> : null}
                      <button
                        type="button"
                        className={`owner-programs__history-pageNum${n === page ? " owner-programs__history-pageNum_active" : ""}`}
                        onClick={() => setPage(n)}
                        disabled={n === page}
                      >
                        {n}
                      </button>
                    </span>
                  );
                })}
            </div>
            <button
              type="button"
              className="owner-programs__history-pageBtn"
              disabled={page >= numPages}
              onClick={() => setPage((p) => Math.min(numPages, p + 1))}
            >
              Вперед
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M7 13h7.59l-3.3 3.29a1 1 0 1 0 1.42 1.42l5-5a1 1 0 0 0 .21-.33 1 1 0 0 0 0-.76 1 1 0 0 0-.21-.33l-5-5a1 1 0 0 0-1.72.71 1 1 0 0 0 .3.71l3.3 3.29H7a1 1 0 0 0 0 2Z"
                />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
