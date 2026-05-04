import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link2, Search, UserPlus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { LK_PROGRAM_LISTS_REFETCH_EVENT, LUMOREF_SITE_STATUS_CHANGED_EVENT } from "../lkProgramListsSync";
import { SiteFaviconAvatar } from "../owner-programs/SiteFaviconAvatar";
import {
  formatCatalogCommissionPercent,
  programCatalogDisplayName,
  programCatalogExternalSiteHref,
  programCatalogSiteOriginLabel,
  programLifecycleStatus,
} from "./programsCatalogModel";
import myProgramsCatalogBanner from "../../../static/images/my-programs-catalog-banner.png";
import achievementRevealEye from "../../../static/images/achievement-reveal-eye.svg";
import programsCatalogHeroHiddenEye from "../../../static/images/programs-catalog-hero-hidden-eye.svg";
import "../owner-programs/owner-programs.css";
import "./dashboard.css";
import {
  eyePosUnchanged,
  floatingEyePosHeroHidden,
  floatingEyeTopLeftFromBannerInset,
  rectCenterToFixedEyeTopLeft,
  roundFixedEyePos,
} from "./catalogHeroEyeGeometry";

const MY_PROGRAMS_BANNER_HIDDEN_KEY = "myProgramsCatalogBannerHidden:v1";

