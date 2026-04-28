import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import "../settings/settings.css";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./owner-programs.css";
import OwnerActivityHistoryPanel from "./OwnerActivityHistoryPanel";

function withSitePublicIdQuery(url, sitePublicId) {
  if (!sitePublicId) return url;
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set("site_public_id", sitePublicId);
    return u.toString();
  } catch {
    return url;
  }
}

export default function SiteHistoryPage() {
  const { sitePublicId: sitePublicIdParam } = useParams();
  const sitePublicId = isUuidString(sitePublicIdParam) ? sitePublicIdParam.trim() : "";
  const baseUrl = useMemo(
    () => withSitePublicIdQuery(API_ENDPOINTS.siteIntegrationActivity, sitePublicId),
    [sitePublicId],
  );

  if (!sitePublicId) {
    return (
      <div className="owner-programs__page owner-programs__site-page">
        <p className="owner-programs__muted">Укажите сайт в адресе страницы.</p>
      </div>
    );
  }

  return (
    <div className="owner-programs__page owner-programs__site-page">
      <OwnerActivityHistoryPanel
        activityBaseUrl={baseUrl}
        portalId="owner-programs-site-history-datepicker-portal"
        sitePublicId={sitePublicId}
        subscribeSiteOwnerActivityBus
      />
    </div>
  );
}
