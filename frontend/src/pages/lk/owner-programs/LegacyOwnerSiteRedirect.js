import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";

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

function currentOwnerSection(pathname, sitePublicId) {
  const prefix = `/lk/partner/${sitePublicId}/`;
  if (!pathname.startsWith(prefix)) return "overview";
  const section = pathname.slice(prefix.length).split("/")[0];
  return section || "overview";
}

// Map legacy section -> canonical project route. The site-level "overview" maps to
// the canonical site route /sites/:sitePublicId; the rest are project-level
// sections that no longer carry a site param in the URL.
function buildCanonicalTargetPath(projectId, section, sitePublicId) {
  const projectBase = `/lk/partner/project/${projectId}`;
  switch (section) {
    case "overview":
    case "site":
    case "widget":
      return `${projectBase}/sites/${encodeURIComponent(sitePublicId)}`;
    case "dashboard":
      return `${projectBase}/sites/${encodeURIComponent(sitePublicId)}/dashboard`;
    case "members":
      return `${projectBase}/sites/${encodeURIComponent(sitePublicId)}/members`;
    case "settings":
      return `${projectBase}/sites/${encodeURIComponent(sitePublicId)}/settings`;
    case "info":
      return `${projectBase}/info`;
    case "sites":
      return `${projectBase}/sites/${encodeURIComponent(sitePublicId)}`;
    default:
      return `${projectBase}/sites/${encodeURIComponent(sitePublicId)}`;
  }
}

export default function LegacyOwnerSiteRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sitePublicId } = useParams();
  const siteId = (sitePublicId || "").trim();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function redirectToProjectRoute() {
      if (!isUuidString(siteId)) {
        navigate("/lk/partner", { replace: true });
        return;
      }

      try {
        const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, siteId), {
          method: "GET",
          headers: authHeaders(),
          credentials: "include",
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) {
            const detail = payload?.code ?? payload?.detail;
            const detailMsg =
              typeof detail === "string"
                ? detail
                : Array.isArray(detail)
                  ? detail.join("\n")
                  : detail != null
                    ? String(detail)
                    : "";
            setError(detailMsg || `Не удалось открыть проект (${res.status})`);
          }
          return;
        }

        const project = payload?.project && typeof payload.project === "object" ? payload.project : {};
        const projectId = typeof project.id === "number" ? project.id : null;
        if (!projectId) {
          if (!cancelled) setError("Не удалось определить проект для этого сайта");
          return;
        }

        // Drop legacy ?site_public_id= from query — the canonical path carries it.
        const params = new URLSearchParams(location.search);
        params.delete("site_public_id");
        const search = params.toString();
        const section = currentOwnerSection(location.pathname, siteId);
        const nextPath = buildCanonicalTargetPath(projectId, section, siteId);
        navigate(
          {
            pathname: nextPath,
            search: search ? `?${search}` : "",
          },
          { replace: true, state: location.state },
        );
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Сетевая ошибка, попробуйте позже");
      }
    }

    redirectToProjectRoute();
    return () => {
      cancelled = true;
    };
  }, [location.pathname, location.search, location.state, navigate, siteId]);

  return (
    <div className="lk-dashboard lk-partner">
      <h1 className="lk-dashboard__title">Проект</h1>
      <p className="lk-dashboard__subtitle">Перенаправляем в проект…</p>
      {error ? <div className="lk-partner__error">{error}</div> : <p className="lk-partner__muted">Загрузка…</p>}
    </div>
  );
}
