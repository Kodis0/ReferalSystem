import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
import { adminFetch } from "../../../components/adminAuth";
import AdminPortalDropdown from "./AdminPortalDropdown";
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

function ArchivedBadge({ archivedAt }) {
  if (archivedAt) {
    return (
      <span className="lk-admin-users__badge lk-admin__badge--archived">Архив</span>
    );
  }
  return (
    <span className="lk-admin-users__badge lk-admin__badge--active">Активен</span>
  );
}

export default function AdminSitesPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [archivedFilter, setArchivedFilter] = useState("all");
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
  }, [debouncedQuery, archivedFilter]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (archivedFilter) params.set("archived", archivedFilter);
    params.set("page", String(page));
    params.set("page_size", String(PAGE_SIZE));
    return `${API_ENDPOINTS.adminSitesList}?${params.toString()}`;
  }, [debouncedQuery, archivedFilter, page]);

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
        setError(res.status === 403 ? "Недостаточно прав" : "Не удалось загрузить список");
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
    <section className="lk-admin-users" aria-labelledby="lk-admin-sites-title">
      <header className="lk-admin-users__header">
        <h1 id="lk-admin-sites-title" className="lk-admin-cabinet__title">
          Сайты
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
              placeholder="Поиск: public_id, email владельца"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Поиск сайтов"
            />
          </span>
        </label>
        <div className="admin-portal__toolbar-filters">
          <div className="admin-portal__toolbar-filter">
            <span className="admin-portal__toolbar-filter-label">Архивность</span>
            <AdminPortalDropdown
              ariaLabel="Фильтр по архивности"
              value={archivedFilter}
              onChange={setArchivedFilter}
              options={[
                { value: "all", label: "Все" },
                { value: "false", label: "Активные" },
                { value: "true", label: "Архивные" },
              ]}
            />
          </div>
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
              "minmax(160px, 1.1fr) minmax(200px, 1.6fr) minmax(90px, 0.5fr) minmax(110px, 0.6fr) minmax(110px, 0.6fr) minmax(150px, 1fr)",
          }}
        >
          <div className="admin-portal__table-row admin-portal__table-row--head">
            <div className="admin-portal__table-cell admin-portal__table-cell--head">public_id</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Владелец</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head admin-portal__table-cell--right">Проект</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Статус</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Архив</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Создан</div>
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
                  to={`/admin-console/sites/${row.id}`}
                  className="lk-admin-users__email-link"
                >
                  {row.public_id || `#${row.id}`}
                </Link>
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body">
                <span className="admin-portal__table-cell--ellipsis">{row.owner_email || "—"}</span>
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body admin-portal__table-cell--mono admin-portal__table-cell--right">
                {row.project_id ?? "—"}
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body">{row.status || "—"}</div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body">
                <ArchivedBadge archivedAt={row.archived_at} />
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body admin-portal__table-cell--mono">
                {formatDateTime(row.created_at)}
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
