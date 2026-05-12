import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { adminFetch } from "../../../components/adminAuth";
import AdminPortalDropdown from "./AdminPortalDropdown";
import AdminPortalPagination from "./AdminPortalPagination";
import "./admin.css";

const PAGE_SIZE = 20;
const COMMISSION_STATUSES = ["pending", "approved"];

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

export default function AdminCommissionsPage() {
  const [statusFilter, setStatusFilter] = useState("");
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
  }, [statusFilter]);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    params.set("page", String(page));
    params.set("page_size", String(PAGE_SIZE));
    return `${API_ENDPOINTS.adminCommissionsList}?${params.toString()}`;
  }, [statusFilter, page]);

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
    <section className="lk-admin-users" aria-labelledby="lk-admin-commissions-title">
      <header className="lk-admin-users__header">
        <h1 id="lk-admin-commissions-title" className="lk-admin-cabinet__title">
          Комиссии
        </h1>
      </header>

      <div className="admin-portal__toolbar" role="group" aria-label="Фильтры">
        <div className="admin-portal__toolbar-filters">
          <div className="admin-portal__toolbar-filter">
            <span className="admin-portal__toolbar-filter-label">Статус</span>
            <AdminPortalDropdown
              ariaLabel="Фильтр по статусу комиссии"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "", label: "Все" },
                ...COMMISSION_STATUSES.map((opt) => ({ value: opt, label: opt })),
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
              "minmax(80px, 0.4fr) minmax(200px, 1.5fr) minmax(160px, 1fr) minmax(140px, 0.8fr) minmax(110px, 0.6fr) minmax(110px, 0.6fr) minmax(150px, 1fr)",
          }}
        >
          <div className="admin-portal__table-row admin-portal__table-row--head">
            <div className="admin-portal__table-cell admin-portal__table-cell--head">ID</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Партнёр</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Заказ</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head admin-portal__table-cell--right">Сумма комиссии</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head admin-portal__table-cell--right">Процент</div>
            <div className="admin-portal__table-cell admin-portal__table-cell--head">Статус</div>
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
                  to={`/admin-console/commissions/${row.id}`}
                  className="lk-admin-users__email-link"
                >
                  #{row.id}
                </Link>
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body">
                <span className="admin-portal__table-cell--ellipsis">{row.partner_user_email || "—"}</span>
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body admin-portal__table-cell--mono">
                {row.order_id != null ? (
                  <Link
                    to={`/admin-console/orders/${row.order_id}`}
                    className="lk-admin-users__email-link"
                  >
                    #{row.order_id}
                    {row.order_external_id ? ` (${row.order_external_id})` : ""}
                  </Link>
                ) : (
                  "—"
                )}
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body admin-portal__table-cell--mono admin-portal__table-cell--right">
                {row.commission_amount ?? "—"}
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body admin-portal__table-cell--mono admin-portal__table-cell--right">
                {row.commission_percent ?? "—"}
              </div>
              <div className="admin-portal__table-cell admin-portal__table-cell--body">{row.status || "—"}</div>
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
