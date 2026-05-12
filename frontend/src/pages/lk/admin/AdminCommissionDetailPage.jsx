import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
import "./admin.css";

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

function DetailRow({ label, children }) {
  return (
    <div className="lk-admin-user-detail__row">
      <span className="lk-admin-user-detail__row-label">{label}</span>
      <span className="lk-admin-user-detail__row-value">{children}</span>
    </div>
  );
}

export default function AdminCommissionDetailPage() {
  const { commissionId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [commission, setCommission] = useState(null);
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotFound(false);
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
      const res = await fetch(API_ENDPOINTS.adminCommissionDetail(commissionId), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        signal: controller.signal,
      });
      if (res.status === 404) {
        setNotFound(true);
        setCommission(null);
        return;
      }
      if (!res.ok) {
        setError(res.status === 403 ? "Недостаточно прав" : "Не удалось загрузить комиссию");
        setCommission(null);
        return;
      }
      const payload = await res.json().catch(() => null);
      setCommission(payload || null);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setError("Сетевая ошибка, попробуйте позже");
      setCommission(null);
    } finally {
      setLoading(false);
    }
  }, [commissionId]);

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

  const backLink = (
    <Link to="/admin-console/commissions" className="lk-admin-user-detail__back">
      <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>К списку комиссий</span>
    </Link>
  );

  if (loading) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-commission-detail-title"
      >
        {backLink}
        <p className="lk-admin-users__muted">Загрузка…</p>
      </section>
    );
  }

  if (notFound) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-commission-detail-title"
      >
        {backLink}
        <h1
          id="lk-admin-commission-detail-title"
          className="lk-admin-cabinet__title"
        >
          Комиссия не найдена
        </h1>
        <p className="lk-admin-users__muted">
          Комиссии с идентификатором {commissionId} нет в системе.
        </p>
      </section>
    );
  }

  if (error || !commission) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-commission-detail-title"
      >
        {backLink}
        <div className="lk-admin-users__error" role="alert">
          {error || "Не удалось загрузить комиссию"}
        </div>
      </section>
    );
  }

  return (
    <section
      className="lk-admin-user-detail"
      aria-labelledby="lk-admin-commission-detail-title"
    >
      {backLink}
      <header className="lk-admin-user-detail__header">
        <h1
          id="lk-admin-commission-detail-title"
          className="lk-admin-cabinet__title"
        >
          #{commission.id}
        </h1>
      </header>

      <div className="lk-admin-user-detail__cards">
        <article className="lk-admin-user-detail__card" aria-label="Основное">
          <h2 className="lk-admin-user-detail__card-title">Основное</h2>
          <DetailRow label="ID">{commission.id}</DetailRow>
          <DetailRow label="Статус">{commission.status || "—"}</DetailRow>
          <DetailRow label="Базовая сумма">
            {commission.base_amount ?? "—"}
          </DetailRow>
          <DetailRow label="Процент комиссии">
            {commission.commission_percent ?? "—"}
          </DetailRow>
          <DetailRow label="Сумма комиссии">
            {commission.commission_amount ?? "—"}
          </DetailRow>
          <DetailRow label="Создан">
            {formatDateTime(commission.created_at)}
          </DetailRow>
          <DetailRow label="Подтверждён">
            {formatDateTime(commission.approved_at)}
          </DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Партнёр">
          <h2 className="lk-admin-user-detail__card-title">Партнёр</h2>
          <DetailRow label="ID">{commission.partner_id ?? "—"}</DetailRow>
          <DetailRow label="Email">
            {commission.partner_user_email || "—"}
          </DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Заказ-источник">
          <h2 className="lk-admin-user-detail__card-title">Заказ-источник</h2>
          <DetailRow label="Order ID">
            {commission.order_id != null ? (
              <Link
                to={`/admin-console/orders/${commission.order_id}`}
                className="lk-admin-users__email-link"
              >
                #{commission.order_id}
              </Link>
            ) : (
              "—"
            )}
          </DetailRow>
          <DetailRow label="External ID">
            {commission.order_external_id || "—"}
          </DetailRow>
          <DetailRow label="Сумма заказа">
            {commission.order_amount != null
              ? `${commission.order_amount} ${commission.order_currency || ""}`.trim()
              : "—"}
          </DetailRow>
          <DetailRow label="Статус заказа">
            {commission.order_status || "—"}
          </DetailRow>
        </article>
      </div>
    </section>
  );
}
