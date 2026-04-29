import { useCallback, useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { LK_PROGRAM_LISTS_REFETCH_EVENT } from "../lkProgramListsSync";
import { DomainCountryFlagSvg, SUPPORTED_DOMAIN_FLAG_SVG_CODES } from "../owner-programs/domainCountryFlagSvg";
import { SiteFaviconAvatar } from "../owner-programs/SiteFaviconAvatar";
import "../owner-programs/owner-programs.css";

function programSiteLabel(program) {
  const originLabel = typeof program?.site_origin_label === "string" ? program.site_origin_label.trim() : "";
  if (originLabel) return originLabel;
  const displayLabel = typeof program?.site_display_label === "string" ? program.site_display_label.trim() : "";
  if (displayLabel) return displayLabel;
  return `Программа · ${program?.site_public_id || "—"}`;
}

function programTitle(program) {
  const displayLabel = typeof program?.site_display_label === "string" ? program.site_display_label.trim() : "";
  if (displayLabel) return displayLabel;
  return programSiteLabel(program);
}

function programStatusLabel(status) {
  if (status === "active" || status === "verified") return "В сети";
  if (status === "draft") return "Черновик";
  return status || "—";
}

function domainHostFromValue(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const raw = value.trim();
  try {
    if (raw.includes("://")) {
      return new URL(raw).hostname.toLowerCase();
    }
  } catch {
    /* ignore */
  }
  return raw.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
}

function countryCodeFromDomain(value) {
  const host = domainHostFromValue(value);
  if (!host) return "";
  const labels = host.split(".").filter(Boolean);
  if (labels.length === 0) return "";
  const tld = labels[labels.length - 1];
  if (/^[a-z]{2}$/i.test(tld)) {
    const upper = tld.toUpperCase();
    if (upper === "UK") return "GB";
    return upper;
  }
  if (tld === "xn--p1ai" || tld === "su") return "RU";
  return "";
}

function emojiFlagFromCountryCode(countryCode) {
  if (!/^[A-Z]{2}$/.test(countryCode)) return "";
  const base = 127397;
  return String.fromCodePoint(...countryCode.split("").map((letter) => base + letter.charCodeAt(0)));
}

function ProgramCountryFlag({ domain }) {
  const countryCode = countryCodeFromDomain(domain);
  if (!countryCode) {
    return (
      <span className="owner-programs__service-card-flag owner-programs__service-card-flag_globe" aria-hidden>
        <Globe size={16} strokeWidth={1.75} />
      </span>
    );
  }
  const upper = countryCode.toUpperCase();
  const useSvg = SUPPORTED_DOMAIN_FLAG_SVG_CODES.has(upper);
  const emoji = emojiFlagFromCountryCode(upper);
  if (!useSvg && !emoji) return null;
  return (
    <span
      className={`owner-programs__service-card-flag${useSvg ? " owner-programs__service-card-flag_svg" : ""}`}
      role="img"
      aria-label={`Флаг страны ${upper}`}
    >
      {useSvg ? <DomainCountryFlagSvg countryCode={upper} /> : emoji}
    </span>
  );
}

/**
 * Member-facing list of referral programs (SiteMembership) for the logged-in user.
 */
export function MyProgramsSection() {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState(null);
  const [programsError, setProgramsError] = useState(null);
  const [leavingSiteId, setLeavingSiteId] = useState("");
  const [leaveError, setLeaveError] = useState("");

  const fetchMyPrograms = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setPrograms([]);
      setProgramsError(null);
      return;
    }
    setPrograms(null);
    setProgramsError(null);
    try {
      const res = await fetch(API_ENDPOINTS.myPrograms, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("programs_fetch_failed");
      const data = await res.json();
      setPrograms(Array.isArray(data.programs) ? data.programs : []);
    } catch {
      setProgramsError(true);
      setPrograms([]);
    }
  }, []);

  useEffect(() => {
    fetchMyPrograms();
  }, [fetchMyPrograms]);

  useEffect(() => {
    function onProgramsAvatarSourcesUpdated() {
      fetchMyPrograms();
    }
    window.addEventListener(LK_PROGRAM_LISTS_REFETCH_EVENT, onProgramsAvatarSourcesUpdated);
    window.addEventListener("lk-account-avatar-updated", onProgramsAvatarSourcesUpdated);
    window.addEventListener("lk-site-avatar-updated", onProgramsAvatarSourcesUpdated);
    return () => {
      window.removeEventListener(LK_PROGRAM_LISTS_REFETCH_EVENT, onProgramsAvatarSourcesUpdated);
      window.removeEventListener("lk-account-avatar-updated", onProgramsAvatarSourcesUpdated);
      window.removeEventListener("lk-site-avatar-updated", onProgramsAvatarSourcesUpdated);
    };
  }, [fetchMyPrograms]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      fetchMyPrograms();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [fetchMyPrograms]);

  const openProgram = (sitePublicId) => {
    if (!sitePublicId) return;
    navigate(`/lk/referral-program/${sitePublicId}`, { state: { from: "/lk/my-programs" } });
  };

  const leaveProgram = async (event, program) => {
    event.stopPropagation();
    const token = localStorage.getItem("access_token");
    const sitePublicId = program?.site_public_id;
    if (!token || !sitePublicId || leavingSiteId) return;
    setLeavingSiteId(sitePublicId);
    setLeaveError("");
    try {
      const leaveRes = await fetch(API_ENDPOINTS.siteCtaLeave, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ site_public_id: sitePublicId }),
      });
      if (!leaveRes.ok) {
        const fallbackRes = await fetch(API_ENDPOINTS.myProgramDetail(sitePublicId), {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!fallbackRes.ok && fallbackRes.status !== 404) {
          throw new Error(`program_leave_failed_${fallbackRes.status || "network"}`);
        }
      }
      const listRes = await fetch(API_ENDPOINTS.myPrograms, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!listRes.ok) throw new Error("program_leave_list_failed");
      const listData = await listRes.json();
      setPrograms(Array.isArray(listData.programs) ? listData.programs : []);
    } catch (error) {
      const raw = error instanceof Error ? error.message.replace("program_leave_failed_", "") : "";
      const suffix = raw && raw !== "program_leave_failed" ? ` (${raw})` : "";
      setLeaveError(`Не удалось выйти из программы. Попробуйте позже.${suffix}`);
    } finally {
      setLeavingSiteId("");
    }
  };

  return (
    <section
      id="my-programs"
      className="lk-dashboard__programs"
      aria-labelledby="lk-dashboard-programs-heading"
    >
      <h2 id="lk-dashboard-programs-heading" className="lk-dashboard__programs-title">
        Агентские программы
      </h2>
      <p className="lk-dashboard__programs-lead">
        Программы, в которых вы участвуете как агент после приглашения от организатора.
      </p>
      {programs === null && !programsError && (
        <p className="lk-dashboard__programs-muted">Загрузка…</p>
      )}
      {programsError && (
        <p className="lk-dashboard__programs-muted">
          Не удалось загрузить список программ. Обновите страницу или попробуйте позже.
        </p>
      )}
      {leaveError ? <p className="lk-dashboard__programs-muted">{leaveError}</p> : null}
      {programs !== null && !programsError && programs.length === 0 && (
        <div className="lk-dashboard__programs-muted">
          <p>Вы пока не участвуете ни в одной программе.</p>
          <p>Откройте каталог, выберите программу и получите персональную ссылку.</p>
        </div>
      )}
      {programs !== null && !programsError && programs.length > 0 && (
        <div className="owner-programs__services-grid" data-testid="my-programs-list">
          {programs.map((p) => {
            const title = programTitle(p);
            const domain = programSiteLabel(p);
            const status = programStatusLabel(p.site_status);
            const platform = p.platform_preset || "—";
            const leavingThisProgram = leavingSiteId === p.site_public_id;
            return (
              <div
                key={p.site_public_id}
                className="owner-programs__service-card lk-dashboard__programs-card-link"
                data-testid="agent-program-list-link"
                role="link"
                tabIndex={0}
                onClick={() => openProgram(p.site_public_id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openProgram(p.site_public_id);
                  }
                }}
              >
                <div className="owner-programs__service-card-top-row">
                  <div className="owner-programs__service-card-hero">
                    <div className="owner-programs__service-card-avatar">
                      <SiteFaviconAvatar
                        key={`mine-${p.site_public_id}-${String(p.avatar_data_url || "").slice(0, 48)}-${String(p.avatar_updated_at || "")}`}
                        manualUrl={typeof p.avatar_data_url === "string" ? p.avatar_data_url.trim() : ""}
                        siteLike={p}
                        letter={title.slice(0, 1).toUpperCase() || "P"}
                        useExternalFavicon={false}
                      />
                    </div>
                  </div>
                  <div className="owner-programs__service-card-top-right">
                    <ProgramCountryFlag domain={domain} />
                    <button
                      type="button"
                      className="lk-dashboard__programs-leave-btn"
                      onClick={(event) => leaveProgram(event, p)}
                      onKeyDown={(event) => event.stopPropagation()}
                      disabled={leavingThisProgram || Boolean(leavingSiteId)}
                      data-testid={`agent-program-leave-${p.site_public_id}`}
                    >
                      {leavingThisProgram ? "Выходим…" : "Выйти"}
                    </button>
                  </div>
                </div>
                <div className="owner-programs__service-card-headline">
                  <span className="owner-programs__service-card-status-dot owner-programs__service-card-status-dot_success" aria-hidden="true" />
                  <span className="owner-programs__service-card-headline-title">{title}</span>
                </div>
                <div className="owner-programs__service-card-specs" title={[domain, status, platform].join(" · ")}>
                  {[domain, status, platform].join(" · ")}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
