import { cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Globe, Search } from "lucide-react";
import { Link, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./CreateOwnerProjectPage.css";
import "./owner-programs.css";
import {
  domainHostFromValue,
  formatDomainLine,
  siteLifecycleLabelRu,
  sitePrimaryDomainLabel,
} from "./siteDisplay";
import {
  isSiteCapturePaused,
  preserveResolvedReachabilityPhase,
  reachabilityDotPhase,
  reachabilityLabel,
  SITE_REACHABILITY_POLL_MS,
  withSitePublicIdQuery,
} from "./siteReachability";
import SiteShellWidgetActionsBar from "../widget-install/SiteShellWidgetActionsBar";
import { DomainCountryFlagSvg, SUPPORTED_DOMAIN_FLAG_SVG_CODES } from "./domainCountryFlagSvg";
import { useSiteShellIntegrationActions } from "./useSiteShellIntegrationActions";
import useCurrentUser from "../../../hooks/useCurrentUser";
import { SiteFaviconAvatar } from "./SiteFaviconAvatar";
function ServicesGridIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 3H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Zm0 8H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1Zm8-8h-4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Zm0 8h-4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1Z"
      />
    </svg>
  );
}

function ServicesListIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20" aria-hidden="true">
      <path fill="currentColor" d="M4 5h12a1 1 0 1 0 0-2H4a1 1 0 1 0 0 2Zm12 4H4a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2Zm0 6H4a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2Z" />
    </svg>
  );
}

const OWNER_PROJECT_SERVICES_LAYOUT_KEY = "lumo_owner_project_services_layout";

function readStoredServicesLayoutMode() {
  try {
    const raw = localStorage.getItem(OWNER_PROJECT_SERVICES_LAYOUT_KEY);
    if (raw === "list" || raw === "cards") return raw;
  } catch {
    /* private mode / quota */
  }
  return "cards";
}

function serviceSearchValue(site) {
  const title = serviceTitle(site);
  const domain = sitePrimaryDomainLabel(site) || formatDomainLine(site.primary_origin, [site.primary_origin]);
  return `${title} ${domain} ${site.public_id} ${site.platform_preset || ""}`.toLowerCase();
}

function serviceTitle(site) {
  const displayName = typeof site?.display_name === "string" ? site.display_name.trim() : "";
  if (displayName) {
    return displayName;
  }
  const domain = sitePrimaryDomainLabel(site) || formatDomainLine(site?.primary_origin, [site?.primary_origin]);
  if (domain && domain !== "Домен не задан") {
    return domain;
  }
  const publicId = typeof site?.public_id === "string" ? site.public_id.trim() : "";
  if (!publicId) {
    return "Сайт";
  }
  const compact = publicId.replace(/-/g, "");
  return `Сайт · ${compact.slice(0, 8)}…`;
}

