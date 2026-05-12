import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { adminFetch } from "../../../components/adminAuth";
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
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <section className="lk-admin-users" aria-labelledby="lk-admin-activity-title">
      <header className="lk-admin-users__header">
        <h1 id="lk-admin-activity-title" className="lk-admin-cabinet__title">
          Активность
        </h1>
      </header>

      <div className="lk-admin-users__filters" role="group" aria-label="Фильтры">
        <input
          type="search"
          className="lk-admin-users__search"
          placeholder="Поиск: email, action, target_type, target_id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск по журналу"
        />
        <label className="lk-admin-users__filter">
          <span className="lk-admin-users__filter-label">Action</span>
          <input
            type="text"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="admin.user.deactivated"
            aria-label="Фильтр по action"
          />
        </label>
        <label className="lk-admin-users__filter">
          <span className="lk-admin-users__filter-label">Target type</span>
          <input
            type="text"
            value={targetTypeFilter}
            onChange={(e) => setTargetTypeFilter(e.target.value)}
            placeholder="user / support_ticket"
            aria-label="Фильтр по target_type"
          />
        </label>
      </div>

      {error && (
        <div className="lk-admin-users__error" role="alert">
          {error}
        </div>
      )}

      <div className="lk-admin-users__table-wrap">
        <table className="lk-admin-users__table">
          <thead>
            <tr>
              <th scope="col">Когда</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Target type</th>
              <th scope="col">Target id</th>
              <th scope="col">IP</th>
              <th scope="col">Контекст</th>
            </tr>
          </thead>
          <tbody>
            {loading && data.results.length === 0 && (
              <tr>
                <td colSpan={7} className="lk-admin-users__muted">
                  Загрузка…
                </td>
              </tr>
            )}
            {!loading && data.results.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="lk-admin-users__muted">
                  Ничего не найдено
                </td>
              </tr>
            )}
            {data.results.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link
                    to={`/admin-console/activity/${row.id}`}
                    className="lk-admin-users__email-link"
                  >
                    {formatDateTime(row.created_at)}
                  </Link>
                </td>
                <td>{row.actor_email || "—"}</td>
                <td>{row.action || "—"}</td>
                <td>{row.target_type || "—"}</td>
                <td>{row.target_id || "—"}</td>
                <td>{row.ip_address || "—"}</td>
                <td>{summaryToText(row.metadata_summary) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav className="lk-admin-users__pagination" aria-label="Постраничная навигация">
        <button
          type="button"
          className="lk-admin-users__page-btn"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={!canPrev || loading}
        >
          Назад
        </button>
        <span className="lk-admin-users__page-info" aria-live="polite">
          Страница {data.page} из {totalPages} (всего {data.count})
        </span>
        <button
          type="button"
          className="lk-admin-users__page-btn"
          onClick={() => setPage((p) => p + 1)}
          disabled={!canNext || loading}
        >
          Вперёд
        </button>
      </nav>
    </section>
  );
}
