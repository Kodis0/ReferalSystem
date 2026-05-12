import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
import { adminFetch } from "../../../components/adminAuth";
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

function formatPayload(value) {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function AdminOrderDetailPage() {
  const { orderId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [order, setOrder] = useState(null);
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
      const res = await adminFetch(API_ENDPOINTS.adminOrderDetail(orderId), {
        credentials: "include",
        signal: controller.signal,
      });
      if (res.status === 404) {
        setNotFound(true);
        setOrder(null);
        return;
      }
      if (!res.ok) {
        setError(res.status === 403 ? "Недостаточно прав" : "Не удалось загрузить заказ");
        setOrder(null);
        return;
      }
      const payload = await res.json().catch(() => null);
      setOrder(payload || null);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setError("Сетевая ошибка, попробуйте позже");
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

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
    <Link to="/admin-console/orders" className="lk-admin-user-detail__back">
      <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>К списку заказов</span>
    </Link>
  );

  if (loading) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-order-detail-title"
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
        aria-labelledby="lk-admin-order-detail-title"
      >
        {backLink}
        <h1 id="lk-admin-order-detail-title" className="lk-admin-cabinet__title">
          Заказ не найден
        </h1>
        <p className="lk-admin-users__muted">
          Заказа с идентификатором {orderId} нет в системе.
        </p>
      </section>
    );
  }

  if (error || !order) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-order-detail-title"
      >
        {backLink}
        <div className="lk-admin-users__error" role="alert">
          {error || "Не удалось загрузить заказ"}
        </div>
      </section>
    );
  }

  const heading = order.external_id || `#${order.id}`;
  const payloadText = formatPayload(order.raw_payload);

  return (
    <section
      className="lk-admin-user-detail"
      aria-labelledby="lk-admin-order-detail-title"
    >
      {backLink}
      <header className="lk-admin-user-detail__header">
        <h1 id="lk-admin-order-detail-title" className="lk-admin-cabinet__title">
          {heading}
        </h1>
      </header>

      <div className="lk-admin-user-detail__cards">
        <article className="lk-admin-user-detail__card" aria-label="Основное">
          <h2 className="lk-admin-user-detail__card-title">Основное</h2>
          <DetailRow label="ID">{order.id}</DetailRow>
          <DetailRow label="External ID">{order.external_id || "—"}</DetailRow>
          <DetailRow label="Dedupe key">{order.dedupe_key || "—"}</DetailRow>
          <DetailRow label="Источник">{order.source || "—"}</DetailRow>
          <DetailRow label="Статус">{order.status || "—"}</DetailRow>
          <DetailRow label="Сумма">
            {order.amount != null ? `${order.amount} ${order.currency || ""}`.trim() : "—"}
          </DetailRow>
          <DetailRow label="Ref code">{order.ref_code || "—"}</DetailRow>
          <DetailRow label="Оплачен">{formatDateTime(order.paid_at)}</DetailRow>
          <DetailRow label="Создан">{formatDateTime(order.created_at)}</DetailRow>
          <DetailRow label="Обновлён">{formatDateTime(order.updated_at)}</DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Партнёр">
          <h2 className="lk-admin-user-detail__card-title">Партнёр</h2>
          <DetailRow label="ID">{order.partner_id ?? "—"}</DetailRow>
          <DetailRow label="Email">{order.partner_user_email || "—"}</DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Клиент и сайт">
          <h2 className="lk-admin-user-detail__card-title">Клиент и сайт</h2>
          <DetailRow label="Customer email">{order.customer_email || "—"}</DetailRow>
          <DetailRow label="Site ID">{order.site_id ?? "—"}</DetailRow>
          <DetailRow label="Site public_id">{order.site_public_id || "—"}</DetailRow>
          <DetailRow label="Payload fingerprint">
            {order.payload_fingerprint || "—"}
          </DetailRow>
        </article>

        {payloadText ? (
          <article
            className="lk-admin-user-detail__card"
            aria-label="Сырые данные"
            style={{ gridColumn: "1 / -1" }}
          >
            <h2 className="lk-admin-user-detail__card-title">Сырые данные</h2>
            <pre className="lk-admin__pre">{payloadText}</pre>
          </article>
        ) : null}
      </div>
    </section>
  );
}
