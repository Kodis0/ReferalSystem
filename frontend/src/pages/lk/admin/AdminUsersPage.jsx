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

function YesNoBadge({ value }) {
  return (
    <span
      className={`lk-admin-users__badge${value ? " lk-admin-users__badge_yes" : " lk-admin-users__badge_no"}`}
    >
      {value ? "Да" : "Нет"}
    </span>
  );
}

export default function AdminUsersPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("true");
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
  }, [debouncedQuery, staffFilter, activeFilter]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (staffFilter) params.set("is_staff", staffFilter);
    if (activeFilter) params.set("is_active", activeFilter);
    params.set("page", String(page));
    params.set("page_size", String(PAGE_SIZE));
    return `${API_ENDPOINTS.adminUsersList}?${params.toString()}`;
  }, [debouncedQuery, staffFilter, activeFilter, page]);

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
    <section className="lk-admin-users" aria-labelledby="lk-admin-users-title">
      <header className="lk-admin-users__header">
        <h1 id="lk-admin-users-title" className="lk-admin-cabinet__title">
          Пользователи
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
              placeholder="Поиск: email, public_id, ФИО, телефон"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Поиск пользователей"
            />
          </span>
        </label>
        <div className="admin-portal__toolbar-filters">
          <div className="admin-portal__toolbar-filter">
            <span className="admin-portal__toolbar-filter-label">Staff</span>
            <AdminPortalDropdown
              ariaLabel="Фильтр по is_staff"
              value={staffFilter}
              onChange={setStaffFilter}
              options={[
                { value: "", label: "Все" },
                { value: "true", label: "Staff" },
                { value: "false", label: "Не staff" },
              ]}
            />
          </div>
          <div className="admin-portal__toolbar-filter">
            <span className="admin-portal__toolbar-filter-label">Активность</span>
            <AdminPortalDropdown
              ariaLabel="Фильтр по is_active"
              value={activeFilter}
              onChange={setActiveFilter}
              options={[
                { value: "true", label: "Активные" },
                { value: "false", label: "Заблокированные" },
                { value: "", label: "Все" },
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
              "minmax(200px, 1.6fr) minmax(110px, 0.9fr) minmax(140px, 1.1fr) minmax(140px, 1fr) minmax(70px, 0.5fr) minmax(70px, 0.5fr) minmax(140px, 1fr) minmax(140px, 1fr)",
          }}
        >
          <div className="admin-portal__table-row admin-portal__table-row--head">
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Email</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">public_id</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">ФИО</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Телефон</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Staff</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Активен</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Регистрация</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Последний вход</div>
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
              <div className="admin-portal__table-cell admin-portal__table-cell--body">
                <Link
                  to={`/admin-console/users/${row.id}`}
                  className="lk-admin-users__email-link"
                >
                  {row.email}
                </Link>
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body admin-portal__table-cell--mono">
                {row.public_id || "—"}
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body">
                <span className="admin-portal__table-cell--ellipsis">{row.fio || "—"}</span>
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body admin-portal__table-cell--mono">
                {row.phone || "—"}
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body">
                <YesNoBadge value={Boolean(row.is_staff)} />
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body">
                <YesNoBadge value={Boolean(row.is_active)} />
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body admin-portal__table-cell--mono">
                {formatDateTime(row.date_joined)}
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body admin-portal__table-cell--mono">
                {formatDateTime(row.last_login)}
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
