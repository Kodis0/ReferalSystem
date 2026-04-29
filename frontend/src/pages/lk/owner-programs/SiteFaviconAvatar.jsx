import { useEffect, useMemo, useState } from "react";
import { siteExternalFaviconUrl, siteFaviconHostname } from "./siteDisplay";

function cacheBustedManualUrl(url, version) {
  const value = typeof url === "string" ? url.trim() : "";
  const stableVersion = typeof version === "string" ? version.trim() : "";
  if (!value || !stableVersion || value.startsWith("data:") || value.startsWith("blob:")) return value;
  const separator = value.includes("?") ? "&" : "?";
  return `${value}${separator}v=${encodeURIComponent(stableVersion)}`;
}

/**
 * Аватар сайта/программы: своё фото → аккаунт (fallback) → favicon → буква.
 * Индекс кандидата сбрасывается при любом изменении URLов props — без залипания старой картинки.
 */
export function SiteFaviconAvatar({
  siteLike,
  manualUrl,
  manualVersion,
  accountFallbackUrl,
  letter,
  imgClassName,
  useExternalFavicon = true,
}) {
  const trimmedManual = typeof manualUrl === "string" ? manualUrl.trim() : "";
  const resolvedManualVersion =
    typeof manualVersion === "string" && manualVersion.trim()
      ? manualVersion.trim()
      : typeof siteLike?.avatar_updated_at === "string" && siteLike.avatar_updated_at.trim()
        ? siteLike.avatar_updated_at.trim()
        : typeof siteLike?.updated_at === "string"
          ? siteLike.updated_at.trim()
          : "";
  const manualSrc = cacheBustedManualUrl(trimmedManual, resolvedManualVersion);
  const trimmedAccount = typeof accountFallbackUrl === "string" ? accountFallbackUrl.trim() : "";
  const faviconHost = siteFaviconHostname(siteLike);
  const faviconUrl = useExternalFavicon ? siteExternalFaviconUrl(faviconHost) : "";

  const candidates = useMemo(() => {
    const list = [];
    if (manualSrc) list.push(manualSrc);
    if (trimmedAccount) list.push(trimmedAccount);
    if (faviconUrl) list.push(faviconUrl);
    return list;
  }, [manualSrc, trimmedAccount, faviconUrl]);

  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [manualSrc, trimmedAccount, faviconUrl]);

  const src = candidateIndex < candidates.length ? candidates[candidateIndex] || "" : "";

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
        setCandidateIndex((i) => Math.min(i + 1, candidates.length));
      }}
    />
  );
}
