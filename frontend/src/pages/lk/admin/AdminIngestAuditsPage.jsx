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

export default function AdminIngestAuditsPage() {
  const [publicCode, setPublicCode] = useState("");
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
    setPage(1);
  }, [publicCode]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    const code = publicCode.trim();
    if (code) params.set("public_code", code);
    params.set("page", String(page));
    params.set("page_size", String(PAGE_SIZE));
    return `${API_ENDPOINTS.adminIngestAuditsList}?${params.toString()}`;
  }, [publicCode, page]);

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
    <section
      className="lk-admin-users"
      aria-labelledby="lk-admin-ingest-audits-title"
    >
      <header className="lk-admin-users__header">
        <h1 id="lk-admin-ingest-audits-title" className="lk-admin-cabinet__title">
          Ingest audits
        </h1>
      </header>

      <div className="lk-admin-users__filters" role="group" aria-label="Фильтры">
        <label className="lk-admin-users__filter">
          <span className="lk-admin-users__filter-label">Public code</span>
          <input
            type="search"
            className="lk-admin-users__search"
            placeholder="Например, invalid_payload"
            value={publicCode}
            onChange={(e) => setPublicCode(e.target.value)}
            aria-label="Фильтр по public_code"
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
              <th scope="col">ID</th>
              <th scope="col">Сайт</th>
              <th scope="col">Public code</th>
              <th scope="col">Internal reason</th>
              <th scope="col">HTTP</th>
              <th scope="col">IP</th>
              <th scope="col">Создан</th>
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
                    to={`/lk/admin/ingest-audits/${row.id}`}
                    className="lk-admin-users__email-link"
                  >
                    #{row.id}
                  </Link>
                </td>
                <td>{row.site_public_id || "—"}</td>
                <td>{row.public_code || "—"}</td>
                <td>{row.internal_reason || "—"}</td>
                <td>{row.http_status ?? "—"}</td>
                <td>{row.client_ip || "—"}</td>
                <td>{formatDateTime(row.created_at)}</td>
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
