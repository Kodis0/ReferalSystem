import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../config/api";
import { persistReturningUserWelcome } from "../pages/login/login";

/**
 * JWT VK/Telegram приходят во fragment. Обрабатываем на любом маршруте (в т.ч. с «/»),
 * без navigate('/login#...') — длинные JWT в hash с `&` ломали client-side переход.
 */
export default function OAuthVkTgFragmentHandler() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastHandledRawRef = useRef(null);

  useEffect(() => {
    const raw = (location.hash || "").replace(/^#/, "") || (typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "");
    if (!raw) return undefined;

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
