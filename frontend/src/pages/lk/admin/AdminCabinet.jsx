import { Link } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import "./admin.css";
import AdminAccessGate from "./AdminAccessGate";
import {
  clearAdminTokens,
  getAdminAccessToken,
  onAdminAuthExpired,
} from "../../../components/adminAuth";

function decodeJwtEmail(token) {
  if (!token || typeof token !== "string") return "";
  const parts = token.split(".");
  if (parts.length < 2) return "";
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json);
    if (payload && typeof payload.email === "string") return payload.email;
  } catch (_) {
    return "";
  }
  return "";
}

function AdminPortalUserBlock() {
  const [hasToken, setHasToken] = useState(() => Boolean(getAdminAccessToken()));
  const [email, setEmail] = useState(() => decodeJwtEmail(getAdminAccessToken()));

  useEffect(() => {
    const refresh = () => {
      const t = getAdminAccessToken();
      setHasToken(Boolean(t));
      setEmail(decodeJwtEmail(t));
    };
    refresh();
    const unsub = onAdminAuthExpired(refresh);
    const onStorage = (e) => {
      if (!e || e.key === "admin_access_token") refresh();
    };
    if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
    return () => {
      unsub();
      if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
  }, []);

  if (!hasToken) return null;

  const handleLogout = () => {
    clearAdminTokens();
    setHasToken(false);
    setEmail("");
    if (typeof window !== "undefined") {
      window.location.assign("/admin-console");
    }
  };

  return (
    <div className="admin-portal__user">
      {email ? (
        <span className="admin-portal__user-email" data-testid="admin-portal-user-email">
          {email}
        </span>
      ) : null}
      <button
        type="button"
        className="admin-portal__logout"
        onClick={handleLogout}
        data-testid="admin-portal-logout"
      >
        <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>Выйти</span>
      </button>
    </div>
  );
}

/**
 * data-* атрибуты, которые другие страницы (LK, лендинг, login) могут вешать на html/body,
 * чтобы привязать к ним свой фон. На время жизни admin-portal мы их снимаем (с сохранением
 * исходного значения для cleanup), чтобы фон не «протекал».
 */
const ATTRS_TO_CLEAR = ["data-lk-page", "data-page"];

function useAdminPortalBodyGuard() {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const html = document.documentElement;
    const body = document.body;

    const saved = {};
    for (const attr of ATTRS_TO_CLEAR) {
      if (html.hasAttribute(attr)) {
        saved[`html:${attr}`] = html.getAttribute(attr);
        html.removeAttribute(attr);
      }
      if (body.hasAttribute(attr)) {
        saved[`body:${attr}`] = body.getAttribute(attr);
        body.removeAttribute(attr);
      }
    }

    html.setAttribute("data-admin-portal", "true");
    body.setAttribute("data-admin-portal", "true");

    return () => {
      html.removeAttribute("data-admin-portal");
      body.removeAttribute("data-admin-portal");
      for (const [key, val] of Object.entries(saved)) {
        const sep = key.indexOf(":");
        const target = key.slice(0, sep) === "html" ? html : body;
        const attr = key.slice(sep + 1);
        target.setAttribute(attr, val);
      }
    };
  }, []);
}

export default function AdminCabinet() {
  useAdminPortalBodyGuard();

  return (
    <div className="admin-portal">
      <header className="admin-portal__header">
        <Link to="/admin-console" className="admin-portal__brand">
          Lumoref Admin
        </Link>
        <AdminPortalUserBlock />
      </header>
      <AdminAccessGate />
    </div>
  );
}