/** Вторая строка списка сайтов: только хост (без схемы/пути), плейсхолдер без изменений. */
function servicesListDomainOnly(domain) {
  if (!domain || domain === "Домен не задан") return domain || "Домен не задан";
  const host = domainHostFromValue(domain);
  return host || domain;
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

/** Строка origin/хоста для определения страны флага (не только `primary_origin`). */
function siteOriginForCountryFlag(site, domainLabel) {
  const o = typeof site?.primary_origin === "string" ? site.primary_origin.trim() : "";
  if (o) return o;
  const l = typeof site?.primary_origin_label === "string" ? site.primary_origin_label.trim() : "";
  if (l) return l;
  if (typeof domainLabel === "string" && domainLabel.trim() && domainLabel !== "Домен не задан") {
    return domainLabel.trim();
  }
  return "";
}

function emojiFlagFromCountryCode(countryCode) {
  if (!/^[A-Z]{2}$/.test(countryCode)) return "";
  const base = 127397;
  return String.fromCodePoint(...countryCode.split("").map((letter) => base + letter.charCodeAt(0)));
}

function ServiceCountryFlag({ domain, fallback = null, title: titleProp = "" }) {
  const tip = typeof titleProp === "string" && titleProp.trim() ? { title: titleProp.trim() } : {};
  const countryCode = countryCodeFromDomain(domain);
  if (!countryCode) {
    if (fallback != null && isValidElement(fallback)) {
      return cloneElement(fallback, tip);
    }
    return fallback;
  }
  const upper = countryCode.toUpperCase();
  const useSvg = SUPPORTED_DOMAIN_FLAG_SVG_CODES.has(upper);
  const emoji = emojiFlagFromCountryCode(upper);
  if (!useSvg && !emoji) {
    if (fallback != null && isValidElement(fallback)) {
      return cloneElement(fallback, tip);
    }
    return fallback;
  }
  return (
    <span
      className={`owner-programs__service-card-flag${useSvg ? " owner-programs__service-card-flag_svg" : ""}`}
      role="img"
      aria-label={`Флаг страны ${upper}`}
      {...tip}
    >
      {useSvg ? <DomainCountryFlagSvg countryCode={upper} /> : emoji}
    </span>
  );
}

function serviceCountryFlagGlobeFallback(globeSize) {
  return (
    <span className="owner-programs__service-card-flag owner-programs__service-card-flag_globe" aria-hidden>
      <Globe size={globeSize} strokeWidth={1.75} />
    </span>
  );
}

/** Подсказка при наведении: задержка HTTP HEAD с сервера до основного URL сайта. */
function serverPingFromServerTitle(site, reach) {
  const phase = reach?.phase ?? "idle";
  const origin = sitePrimaryDomainLabel(site);
  const lat = typeof reach?.latencyMs === "number" ? reach.latencyMs : null;
  const checked = typeof reach?.checkedUrl === "string" && reach.checkedUrl.trim() ? reach.checkedUrl.trim() : "";

  if (!origin || phase === "no_url") {
    return "Нет адреса для проверки с сервера";
  }
  if (phase === "checking") {
    return lat != null ? `Проверка HTTP (HEAD) с сервера… (последний ответ: ${lat} мс)` : "Проверка HTTP (HEAD) с сервера…";
  }
  if (phase === "idle") {
    return "Проверка с сервера ещё не запускалась";
  }
  if (phase === "online") {
    if (lat != null) {
      return checked ? `Пинг с сервера: ${lat} мс · ${checked}` : `Пинг с сервера: ${lat} мс`;
    }
    return checked ? `Сайт отвечает (HEAD с сервера) · ${checked}` : "Сайт отвечает на HTTP HEAD с сервера";
  }
  if (phase === "offline") {
    const tail = lat != null ? ` · ${lat} мс до отказа` : "";
    return checked ? `С сервера недоступен · ${checked}${tail}` : `С сервера недоступен${tail}`;
  }
  return "";
}

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function ServiceActionsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="currentColor" d="M9 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm-5.25 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm10.5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
    </svg>
  );
}

function serviceStatusTone(status) {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!value) return "success";
  if (value.includes("draft") || value.includes("чернов")) return "warning";
  if (value.includes("error") || value.includes("fail") || value.includes("disabled")) return "danger";
  return "success";
}

function serviceStatusPresentation(site, reachabilityPhase, isCurrent) {
  const currentSuffix = isCurrent ? " · текущий" : "";
  if (isSiteCapturePaused(site)) {
    const dotClassName = `owner-programs__shell-reachability-dot owner-programs__shell-reachability-dot_${reachabilityDotPhase("paused")}`;
    return {
      label: `${reachabilityLabel("paused")}${currentSuffix}`,
      cardDotClassName: dotClassName,
      listDotClassName: dotClassName,
    };
  }
  if (reachabilityPhase === "checking" || reachabilityPhase === "online" || reachabilityPhase === "offline") {
    const dotClassName = `owner-programs__shell-reachability-dot owner-programs__shell-reachability-dot_${reachabilityDotPhase(reachabilityPhase)}`;
    return {
      label: `${reachabilityLabel(reachabilityPhase)}${currentSuffix}`,
      cardDotClassName: dotClassName,
      listDotClassName: dotClassName,
    };
  }

  const statusTone = serviceStatusTone(site.status);
  return {
    label: `${siteLifecycleLabelRu(site.status)}${currentSuffix}`,
    cardDotClassName: `owner-programs__service-card-status-dot owner-programs__service-card-status-dot_${statusTone}`,
    listDotClassName: `owner-programs__services-list-status owner-programs__services-list-status_${statusTone}`,
  };
}

const CONNECT_SITE_PLATFORMS = [
  { value: "tilda", label: "Tilda" },
  { value: "generic", label: "Generic" },
];

