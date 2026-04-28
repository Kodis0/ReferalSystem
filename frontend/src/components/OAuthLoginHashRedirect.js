import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * JWT после VK/Telegram приезжают во fragment (#oauth=…&access_token=…).
 * Обработка есть только в странице Login: если OAuth вернул пользователя на "/" или другой путь,
 * переносим на /login с тем же hash, иначе токены так и остаются непрочитанными.
 */
export default function OAuthLoginHashRedirect() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const raw = (window.location.hash || "").replace(/^#/, "");
    if (!raw) return;
    const hp = new URLSearchParams(raw);
    const oauth = hp.get("oauth");
    if (oauth !== "vk" && oauth !== "tg") return;
    if (!hp.get("access_token")?.trim() || !hp.get("refresh_token")?.trim()) return;
    if (location.pathname === "/login") return;

    const qs = location.search || "";
    navigate(`/login${qs}#${raw}`, { replace: true });
  }, [location.pathname, location.search, navigate]);

  return null;
}
