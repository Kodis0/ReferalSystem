import { useEffect, useState } from "react";
import { siteExternalFaviconUrl, siteFaviconHostname } from "./siteDisplay";

/**
 * Favicon for a site-like object (owner Site API shape or member program payload), with letter fallback.
 */
export function SiteFaviconAvatar({ siteLike, manualUrl, letter, imgClassName }) {
  const trimmedManual = typeof manualUrl === "string" ? manualUrl.trim() : "";
  const faviconHost = siteFaviconHostname(siteLike);
  const faviconUrl = siteExternalFaviconUrl(faviconHost);
  const initialSrc = trimmedManual || faviconUrl || "";
  const [src, setSrc] = useState(initialSrc);

  useEffect(() => {
    setSrc(trimmedManual || faviconUrl || "");
  }, [trimmedManual, faviconUrl]);

  if (!src) {
    return <span>{letter}</span>;
  }

  const cls = imgClassName || "owner-programs__service-card-avatar-img";

  return (
    <img
      src={src}
      alt=""
      className={cls}
      onError={() => {
        if (trimmedManual && src === trimmedManual && faviconUrl) {
          setSrc(faviconUrl);
          return;
        }
        setSrc("");
      }}
    />
  );
}
