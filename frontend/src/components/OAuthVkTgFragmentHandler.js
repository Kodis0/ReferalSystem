import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../config/api";
import { persistReturningUserWelcome } from "../pages/login/login";

/**
 * 1) Редирект с бэка: #oauth=vk|tg&access_token&refresh_token
 * 2) Telegram Login Widget (часто на главной): #tgAuthResult=<base64 JSON> — меняем на POST /token/telegram/widget/
 */
export default function OAuthVkTgFragmentHandler() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastHandledRawRef = useRef(null);

  useEffect(() => {
    const raw =
      (location.hash || "").replace(/^#/, "") ||
      (typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "");
    if (!raw) return undefined;

    /* Telegram Login Widget — не наш JWT во fragment */
    if (raw.startsWith("tgAuthResult=")) {
      const b64 = raw.slice("tgAuthResult=".length);
      if (!b64 || lastHandledRawRef.current === `w:${b64}`) return undefined;
      lastHandledRawRef.current = `w:${b64}`;

      const path = typeof window !== "undefined" ? window.location.pathname : "";
      const search = typeof window !== "undefined" ? window.location.search : "";
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `${path}${search}`);
      }

      (async () => {
        try {
          const response = await fetch(API_ENDPOINTS.tokenTelegramWidget, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tgAuthResult: b64 }),
            credentials: "include",
          });
          const data = await response.json();
          if (!response.ok) {
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
          navigate("/lk/partner", { replace: true });
        } catch {
          navigate("/login?tg_error=tg_auth_invalid", { replace: true });
        }
      })();

      return undefined;
    }

    const hp = new URLSearchParams(raw);
    const oauth = hp.get("oauth");
    if (oauth !== "vk" && oauth !== "tg") return undefined;
    const access = hp.get("access_token");
    const refresh = hp.get("refresh_token");
    if (!access?.trim() || !refresh?.trim()) return undefined;
    if (lastHandledRawRef.current === raw) return undefined;
    lastHandledRawRef.current = raw;

    const path = typeof window !== "undefined" ? window.location.pathname : "";
    const search = typeof window !== "undefined" ? window.location.search : "";
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `${path}${search}`);
    }

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
      navigate("/lk/partner", { replace: true });
    })();

    return undefined;
  }, [location.hash, navigate]);

  return null;
}
