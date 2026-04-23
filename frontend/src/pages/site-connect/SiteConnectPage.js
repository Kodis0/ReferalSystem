import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../config/api";
import { isUuidString } from "../registration/postJoinNavigation";
import "../lk/dashboard/dashboard.css";
import "../lk/partner/partner.css";
import "../lk/widget-install/widget-install.css";
import "./site-connect.css";

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function withSelectedSite(url, sitePublicId) {
  if (!sitePublicId) return url;
  const u = new URL(url, window.location.origin);
  u.searchParams.set("site_public_id", sitePublicId);
  return u.toString();
}

/**
 * Auth-only standalone screen (no LK layout): embed snippet + copy + video placeholder.
 * Route: /site-connect?site_public_id=…
 */
export default function SiteConnectPage() {
  const [searchParams] = useSearchParams();
  const rawId = String(searchParams.get("site_public_id") || "").trim();
  const sitePublicId = isUuidString(rawId) ? rawId : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snippet, setSnippet] = useState("");
  const [copyHint, setCopyHint] = useState("");

  const load = useCallback(async () => {
    if (!sitePublicId) {
      setLoading(false);
      setError("Не указан site_public_id.");
      setSnippet("");
      return;
    }
    setLoading(true);
    setError("");
    setSnippet("");
    try {
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, sitePublicId), {
        method: "GET",
        headers: authHeaders(),
        credentials: "include",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = payload?.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setError(detailMsg || `Ошибка загрузки (${res.status})`);
        return;
      }
      const text = typeof payload?.widget_embed_snippet === "string" ? payload.widget_embed_snippet : "";
      if (!text.trim()) {
        setError("Сниппет для этого сайта пока не готов. Обновите страницу позже.");
        return;
      }
      setSnippet(text);
    } catch (e) {
      console.error(e);
      setError("Сетевая ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  }, [sitePublicId]);

  useEffect(() => {
    load();
  }, [load]);

  const onCopySnippet = useCallback(async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopyHint("Код скопирован");
      window.setTimeout(() => setCopyHint(""), 2000);
    } catch {
      setCopyHint("Не удалось скопировать");
      window.setTimeout(() => setCopyHint(""), 2000);
    }
  }, [snippet]);

  let body;
  if (!sitePublicId && !loading) {
    body = (
      <div className="lk-partner__error" role="alert">
        {error || "Укажите site_public_id в адресе страницы."}
      </div>
    );
  } else if (loading) {
    body = <p className="lk-partner__muted">Загрузка…</p>;
  } else if (error) {
    body = (
      <div className="lk-partner__error" role="alert">
        {error}
      </div>
    );
  } else {
    body = (
      <>
        <section className="lk-widget-install__card lk-widget-install__install-hero" data-testid="site-connect-snippet-block">
          <div className="lk-widget-install__install-hero-head">
            <h2 className="lk-partner__section-title lk-widget-install__install-title">Код подключения</h2>
          </div>
          <div className="lk-widget-install__snippet-wrap">
            <pre className="lk-widget-install__mono lk-widget-install__snippet">{snippet}</pre>
          </div>
          <div className="lk-widget-install__install-actions">
            <button type="button" className="lk-widget-install__btn lk-widget-install__install-copy-btn" onClick={onCopySnippet}>
              Скопировать код
            </button>
            {copyHint ? (
              <span className="lk-widget-install__install-feedback" role="status">
                {copyHint}
              </span>
            ) : null}
          </div>
        </section>

        <section
          className="lk-widget-install__card lk-widget-install__video-placeholder"
          aria-labelledby="site-connect-video-title"
        >
          <h2 id="site-connect-video-title" className="lk-partner__section-title">
            Видеоинструкция
          </h2>
          <p className="lk-partner__muted">Здесь будет видеоинструкция по подключению.</p>
        </section>
      </>
    );
  }

  return (
    <div className="site-connect-root">
      <div className="lk-dashboard lk-partner lk-widget-install lk-widget-install_focused" data-testid="site-connect-page">
        <h1 className="lk-dashboard__title">Подключите сайт</h1>
        {body}
      </div>
    </div>
  );
}
