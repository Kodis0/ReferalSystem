import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
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

export default function AdminProjectsPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
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
  }, [debouncedQuery]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    params.set("page", String(page));
    params.set("page_size", String(PAGE_SIZE));
    return `${API_ENDPOINTS.adminProjectsList}?${params.toString()}`;
  }, [debouncedQuery, page]);

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
      const token =
        typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <section className="lk-admin-users" aria-labelledby="lk-admin-projects-title">
      <header className="lk-admin-users__header">
        <h1 id="lk-admin-projects-title" className="lk-admin-cabinet__title">
          Проекты
        </h1>
      </header>

      <div className="lk-admin-users__filters" role="group" aria-label="Фильтры">
        <input
          type="search"
          className="lk-admin-users__search"
          placeholder="Поиск: название, email владельца"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск проектов"
        />
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
              <th scope="col">ID</th>
              <th scope="col">Название</th>
              <th scope="col">Владелец</th>
              <th scope="col">Сайтов</th>
              <th scope="col">Создан</th>
              <th scope="col">Обновлён</th>
            </tr>
          </thead>
          <tbody>
            {loading && data.results.length === 0 && (
              <tr>
                <td colSpan={6} className="lk-admin-users__muted">
                  Загрузка…
                </td>
              </tr>
            )}
            {!loading && data.results.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="lk-admin-users__muted">
                  Ничего не найдено
                </td>
              </tr>
            )}
            {data.results.map((row) => {
              const label = row.name || `#${row.id}`;
              return (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>
                    <Link
                      to={`/lk/admin/projects/${row.id}`}
                      className="lk-admin-users__email-link"
                    >
                      {label}
                    </Link>
                  </td>
                  <td>{row.owner_email || "—"}</td>
                  <td>{Number(row.sites_count) || 0}</td>
                  <td>{formatDateTime(row.created_at)}</td>
                  <td>{formatDateTime(row.updated_at)}</td>
                </tr>
              );
            })}
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
