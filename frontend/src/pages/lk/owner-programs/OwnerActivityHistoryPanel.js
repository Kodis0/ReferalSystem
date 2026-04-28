import { forwardRef, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Globe } from "lucide-react";
import { PersonalDatePicker } from "../settings/AccountPersonalDataPage";
import { SITE_OWNER_ACTIVITY_EVENT } from "./siteOwnerActivityBus";
import "react-datepicker/dist/react-datepicker.css";

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function formatHistoryAt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dateStr = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(d)
    .replace(/\s*г\.?\s*$/u, "");
  const timeStr = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${dateStr}, ${timeStr}`;
}

/** Дашборд сервиса в оболочке владельца (см. `lk.js` Route `sites/:sitePublicId/dashboard`). */
function serviceSiteDashboardTo(row) {
  const pid = row.project_id;
  const sid = typeof row.site_public_id === "string" ? row.site_public_id.trim() : "";
  if (sid === "" || pid == null) return null;
  const n = typeof pid === "number" ? pid : Number(pid);
  if (!Number.isFinite(n)) return null;
  return `/lk/partner/project/${n}/sites/${sid}/dashboard`;
}

const OwnerHistDateFilterTrigger = forwardRef(function OwnerHistDateFilterTrigger(
  {
    value,
    onClick,
    disabled,
    id,
    name,
    className: classNameFromPicker,
    placeholder: _ignoredPlaceholder,
    calendarOpen = false,
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
      aria-expanded={calendarOpen}
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
          className={`owner-programs__histSortArrow${calendarOpen ? " owner-programs__histSortArrow_open" : ""}`}
          aria-hidden="true"
        >
          <path fill="currentColor" d="m4 4 4-4H0l4 4Z" />
        </svg>
      </span>
      {hasValue ? (
        <span
          className="owner-programs__histDateTrigger__value owner-programs__histText owner-programs__histText_s"
          aria-hidden="true"
        >
          {value}
        </span>
      ) : null}
    </button>
  );
});
OwnerHistDateFilterTrigger.displayName = "OwnerHistDateFilterTrigger";

/**
 * @param {object} props
 * @param {string} props.activityBaseUrl — API URL (no query)
 * @param {string} [props.portalId] — node id for datepicker portal
 * @param {boolean} [props.showInnerTitle]
 * @param {string} [props.innerTitle]
 * @param {string|null} [props.sitePublicId] — if set, adds site_public_id query (per-site history)
 * @param {boolean} [props.subscribeSiteOwnerActivityBus]
 * @param {boolean} [props.showServiceColumn] — «Сервис» (все сайты аккаунта); для ленты одного сайта не нужен
 * @param {string} [props.ownerShellBackTo] — путь для кнопки «Назад» в оболочке сайта (state.ownerShellBackTo)
 */
export default function OwnerActivityHistoryPanel({
  activityBaseUrl,
  portalId = "owner-activity-history-datepicker-portal",
  showInnerTitle = true,
  innerTitle = "История",
  sitePublicId = null,
  subscribeSiteOwnerActivityBus = false,
  showServiceColumn = false,
  ownerShellBackTo = "",
}) {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [filterDateYmd, setFilterDateYmd] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const u = new URL(activityBaseUrl, window.location.origin);
      if (sitePublicId) {
        u.searchParams.set("site_public_id", sitePublicId);
      }
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
  }, [activityBaseUrl, filterDateYmd, page, pageSize, sitePublicId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFilterDateChange = useCallback((ymd) => {
    setFilterDateYmd(ymd);
    setPage(1);
  }, []);

  useEffect(() => {
    if (!subscribeSiteOwnerActivityBus || !sitePublicId) return undefined;

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
  }, [load, sitePublicId, subscribeSiteOwnerActivityBus]);

  const historyRootClass = [
    "owner-programs__history",
    showServiceColumn ? "owner-programs__history_withService" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={historyRootClass}>
      {showInnerTitle ? <h2 className="owner-programs__history-title">{innerTitle}</h2> : null}
      <div id={portalId} className="owner-programs__history-datepicker-portal" aria-hidden="true" />

      {error ? (
        <p className="owner-programs__history-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="owner-programs__history-mobileDateBar">
        <div className="lk-settings-personal-page__date-wrap owner-programs__histHeaderDateFilter__pickerWrap">
          <PersonalDatePicker
            id={`${portalId}-date-filter-mobile`}
            name="owner_activity_filter_date"
            value={filterDateYmd}
            onChange={onFilterDateChange}
            maxDate={new Date()}
            placeholderText="дд.мм.гггг"
            portalId={portalId}
            customInput={<OwnerHistDateFilterTrigger />}
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
                    id={`${portalId}-date-filter`}
                    name="owner_activity_filter_date"
                    value={filterDateYmd}
                    onChange={onFilterDateChange}
                    maxDate={new Date()}
                    placeholderText="дд.мм.гггг"
                    portalId={portalId}
                    customInput={<OwnerHistDateFilterTrigger />}
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
            {showServiceColumn ? (
              <div className="owner-programs__histCell owner-programs__histCell_service owner-programs__histCell_headerCell">
                <span className="owner-programs__histText owner-programs__histText_s owner-programs__histText_grey owner-programs__histText_alignLeft">
                  Сервис
                </span>
              </div>
            ) : null}
            <div className="owner-programs__histCell owner-programs__histCell_user owner-programs__histCell_headerCell">
              <span className="owner-programs__histText owner-programs__histText_s owner-programs__histText_grey owner-programs__histText_alignLeft">
                Пользователь
              </span>
            </div>
          </div>

          {loading ? (
            <div className="owner-programs__histRow owner-programs__histRow_body">
              <div className="owner-programs__histCell owner-programs__histCell_full" role="status" aria-label="Загрузка">
                <div className="owner-programs__tab-page-skel_wide">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <span
                      key={i}
                      className="owner-programs__skel owner-programs__tab-page-skel_history-row"
                      style={{ display: "block", marginBottom: 8 }}
                      aria-hidden
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : rows.length === 0 ? (
            <div className="owner-programs__histRow owner-programs__histRow_body">
              <div className="owner-programs__histCell owner-programs__histCell_full">
                <p className="owner-programs__histText owner-programs__histText_muted">Пока нет записей.</p>
              </div>
            </div>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="owner-programs__histBlock">
                <div className="owner-programs__histRow owner-programs__histRow_body">
                  <div className="owner-programs__histCell owner-programs__histCell_date">
                    <p className="owner-programs__histText owner-programs__histText_date">{formatHistoryAt(row.at)}</p>
                  </div>
                  <div className="owner-programs__histCell owner-programs__histCell_event">
                    <div className="owner-programs__histEventRow">
                      <p className="owner-programs__histText owner-programs__histText_body">
                        {row.message || "—"}
                      </p>
                    </div>
                  </div>
                  {showServiceColumn ? (
                    <div className="owner-programs__histCell owner-programs__histCell_service">
                      {(() => {
                        const label =
                          typeof row.service_label === "string" && row.service_label.trim()
                            ? row.service_label
                            : "—";
                        const dashboardTo = serviceSiteDashboardTo(row);
                        const body = (
                          <>
                            <Globe
                              className="owner-programs__histServiceIcon"
                              size={16}
                              strokeWidth={1.75}
                              aria-hidden
                            />
                            <span className="owner-programs__histText owner-programs__histText_body">
                              {label}
                            </span>
                          </>
                        );
                        const backState =
                          typeof ownerShellBackTo === "string" &&
                          ownerShellBackTo.startsWith("/") &&
                          ownerShellBackTo.trim() !== ""
                            ? { ownerShellBackTo: ownerShellBackTo.trim() }
                            : undefined;
                        return dashboardTo ? (
                          <Link
                            className="owner-programs__histServiceLink"
                            to={dashboardTo}
                            state={backState}
                            aria-label={`Открыть дашборд сервиса «${label}»`}
                          >
                            {body}
                          </Link>
                        ) : (
                          <div className="owner-programs__histServiceRow">{body}</div>
                        );
                      })()}
                    </div>
                  ) : null}
                  <div className="owner-programs__histCell owner-programs__histCell_user">
                    <p className="owner-programs__histText owner-programs__histText_body">{row.actor_display || "—"}</p>
                  </div>
                </div>
              </div>
            ))
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
  );
}
