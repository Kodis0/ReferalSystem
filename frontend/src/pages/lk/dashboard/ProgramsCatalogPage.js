import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ListFilter, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { LK_PROGRAM_LISTS_REFETCH_EVENT, LUMOREF_SITE_STATUS_CHANGED_EVENT } from "../lkProgramListsSync";
import { SiteFaviconAvatar } from "../owner-programs/SiteFaviconAvatar";
import programsCatalogHeroArt from "../../../static/images/programs-catalog-hero-megaphone.png";
import achievementRevealEye from "../../../static/images/achievement-reveal-eye.svg";
import programsCatalogHeroHiddenEye from "../../../static/images/programs-catalog-hero-hidden-eye.svg";
import "../lk.css";
import "../owner-programs/owner-programs.css";
import "./dashboard.css";
import {
  CatalogFilterListbox,
  COMMISSION_FILTER_OPTIONS,
  PARTICIPANTS_FILTER_OPTIONS,
} from "./ProgramsCatalogFilters";
import {
  formatCatalogCommissionPercent,
  getCatalogFilteredSortedPrograms,
  programLifecycleStatus,
  programCatalogDisplayName,
  programCatalogExternalSiteHref,
  programCatalogSiteOriginLabel,
} from "./programsCatalogModel";
import {
  eyePosUnchanged,
  floatingEyePosHeroHidden,
  floatingEyeTopLeftFromBannerInset,
  rectCenterToFixedEyeTopLeft,
  roundFixedEyePos,
} from "./catalogHeroEyeGeometry";

/** Скрытие hero-баннера каталога (версия ключа — при смене текста баннера поднять :v2). */
const REFERRAL_PROGRAMS_HERO_HIDDEN_KEY = "referralProgramsHeroHidden:v1";

function readCatalogHeroHiddenFromStorage() {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(REFERRAL_PROGRAMS_HERO_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function persistCatalogHeroHidden(hidden) {
  try {
    if (typeof window === "undefined") return;
    if (hidden) {
      window.localStorage.setItem(REFERRAL_PROGRAMS_HERO_HIDDEN_KEY, "1");
    } else {
      window.localStorage.removeItem(REFERRAL_PROGRAMS_HERO_HIDDEN_KEY);
    }
  } catch {
    /* storage недоступен — состояние только в памяти сессии */
  }
}

function ServiceActionsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="currentColor" d="M9 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm-5.25 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm10.5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
    </svg>
  );
}

function programAvatarLetter(label) {
  const value = typeof label === "string" ? label.trim() : "";
  return (value.slice(0, 1).toUpperCase() || "P");
}

const PROGRAMS_CATALOG_SKEL_ROW_KEYS = [0, 1, 2, 3, 4];

