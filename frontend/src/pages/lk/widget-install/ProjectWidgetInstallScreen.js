import { useParams } from "react-router-dom";
import { isUuidString } from "../../registration/postJoinNavigation";
import WidgetInstallScreen from "./widget-install";

/** Renders widget install UI bound to `/lk/partner/:sitePublicId/widget`. */
export default function ProjectWidgetInstallScreen() {
  const { sitePublicId } = useParams();
  const raw = (sitePublicId || "").trim();
  const id = isUuidString(raw) ? raw : "";
  return <WidgetInstallScreen routeSitePublicId={id} />;
}
