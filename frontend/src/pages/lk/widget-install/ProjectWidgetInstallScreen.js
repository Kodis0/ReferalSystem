import { useLocation, useOutletContext, useParams } from "react-router-dom";
import { isUuidString } from "../../registration/postJoinNavigation";
import WidgetInstallScreen from "./widget-install";

/** Renders widget install UI inside the project shell using selected site context. */
export default function ProjectWidgetInstallScreen() {
  const location = useLocation();
  const { sitePublicId } = useParams();
  const outletContext = useOutletContext() || {};
  const raw = (outletContext.selectedSitePublicId || sitePublicId || "").trim();
  const id = isUuidString(raw) ? raw : "";
  const focused = location.state?.projectViewMode === "connect-site";
  return <WidgetInstallScreen routeSitePublicId={id} focused={focused} />;
}
