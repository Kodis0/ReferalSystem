import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
import { adminFetch } from "../../../components/adminAuth";
import AdminPortalPagination from "./AdminPortalPagination";
import "./admin.css";

const PAGE_SIZE = 20;

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

function summaryToText(summary) {
  if (!summary || typeof summary !== "object") return "";
  const entries = Object.entries(summary).slice(0, 2);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      let s;
      if (v === null || v === undefined) s = "";
      else if (typeof v === "string") s = v;
      else {
        try {
          s = JSON.stringify(v);
        } catch {
          s = String(v);
        }
      }
      if (s.length > 40) s = s.slice(0, 37) + "...";
      return `${k}: ${s}`;
    })
    .join(", ");
}

export default function AdminActivityPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [targetTypeFilter, setTargetTypeFilter] = useState("");
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState({
    results: [],
    count: 0,
    page: 1,
    page_size: PAGE_SIZE,
    total_pages: 1,
  });

  const abortRef = useRef(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, actionFilter, targetTypeFilter]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (actionFilter.trim()) params.set("action", actionFilter.trim());
    if (targetTypeFilter.trim())
      params.set("target_type", targetTypeFilter.trim());
    params.set("page", String(page));
    params.set("page_size", String(PAGE_SIZE));
    return `${API_ENDPOINTS.adminActionAuditsList}?${params.toString()}`;
  }, [debouncedQuery, actionFilter, targetTypeFilter, page]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
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
      const res = await adminFetch(url, {
        credentials: "include",
        signal: controller.signal,
      });
      if (!res.ok) {
        setError(
          res.status === 403 ? "Недостаточно прав" : "Не удалось загрузить журнал",
        );
        setData({ results: [], count: 0, page: 1, page_size: PAGE_SIZE, total_pages: 1 });
        return;
      }
      const payload = await res.json().catch(() => ({}));
      setData({
        results: Array.isArray(payload.results) ? payload.results : [],
        count: Number(payload.count) || 0,
        page: Number(payload.page) || 1,
        page_size: Number(payload.page_size) || PAGE_SIZE,
        total_pages: Number(payload.total_pages) || 1,
      });
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setError("Сетевая ошибка, попробуйте позже");
      setData({ results: [], count: 0, page: 1, page_size: PAGE_SIZE, total_pages: 1 });
    } finally {
      setLoading(false);
    }
  }, [url]);

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

  const totalPages = Math.max(1, data.total_pages || 1);
  return (
    <section className="lk-admin-users" aria-labelledby="lk-admin-activity-title">
      <header className="lk-admin-users__header">
        <h1 id="lk-admin-activity-title" className="lk-admin-cabinet__title">
          Активность
        </h1>
      </header>

      <div className="admin-portal__toolbar" role="group" aria-label="Фильтры">
        <label className="admin-portal__toolbar-search">
          <span className="admin-portal__toolbar-search-inner">
            <Search
              className="admin-portal__toolbar-search-icon"
              size={18}
              strokeWidth={1.5}
              aria-hidden
            />
            <input
              type="search"
              className="admin-portal__toolbar-search-input"
              placeholder="Поиск: email, action, target_type, target_id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Поиск по журналу"
            />
          </span>
        </label>
        <div className="admin-portal__toolbar-filters">
          <label className="admin-portal__toolbar-filter">
            <span className="admin-portal__toolbar-filter-label">Action</span>
            <input
              type="text"
              className="admin-portal__toolbar-filter-input"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              placeholder="admin.user.deactivated"
              aria-label="Фильтр по action"
            />
          </label>
          <label className="admin-portal__toolbar-filter">
            <span className="admin-portal__toolbar-filter-label">Target type</span>
            <input
              type="text"
              className="admin-portal__toolbar-filter-input"
              value={targetTypeFilter}
              onChange={(e) => setTargetTypeFilter(e.target.value)}
              placeholder="user / support_ticket"
              aria-label="Фильтр по target_type"
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="lk-admin-users__error" role="alert">
          {error}
        </div>
      )}

      <div className="admin-portal__table-wrap">
        <div
          className="admin-portal__table"
          style={{
            "--admin-cols":
              "minmax(160px, 1fr) minmax(200px, 1.4fr) minmax(180px, 1.2fr) minmax(140px, 0.8fr) minmax(100px, 0.5fr) minmax(120px, 0.7fr) minmax(200px, 1.4fr)",
          }}
        >
          <div className="admin-portal__table-row admin-portal__table-row--head">
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Когда</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Actor</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Action</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Target type</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Target id</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">IP</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Контекст</div>
          </div>
          {loading && data.results.length === 0 && (
            <div className="admin-portal__table-row admin-portal__table-row--body">
              <div className="admin-portal__table-cell admin-portal__table-cell--full">Загрузка…</div>
            </div>
          )}
          {!loading && data.results.length === 0 && !error && (
            <div className="admin-portal__table-row admin-portal__table-row--body">
              <div className="admin-portal__table-cell admin-portal__table-cell--full">Ничего не найдено</div>
            </div>
          )}
          {data.results.map((row) => (
            <div
              key={row.id}
              className="admin-portal__table-row admin-portal__table-row--body admin-portal__table-row--link"
            >
              <div className="admin-portal__table-cell admin-portal__table-cell--body admin-portal__table-cell--mono">
                <Link
                  to={`/admin-console/activity/${row.id}`}
                  className="lk-admin-users__email-link"
                >
                  {formatDateTime(row.created_at)}
                </Link>
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body">
                <span className="admin-portal__table-cell--ellipsis">{row.actor_email || "—"}</span>
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body admin-portal__table-cell--mono">
                <span className="admin-portal__table-cell--ellipsis">{row.action || "—"}</span>
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body">{row.target_type || "—"}</div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body admin-portal__table-cell--mono">
                {row.target_id || "—"}
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body admin-portal__table-cell--mono">
                {row.ip_address || "—"}
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body">
                <span className="admin-portal__table-cell--ellipsis">{summaryToText(row.metadata_summary) || "—"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AdminPortalPagination
        page={data.page}
        numPages={totalPages}
        count={data.count}
        onPageChange={(n) => setPage(n)}
      />
    </section>
  );
}
