import { Navigate, useLocation, useParams } from "react-router-dom";
import { isUuidString } from "../../registration/postJoinNavigation";
import WidgetInstallScreen from "./widget-install";

/**
 * Transitional connect-site screen inside the project shell.
 *
 * The /widget route does not carry :sitePublicId in the path. It exists only as a
 * focused flow right after a site is created (add-site -> connect). It accepts
 * location.state.sitePublicIdForConnect as the *transitional* input and renders
 * the connect view; on success WidgetInstallScreen redirects to the canonical
 * /sites/:sitePublicId route.
 *
 * No fallbacks to query / outlet / primary site are allowed. If there is no
 * transitional state, navigate explicitly to the project sites list.
 */
export default function ProjectWidgetInstallScreen() {
  const location = useLocation();
  const { projectId } = useParams();
  const connectFromState =
    typeof location.state?.sitePublicIdForConnect === "string"
      ? location.state.sitePublicIdForConnect.trim()
      : "";
  const id = isUuidString(connectFromState) ? connectFromState : "";
  const focused = location.state?.projectViewMode === "connect-site";

  if (!id) {
    if (projectId) {
      return <Navigate to={`/lk/partner/project/${projectId}/sites`} replace />;
    }
    return <Navigate to="/lk/partner" replace />;
  }

  return <WidgetInstallScreen routeSitePublicId={id} focused={focused} cleanupDraftOnExit />;
}
