import './registration.css';
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../config/api";
import {
  buildSiteCtaJoinRequestBody,
  ctaContextFromURLSearchParams,
} from "./ctaQuery";
import { buildPostJoinDashboardPath } from "./postJoinNavigation";
import { formatRegistrationErrors } from "./registrationErrors";

/**
 * CTA / Tilda block → app registration query contract (MVP):
 *   ?site=<uuid> or ?site_public_id=<uuid>  — target Site.public_id
 *   ?ref=<code> or ?ref_code=<code>        — optional partner ref (same as signup body)
 * Widget builders can deep-link the SPA registration route with these params.
 */

const REGISTER_URL = API_ENDPOINTS.register;
/** Если бэкенд не прислал redirect_url — открываем вкладку «Панель» (после выдачи JWT при регистрации). */
const DEFAULT_REDIRECT = "/lk/dashboard";

function Registration() {
  const [searchParams] = useSearchParams();
  const ctaContext = useMemo(
    () => ctaContextFromURLSearchParams(searchParams),
    [searchParams]
  );

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  /** Logged-in user + CTA site: automatic join instead of signup form. */
  const [ctaJoinPhase, setCtaJoinPhase] = useState("idle");

  useEffect(() => {
    const body = buildSiteCtaJoinRequestBody(ctaContext);
    if (!body) return;
    const token = (localStorage.getItem("access_token") || "").trim();
    if (!token) return;

    let cancelled = false;
    (async () => {
      setCtaJoinPhase("loading");
      try {
        const res = await fetch(API_ENDPOINTS.siteCtaJoin, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          credentials: "include",
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 401) {
          setCtaJoinPhase("idle");
          return;
        }
        if (res.ok) {
          setCtaJoinPhase("done");
          const siteId = data.site_public_id;
          const outcome =
            data.status === "already_joined" ? "already_joined" : "joined";
          const path = buildPostJoinDashboardPath(siteId, outcome, data.site_display_label);
          window.location.href = `${window.location.origin}${path}`;
          return;
        }
        setCtaJoinPhase("error");
        setMessage(formatRegistrationErrors(data));
      } catch (err) {
        if (!cancelled) {
          console.error("Site CTA join error:", err);
          setCtaJoinPhase("error");
          setMessage("Ошибка сети или сервера. Попробуйте позже.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctaContext.site_public_id, ctaContext.ref]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const payload = { email, password };
    if (username.trim()) payload.username = username.trim();
    if (ctaContext.site_public_id) payload.site_public_id = ctaContext.site_public_id;
    if (ctaContext.ref) {
      payload.ref = ctaContext.ref;
      payload.ref_code = ctaContext.ref;
    }

    try {
      const res = await fetch(REGISTER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        if (data.access && data.refresh) {
          localStorage.setItem("access_token", data.access);
          localStorage.setItem("refresh_token", data.refresh);
          if (data.user) {
            localStorage.setItem("user", JSON.stringify(data.user));
          }
        }
        let redirectUrl = data.redirect_url || DEFAULT_REDIRECT;
        const cj = data.cta_join;
        const siteFromResponse = cj && cj.site_public_id;
        const siteForJoin = siteFromResponse || ctaContext.site_public_id;
        if (siteForJoin) {
          const outcome =
            cj && cj.status === "already_joined"
              ? "already_joined"
              : "joined";
          const path = buildPostJoinDashboardPath(
            siteForJoin,
            outcome,
            cj && cj.site_display_label
          );
          redirectUrl = path;
        }
        const target = redirectUrl.startsWith("http")
          ? redirectUrl
          : `${window.location.origin}${redirectUrl.startsWith("/") ? redirectUrl : "/" + redirectUrl}`;
        window.location.href = target;
        return;
      }

      if (res.status === 400 || res.status === 403) {
        setMessage(formatRegistrationErrors(data));
        setLoading(false);
        return;
      }

      const fallback = formatRegistrationErrors(data);
      setMessage(
        fallback !== "Ошибка регистрации"
          ? fallback
          : "Не удалось зарегистрироваться"
      );
    } catch (err) {
      console.error("Registration error:", err);
      setMessage("Ошибка сети или сервера. Попробуйте позже.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="registration-page">
      <div className="container">
        {message && (
          <div
            className="message"
            style={{
              backgroundColor: message.startsWith("✅") ? "#0d9488" : "#dc2626",
              color: "#fff",
            }}
          >
            {message}
          </div>
        )}

        <div className="circle"></div>
        <h1>Регистрация</h1>
        <h2>
          {ctaJoinPhase === "loading" || ctaJoinPhase === "done"
            ? "Присоединение к программе"
            : "Создайте аккаунт"}
        </h2>

        {(ctaJoinPhase === "loading" || ctaJoinPhase === "done") && (
          <p className="registration-cta-hint" style={{ textAlign: "center" }}>
            {ctaJoinPhase === "loading"
              ? "Проверяем вход и подключаем к площадке…"
              : null}
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          style={{
            display:
              ctaJoinPhase === "loading" || ctaJoinPhase === "done"
                ? "none"
                : undefined,
          }}
        >
          <div className="form-group">
            <input
              type="text"
              id="username"
              name="username"
              placeholder=" "
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <label htmlFor="username">Имя</label>
          </div>
          <div className="form-group">
            <input
              type="email"
              id="email"
              name="email"
              placeholder=" "
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <label htmlFor="email">Email</label>
          </div>
          <div className="form-group">
            <input
              type="password"
              id="password"
              name="password"
              placeholder=" "
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <label htmlFor="password">Пароль</label>
          </div>
          <button type="submit" disabled={loading}>
            {loading ? "Регистрация..." : "Зарегистрироваться"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Registration;