function ProgramsCatalogLoadingSkeleton() {
  return (
    <div
      className="lk-dashboard__programs-catalog-skel"
      role="status"
      aria-busy="true"
      aria-label="Загрузка каталога программ"
      data-testid="programs-catalog-loading"
    >
      <div className="lk-dashboard__programs-catalog-skel-toolbar">
        <span className="owner-programs__skel lk-dashboard__programs-catalog-skel-search" aria-hidden />
        <span className="owner-programs__skel lk-dashboard__programs-catalog-skel-filters-btn" aria-hidden />
      </div>
      <div className="lk-dashboard__programs-catalog-skel-section">
        <span className="owner-programs__skel lk-dashboard__programs-catalog-skel-section-title" aria-hidden />
      </div>
      <ul className="lk-dashboard__programs-list lk-dashboard__programs-catalog-skel-list">
        {PROGRAMS_CATALOG_SKEL_ROW_KEYS.map((key) => (
          <li key={key} className="lk-dashboard__programs-item">
            <div className="lk-dashboard__programs-catalog-skel-row">
              <div className="lk-dashboard__programs-catalog-skel-avatar-wrap">
                <span className="owner-programs__skel lk-dashboard__programs-catalog-skel-avatar" aria-hidden />
              </div>
              <div className="lk-dashboard__programs-catalog-skel-middle">
                <span className="owner-programs__skel lk-dashboard__programs-catalog-skel-dot" aria-hidden />
                <div className="lk-dashboard__programs-catalog-skel-text" aria-hidden>
                  <span className="owner-programs__skel lk-dashboard__programs-catalog-skel-chip lk-dashboard__programs-catalog-skel-chip_title" />
                  <span className="owner-programs__skel lk-dashboard__programs-catalog-skel-chip lk-dashboard__programs-catalog-skel-chip_status" />
                  <span className="owner-programs__skel lk-dashboard__programs-catalog-skel-chip lk-dashboard__programs-catalog-skel-chip_pct" />
                </div>
              </div>
              <span className="owner-programs__skel lk-dashboard__programs-catalog-skel-menu" aria-hidden />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ProgramsCatalogPage() {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState(null);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [commissionFilter, setCommissionFilter] = useState("");
  const [participantsFilter, setParticipantsFilter] = useState("");
  const [filtersPanelOpen, setFiltersPanelOpen] = useState(false);
  const [filterListboxOpen, setFilterListboxOpen] = useState(null);
  const filtersWrapRef = useRef(null);
  const programsRef = useRef([]);
  const [activeMenuSiteId, setActiveMenuSiteId] = useState("");
  const [joiningSiteId, setJoiningSiteId] = useState("");
  const [leavingSiteId, setLeavingSiteId] = useState("");
  const menuDropdownPortalRef = useRef(null);
  const [menuAnchorRect, setMenuAnchorRect] = useState(null);
  const [catalogHeroHidden, setCatalogHeroHidden] = useState(readCatalogHeroHiddenFromStorage);
  const [catalogHeroEyePos, setCatalogHeroEyePos] = useState(null);
  const catalogHeroEyeRoRafRef = useRef(null);
  /** После «Скрыть» при открытом баннере — полный {top,left} угла hero (как в открытом состоянии); не пересчитывать по строке заголовка */
  const catalogHeroEyeFrozenPosRef = useRef(null);
  const catalogHeroCornerAnchorRef = useRef(null);
  const catalogHeroBannerRef = useRef(null);
  const catalogHeroCollapseRef = useRef(null);
  const catalogHeroHeadingRowRef = useRef(null);
  const catalogHeroHeadingRef = useRef(null);
  /** Резерв ширины справа у строки заголовка (inline flex) */
  const catalogHeroHeadingEyeAnchorRef = useRef(null);

  useEffect(() => {
    return () => {
      if (catalogHeroEyeRoRafRef.current != null) {
        window.cancelAnimationFrame(catalogHeroEyeRoRafRef.current);
      }
    };
  }, []);

  /**
   * Один портал: открыто — угол баннера; скрыто — замороженная позиция угла на момент «Скрыть», иначе слот строки (только LS).
   */
  const syncCatalogHeroFloatingEye = useCallback(() => {
    const commitEyePos = (raw) => {
      const pos = raw ? roundFixedEyePos(raw) : null;
      if (!pos) return;
      setCatalogHeroEyePos((prev) => (eyePosUnchanged(prev, pos) ? prev : pos));
    };

    if (!catalogHeroHidden) {
      const fromBanner = floatingEyeTopLeftFromBannerInset(catalogHeroBannerRef.current);
      if (fromBanner) {
        commitEyePos(fromBanner);
      } else {
        const corner = catalogHeroCornerAnchorRef.current;
        const cornerRect = corner?.getBoundingClientRect();
        if (cornerRect && cornerRect.width >= 1 && cornerRect.height >= 1) {
          commitEyePos(rectCenterToFixedEyeTopLeft(cornerRect));
        }
      }
      return;
    }

    const frozen = catalogHeroEyeFrozenPosRef.current;
    if (frozen) {
      commitEyePos(frozen);
      return;
    }

    const slotPos = floatingEyePosHeroHidden(catalogHeroHeadingEyeAnchorRef.current, catalogHeroHeadingRowRef.current);
    if (slotPos) {
      commitEyePos(slotPos);
    }
  }, [catalogHeroHidden]);

  const hideCatalogHero = useCallback(() => {
    const fromBanner = floatingEyeTopLeftFromBannerInset(catalogHeroBannerRef.current);
    if (fromBanner) {
      catalogHeroEyeFrozenPosRef.current = fromBanner;
    } else {
      const corner = catalogHeroCornerAnchorRef.current;
      const cr = corner?.getBoundingClientRect();
      if (cr && cr.width >= 1 && cr.height >= 1) {
        catalogHeroEyeFrozenPosRef.current = rectCenterToFixedEyeTopLeft(cr);
      } else {
        const slotPos = floatingEyePosHeroHidden(
          catalogHeroHeadingEyeAnchorRef.current,
          catalogHeroHeadingRowRef.current,
        );
        if (slotPos) {
          catalogHeroEyeFrozenPosRef.current = slotPos;
        }
      }
    }
    setCatalogHeroHidden(true);
    persistCatalogHeroHidden(true);
  }, []);

  const showCatalogHero = useCallback(() => {
    catalogHeroEyeFrozenPosRef.current = null;
    setCatalogHeroHidden(false);
    persistCatalogHeroHidden(false);
  }, []);

  useLayoutEffect(() => {
    syncCatalogHeroFloatingEye();
  }, [syncCatalogHeroFloatingEye]);

  useLayoutEffect(() => {
    if (typeof ResizeObserver !== "function") {
      return undefined;
    }
    const row = catalogHeroHeadingRowRef.current;
    const collapse = catalogHeroCollapseRef.current;
    const scheduleSync = () => {
      if (catalogHeroEyeRoRafRef.current != null) {
        window.cancelAnimationFrame(catalogHeroEyeRoRafRef.current);
      }
      catalogHeroEyeRoRafRef.current = window.requestAnimationFrame(() => {
        catalogHeroEyeRoRafRef.current = null;
        syncCatalogHeroFloatingEye();
      });
    };
    const ro = new ResizeObserver(scheduleSync);
    if (row) ro.observe(row);
    if (collapse) ro.observe(collapse);
    return () => {
      ro.disconnect();
      if (catalogHeroEyeRoRafRef.current != null) {
        window.cancelAnimationFrame(catalogHeroEyeRoRafRef.current);
        catalogHeroEyeRoRafRef.current = null;
      }
    };
  }, [syncCatalogHeroFloatingEye]);

  useEffect(() => {
    function onViewportChange() {
      syncCatalogHeroFloatingEye();
    }
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [syncCatalogHeroFloatingEye]);

  useEffect(() => {
    if (!filtersPanelOpen) return undefined;
    function onPointerDown(event) {
      if (filtersWrapRef.current && !filtersWrapRef.current.contains(event.target)) {
        setFiltersPanelOpen(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setFiltersPanelOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filtersPanelOpen]);

  useEffect(() => {
    if (!filtersPanelOpen) setFilterListboxOpen(null);
  }, [filtersPanelOpen]);

  useEffect(() => {
    if (!filterListboxOpen) return undefined;
    function onPointerDown(event) {
      const t = event.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-programs-catalog-filter-menu]")) return;
      setFilterListboxOpen(null);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setFilterListboxOpen(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filterListboxOpen]);

  useEffect(() => {
    if (!activeMenuSiteId) return undefined;
    function onPointerDown(event) {
      const t = event.target;
      if (!(t instanceof Element)) return;
      if (menuDropdownPortalRef.current?.contains(t)) return;
      if (t.closest("[data-catalog-program-menu]")) return;
      setActiveMenuSiteId("");
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setActiveMenuSiteId("");
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeMenuSiteId]);

  const catalogListFetchInit = useCallback((token) => {
    return {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    };
  }, []);

  const refetchPrograms = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const res = await fetch(API_ENDPOINTS.programsCatalog, catalogListFetchInit(token));
      if (!res.ok) return;
      const data = await res.json();
      const nextPrograms = Array.isArray(data.programs) ? data.programs : [];
      programsRef.current = nextPrograms;
      setPrograms(nextPrograms);
    } catch {
      /* ignore */
    }
  }, [catalogListFetchInit]);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("access_token");
    if (!token) {
      setPrograms([]);
      setError(false);
      return () => {
        cancelled = true;
      };
    }

    setPrograms(null);
    setError(false);
    fetch(API_ENDPOINTS.programsCatalog, catalogListFetchInit(token))
      .then((res) => {
        if (!res.ok) throw new Error("programs_catalog_fetch_failed");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          const nextPrograms = Array.isArray(data.programs) ? data.programs : [];
          programsRef.current = nextPrograms;
          setPrograms(nextPrograms);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setPrograms([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [catalogListFetchInit]);

  const applyProgramStatusEvent = useCallback((detail) => {
    const changedSiteId = String(detail?.site_public_id || "").trim();
    if (!changedSiteId) return;
    const hasStatus = typeof detail.site_status === "string" && detail.site_status.trim();
    const hasWidgetEnabled = typeof detail.widget_enabled === "boolean";
    const hasProgramActive = typeof detail.program_active === "boolean";
    if (!hasStatus && !hasWidgetEnabled && !hasProgramActive) return;
    setPrograms((prev) => {
      if (!Array.isArray(prev)) return prev;
      let changed = false;
      const next = prev.map((program) => {
        if (String(program?.site_public_id || "").trim() !== changedSiteId) return program;
        changed = true;
        return {
          ...program,
          ...(hasStatus ? { site_status: detail.site_status.trim() } : {}),
          ...(hasWidgetEnabled ? { widget_enabled: detail.widget_enabled } : {}),
          ...(hasProgramActive ? { program_active: detail.program_active } : {}),
        };
      });
      if (changed) programsRef.current = next;
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    function onProgramsAvatarSourcesUpdated(event) {
      if (event?.type === LUMOREF_SITE_STATUS_CHANGED_EVENT) {
        applyProgramStatusEvent(event.detail);
      }
      refetchPrograms();
    }
    window.addEventListener(LK_PROGRAM_LISTS_REFETCH_EVENT, onProgramsAvatarSourcesUpdated);
    window.addEventListener(LUMOREF_SITE_STATUS_CHANGED_EVENT, onProgramsAvatarSourcesUpdated);
    window.addEventListener("lk-account-avatar-updated", onProgramsAvatarSourcesUpdated);
    window.addEventListener("lk-site-avatar-updated", onProgramsAvatarSourcesUpdated);
    return () => {
      window.removeEventListener(LK_PROGRAM_LISTS_REFETCH_EVENT, onProgramsAvatarSourcesUpdated);
      window.removeEventListener(LUMOREF_SITE_STATUS_CHANGED_EVENT, onProgramsAvatarSourcesUpdated);
      window.removeEventListener("lk-account-avatar-updated", onProgramsAvatarSourcesUpdated);
      window.removeEventListener("lk-site-avatar-updated", onProgramsAvatarSourcesUpdated);
    };
  }, [applyProgramStatusEvent, refetchPrograms]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      refetchPrograms();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", refetchPrograms);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", refetchPrograms);
    };
  }, [refetchPrograms]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  /** Уже подключённые программы показываются только в «Мои программы». */
  const programsExcludingJoined = useMemo(() => {
    if (!Array.isArray(programs)) return null;
    return programs.filter((p) => !p.joined);
  }, [programs]);

  const { filteredPrograms, sortedFilteredPrograms } = getCatalogFilteredSortedPrograms(
    programsExcludingJoined ?? [],
    normalizedSearchQuery,
    commissionFilter,
    participantsFilter,
  );

  const openProgramCard = (sitePublicId) => {
    if (!sitePublicId) return;
    navigate(`/lk/referral-program/${sitePublicId}`, { state: { from: "/lk/programs" } });
  };

  const handleJoinProgram = async (event, sitePublicId) => {
    event.stopPropagation();
    const token = localStorage.getItem("access_token");
    if (!token || !sitePublicId || joiningSiteId) return;
    setJoiningSiteId(sitePublicId);
    setActiveMenuSiteId("");
    try {
      const res = await fetch(API_ENDPOINTS.siteCtaJoin, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ site_public_id: sitePublicId }),
      });
      if (!res.ok) throw new Error("join_failed");
      await refetchPrograms();
    } catch {
      /* UI: silent; user can retry from card */
    } finally {
      setJoiningSiteId("");
    }
  };

  useLayoutEffect(() => {
    if (!activeMenuSiteId) {
      setMenuAnchorRect(null);
      return undefined;
    }
    const sync = () => {
      const el = document.querySelector(`[data-testid="programs-catalog-menu-trigger-${activeMenuSiteId}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setMenuAnchorRect({
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        left: r.left,
        width: r.width,
        height: r.height,
      });
    };
    sync();
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [activeMenuSiteId]);

  const handleLeaveProgram = async (event, sitePublicId) => {
    event.stopPropagation();
    const token = localStorage.getItem("access_token");
    if (!token || !sitePublicId || leavingSiteId) return;
    setLeavingSiteId(sitePublicId);
    setActiveMenuSiteId("");
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
        if (!fallbackRes.ok && fallbackRes.status !== 404) throw new Error("leave_failed");
      }
      await refetchPrograms();
    } catch {
      /* ignore */
    } finally {
      setLeavingSiteId("");
    }
  };

  const portalProgram = useMemo(() => {
    if (!activeMenuSiteId || !Array.isArray(programs)) return null;
    return sortedFilteredPrograms.find((p) => p.site_public_id === activeMenuSiteId) || null;
  }, [activeMenuSiteId, sortedFilteredPrograms, programs]);

  useEffect(() => {
    if (!activeMenuSiteId) return;
    if (!sortedFilteredPrograms.some((p) => p.site_public_id === activeMenuSiteId)) {
      setActiveMenuSiteId("");
    }
  }, [sortedFilteredPrograms, activeMenuSiteId]);

  const menuPortal =
    activeMenuSiteId && menuAnchorRect && portalProgram && typeof window !== "undefined"
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
            {Boolean(portalProgram.joined) ? (
              <button
                type="button"
                className="owner-programs__service-card-menu-item owner-programs__service-card-menu-item_danger"
                role="menuitem"
                disabled={leavingSiteId === portalProgram.site_public_id}
                onClick={(event) => handleLeaveProgram(event, portalProgram.site_public_id)}
              >
                {leavingSiteId === portalProgram.site_public_id ? "Выходим…" : "Выйти"}
              </button>
            ) : (
              <button
                type="button"
                className="owner-programs__service-card-menu-item"
                role="menuitem"
                disabled={
                  joiningSiteId === portalProgram.site_public_id ||
                  programLifecycleStatus(portalProgram).tone !== "success"
                }
                onClick={(event) => handleJoinProgram(event, portalProgram.site_public_id)}
              >
                {joiningSiteId === portalProgram.site_public_id
                  ? "Вступаем…"
                  : programLifecycleStatus(portalProgram).tone === "success"
                    ? "Вступить"
                    : "Программа временно недоступна"}
              </button>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
    <div className="lk-dashboard lk-dashboard_my-programs-page">
      <section
        className="lk-dashboard__programs lk-dashboard__programs_catalog"
        aria-labelledby="programs-catalog-heading"
        aria-busy={programs === null && !error ? true : undefined}
      >
        <div
          ref={catalogHeroCollapseRef}
          className={
            "lk-dashboard__programs-catalog-hero-collapse" +
            (catalogHeroHidden ? "" : " lk-dashboard__programs-catalog-hero-collapse--open")
          }
          aria-hidden={catalogHeroHidden}
        >
          <div className="lk-dashboard__programs-catalog-hero-collapse-sizer">
            <div
              ref={catalogHeroBannerRef}
              className="lk-dashboard__my-programs-catalog-banner lk-dashboard__programs-catalog-hero"
            >
              <span
                ref={catalogHeroCornerAnchorRef}
                className="lk-dashboard__programs-catalog-hero-eye-anchor lk-dashboard__programs-catalog-hero-eye-anchor--corner"
                aria-hidden="true"
              />
              <div className="lk-dashboard__my-programs-catalog-banner-inner">
                <div className="lk-dashboard__my-programs-catalog-banner-copy">
                  <p className="lk-dashboard__my-programs-catalog-banner-title">
                    Начните зарабатывать на рекомендациях
                  </p>
                  <p className="lk-dashboard__my-programs-catalog-banner-sub">
                    Выберите подходящую программу, вступите в неё и получите персональную ссылку. Делитесь ссылкой с
                    аудиторией — все привлечённые клиенты будут закрепляться за вами.
                  </p>
                </div>
                <div className="lk-dashboard__my-programs-catalog-banner-art" aria-hidden="true">
                  <img src={programsCatalogHeroArt} alt="" decoding="async" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div ref={catalogHeroHeadingRowRef} className="lk-dashboard__programs-catalog-heading-row">
          <h1 ref={catalogHeroHeadingRef} id="programs-catalog-heading" className="lk-dashboard__programs-title">
            Каталог реферальных программ
          </h1>
          <span
            ref={catalogHeroHeadingEyeAnchorRef}
            className="lk-dashboard__programs-catalog-hero-eye-anchor lk-dashboard__programs-catalog-hero-eye-anchor--inline"
            aria-hidden="true"
          />
        </div>

        {programs !== null && !error && programsExcludingJoined && programsExcludingJoined.length > 0 ? (
          <>
            <div className="lk-dashboard__programs-toolbar">
              <label className="lk-dashboard__programs-search" aria-label="Поиск программ">
                <span className="lk-dashboard__programs-search-icon" aria-hidden="true">
                  <Search size={16} />
                </span>
                <input
                  type="search"
                  className="lk-dashboard__programs-search-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Поиск"
                  autoComplete="off"
                />
              </label>
              <div className="lk-dashboard__programs-filters-wrap" ref={filtersWrapRef}>
                <button
                  type="button"
                  className="lk-dashboard__programs-filters-btn"
                  aria-expanded={filtersPanelOpen}
                  aria-controls="programs-catalog-filters-panel"
                  aria-haspopup="true"
                  onClick={() => {
                    setFiltersPanelOpen((open) => !open);
                    setFilterListboxOpen(null);
                  }}
                  data-testid="programs-catalog-filters-toggle"
                >
                  <ListFilter size={18} strokeWidth={2} aria-hidden={true} />
                  <span>Фильтры</span>
                  {commissionFilter || participantsFilter ? (
                    <span className="lk-dashboard__programs-filters-btn-dot" aria-hidden={true} />
                  ) : null}
                </button>
                {filtersPanelOpen ? (
                  <div
                    id="programs-catalog-filters-panel"
                    className="lk-dashboard__programs-filters-panel"
                    role="group"
                    aria-label="Фильтры каталога"
                  >
                    <CatalogFilterListbox
                      fieldKey="commission"
                      labelText="Начисление, %"
                      labelId="programs-catalog-filter-commission-label"
                      triggerId="programs-catalog-filter-commission"
                      listboxId="programs-catalog-filter-commission-listbox"
                      value={commissionFilter}
                      onChange={setCommissionFilter}
                      options={COMMISSION_FILTER_OPTIONS}
                      openField={filterListboxOpen}
                      setOpenField={setFilterListboxOpen}
                    />
                    <CatalogFilterListbox
                      fieldKey="participants"
                      labelText="Участники"
                      labelId="programs-catalog-filter-participants-label"
                      triggerId="programs-catalog-filter-participants"
                      listboxId="programs-catalog-filter-participants-listbox"
                      value={participantsFilter}
                      onChange={setParticipantsFilter}
                      options={PARTICIPANTS_FILTER_OPTIONS}
                      openField={filterListboxOpen}
                      setOpenField={setFilterListboxOpen}
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="lk-dashboard__programs-catalog-section-title" data-testid="programs-catalog-section-title">
              <h2 className="lk-dashboard__programs-catalog-section-heading">
                Программы <span className="lk-dashboard__programs-catalog-section-count">{programsExcludingJoined.length}</span>
              </h2>
            </div>
          </>
        ) : null}

        {programs === null && !error ? <ProgramsCatalogLoadingSkeleton /> : null}
        {error ? (
          <p className="lk-dashboard__programs-muted">
            Не удалось загрузить список программ. Обновите страницу или попробуйте позже.
          </p>
        ) : null}
        {programs !== null && !error && programs.length === 0 ? (
          <div className="lk-dashboard__programs-muted">
            <p>Пока нет доступных программ.</p>
            <p>Когда владельцы сайтов опубликуют реферальные программы, они появятся здесь.</p>
          </div>
        ) : null}
        {programs !== null && !error && programs.length > 0 && programsExcludingJoined && programsExcludingJoined.length === 0 ? (
          <div className="lk-dashboard__programs-muted">
            <p>В каталоге нет программ для подключения — вы уже участвуете во всех доступных.</p>
          </div>
        ) : null}
        {programs !== null &&
        !error &&
        programsExcludingJoined &&
        programsExcludingJoined.length > 0 &&
        filteredPrograms.length === 0 ? (
          <p className="lk-dashboard__programs-muted">По вашему запросу программ не найдено.</p>
        ) : null}

        {programs !== null && !error && filteredPrograms.length > 0 ? (
          <ul className="lk-dashboard__programs-list">
            {sortedFilteredPrograms.map((p) => {
              const rowTitle = programCatalogDisplayName(p);
              const commissionLabel = formatCatalogCommissionPercent(p);
              const catalogOriginLabel = programCatalogSiteOriginLabel(p);
              const catalogSiteHref = programCatalogExternalSiteHref(p);
              const menuOpen = activeMenuSiteId === p.site_public_id;
              const busyJoin = joiningSiteId === p.site_public_id;
              const busyLeave = leavingSiteId === p.site_public_id;
              const status = programLifecycleStatus(p);
              return (
                <li key={p.site_public_id} className="lk-dashboard__programs-item">
                  <div
                    className={`lk-dashboard__programs-catalog-row${menuOpen ? " lk-dashboard__programs-catalog-row_menu-open" : ""}`}
                    data-testid="programs-catalog-list-link"
                    data-nav-target={`/lk/referral-program/${p.site_public_id}`}
                    role="link"
                    tabIndex={0}
                    onClick={() => openProgramCard(p.site_public_id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openProgramCard(p.site_public_id);
                      }
                    }}
                  >
                    <div className="lk-dashboard__programs-item-top">
                      <div className="lk-dashboard__programs-avatar" aria-hidden="true">
                        <SiteFaviconAvatar
                          key={`cat-${p.site_public_id}-${String(p.avatar_data_url || "").slice(0, 48)}-${String(p.avatar_updated_at || "")}`}
                          manualUrl={typeof p.avatar_data_url === "string" ? p.avatar_data_url.trim() : ""}
                          siteLike={p}
                          letter={programAvatarLetter(rowTitle)}
                          imgClassName="lk-dashboard__programs-avatar-img"
                          useExternalFavicon={false}
                        />
                      </div>
                    </div>
                    <div className="lk-dashboard__programs-catalog-row-middle">
                      <span className={`lk-dashboard__programs-status-dot lk-dashboard__programs-status-dot_${status.tone}`} aria-hidden="true" />
                      <div className="lk-dashboard__programs-catalog-row-text">
                        <span className="lk-dashboard__programs-catalog-title">{rowTitle}</span>
                        {catalogSiteHref ? (
                          <a
                            className="lk-dashboard__programs-catalog-domain"
                            href={catalogSiteHref}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Открыть сайт ${catalogOriginLabel}`}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            {catalogOriginLabel}
                          </a>
                        ) : null}
                        <span className="lk-dashboard__programs-catalog-status">{status.label}</span>
                        <span className="lk-dashboard__programs-catalog-commission">{commissionLabel}</span>
                      </div>
                    </div>
                    <div
                      className="lk-dashboard__programs-catalog-row-actions"
                      data-catalog-program-menu="true"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <div className="owner-programs__service-card-menu owner-programs__services-list-menu">
                        <button
                          type="button"
                          className="owner-programs__service-card-menu-trigger owner-programs__services-list-menu-trigger"
                          aria-haspopup="menu"
                          aria-expanded={menuOpen}
                          aria-label="Действия по программе"
                          data-testid={`programs-catalog-menu-trigger-${p.site_public_id}`}
                          disabled={busyJoin || busyLeave}
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveMenuSiteId((cur) => (cur === p.site_public_id ? "" : p.site_public_id));
                          }}
                        >
                          <ServiceActionsIcon />
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
    {catalogHeroEyePos && typeof document !== "undefined"
      ? createPortal(
          <button
            type="button"
            className="lk-dashboard__programs-catalog-floating-eye lk-dashboard__programs-catalog-hero-eye"
            style={{
              top: catalogHeroEyePos.top,
              left: catalogHeroEyePos.left,
            }}
            onClick={catalogHeroHidden ? showCatalogHero : hideCatalogHero}
            aria-label={
              catalogHeroHidden
                ? "Показать подсказку по каталогу программ"
                : "Скрыть подсказку по каталогу программ"
            }
          >
            <img
              src={catalogHeroHidden ? programsCatalogHeroHiddenEye : achievementRevealEye}
              alt=""
              width={catalogHeroHidden ? 23 : 26}
              height={catalogHeroHidden ? 20 : 18}
              decoding="async"
            />
          </button>,
          document.body,
        )
      : null}
    {menuPortal}
    </>
  );
}
