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
            const detail = payload?.detail;
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

        const params = new URLSearchParams(location.search);
        params.set("site_public_id", siteId);
        const search = params.toString();
        const nextPath = `/lk/partner/project/${projectId}/${currentOwnerSection(location.pathname, siteId)}`;
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
