import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./owner-programs.css";

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function formatApiFieldErrors(payload) {
  if (!payload || typeof payload !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(payload)) {
    if (k === "detail") continue;
    if (Array.isArray(v)) parts.push(`${k}: ${v.join(" ")}`);
    else if (typeof v === "string") parts.push(`${k}: ${v}`);
  }
  return parts.join("\n");
}

export default function CreateOwnerProjectPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [origin, setOrigin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setFieldErrors({});
    try {
      const res = await fetch(API_ENDPOINTS.siteCreate, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({
          display_name: displayName.trim(),
          origin: origin.trim(),
          platform_preset: "tilda",
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 400 && payload && typeof payload === "object") {
          const fe = {};
          for (const [k, v] of Object.entries(payload)) {
            if (Array.isArray(v) && v.length) fe[k] = v.join(" ");
            else if (typeof v === "string") fe[k] = v;
          }
          setFieldErrors(fe);
        }
        const d = payload.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        const flat = formatApiFieldErrors(payload);
        setError(detailMsg || flat || `Не удалось создать проект (${res.status})`);
        return;
      }
      const id = payload.public_id && isUuidString(payload.public_id) ? payload.public_id.trim() : "";
      if (id) {
        navigate(`/lk/partner/${id}/overview`, { replace: true });
        return;
      }
      setError("Сервер не вернул идентификатор проекта");
    } catch (err) {
      console.error(err);
      setError("Сетевая ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lk-dashboard lk-partner">
      <h1 className="lk-dashboard__title">Новый проект</h1>
      <p className="lk-dashboard__subtitle">
        Создайте отдельную площадку (сайт) для виджета. Платформа по умолчанию: Tilda.
      </p>
      <p className="owner-programs__muted">
        <Link to="/lk/partner">← К списку проектов</Link>
      </p>

      <form className="owner-programs__form" onSubmit={onSubmit}>
        <div className="owner-programs__field">
          <label className="owner-programs__label" htmlFor="owner-new-project-name">
            Название проекта
          </label>
          <input
            id="owner-new-project-name"
            className="owner-programs__input"
            value={displayName}
            onChange={(ev) => setDisplayName(ev.target.value)}
            autoComplete="off"
            maxLength={200}
            required
          />
          {fieldErrors.display_name ? (
            <div className="owner-programs__field-error">{fieldErrors.display_name}</div>
          ) : null}
        </div>
        <div className="owner-programs__field">
          <label className="owner-programs__label" htmlFor="owner-new-project-origin">
            Домен / origin
          </label>
          <input
            id="owner-new-project-origin"
            className="owner-programs__input"
            value={origin}
            onChange={(ev) => setOrigin(ev.target.value)}
            placeholder="https://mysite.tilda.ws"
            autoComplete="off"
            required
          />
          <p className="owner-programs__field-hint">Можно указать с https:// или только домен (будет добавлен https://).</p>
          {fieldErrors.origin ? <div className="owner-programs__field-error">{fieldErrors.origin}</div> : null}
        </div>
        {fieldErrors.platform_preset ? (
          <div className="owner-programs__field-error">{fieldErrors.platform_preset}</div>
        ) : null}
        {error ? <div className="owner-programs__error">{error}</div> : null}
        <div className="owner-programs__actions" style={{ marginTop: 8 }}>
          <button type="submit" className="owner-programs__btn" disabled={loading}>
            {loading ? "Создание…" : "Создать проект"}
          </button>
          <Link to="/lk/partner" className="lk-partner__muted" style={{ alignSelf: "center" }}>
            Отмена
          </Link>
        </div>
      </form>
    </div>
  );
}
