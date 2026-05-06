import { useCallback, useEffect, useState } from "react";
import { API_ENDPOINTS } from "../../../config/api";
import "../dashboard/dashboard.css";
import "./partner.css";

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function PartnerDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [copyHint, setCopyHint] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setCopyHint("");
    try {
      const onboardRes = await fetch(API_ENDPOINTS.partnerOnboard, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: "{}",
      });

      const onboardPayload = await onboardRes.json().catch(() => ({}));

      if (!onboardRes.ok) {
        setData(null);
        const d = onboardPayload.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setError(detailMsg || `Ошибка партнёра (${onboardRes.status})`);
        return;
      }

      setData(onboardPayload);
    } catch (e) {
      console.error(e);
      setData(null);
      setError("Сетевая ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onCopy = async () => {
    const link = data?.referral_link;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopyHint("Скопировано");
      setTimeout(() => setCopyHint(""), 2000);
    } catch {
      setCopyHint("Не удалось скопировать");
    }
  };

  const history = Array.isArray(data?.commission_history) ? data.commission_history : [];
  const recentLeads = Array.isArray(data?.recent_leads) ? data.recent_leads : [];
  const recentOrders = Array.isArray(data?.recent_orders) ? data.recent_orders : [];

  return (
    <div className="lk-dashboard lk-partner">
      <h1 className="lk-dashboard__title">Партнёрская ссылка</h1>
      <p className="lk-dashboard__subtitle">
        Персональная ссылка, код и статистика — отдельно от агентских программ на панели.
      </p>

      {loading && <p className="lk-partner__muted">Загрузка…</p>}
      {!loading && error && <div className="lk-partner__error">{String(error)}</div>}

      {!loading && data && (
        <>
          <h2 className="lk-partner__section-title" style={{ marginTop: 20 }}>
            Моя реферальная ссылка
          </h2>
          <div className="lk-partner__link-row">
            <input
              className="lk-partner__link-input"
              readOnly
              value={data.referral_link || ""}
              aria-label="Полная реферальная ссылка"
            />
            <button type="button" className="lk-partner__copy-btn" onClick={onCopy}>
              Копировать
            </button>
          </div>
          {copyHint ? <p className="lk-partner__muted">{copyHint}</p> : null}

          <div className="lk-partner__stats">
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Код</div>
              <div className="lk-partner__stat-value">{data.ref_code}</div>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Статус</div>
              <div className="lk-partner__stat-value">{data.status}</div>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Комиссия, %</div>
              <div className="lk-partner__stat-value">{data.commission_percent}</div>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Визиты</div>
              <div className="lk-partner__stat-value">{data.visit_count}</div>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Лиды</div>
              <div className="lk-partner__stat-value">{data.total_leads_count ?? 0}</div>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Заказы (все)</div>
              <div className="lk-partner__stat-value">{data.attributed_orders_count}</div>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Оплаченные</div>
              <div className="lk-partner__stat-value">{data.paid_orders_count}</div>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Сумма заказов</div>
              <div className="lk-partner__stat-value">{data.attributed_orders_amount_total ?? "—"}</div>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Баланс доступно</div>
              <div className="lk-partner__stat-value">{data.balance_available}</div>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Баланс всего</div>
              <div className="lk-partner__stat-value">{data.balance_total}</div>
            </div>
            <div className="lk-partner__stat">
              <div className="lk-partner__stat-label">Комиссии сумма</div>
              <div className="lk-partner__stat-value">{data.commissions_total}</div>
            </div>
          </div>

          <h2 className="lk-partner__section-title">Недавние заказы</h2>
          {recentOrders.length === 0 ? (
            <p className="lk-partner__muted">Пока нет заказов с суммой по вашей ссылке</p>
          ) : (
            <div className="lk-partner__table-wrap">
              <table className="lk-partner__table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Сумма</th>
                    <th>Валюта</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((row) => (
                    <tr key={row.id}>
                      <td>{row.created_at?.replace("T", " ").slice(0, 19)}</td>
                      <td>{row.amount ?? "—"}</td>
                      <td>{row.currency || "—"}</td>
                      <td>{row.status ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 className="lk-partner__section-title">Недавние лиды</h2>
          {recentLeads.length === 0 ? (
            <p className="lk-partner__muted">Пока нет лидов с виджета</p>
          ) : (
            <div className="lk-partner__table-wrap">
              <table className="lk-partner__table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Сумма</th>
                    <th>Валюта</th>
                    <th>Email (маска)</th>
                    <th>Страница</th>
                  </tr>
                </thead>
                <tbody>
                  {recentLeads.map((row, idx) => (
                    <tr key={`${row.created_at}-${row.page_path || ""}-${idx}`}>
                      <td>{row.created_at?.replace("T", " ").slice(0, 19)}</td>
                      <td>{row.amount != null && row.amount !== "" ? row.amount : "—"}</td>
                      <td>{row.currency || "—"}</td>
                      <td>{row.customer_email_masked || "—"}</td>
                      <td title={row.page_path || ""}>{row.page_path || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 className="lk-partner__section-title">История комиссий</h2>
          {history.length === 0 ? (
            <p className="lk-partner__muted">Пока нет начислений</p>
          ) : (
            <div className="lk-partner__table-wrap">
              <table className="lk-partner__table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Заказ</th>
                    <th>База</th>
                    <th>%</th>
                    <th>Комиссия</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td>{row.created_at?.replace("T", " ").slice(0, 19)}</td>
                      <td>{row.order_id}</td>
                      <td>{row.base_amount}</td>
                      <td>{row.commission_percent}</td>
                      <td>{row.commission_amount}</td>
                      <td>{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PartnerDashboard;
