import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../config/api";
import { persistReturningUserWelcome } from "../pages/login/login";

/**
 * 1) Редирект с бэка: #oauth=vk|tg&access_token&refresh_token
 * 2) Telegram Login Widget: #tgAuthResult=<base64> → POST /users/token/telegram/widget/
 *
 * Hash берём из window — у BrowserRouter на первом paint часто пустой location.hash.
 * replaceState без успеха не делаем, иначе остаётся «/» без обработки при ошибке сети.
 */
export default function OAuthVkTgFragmentHandler() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastHandledRawRef = useRef(null);

  useLayoutEffect(() => {
    const hashFromWindow = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    const hashFromRouter = (location.hash || "").replace(/^#/, "");
    const raw = hashFromWindow || hashFromRouter;
    if (!raw) return undefined;

    const stripHashFromUrl = () => {
      if (typeof window === "undefined") return;
      const path = window.location.pathname;
      const search = window.location.search;
      window.history.replaceState(null, "", `${path}${search}`);
    };

    /* Не только URLSearchParams: в base64 бывают «+», их get() портит как пробел. */
    let tgB64 = null;
    if (raw.startsWith("tgAuthResult=")) {
      tgB64 = raw.slice("tgAuthResult=".length);
    } else {
      tgB64 = new URLSearchParams(raw).get("tgAuthResult");
    }

    if (tgB64 && tgB64.trim()) {
      const b64 = tgB64.trim();
      if (lastHandledRawRef.current === `w:${b64}`) return undefined;
      lastHandledRawRef.current = `w:${b64}`;

      let cancelled = false;
      (async () => {
        try {
          const response = await fetch(API_ENDPOINTS.tokenTelegramWidget, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tgAuthResult: b64 }),
            credentials: "include",
          });
          let data = {};
          try {
            data = await response.json();
          } catch {
            data = {};
          }
          if (cancelled) return;
          if (!response.ok) {
            stripHashFromUrl();
            const code = typeof data.code === "string" ? data.code : "tg_auth_invalid";
            navigate(`/login?tg_error=${encodeURIComponent(code)}`, { replace: true });
            return;
          }
          localStorage.setItem("access_token", data.access);
          localStorage.setItem("refresh_token", data.refresh);
          if (data.user) {
            localStorage.setItem("user", JSON.stringify(data.user));
            persistReturningUserWelcome(data.user);
          }
          stripHashFromUrl();
          navigate("/lk/partner", { replace: true });
        } catch {
          if (!cancelled) {
            stripHashFromUrl();
            navigate("/login?tg_error=tg_auth_invalid", { replace: true });
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    const hp = new URLSearchParams(raw);
    const oauth = hp.get("oauth");
    if (oauth !== "vk" && oauth !== "tg") return undefined;
    const access = hp.get("access_token");
    const refresh = hp.get("refresh_token");
    if (!access?.trim() || !refresh?.trim()) return undefined;
    if (lastHandledRawRef.current === raw) return undefined;
    lastHandledRawRef.current = raw;

    stripHashFromUrl();

    let cancelled = false;
    (async () => {
      try {
        localStorage.setItem("access_token", access);
        localStorage.setItem("refresh_token", refresh);
        const response = await fetch(API_ENDPOINTS.currentUser, {
          headers: { Authorization: `Bearer ${access}` },
          credentials: "include",
        });
        if (response.ok) {
          const user = await response.json();
          if (user && typeof user === "object") {
            localStorage.setItem("user", JSON.stringify(user));
            persistReturningUserWelcome(user);
          }
        }
      } catch {
        /* ЛК подтянет пользователя при наличии токена */
      }
      if (!cancelled) {
        const path =
          typeof window !== "undefined" && window.location.pathname.startsWith("/lk/settings")
            ? "/lk/settings"
            : "/lk/partner";
        navigate(path, { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, location.search, location.hash, navigate]);

  return null;
}
