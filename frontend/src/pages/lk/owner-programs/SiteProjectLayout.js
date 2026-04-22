import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./owner-programs.css";
import { formatDomainLine, formatSiteCardTitle, siteLifecycleLabelRu } from "./siteDisplay";

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

function tabClass({ isActive }) {
  return `owner-programs__tab ${isActive ? "owner-programs__tab_active" : ""}`;
}

export default function SiteProjectLayout() {
  const { sitePublicId } = useParams();
  const id = (sitePublicId || "").trim();
  const [headLoading, setHeadLoading] = useState(true);
  const [headTitle, setHeadTitle] = useState("Проект");
  const [headSub, setHeadSub] = useState("");

  const loadHead = useCallback(async () => {
    if (!isUuidString(id)) return;
    setHeadLoading(true);
    try {
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, id), {
        method: "GET",
        headers: authHeaders(),
        credentials: "include",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setHeadTitle("Проект");
        if (res.status === 404) {
          setHeadSub("Проект не найден или нет доступа");
        } else {
          const d = payload.detail;
          const detailMsg =
            typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
          setHeadSub(detailMsg || `Ошибка (${res.status})`);
        }
        return;
      }
      const origins = Array.isArray(payload.allowed_origins) ? payload.allowed_origins : [];
      const cfg = payload.config_json && typeof payload.config_json === "object" ? payload.config_json : {};
      const dn = typeof cfg.display_name === "string" ? cfg.display_name.trim() : "";
      setHeadTitle(formatSiteCardTitle(payload.public_id, origins[0], dn));
      setHeadSub(`${formatDomainLine(null, origins)} · ${siteLifecycleLabelRu(payload.status)}`);
    } catch {
      setHeadTitle("Проект");
      setHeadSub("Сетевая ошибка");
    } finally {
      setHeadLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadHead();
  }, [loadHead]);

  if (!isUuidString(id)) {
    return <Navigate to="/lk/partner" replace />;
  }

  const base = `/lk/partner/${id}`;

  return (
    <div className="lk-dashboard lk-partner owner-programs__shell">
      <p className="owner-programs__shell-crumb">
        <Link to="/lk/partner">Проекты</Link>
      </p>
      <header className="owner-programs__shell-header">
        <h1 className="owner-programs__shell-title">{headLoading ? "Проект…" : headTitle}</h1>
        <p className="owner-programs__shell-sub">{headLoading ? <span className="lk-partner__muted">Загрузка…</span> : headSub}</p>
      </header>

      <nav className="owner-programs__tabs" aria-label="Разделы проекта">
        <NavLink to={`${base}/overview`} className={tabClass} end>
          Обзор
        </NavLink>
        <NavLink to={`${base}/widget`} className={tabClass}>
          Виджет
        </NavLink>
        <NavLink to={`${base}/members`} className={tabClass}>
          Участники
        </NavLink>
        <NavLink to={`${base}/settings`} className={tabClass}>
          Настройки
        </NavLink>
      </nav>

      <Outlet />
    </div>
  );
}