function ConnectSitePlatformSelect({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const currentLabel = CONNECT_SITE_PLATFORMS.find((o) => o.value === value)?.label || value;

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!rootRef.current || rootRef.current.contains(event.target)) return;
      setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="input" ref={rootRef}>
      <div className="inputWrapper owner-programs__menu-select-wrap">
        <button
          type="button"
          id="project-add-site-platform-trigger"
          className="owner-programs__menu-select-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls="project-add-site-platform-listbox"
          aria-labelledby="project-add-site-platform-label"
          disabled={disabled}
          data-testid="project-add-site-platform"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="owner-programs__menu-select-value">{currentLabel}</span>
          <ChevronDown
            size={18}
            className={
              open ? "owner-programs__menu-select-chevron owner-programs__menu-select-chevron_open" : "owner-programs__menu-select-chevron"
            }
            aria-hidden="true"
          />
        </button>
        {open ? (
          <div
            id="project-add-site-platform-listbox"
            className="owner-programs__menu-select-dropdown"
            role="listbox"
            aria-labelledby="project-add-site-platform-label"
          >
            {CONNECT_SITE_PLATFORMS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={value === opt.value}
                className={`owner-programs__menu-select-option${value === opt.value ? " owner-programs__menu-select-option_active" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ProjectOverviewPage() {
  const navigate = useNavigate();
  const {
    projectId,
    buildProjectPath,
    buildProjectSitePath,
    projectEntry,
    reloadProjectEntry,
    projectEntryLoading,
    projectEntryError,
    addSiteOpen,
    addSiteDisplayName,
    addSiteOrigin,
    addSitePlatform,
    addSiteState,
    addSiteError,
    setAddSiteDisplayName,
    setAddSiteOrigin,
    setAddSitePlatform,
    toggleAddSiteForm,
    handleAddSite,
  } = useOutletContext();
  const { user } = useCurrentUser();
  const partnerAccountAvatarUrl =
    typeof user?.avatar_data_url === "string" ? user.avatar_data_url.trim() : "";
  // Soft hint for "currently viewed" highlight only — never used for site
  // identity selection on a site-level screen.
  const [searchParams] = useSearchParams();
  const sitePublicId = (searchParams.get("site_public_id") || "").trim();
  const hasSiteId = Boolean(sitePublicId);
  const [searchValue, setSearchValue] = useState("");
  const [layoutMode, setLayoutMode] = useState(() => readStoredServicesLayoutMode());
  const [activeMenuSiteId, setActiveMenuSiteId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingSiteId, setDeletingSiteId] = useState("");
  const [siteReachabilityById, setSiteReachabilityById] = useState({});
  const siteReachabilityByIdRef = useRef({});
  const reachabilityProbeTargetsRef = useRef([]);
  const menuRef = useRef(null);
  const menuDropdownPortalRef = useRef(null);
  const [menuAnchorRect, setMenuAnchorRect] = useState(null);

  const closeActiveSiteMenu = useCallback(() => setActiveMenuSiteId(""), []);
  const onSiteDeletePending = useCallback((id) => setDeletingSiteId(id), []);
  const onSiteDeleteSettled = useCallback(() => setDeletingSiteId(""), []);
  const siteMenuIntegration = useSiteShellIntegrationActions({
    sitePublicId: activeMenuSiteId,
    projectIdProp: typeof projectId === "number" ? projectId : undefined,
    projectEntry,
    reloadProjectEntry,
    buildProjectPath,
    deleteContext: "overview",
    overviewRouteSitePublicId: sitePublicId,
    onAfterDeleteSuccess: closeActiveSiteMenu,
    onSiteDeletePending,
    onSiteDeleteSettled,
  });

  const currentProjectSites = Array.isArray(projectEntry?.sites) ? projectEntry.sites : [];
  const visibleProjectSites = useMemo(
    () => currentProjectSites.filter((site) => site.public_id !== deletingSiteId),
    [currentProjectSites, deletingSiteId],
  );
  const showAddSiteForm = addSiteOpen;
  const filteredSites = useMemo(() => {
    const needle = searchValue.trim().toLowerCase();
    if (!needle) return visibleProjectSites;
    return visibleProjectSites.filter((site) => serviceSearchValue(site).includes(needle));
  }, [visibleProjectSites, searchValue]);
  const reachabilityProbeTargets = useMemo(
    () =>
      visibleProjectSites
        .filter((site) => typeof site?.public_id === "string" && site.public_id.trim())
        .map((site) => ({
          public_id: site.public_id.trim(),
          primary_origin: typeof site?.primary_origin === "string" ? site.primary_origin : "",
          primary_origin_label: typeof site?.primary_origin_label === "string" ? site.primary_origin_label : "",
        })),
    [visibleProjectSites],
  );
  const reachabilityProbeKey = useMemo(
    () => reachabilityProbeTargets.map((site) => `${site.public_id}:${site.primary_origin_label}:${site.primary_origin}`).join("|"),
    [reachabilityProbeTargets],
  );

  useEffect(() => {
    try {
      localStorage.setItem(OWNER_PROJECT_SERVICES_LAYOUT_KEY, layoutMode);
    } catch {
      /* ignore */
    }
  }, [layoutMode]);

  useEffect(() => {
    siteReachabilityByIdRef.current = siteReachabilityById;
  }, [siteReachabilityById]);

  useEffect(() => {
    reachabilityProbeTargetsRef.current = reachabilityProbeTargets;
  }, [reachabilityProbeTargets]);

  const openSiteCard = useCallback(
    (sitePublicId) => {
      if (!sitePublicId || typeof buildProjectSitePath !== "function") return;
      navigate(`${buildProjectSitePath(sitePublicId)}/dashboard`);
    },
    [buildProjectSitePath, navigate],
  );

  useEffect(() => {
    function handlePointerDown(event) {
      const t = event.target;
      if (menuRef.current?.contains(t)) return;
      if (menuDropdownPortalRef.current?.contains(t)) return;
      setActiveMenuSiteId("");
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setActiveMenuSiteId("");
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useLayoutEffect(() => {
    if (!activeMenuSiteId) {
      setMenuAnchorRect(null);
      return undefined;
    }
    const sync = () => {
      const el = document.querySelector(`[data-testid="project-child-site-menu-trigger-${activeMenuSiteId}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setMenuAnchorRect({ top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height });
    };
    sync();
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [activeMenuSiteId]);

  useEffect(() => {
    if (!activeMenuSiteId) return;
    if (!filteredSites.some((s) => s.public_id === activeMenuSiteId)) {
      setActiveMenuSiteId("");
    }
  }, [filteredSites, activeMenuSiteId]);

  useEffect(() => {
    const sitesForProbe = reachabilityProbeTargetsRef.current;

    if (sitesForProbe.length === 0) {
      setSiteReachabilityById({});
      return undefined;
    }

    let cancelled = false;

    async function runOnce() {
      const snapshot = siteReachabilityByIdRef.current;
      const optimisticState = {};

      sitesForProbe.forEach((site) => {
        const prev = snapshot[site.public_id] || {};
        const previousPhase = prev.phase || "idle";
        const hasOrigin = Boolean(sitePrimaryDomainLabel(site));
        let phase = hasOrigin ? preserveResolvedReachabilityPhase(previousPhase) || "checking" : "no_url";
        if (phase === "idle") {
          phase = "checking";
        }
        optimisticState[site.public_id] = hasOrigin
          ? { ...prev, phase }
          : { phase: "no_url", latencyMs: null, checkedUrl: null, httpStatus: null };
      });

      setSiteReachabilityById(optimisticState);

      const updates = await Promise.all(
        sitesForProbe.map(async (site) => {
          const origin = sitePrimaryDomainLabel(site);
          if (!origin) {
            return [site.public_id, { phase: "no_url", latencyMs: null, checkedUrl: null, httpStatus: null }];
          }

          try {
            const res = await fetch(withSitePublicIdQuery(API_ENDPOINTS.siteReachability, site.public_id), {
              headers: authHeaders(),
              credentials: "include",
            });
            const body = await res.json().catch(() => ({}));
            const prevSnap = snapshot[site.public_id] || {};
            if (!res.ok) {
              return [
                site.public_id,
                {
                  ...prevSnap,
                  phase: preserveResolvedReachabilityPhase(prevSnap.phase || "idle"),
                },
              ];
            }
            return [
              site.public_id,
              {
                phase: body.reachable ? "online" : "offline",
                latencyMs: typeof body.latency_ms === "number" ? body.latency_ms : null,
                checkedUrl: typeof body.checked_url === "string" ? body.checked_url : null,
                httpStatus: typeof body.http_status === "number" ? body.http_status : null,
              },
            ];
          } catch {
            const prevSnap = snapshot[site.public_id] || {};
            return [
              site.public_id,
              {
                ...prevSnap,
                phase: preserveResolvedReachabilityPhase(prevSnap.phase || "idle"),
              },
            ];
          }
        }),
      );

      if (cancelled) {
        return;
      }

      setSiteReachabilityById((prev) => {
        const next = { ...prev };
        updates.forEach(([siteId, state]) => {
          next[siteId] = state;
        });
        return next;
      });
    }

    runOnce();
    const timer = window.setInterval(runOnce, SITE_REACHABILITY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [reachabilityProbeKey]);

  const handleDeleteSite = useCallback(
    async (site) => {
      const title = serviceTitle(site);
      const confirmed = window.confirm(`Удалить сайт "${title}"?`);
      if (!confirmed) return;
      if (typeof projectEntry?.id !== "number") {
        setDeleteError("Не удалось определить проект для удаления сайта");
        return;
      }

      setActiveMenuSiteId("");
      setDeleteError("");
      setDeletingSiteId(site.public_id);

      try {
        const res = await fetch(API_ENDPOINTS.projectSiteDelete(projectEntry.id), {
          method: "DELETE",
          headers: authHeaders(),
          credentials: "include",
          body: JSON.stringify({ site_public_id: site.public_id }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = payload?.code ?? payload?.detail;
          const detailMsg =
            typeof detail === "string" ? detail : Array.isArray(detail) ? detail.join("\n") : detail != null ? String(detail) : "";
          throw new Error(detailMsg || `Не удалось удалить сайт (${res.status})`);
        }

        const updatedProject =
          typeof projectEntry?.id === "number" ? await reloadProjectEntry(projectEntry.id, { silent: true }) : null;

        // After deletion, return to project sites list. We deliberately do NOT
        // pick a "next" site for the user — site identity belongs to the URL,
        // and the user should choose explicitly from the list.
        if (site.public_id === sitePublicId) {
          navigate(
            typeof buildProjectPath === "function"
              ? buildProjectPath("sites")
              : projectId
                ? `/lk/partner/project/${projectId}/sites`
                : "/lk/partner",
            { replace: true },
          );
          return;
        }
        // Touch updatedProject to keep loadProjectEntry's return value relevant.
        void updatedProject;
      } catch (err) {
        console.error(err);
        setDeleteError(err instanceof Error && err.message ? err.message : "Не удалось удалить сайт");
      } finally {
        setDeletingSiteId("");
      }
    },
    [buildProjectPath, navigate, projectEntry?.id, projectId, reloadProjectEntry, sitePublicId],
  );

  const renderServiceSiteMenuPanelBody = (site) => {
    const title = serviceTitle(site);
    const integrationPayload = siteMenuIntegration.data;
    const hasIntegration = Boolean(integrationPayload);
    const loadFailedNoPayload = Boolean(siteMenuIntegration.error) && !hasIntegration;
    const listStatus = typeof site.status === "string" ? site.status.trim().toLowerCase() : "";
    const lifecycleStatus =
      siteMenuIntegration.diag?.site_status || integrationPayload?.status || (listStatus || undefined);
    const widgetEnabled = hasIntegration ? siteMenuIntegration.widgetEnabled : Boolean(site.widget_enabled);
    const toggleDisabledUntilReady = !hasIntegration && listStatus === "active";

    return loadFailedNoPayload ? (
      <>
        <div className="owner-programs__service-card-menu-hint" role="note">
          Не удалось загрузить настройки
        </div>
        <button
          type="button"
          className="owner-programs__service-card-menu-item owner-programs__service-card-menu-item_danger"
          onClick={(event) => {
            event.stopPropagation();
            handleDeleteSite(site);
          }}
          role="menuitem"
          data-testid={`project-child-site-delete-${site.public_id}`}
          disabled={deletingSiteId === site.public_id}
        >
          {deletingSiteId === site.public_id ? "Удаление…" : "Удалить"}
        </button>
      </>
    ) : (
      <SiteShellWidgetActionsBar
        variant="menu"
        deleteConfirmTitle={title}
        deleteMenuTestId={`project-child-site-delete-${site.public_id}`}
        actionsRef={siteMenuIntegration.actionsRef}
        deleteSiteBusy={siteMenuIntegration.deleteSiteBusy}
        verifyLoading={siteMenuIntegration.verifyLoading}
        refreshBusy={siteMenuIntegration.refreshBusy}
        lifecycleStatus={lifecycleStatus}
        widgetEnabled={widgetEnabled}
        toggleBusy={siteMenuIntegration.saving || siteMenuIntegration.activateLoading}
        toggleDisabledUntilReady={toggleDisabledUntilReady}
      />
    );
  };

  const portalSite = activeMenuSiteId
    ? filteredSites.find((s) => s.public_id === activeMenuSiteId) ||
      visibleProjectSites.find((s) => s.public_id === activeMenuSiteId) ||
      currentProjectSites.find((s) => s.public_id === activeMenuSiteId) ||
      null
    : null;

  const siteMenuPortal =
    activeMenuSiteId && menuAnchorRect && portalSite && typeof window !== "undefined"
      ? createPortal(
          <div
            ref={menuDropdownPortalRef}
            className="owner-programs__service-card-menu-dropdown owner-programs__service-card-menu-dropdown_portal"
            style={{
              position: "fixed",
              top: menuAnchorRect.bottom + 8,
              right: window.innerWidth - menuAnchorRect.right,
              zIndex: 6000,
            }}
            role="menu"
          >
            {renderServiceSiteMenuPanelBody(portalSite)}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="owner-programs__page" data-testid="project-services-page">
      {!projectEntryLoading && !projectEntryError && showAddSiteForm ? (
        <section className="owner-programs__connect-site-panel">
          <div className="page__returnButton">
            <Link className="tw-link link_primary link_s" to="/lk/partner" data-testid="project-connect-site-back">
              <svg xmlns="http://www.w3.org/2000/svg" width="7" height="13" fill="none" viewBox="0 0 7 13" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M1 6.99a1 1 0 0 1 .23-.64l4-5a1 1 0 0 1 1.54 1.29L3.29 6.99l3.32 4.35a1 1 0 0 1-.15 1.4A1 1 0 0 1 5 12.62l-3.83-5A1 1 0 0 1 1 7Z"
                />
              </svg>
              Назад
            </Link>
          </div>
          <h2 className="owner-programs__overview-title">
            {currentProjectSites.length === 0 ? "Подключение сайта" : "Добавить сайт"}
          </h2>
          <div id="create-owner-project" className="owner-programs__connect-site-nested-create">
            <form className="form" onSubmit={handleAddSite}>
              <label className="formControl" htmlFor="project-add-site-name">
                <div className="formControl__label">
                  <span className="text text_s text_bold text_grey text_align_left">Название сайта</span>
                </div>
                <div className="input">
                  <div className="inputWrapper">
                    <input
                      id="project-add-site-name"
                      className="inputField"
                      value={addSiteDisplayName}
                      onChange={(event) => setAddSiteDisplayName(event.target.value)}
                      placeholder="Основной лендинг"
                      autoComplete="off"
                      required
                      maxLength={200}
                      data-testid="project-add-site-name"
                    />
                  </div>
                </div>
              </label>

              <label className="formControl" htmlFor="project-add-site-origin">
                <div className="formControl__label">
                  <span className="text text_s text_bold text_grey text_align_left">Домен или origin</span>
                </div>
                <div className="input">
                  <div className="inputWrapper">
                    <input
                      id="project-add-site-origin"
                      className="inputField"
                      value={addSiteOrigin}
                      onChange={(event) => setAddSiteOrigin(event.target.value)}
                      placeholder="https://mysite.tilda.ws"
                      autoComplete="off"
                      required
                      data-testid="project-add-site-origin"
                    />
                  </div>
                </div>
              </label>

              <div className="formControl">
                <div className="formControl__label" id="project-add-site-platform-label">
                  <span className="text text_s text_bold text_grey text_align_left">Платформа</span>
                </div>
                <ConnectSitePlatformSelect value={addSitePlatform} onChange={setAddSitePlatform} disabled={addSiteState === "saving"} />
              </div>

              {addSiteError ? <div className="formError">{addSiteError}</div> : null}

              <div className="owner-programs__connect-site-form-actions">
                <button
                  type="submit"
                  className="baseButton button button_size_medium baseButton__size_medium baseButton__color_primary"
                  disabled={addSiteState === "saving"}
                  data-testid="project-add-site-submit"
                >
                  {addSiteState === "saving" ? "Создание…" : "Создать и настроить"}
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      {!showAddSiteForm ? (
        <>
          <div className="owner-programs__services-toolbar">
            <label className="owner-programs__services-search">
              <span className="owner-programs__services-search-icon">
                <Search size={16} />
              </span>
              <input
                className="owner-programs__input owner-programs__services-search-input"
                type="search"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Поиск"
                data-testid="project-services-search"
              />
            </label>
            <div className="owner-programs__services-layout-switch" role="group" aria-label="Вид списка сайтов">
              <button
                type="button"
                className={`owner-programs__services-layout-btn${layoutMode === "cards" ? " owner-programs__services-layout-btn_active" : ""}`}
                onClick={() => setLayoutMode("cards")}
                aria-pressed={layoutMode === "cards"}
                data-testid="project-services-layout-cards"
              >
                <ServicesGridIcon />
              </button>
              <button
                type="button"
                className={`owner-programs__services-layout-btn${layoutMode === "list" ? " owner-programs__services-layout-btn_active" : ""}`}
                onClick={() => setLayoutMode("list")}
                aria-pressed={layoutMode === "list"}
                data-testid="project-services-layout-list"
              >
                <ServicesListIcon />
              </button>
            </div>
          </div>

          <div className="owner-programs__services-section-title" data-testid="project-services-section-title">
            <h2 className="owner-programs__services-section-heading">
              Сайты{" "}
              {projectEntryLoading ? (
                <span className="owner-programs__skel owner-programs__services-section-count-skel" aria-hidden="true" />
              ) : (
                <span className="owner-programs__services-section-count">{visibleProjectSites.length}</span>
              )}
            </h2>
          </div>

          {projectEntryLoading ? (
            <div className="owner-programs__project-services-skel-grid" role="status" aria-label="Загрузка сайтов проекта">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="owner-programs__skel owner-programs__tab-page-skel_service-card" aria-hidden />
              ))}
            </div>
          ) : null}
          {!projectEntryLoading && projectEntryError ? <div className="owner-programs__error">{projectEntryError}</div> : null}
          {!projectEntryLoading && !projectEntryError && deleteError ? <div className="owner-programs__error">{deleteError}</div> : null}
          {!projectEntryLoading && !projectEntryError && filteredSites.length === 0 && visibleProjectSites.length === 0 ? (
            <p className="owner-programs__muted" data-testid="project-services-empty">
              У проекта пока нет сайтов.
            </p>
          ) : null}
          {!projectEntryLoading && !projectEntryError && filteredSites.length === 0 && visibleProjectSites.length > 0 ? (
            <p className="owner-programs__muted">По вашему запросу сайты не найдены.</p>
          ) : null}

          {!projectEntryLoading && !projectEntryError && filteredSites.length > 0 ? (
            layoutMode === "cards" ? (
              <div className="owner-programs__services-grid" data-testid="project-child-sites-list">
                {filteredSites.map((site) => {
                  const isCurrent = site.public_id === sitePublicId;
                  const title = serviceTitle(site);
                  const domain = sitePrimaryDomainLabel(site) || formatDomainLine(site.primary_origin, [site.primary_origin]);
                  const status = serviceStatusPresentation(site, siteReachabilityById[site.public_id]?.phase || "idle", hasSiteId && isCurrent);
                  const siteCardAvatarUrl =
                    typeof site.avatar_data_url === "string" ? site.avatar_data_url.trim() : "";
                  const menuOpen = activeMenuSiteId === site.public_id;
                  const cardLetter = title.slice(0, 1).toUpperCase() || "S";
                  return (
                    <div
                      key={site.public_id}
                      className={`owner-programs__service-card${menuOpen ? " owner-programs__service-card_menu-open" : ""}`}
                      data-testid={`project-child-site-${site.public_id}`}
                      role="link"
                      aria-current={hasSiteId && isCurrent ? "page" : undefined}
                      tabIndex={0}
                      onClick={() => openSiteCard(site.public_id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openSiteCard(site.public_id);
                        }
                      }}
                    >
                      <div className="owner-programs__service-card-top-row">
                        <div className="owner-programs__service-card-hero">
                          <div className="owner-programs__service-card-avatar">
                            <SiteFaviconAvatar
                              manualUrl={siteCardAvatarUrl}
                              accountFallbackUrl={partnerAccountAvatarUrl}
                              siteLike={site}
                              letter={cardLetter}
                            />
                          </div>
                        </div>
                        <div className="owner-programs__service-card-top-right" ref={activeMenuSiteId === site.public_id ? menuRef : null}>
                          <ServiceCountryFlag
                            domain={siteOriginForCountryFlag(site, domain)}
                            fallback={serviceCountryFlagGlobeFallback(16)}
                            title={serverPingFromServerTitle(site, siteReachabilityById[site.public_id])}
                          />
                          <div className="owner-programs__service-card-menu" onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              className="owner-programs__service-card-menu-trigger"
                              onClick={(event) => {
                                event.stopPropagation();
                                setActiveMenuSiteId((value) => (value === site.public_id ? "" : site.public_id));
                              }}
                              aria-haspopup="menu"
                              aria-expanded={activeMenuSiteId === site.public_id}
                              data-testid={`project-child-site-menu-trigger-${site.public_id}`}
                              disabled={
                                deletingSiteId === site.public_id ||
                                (siteMenuIntegration.deleteSiteBusy && activeMenuSiteId === site.public_id)
                              }
                            >
                              <ServiceActionsIcon />
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="owner-programs__service-card-headline">
                        <span className={status.cardDotClassName} aria-hidden="true" />
                        <span className="owner-programs__service-card-headline-title">{title}</span>
                      </div>
                      <div className="owner-programs__service-card-specs" title={domain || "—"}>
                        {domain || "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="owner-programs__members-list owner-programs__services-list" data-testid="project-child-sites-list">
                {filteredSites.map((site) => {
                  const isCurrent = site.public_id === sitePublicId;
                  const domain = sitePrimaryDomainLabel(site) || formatDomainLine(site.primary_origin, [site.primary_origin]);
                  const status = serviceStatusPresentation(site, siteReachabilityById[site.public_id]?.phase || "idle", hasSiteId && isCurrent);
                  const siteListAvatarUrl =
                    typeof site.avatar_data_url === "string" ? site.avatar_data_url.trim() : "";
                  const menuOpen = activeMenuSiteId === site.public_id;
                  const listLetter = (servicesListDomainOnly(domain) || "S").slice(0, 1).toUpperCase() || "S";
                  return (
                    <div
                      key={site.public_id}
                      className={`owner-programs__services-list-row${menuOpen ? " owner-programs__services-list-row_menu-open" : ""}`}
                      data-testid={`project-child-site-${site.public_id}`}
                      role="link"
                      aria-current={hasSiteId && isCurrent ? "page" : undefined}
                      tabIndex={0}
                      onClick={() => openSiteCard(site.public_id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openSiteCard(site.public_id);
                        }
                      }}
                    >
                      <div className="owner-programs__services-list-top">
                        <div className="owner-programs__service-card-avatar owner-programs__services-list-avatar">
                          <SiteFaviconAvatar
                            manualUrl={siteListAvatarUrl}
                            accountFallbackUrl={partnerAccountAvatarUrl}
                            siteLike={site}
                            letter={listLetter}
                          />
                        </div>
                      </div>
                      <div className="owner-programs__services-list-middle">
                        <div className={status.listDotClassName} aria-hidden="true" />
                        <div className="owner-programs__services-list-middle-main">
                          <p className="owner-programs__services-list-title">{servicesListDomainOnly(domain)}</p>
                        </div>
                      </div>
                      <div className="owner-programs__services-list-bottom">
                        <div className="owner-programs__services-list-end">
                          <div className="owner-programs__services-list-flag-wrap">
                            <ServiceCountryFlag
                              domain={siteOriginForCountryFlag(site, domain)}
                              fallback={serviceCountryFlagGlobeFallback(16)}
                              title={serverPingFromServerTitle(site, siteReachabilityById[site.public_id])}
                            />
                          </div>
                          <div
                            className="owner-programs__service-card-menu owner-programs__services-list-menu"
                            ref={activeMenuSiteId === site.public_id ? menuRef : null}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="owner-programs__service-card-menu-trigger owner-programs__services-list-menu-trigger"
                              onClick={(event) => {
                                event.stopPropagation();
                                setActiveMenuSiteId((value) => (value === site.public_id ? "" : site.public_id));
                              }}
                              aria-haspopup="menu"
                              aria-expanded={activeMenuSiteId === site.public_id}
                              data-testid={`project-child-site-menu-trigger-${site.public_id}`}
                              disabled={
                                deletingSiteId === site.public_id ||
                                (siteMenuIntegration.deleteSiteBusy && activeMenuSiteId === site.public_id)
                              }
                            >
                              <ServiceActionsIcon />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : null}
        </>
      ) : null}
      {siteMenuPortal}
    </div>
  );
}