function readMyProgramsBannerHiddenFromStorage() {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(MY_PROGRAMS_BANNER_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function persistMyProgramsBannerHidden(hidden) {
  try {
    if (typeof window === "undefined") return;
    if (hidden) {
      window.localStorage.setItem(MY_PROGRAMS_BANNER_HIDDEN_KEY, "1");
    } else {
      window.localStorage.removeItem(MY_PROGRAMS_BANNER_HIDDEN_KEY);
    }
  } catch {
    /* storage недоступен */
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
  return value.slice(0, 1).toUpperCase() || "P";
}

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

/**
 * Member-facing list of referral programs (SiteMembership) for the logged-in user.
 */
export function MyProgramsSection() {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState(null);
  const programsRef = useRef([]);
  const [programsError, setProgramsError] = useState(null);
  const [leavingSiteId, setLeavingSiteId] = useState("");
  const [leaveError, setLeaveError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMenuSiteId, setActiveMenuSiteId] = useState("");
  const menuDropdownPortalRef = useRef(null);
  const [menuAnchorRect, setMenuAnchorRect] = useState(null);

  const [myProgramsHeroHidden, setMyProgramsHeroHidden] = useState(readMyProgramsBannerHiddenFromStorage);
  const [myProgramsHeroEyePos, setMyProgramsHeroEyePos] = useState(null);
  const myProgramsHeroEyeRoRafRef = useRef(null);
  const myProgramsHeroEyeFrozenPosRef = useRef(null);
  const myProgramsHeroCornerAnchorRef = useRef(null);
  const myProgramsHeroBannerRef = useRef(null);
  const myProgramsHeroCollapseRef = useRef(null);
  const myProgramsHeroHeadingRowRef = useRef(null);
  const myProgramsHeroHeadingEyeAnchorRef = useRef(null);

  useEffect(() => {
    return () => {
      if (myProgramsHeroEyeRoRafRef.current != null) {
        window.cancelAnimationFrame(myProgramsHeroEyeRoRafRef.current);
      }
    };
  }, []);

  const syncMyProgramsHeroFloatingEye = useCallback(() => {
    const commitEyePos = (raw) => {
      const pos = raw ? roundFixedEyePos(raw) : null;
      if (!pos) return;
      setMyProgramsHeroEyePos((prev) => (eyePosUnchanged(prev, pos) ? prev : pos));
    };

    if (!myProgramsHeroHidden) {
      const fromBanner = floatingEyeTopLeftFromBannerInset(myProgramsHeroBannerRef.current);
      if (fromBanner) {
        commitEyePos(fromBanner);
      } else {
        const corner = myProgramsHeroCornerAnchorRef.current;
        const cornerRect = corner?.getBoundingClientRect();
        if (cornerRect && cornerRect.width >= 1 && cornerRect.height >= 1) {
          commitEyePos(rectCenterToFixedEyeTopLeft(cornerRect));
        }
      }
      return;
    }

    const frozen = myProgramsHeroEyeFrozenPosRef.current;
    if (frozen) {
      commitEyePos(frozen);
      return;
    }

    const slotPos = floatingEyePosHeroHidden(
      myProgramsHeroHeadingEyeAnchorRef.current,
      myProgramsHeroHeadingRowRef.current,
    );
    if (slotPos) {
      commitEyePos(slotPos);
    }
  }, [myProgramsHeroHidden]);

  const hideMyProgramsHero = useCallback(() => {
    const fromBanner = floatingEyeTopLeftFromBannerInset(myProgramsHeroBannerRef.current);
    if (fromBanner) {
      myProgramsHeroEyeFrozenPosRef.current = fromBanner;
    } else {
      const corner = myProgramsHeroCornerAnchorRef.current;
      const cr = corner?.getBoundingClientRect();
      if (cr && cr.width >= 1 && cr.height >= 1) {
        myProgramsHeroEyeFrozenPosRef.current = rectCenterToFixedEyeTopLeft(cr);
      } else {
        const slotPos = floatingEyePosHeroHidden(
          myProgramsHeroHeadingEyeAnchorRef.current,
          myProgramsHeroHeadingRowRef.current,
        );
        if (slotPos) {
          myProgramsHeroEyeFrozenPosRef.current = slotPos;
        }
      }
    }
    setMyProgramsHeroHidden(true);
    persistMyProgramsBannerHidden(true);
  }, []);

  const showMyProgramsHero = useCallback(() => {
    myProgramsHeroEyeFrozenPosRef.current = null;
    setMyProgramsHeroHidden(false);
    persistMyProgramsBannerHidden(false);
  }, []);

  useLayoutEffect(() => {
    syncMyProgramsHeroFloatingEye();
  }, [syncMyProgramsHeroFloatingEye]);

  useLayoutEffect(() => {
    if (typeof ResizeObserver !== "function") {
      return undefined;
    }
    const row = myProgramsHeroHeadingRowRef.current;
    const collapse = myProgramsHeroCollapseRef.current;
    const scheduleSync = () => {
      if (myProgramsHeroEyeRoRafRef.current != null) {
        window.cancelAnimationFrame(myProgramsHeroEyeRoRafRef.current);
      }
      myProgramsHeroEyeRoRafRef.current = window.requestAnimationFrame(() => {
        myProgramsHeroEyeRoRafRef.current = null;
        syncMyProgramsHeroFloatingEye();
      });
    };
    const ro = new ResizeObserver(scheduleSync);
    if (row) ro.observe(row);
    if (collapse) ro.observe(collapse);
    return () => {
      ro.disconnect();
      if (myProgramsHeroEyeRoRafRef.current != null) {
        window.cancelAnimationFrame(myProgramsHeroEyeRoRafRef.current);
        myProgramsHeroEyeRoRafRef.current = null;
      }
    };
  }, [syncMyProgramsHeroFloatingEye]);

  useEffect(() => {
    function onViewportChange() {
      syncMyProgramsHeroFloatingEye();
    }
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [syncMyProgramsHeroFloatingEye]);

  useEffect(() => {
    if (!activeMenuSiteId) return undefined;
    function onPointerDown(event) {
      const t = event.target;
      if (!(t instanceof Element)) return;
      if (menuDropdownPortalRef.current?.contains(t)) return;
      if (t.closest("[data-my-programs-catalog-menu]")) return;
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

  const fetchMyPrograms = useCallback(async (softRefresh = false) => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setPrograms([]);
      setProgramsError(null);
      return;
    }
    if (!softRefresh) {
      setPrograms(null);
      setProgramsError(null);
    }
    try {
      const res = await fetch(API_ENDPOINTS.myPrograms, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("programs_fetch_failed");
      const data = await res.json();
      const nextPrograms = Array.isArray(data.programs) ? data.programs : [];
      programsRef.current = nextPrograms;
      setPrograms(nextPrograms);
      if (softRefresh) setProgramsError(null);
    } catch {
      if (!softRefresh) {
        setProgramsError(true);
        programsRef.current = [];
        setPrograms([]);
      }
    }
  }, []);

  useEffect(() => {
    fetchMyPrograms();
  }, [fetchMyPrograms]);

  useEffect(() => {
    function onProgramsAvatarSourcesUpdated(event) {
      const changedSiteId = String(event?.detail?.site_public_id || "").trim();
      if (
        changedSiteId &&
        !programsRef.current.some((program) => String(program?.site_public_id || "").trim() === changedSiteId)
      ) {
        return;
      }
      fetchMyPrograms(true);
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
  }, [fetchMyPrograms]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      fetchMyPrograms(true);
    }
    function onWindowFocus() {
      fetchMyPrograms(true);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [fetchMyPrograms]);

  const filteredPrograms = useMemo(() => {
    if (!Array.isArray(programs)) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return programs;
    return programs.filter((p) => {
      const status = programLifecycleStatus(p);
      const title = programTitle(p);
      const domain = programSiteLabel(p);
      const haystack = [
        title,
        domain,
        String(p?.site_public_id || ""),
        typeof p?.site_display_label === "string" ? p.site_display_label.trim() : "",
        typeof p?.site_origin_label === "string" ? p.site_origin_label.trim() : "",
        status.label,
        typeof p?.platform_preset === "string" ? String(p.platform_preset) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [programs, searchQuery]);

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

  useEffect(() => {
    if (!activeMenuSiteId) return;
    if (!filteredPrograms.some((p) => p.site_public_id === activeMenuSiteId)) {
      setActiveMenuSiteId("");
    }
  }, [filteredPrograms, activeMenuSiteId]);

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
    setActiveMenuSiteId("");
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
      const nextPrograms = Array.isArray(listData.programs) ? listData.programs : [];
      programsRef.current = nextPrograms;
      setPrograms(nextPrograms);
    } catch (error) {
      const raw = error instanceof Error ? error.message.replace("program_leave_failed_", "") : "";
      const suffix = raw && raw !== "program_leave_failed" ? ` (${raw})` : "";
      setLeaveError(`Не удалось выйти из программы. Попробуйте позже.${suffix}`);
    } finally {
      setLeavingSiteId("");
    }
  };

  const portalProgram = useMemo(() => {
    if (!activeMenuSiteId || !Array.isArray(programs)) return null;
    return programs.find((p) => p.site_public_id === activeMenuSiteId) || null;
  }, [activeMenuSiteId, programs]);

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
            <button
              type="button"
              className="owner-programs__service-card-menu-item owner-programs__service-card-menu-item_danger"
              role="menuitem"
              disabled={leavingSiteId === portalProgram.site_public_id}
              data-testid={`agent-program-leave-${portalProgram.site_public_id}`}
              onClick={(event) => leaveProgram(event, portalProgram)}
            >
              {leavingSiteId === portalProgram.site_public_id ? "Выходим…" : "Выйти"}
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
    <section
      id="my-programs"
      className="lk-dashboard__programs lk-dashboard__programs_catalog"
      aria-label="Агентские программы"
      aria-busy={programs === null && !programsError ? true : undefined}
    >
      <div
        ref={myProgramsHeroCollapseRef}
        className={
          "lk-dashboard__programs-catalog-hero-collapse" +
          (myProgramsHeroHidden ? "" : " lk-dashboard__programs-catalog-hero-collapse--open")
        }
        aria-hidden={myProgramsHeroHidden}
      >
        <div className="lk-dashboard__programs-catalog-hero-collapse-sizer">
          <div className="lk-dashboard__my-programs-hero-stack">
            <div
              ref={myProgramsHeroBannerRef}
              className="lk-dashboard__my-programs-catalog-banner lk-dashboard__programs-catalog-hero"
              data-testid="my-programs-catalog-banner"
            >
              <span
                ref={myProgramsHeroCornerAnchorRef}
                className="lk-dashboard__programs-catalog-hero-eye-anchor lk-dashboard__programs-catalog-hero-eye-anchor--corner"
                aria-hidden="true"
              />
              <div className="lk-dashboard__my-programs-catalog-banner-inner">
                <div className="lk-dashboard__my-programs-catalog-banner-copy">
                  <p className="lk-dashboard__my-programs-catalog-banner-title">Начните с каталога</p>
                  <p className="lk-dashboard__my-programs-catalog-banner-sub">
                    Выберите подходящую программу из каталога, вступите в неё и получите личную ссылку — по ней будут засчитываться привлечённые вами клиенты.
                  </p>
                  <Link
                    className="lk-dashboard__my-programs-catalog-banner-cta"
                    to="/lk/programs"
                    data-testid="my-programs-catalog-find-program"
                  >
                    Найти программу
                  </Link>
                </div>
                <div className="lk-dashboard__my-programs-catalog-banner-art" aria-hidden="true">
                  <img src={myProgramsCatalogBanner} alt="" decoding="async" />
                </div>
              </div>
            </div>

            <div className="lk-dashboard__my-programs-catalog-cards" data-testid="my-programs-catalog-cards">
              <div
                className="lk-dashboard__my-programs-catalog-card lk-dashboard__my-programs-catalog-card_has-body"
                role="group"
                aria-labelledby="my-programs-card-choose-title"
                data-testid="my-programs-catalog-card-choose-program"
              >
                <div className="lk-dashboard__my-programs-catalog-card-icon" aria-hidden="true">
                  <Search size={22} strokeWidth={1.75} />
                </div>
                <p id="my-programs-card-choose-title" className="lk-dashboard__my-programs-catalog-card-title">
                  Выберите программу
                </p>
                <p className="lk-dashboard__my-programs-catalog-card-desc">
                  Откройте каталог и найдите программу с подходящими условиями вознаграждения.
                </p>
              </div>
              <div
                className="lk-dashboard__my-programs-catalog-card lk-dashboard__my-programs-catalog-card_has-body"
                role="group"
                aria-labelledby="my-programs-card-join-title"
                data-testid="my-programs-catalog-card-join-program"
              >
                <div className="lk-dashboard__my-programs-catalog-card-icon" aria-hidden="true">
                  <UserPlus size={22} strokeWidth={1.75} />
                </div>
                <p id="my-programs-card-join-title" className="lk-dashboard__my-programs-catalog-card-title">
                  Вступите в программу
                </p>
                <p className="lk-dashboard__my-programs-catalog-card-desc">
                  Подтвердите участие, чтобы программа появилась в вашем кабинете и стала доступна личная ссылка.
                </p>
              </div>
              <div
                className="lk-dashboard__my-programs-catalog-card lk-dashboard__my-programs-catalog-card_has-body"
                role="group"
                aria-labelledby="my-programs-card-link-title"
                data-testid="my-programs-catalog-card-personal-link"
              >
                <div className="lk-dashboard__my-programs-catalog-card-icon" aria-hidden="true">
                  <Link2 size={22} strokeWidth={1.75} />
                </div>
                <p id="my-programs-card-link-title" className="lk-dashboard__my-programs-catalog-card-title">
                  Получите личную ссылку
                </p>
                <p className="lk-dashboard__my-programs-catalog-card-desc">
                  Делитесь ссылкой — по ней будут засчитываться привлечённые вами клиенты.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        ref={myProgramsHeroHeadingRowRef}
        className="lk-dashboard__programs-catalog-heading-row"
        data-testid="my-programs-section-title"
      >
        <h2 className="lk-dashboard__programs-title owner-programs__services-section-heading">
          Мои программы
          {programs !== null && !programsError ? (
            <>
              {" "}
              <span className="owner-programs__services-section-count">{programs.length}</span>
            </>
          ) : null}
        </h2>
        <span
          ref={myProgramsHeroHeadingEyeAnchorRef}
          className="lk-dashboard__programs-catalog-hero-eye-anchor lk-dashboard__programs-catalog-hero-eye-anchor--inline"
          aria-hidden="true"
        />
      </div>
      {programsError && (
        <p className="lk-dashboard__programs-muted">
          Не удалось загрузить список программ. Обновите страницу или попробуйте позже.
        </p>
      )}
      {leaveError ? <p className="lk-dashboard__programs-muted">{leaveError}</p> : null}
      {programs !== null && !programsError && (
        <>
          <div className="lk-dashboard__programs-toolbar lk-dashboard__my-programs-toolbar">
            <label className="lk-dashboard__programs-search" aria-label="Поиск по названию и домену">
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
                data-testid="my-programs-search-input"
              />
            </label>
          </div>
          {programs.length === 0 ? (
            <div className="lk-dashboard__programs-empty-card">
              <div className="lk-dashboard__programs-empty-copy">
                <p className="lk-dashboard__programs-empty-title">Вы пока не участвуете ни в одной программе.</p>
                <p className="lk-dashboard__programs-empty-sub">
                  Откройте каталог, выберите программу и получите персональную ссылку.
                </p>
              </div>
            </div>
          ) : filteredPrograms.length === 0 ? (
            <p className="lk-dashboard__programs-muted">По вашему запросу программ не найдено.</p>
          ) : (
            <ul className="lk-dashboard__programs-list" data-testid="my-programs-list">
              {filteredPrograms.map((p) => {
                const rowTitle = programCatalogDisplayName(p);
                const commissionLabel = formatCatalogCommissionPercent(p);
                const catalogOriginLabel = programCatalogSiteOriginLabel(p);
                const catalogSiteHref = programCatalogExternalSiteHref(p);
                const menuOpen = activeMenuSiteId === p.site_public_id;
                const status = programLifecycleStatus(p);
                const leavingThisProgram = leavingSiteId === p.site_public_id;
                return (
                  <li key={p.site_public_id} className="lk-dashboard__programs-item">
                    <div
                      className={`lk-dashboard__programs-catalog-row${menuOpen ? " lk-dashboard__programs-catalog-row_menu-open" : ""}`}
                      data-testid="agent-program-list-link"
                      data-nav-target={`/lk/referral-program/${p.site_public_id}`}
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
                      <div className="lk-dashboard__programs-item-top">
                        <div className="lk-dashboard__programs-avatar" aria-hidden="true">
                          <SiteFaviconAvatar
                            key={`mine-${p.site_public_id}-${String(p.avatar_data_url || "").slice(0, 48)}-${String(p.avatar_updated_at || "")}`}
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
                        data-my-programs-catalog-menu="true"
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
                            disabled={leavingThisProgram || Boolean(leavingSiteId)}
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
          )}
        </>
      )}
    </section>
    {myProgramsHeroEyePos && typeof document !== "undefined"
      ? createPortal(
          <button
            type="button"
            className="lk-dashboard__programs-catalog-floating-eye lk-dashboard__programs-catalog-hero-eye"
            style={{
              top: myProgramsHeroEyePos.top,
              left: myProgramsHeroEyePos.left,
            }}
            onClick={myProgramsHeroHidden ? showMyProgramsHero : hideMyProgramsHero}
            aria-label={
              myProgramsHeroHidden
                ? "Показать подсказку на странице «Мои программы»"
                : "Скрыть подсказку на странице «Мои программы»"
            }
          >
            <img
              src={myProgramsHeroHidden ? programsCatalogHeroHiddenEye : achievementRevealEye}
              alt=""
              width={myProgramsHeroHidden ? 23 : 26}
              height={myProgramsHeroHidden ? 20 : 18}
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
