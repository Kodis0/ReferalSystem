import { useCallback, useEffect, useRef, useState } from "react";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./balance.css";
import {
  fetchProgramBudgetBalance,
  fetchProgramBudgetTransactions,
  formatProgramBudgetMoney,
  topUpProgramBudget,
} from "./programBudgetApi";

const PROGRAM_BUDGET_TOPUP_METHODS = [
  { id: "bank_card", label: "Банковская карта" },
];

function getTopUpMethodLabel(methodId) {
  return PROGRAM_BUDGET_TOPUP_METHODS.find((method) => method.id === methodId)?.label || "Банковская карта";
}

function TopUpMethodIcon({ methodId }) {
  return (
    <span className="lk-balance__method-icon" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2.5" y="4.5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 8H16.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M5.5 12.5H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function BalancePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [programBudget, setProgramBudget] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpMethod, setTopUpMethod] = useState(PROGRAM_BUDGET_TOPUP_METHODS[0].id);
  const [topUpMethodOpen, setTopUpMethodOpen] = useState(false);
  const [topUpError, setTopUpError] = useState("");
  const [topUpNotice, setTopUpNotice] = useState("");
  const [topUpSubmitting, setTopUpSubmitting] = useState(false);
  const [activeSection, setActiveSection] = useState("topup");
  const topUpMethodRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [balancePayload, transactionsPayload] = await Promise.all([
        fetchProgramBudgetBalance(),
        fetchProgramBudgetTransactions(),
      ]);
      setProgramBudget(balancePayload);
      setTransactions(transactionsPayload);
    } catch (e) {
      setProgramBudget(null);
      setTransactions([]);
      setError(e?.message || "Не удалось загрузить бюджет программы");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onDocumentClick(event) {
      if (topUpMethodRef.current && !topUpMethodRef.current.contains(event.target)) {
        setTopUpMethodOpen(false);
      }
    }

    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  const handleTopUpSubmit = async (event) => {
    event.preventDefault();
    setTopUpError("");
    setTopUpNotice("");
    setTopUpSubmitting(true);

    try {
      const result = await topUpProgramBudget({ amount: topUpAmount, paymentMethod: topUpMethod });
      setProgramBudget(result.balance);
      const nextTransactions = await fetchProgramBudgetTransactions();
      setTransactions(nextTransactions);
      setTopUpAmount("");
      if (result.paymentUrl) {
        window.location.assign(result.paymentUrl);
        return;
      }
      setTopUpNotice(result.detail || "Платеж обрабатывается. Баланс обновится после подтверждения оплаты.");
    } catch (e) {
      setTopUpError(e?.message || "Не удалось пополнить бюджет");
    } finally {
      setTopUpSubmitting(false);
    }
  };

  return (
    <div className="lk-dashboard lk-balance">
      <h1 className="lk-dashboard__title">Бюджет программы</h1>
      <p className="lk-dashboard__subtitle">Эти средства используются для будущих выплат рефералам.</p>

      <nav className="lk-balance__tabs" aria-label="Операции с бюджетом программы">
        <button
          type="button"
          className={`lk-balance__tab ${activeSection === "topup" ? "lk-balance__tab_active" : ""}`}
          onClick={() => setActiveSection("topup")}
        >
          Пополнение
        </button>
        <button
          type="button"
          className={`lk-balance__tab ${activeSection === "withdraw" ? "lk-balance__tab_active" : ""}`}
          onClick={() => setActiveSection("withdraw")}
        >
          Вывод
        </button>
      </nav>

      {loading && <p className="lk-partner__muted">Загрузка…</p>}
      {!loading && error && <div className="lk-partner__error">{String(error)}</div>}

      {!loading && programBudget && activeSection === "topup" && (
        <>
          <section className="lk-balance__hero" aria-label="Текущий баланс">
            <div>
              <div className="lk-balance__hero-label">Текущий баланс</div>
              <div className="lk-balance__hero-value">
                {formatProgramBudgetMoney(programBudget.availableAmount, programBudget.currency)}
              </div>
            </div>
          </section>

          <form className="lk-balance__topup-panel" onSubmit={handleTopUpSubmit}>
            <h2 className="lk-balance__panel-title">Пополнить бюджет</h2>

            <div className="lk-balance__field lk-balance__topup-method" ref={topUpMethodRef}>
              <span>Способ оплаты</span>
              <button
                type="button"
                className="lk-balance__method-trigger"
                onClick={() => setTopUpMethodOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={topUpMethodOpen}
              >
                <TopUpMethodIcon methodId={topUpMethod} />
                <span>{getTopUpMethodLabel(topUpMethod)}</span>
                <span className={`lk-balance__method-chevron ${topUpMethodOpen ? "lk-balance__method-chevron_open" : ""}`}>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </span>
              </button>
              {topUpMethodOpen && (
                <div className="lk-balance__method-menu" role="menu">
                  {PROGRAM_BUDGET_TOPUP_METHODS.map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      className="lk-balance__method-item"
                      role="menuitem"
                      onClick={() => {
                        setTopUpMethod(method.id);
                        setTopUpMethodOpen(false);
                      }}
                    >
                      <TopUpMethodIcon methodId={method.id} />
                      <span>{method.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="lk-balance__method-note">Оплата банковской картой</p>

            <label className="lk-balance__field lk-balance__topup-amount">
              <span>Сумма</span>
              <input
                value={topUpAmount}
                onChange={(event) => setTopUpAmount(event.target.value)}
                inputMode="decimal"
                placeholder="1000"
              />
            </label>

            {topUpNotice ? <div className="lk-balance__notice">{topUpNotice}</div> : null}
            {topUpError ? <div className="lk-partner__error">{topUpError}</div> : null}

            <button type="submit" className="lk-balance__topup-btn" disabled={topUpSubmitting}>
              {topUpSubmitting ? "Пополняем…" : "Пополнить бюджет"}
            </button>
          </form>

          <h2 className="lk-partner__section-title">История пополнений</h2>
          {transactions.length === 0 ? (
            <p className="lk-partner__muted">Операций пока нет</p>
          ) : (
            <div className="lk-partner__table-wrap">
              <table className="lk-partner__table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Способ</th>
                    <th>Сумма</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((row) => (
                    <tr key={row.id}>
                      <td>{row.createdAt?.replace("T", " ").slice(0, 19)}</td>
                      <td>{getTopUpMethodLabel(row.paymentMethod)}</td>
                      <td>{formatProgramBudgetMoney(row.amount, row.currency)}</td>
                      <td>{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!loading && programBudget && activeSection === "withdraw" && (
        <>
          <section className="lk-balance__hero" aria-label="Вывод средств">
            <div>
              <div className="lk-balance__hero-label">Доступно в бюджете программы</div>
              <div className="lk-balance__hero-value">
                {formatProgramBudgetMoney(programBudget.availableAmount, programBudget.currency)}
              </div>
            </div>
          </section>

          <div className="lk-balance__placeholder">
            <h2>Вывод средств</h2>
            <p>Вывод из бюджета программы пока недоступен. Эти средства зарезервированы для будущих выплат рефералам.</p>
          </div>

          <h2 className="lk-partner__section-title">История выводов</h2>
          <p className="lk-partner__muted">Операций пока нет</p>
        </>
      )}
    </div>
  );
}

export default BalancePage;
