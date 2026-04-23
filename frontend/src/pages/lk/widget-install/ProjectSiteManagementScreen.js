import { useEffect } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { isUuidString } from "../../registration/postJoinNavigation";
import WidgetInstallScreen from "./widget-install";

/**
 * Site management UI inside project shell.
 *
 * This is a site-level screen. Its identity comes ONLY from useParams().sitePublicId
 * on the canonical route /lk/partner/project/:projectId/sites/:sitePublicId/widget.
 *
 * Legacy mode (legacyTabRoute=true) is a transitional input: it normalizes
 * /lk/partner/project/:projectId/site?site_public_id=... (or legacy location.state)
 * to the canonical site route. It is never a second rendering mode.
 *
 * No fallbacks to outletContext / primary site / first site are allowed.
 */
export default function ProjectSiteManagementScreen({ legacyTabRoute = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId, sitePublicId: routeSitePublicIdParam } = useParams();
  const [searchParams] = useSearchParams();

  const fromSearchRaw = String(searchParams.get("site_public_id") || "").trim();
  const fromStateRaw =
    typeof location.state?.sitePublicIdForConnect === "string"
      ? location.state.sitePublicIdForConnect.trim()
      : "";
  const legacyCandidate = isUuidString(fromSearchRaw)
    ? fromSearchRaw
    : isUuidString(fromStateRaw)
    ? fromStateRaw
    : "";

  const routeSitePublicId = typeof routeSitePublicIdParam === "string" ? routeSitePublicIdParam.trim() : "";
  const id = isUuidString(routeSitePublicId) ? routeSitePublicId : "";

  // Canonical site route with invalid/missing :sitePublicId: explicit redirect,
  // never silent fallback to first/primary/selected site. Hook order is stable
  // across renders regardless of legacy/canonical branch.
  useEffect(() => {
    if (legacyTabRoute) return;
    if (!id && projectId) {
      navigate(`/lk/partner/project/${projectId}/sites`, { replace: true });
    }
  }, [id, legacyTabRoute, navigate, projectId]);

  if (legacyTabRoute) {
    if (!projectId) {
      return <Navigate to="/lk/partner" replace />;
    }
    if (legacyCandidate) {
      return (
        <Navigate
          to={`/lk/partner/project/${projectId}/sites/${encodeURIComponent(legacyCandidate)}/widget`}
          replace
        />
      );
    }
    return <Navigate to={`/lk/partner/project/${projectId}/sites`} replace />;
  }

  if (!id) {
    return null;
  }

  return <WidgetInstallScreen routeSitePublicId={id} focused={false} presentation="project-site" />;
}
