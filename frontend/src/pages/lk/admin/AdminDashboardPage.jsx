import { useCallback, useEffect, useState } from "react";
import { Building2, TrendingUp, Users } from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
import { adminFetch } from "../../../components/adminAuth";
import "./admin.css";

const INTEGER_FORMATTER = new Intl.NumberFormat("ru-RU");
const MONEY_FORMATTER = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return INTEGER_FORMATTER.format(n);
}

function formatMoney(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return "0,00";
  return MONEY_FORMATTER.format(n);
}

export default function AdminDashboardPage() {
  const [status, setStatus] = useState("loading");
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await adminFetch(API_ENDPOINTS.adminDashboardStats, {
        credentials: "include",
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const payload = await res.json().catch(() => null);
      if (!payload || typeof payload !== "object") {
        setStatus("error");
        return;
      }
      setData(payload);
      setStatus("ready");
    } catch (_) {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (status === "loading") {
    return (
      <section className="lk-admin-dashboard" aria-labelledby="lk-admin-dashboard-title">
        <header className="lk-admin-dashboard__header">
          <h1 id="lk-admin-dashboard-title" className="lk-admin-dashboard__title">
            Дашборд
          </h1>
        </header>
        <div
          className="lk-admin-dashboard__loading"
          role="status"
          data-testid="admin-dashboard-loading"
        >
          Загрузка…
        </div>
      </section>
    );
  }

  if (status === "error" || !data) {
    return (
      <section className="lk-admin-dashboard" aria-labelledby="lk-admin-dashboard-title">
        <header className="lk-admin-dashboard__header">
          <h1 id="lk-admin-dashboard-title" className="lk-admin-dashboard__title">
            Дашборд
          </h1>
        </header>
        <div
          className="lk-admin-dashboard__error"
          role="alert"
          data-testid="admin-dashboard-error"
        >
          <span>Не удалось загрузить статистику</span>
          <button
            type="button"
            className="lk-admin-dashboard__retry"
            onClick={load}
            data-testid="admin-dashboard-retry"
          >
            Повторить
          </button>
        </div>
      </section>
    );
  }

  const currency = data.platform_revenue_currency || "RUB";

  return (
    <section className="lk-admin-dashboard" aria-labelledby="lk-admin-dashboard-title">
      <header className="lk-admin-dashboard__header">
        <h1 id="lk-admin-dashboard-title" className="lk-admin-dashboard__title">
          Дашборд
        </h1>
        <p className="lk-admin-dashboard__subtitle">
          Ключевые метрики платформы.
        </p>
      </header>
      <div className="lk-admin-dashboard__grid">
        <article
          className="lk-admin-dashboard__card"
          data-testid="admin-dashboard-card-revenue"
        >
          <span className="lk-admin-dashboard__card-icon" aria-hidden="true">
            <TrendingUp size={20} strokeWidth={1.75} />
          </span>
          <span className="lk-admin-dashboard__card-label">Заработок платформы</span>
          <span className="lk-admin-dashboard__card-value">
            {formatMoney(data.platform_revenue_amount)}{" "}
            <span className="lk-admin-dashboard__card-currency">{currency}</span>
          </span>
          <span className="lk-admin-dashboard__card-subline">
            Оборот: {formatMoney(data.orders_total_amount)} {currency}, выплачено
            партнёрам: {formatMoney(data.partners_payout_amount)} {currency}
          </span>
        </article>

        <article
          className="lk-admin-dashboard__card"
          data-testid="admin-dashboard-card-users"
        >
          <span className="lk-admin-dashboard__card-icon" aria-hidden="true">
            <Users size={20} strokeWidth={1.75} />
          </span>
          <span className="lk-admin-dashboard__card-label">Пользователи</span>
          <span className="lk-admin-dashboard__card-value">
            {formatInteger(data.users_count)}
          </span>
        </article>

        <article
          className="lk-admin-dashboard__card"
          data-testid="admin-dashboard-card-partners"
        >
          <span className="lk-admin-dashboard__card-icon" aria-hidden="true">
            <Building2 size={20} strokeWidth={1.75} />
          </span>
          <span className="lk-admin-dashboard__card-label">Партнёры</span>
          <span className="lk-admin-dashboard__card-value">
            {formatInteger(data.partners_count)}
          </span>
        </article>
      </div>
    </section>
  );
}
