import { Routes, Route, Link, useNavigate, Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, UserRound } from "lucide-react";
import { LkHeaderBrandMark } from "./LkHeaderBrandMark";
import Dashboard from "./dashboard/dashboard"; // импорт компонента Dashboard
import AgentProgramDetailPage from "./dashboard/AgentProgramDetailPage";
import Settings from "./settings/settings"; // импорт компонента Settings
import AccountPersonalDataPage from "./settings/AccountPersonalDataPage";
import LkSidebar from "./LkSidebar";
import NewsPage from "./news/news";
import BugPage from "./bug/bug";
import IdeaPage from "./idea/idea";
import PartnerDashboard from "./partner/partner";
import WidgetInstallScreen from "./widget-install/widget-install";
import ProjectWidgetInstallScreen from "./widget-install/ProjectWidgetInstallScreen";
import ProjectSiteManagementScreen from "./widget-install/ProjectSiteManagementScreen";
import OwnerSitesListPage from "./owner-programs/OwnerSitesListPage";
import CreateOwnerProjectPage from "./owner-programs/CreateOwnerProjectPage";
import SiteProjectLayout from "./owner-programs/SiteProjectLayout";
import LegacyOwnerSiteRedirect from "./owner-programs/LegacyOwnerSiteRedirect";
import ProjectOverviewPage from "./owner-programs/ProjectOverviewPage";
import ProjectMembersPage from "./owner-programs/ProjectMembersPage";
import ProjectSettingsPage from "./owner-programs/ProjectSettingsPage";
import ProjectInfoPage from "./owner-programs/ProjectInfoPage";
import SiteDashboardPage from "./owner-programs/SiteDashboardPage";
import SiteHistoryPage from "./owner-programs/SiteHistoryPage";
import ProjectReferralBlockScreen from "./owner-programs/ProjectReferralBlockScreen";
import useCurrentUser from "../../hooks/useCurrentUser";
import useAuth from "../../hooks/auth";
import { isUuidString } from "../registration/postJoinNavigation";
import "./lk.css";

/** Базовый URL сайта ведёт на дашборд; «Виджет» — отдельный сегмент `/widget`. */
function SiteShellDefaultToDashboard() {
  const { projectId, sitePublicId } = useParams();
  const raw = String(sitePublicId || "").trim();
  const pid = String(projectId ?? "");
  if (!isUuidString(raw)) {
    return <Navigate to={`/lk/partner/project/${pid}/sites`} replace />;
  }
  const sid = encodeURIComponent(raw);
  return <Navigate to={`/lk/partner/project/${pid}/sites/${sid}/dashboard`} replace />;
}

function formatAccountId(user) {
  const publicId = typeof user?.public_id === "string" ? user.public_id.trim().toLowerCase() : "";
  if (/^[a-z0-9]{7}$/.test(publicId)) {
    return publicId;
  }

  const source = String(user?.id ?? user?.email ?? "").trim();
  if (!source) {
    return "e000000";
  }

  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }

  return `e${hash.toString(16).padStart(6, "0").slice(-6)}`;
}

function SupportButtonIcon() {
  return (
    <svg
      className="lk-header__support-icon-svg"
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        id="support-Vector_1"
        d="M12 2C10.6868 2 9.38642 2.25866 8.17317 2.7612C6.95991 3.26375 5.85752 4.00035 4.92893 4.92893C3.05357 6.8043 2 9.34784 2 12V19C2 19.2652 2.10536 19.5196 2.29289 19.7071C2.48043 19.8946 2.73478 20 3 20H6C6.79565 20 7.55871 19.6839 8.12132 19.1213C8.68393 18.5587 9 17.7956 9 17V15C9 14.2044 8.68393 13.4413 8.12132 12.8787C7.55871 12.3161 6.79565 12 6 12H4C4 9.87827 4.84285 7.84344 6.34315 6.34315C7.84344 4.84285 9.87827 4 12 4C14.1217 4 16.1566 4.84285 17.6569 6.34315C19.1571 7.84344 20 9.87827 20 12H18C17.2044 12 16.4413 12.3161 15.8787 12.8787C15.3161 13.4413 15 14.2044 15 15V17C15 17.7956 15.3161 18.5587 15.8787 19.1213C16.4413 19.6839 17.2044 20 18 20H21C21.2652 20 21.5196 19.8946 21.7071 19.7071C21.8946 19.5196 22 19.2652 22 19V12C22 10.6868 21.7413 9.38642 21.2388 8.17317C20.7362 6.95991 19.9997 5.85752 19.0711 4.92893C18.1425 4.00035 17.0401 3.26375 15.8268 2.7612C14.6136 2.25866 13.3132 2 12 2ZM6 14C6.26522 14 6.51957 14.1054 6.70711 14.2929C6.89464 14.4804 7 14.7348 7 15V17C7 17.2652 6.89464 17.5196 6.70711 17.7071C6.51957 17.8946 6.26522 18 6 18H4V14H6ZM20 18H18C17.7348 18 17.4804 17.8946 17.2929 17.7071C17.1054 17.5196 17 17.2652 17 17V15C17 14.7348 17.1054 14.4804 17.2929 14.2929C17.4804 14.1054 17.7348 14 18 14H20V18Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SupportButtonChevron() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      fill="none"
      viewBox="0 0 24 24"
      className="lk-header__support-chevron-svg"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M12 16a1 1 0 0 1-.64-.23l-5-4a1 1 0 0 1 1.28-1.54L12 13.71l4.36-3.32a1 1 0 0 1 1.41.15 1 1 0 0 1-.14 1.46l-5 3.83A1 1 0 0 1 12 16Z"
      />
    </svg>
  );
}

/** Событие для обновления счётчика на кнопке «Идеи» без перезагрузки (например, после ответа API). */
export const LK_IDEAS_NAV_BADGE_EVENT = "lk-ideas-nav-badge-count";

function formatIdeaNavBadgeLabel(count) {
  if (count <= 0) return "";
  if (count > 99) return "99+";
  if (count >= 10) return "9+";
  return String(count);
}

function LKPageScrollbar({ scrollerRef, theme }) {
  const [metrics, setMetrics] = useState({
    visible: false,
    thumbHeight: 0,
    thumbTop: 0,
  });
  const trackRef = useRef(null);
  const dragOffsetRef = useRef(0);

  useEffect(() => {
    let rafId = 0;

    function updateScrollbar() {
      const scroller = scrollerRef.current;
      if (!scroller) return;

      const viewportHeight = scroller.clientHeight || 0;
      const scrollHeight = scroller.scrollHeight || 0;
      const trackHeight = trackRef.current?.clientHeight || viewportHeight;
      const maxScrollTop = Math.max(0, scrollHeight - viewportHeight);

      if (maxScrollTop <= 1 || viewportHeight <= 0 || trackHeight <= 0) {
        setMetrics({ visible: false, thumbHeight: 0, thumbTop: 0 });
        return;
      }

      const thumbHeight = Math.max(44, Math.round((trackHeight * viewportHeight) / scrollHeight));
      const thumbTop = Math.round((scroller.scrollTop / maxScrollTop) * (trackHeight - thumbHeight));
      setMetrics({ visible: true, thumbHeight, thumbTop });
    }

    function scheduleUpdate() {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateScrollbar);
    }

    updateScrollbar();
    const scroller = scrollerRef.current;
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleUpdate) : null;
    scroller?.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    if (scroller && resizeObserver) {
      resizeObserver.observe(scroller);
    }

    return () => {
      cancelAnimationFrame(rafId);
      scroller?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [scrollerRef]);

  function scrollToPointer(pointerY) {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    if (!scroller || !track) return;

    const viewportHeight = scroller.clientHeight || 0;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - viewportHeight);
    const trackRect = track.getBoundingClientRect();
    const maxThumbTop = Math.max(1, track.clientHeight - metrics.thumbHeight);
    const nextThumbTop = Math.min(Math.max(0, pointerY - trackRect.top - dragOffsetRef.current), maxThumbTop);

    scroller.scrollTop = (nextThumbTop / maxThumbTop) * maxScrollTop;
  }

  function startDrag(event, offsetY) {
    if (!metrics.visible) return;
    event.preventDefault();
    dragOffsetRef.current = offsetY;
    scrollToPointer(event.clientY);

    function onPointerMove(moveEvent) {
      scrollToPointer(moveEvent.clientY);
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  return (
    <div
      ref={trackRef}
      className={`lk-page-scrollbar lk-page-scrollbar_${theme}`}
      aria-hidden="true"
      data-visible={metrics.visible ? "true" : "false"}
      onPointerDown={(event) => startDrag(event, metrics.thumbHeight / 2)}
    >
      <div
        className="lk-page-scrollbar__thumb"
        style={{
          height: `${metrics.thumbHeight}px`,
          transform: `translateY(${metrics.thumbTop}px)`,
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          startDrag(event, event.clientY - event.currentTarget.getBoundingClientRect().top);
        }}
      />
    </div>
  );
}

function LK() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [personalizationOpen, setPersonalizationOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const searchInputRef = useRef(null);
  const lkRootRef = useRef(null);
  const menuRef = useRef(null);
  const supportRef = useRef(null);
  const personalizationRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, fetchUser } = useCurrentUser();
  const { logout } = useAuth();
  const [ideaNavBadgeCount, setIdeaNavBadgeCount] = useState(0);

  const accountId = formatAccountId(user);

  const THEME_KEY = "lumo-theme";
  const PANEL_WIDTH_KEY = "lk-panel-width";
  const LANG_KEY = "lk-lang";

  const [lkTheme, setLkTheme] = useState(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
    return saved === "light" ? "light" : "dark";
  });

  const [panelWidthMode, setPanelWidthMode] = useState(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(PANEL_WIDTH_KEY) : null;
    return saved === "fixed" ? "fixed" : "wide";
  });

  const [lang, setLang] = useState(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(LANG_KEY) : null;
    return saved === "en" ? "en" : "ru";
  });

  const lkHeaderBg = lkTheme === "light" ? "#ffffff" : "#242F3D";
  const currentPath = location.pathname.toLowerCase();
  /** Совпадает с левым краем full-bleed `.owner-programs__shell` (margin -24px к padding `.LK-content`). */
  const headerSearchAlignShellTrack = /^\/lk\/partner\/project\/[^/]+/i.test(location.pathname);

  useEffect(() => {
    function onIdeasBadgeEvent(event) {
      const raw = event?.detail?.count;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n) || n < 0) return;
      setIdeaNavBadgeCount(Math.min(999, Math.floor(n)));
    }
    window.addEventListener(LK_IDEAS_NAV_BADGE_EVENT, onIdeasBadgeEvent);
    return () => window.removeEventListener(LK_IDEAS_NAV_BADGE_EVENT, onIdeasBadgeEvent);
  }, []);

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (supportRef.current && !supportRef.current.contains(e.target)) setSupportOpen(false);
      if (personalizationRef.current && !personalizationRef.current.contains(e.target)) {
        setPersonalizationOpen(false);
        setLanguageOpen(false);
      }
    }

    function isSearchShortcut(event) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
      if (event.code === "KeyK") return true;
      return event.key.toLowerCase() === "k";
    }

    function onKeyDown(e) {
      if (isSearchShortcut(e)) {
        const searchInput = searchInputRef.current;
        if (searchInput && searchInput.offsetParent !== null) {
          e.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      if (e.key === "Escape") {
        if (document.activeElement === searchInputRef.current) {
          searchInputRef.current.blur();
        }
        setMenuOpen(false);
        setSupportOpen(false);
        setPersonalizationOpen(false);
        setLanguageOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("click", onDocClick);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-lk-page", "true");
    document.body.setAttribute("data-lk-page", "true");

    return () => {
      document.documentElement.removeAttribute("data-lk-page");
      document.body.removeAttribute("data-lk-page");
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", lkTheme);
    localStorage.setItem(THEME_KEY, lkTheme);
  }, [lkTheme]);

  useEffect(() => {
    localStorage.setItem(PANEL_WIDTH_KEY, panelWidthMode);
  }, [panelWidthMode]);

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
  }, [lang]);

  return (
    <div
      ref={lkRootRef}
      className={`LK${headerSearchAlignShellTrack ? " LK--header-search-align-shell" : ""}`}
      data-lk-theme={lkTheme}
      style={{ backgroundColor: lkTheme === "light" ? "#ffffff" : "#17212B" }}
    >
      <header
        className="LK-header"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          height: 76,
          padding: 0,
          background: lkHeaderBg,
          borderBottom: "none",
        }}
        id="topMenu"
      >
        <div className="lk-header__inner">
          <div className="lk-header__left">
            <Link to="/" aria-label="LUMO Referrals" className="lk-header__logo-link">
              {/* Лого шапки: LkHeaderBrandMark (Group 17). LoginBrandLogo — только login/registration. */}
              <LkHeaderBrandMark />
            </Link>
          </div>

          <div className="lk-header__content-strip">
            <div className="lk-header__center">
              <div className="lk-header__search" role="search">
                <div
                  className="lk-header__search-inputWrapper"
                  onMouseDown={(event) => {
                    if (event.target !== searchInputRef.current) {
                      event.preventDefault();
                    }
                  }}
                  onClick={() => searchInputRef.current?.focus()}
                >
                  <input
                    ref={searchInputRef}
                    id="lk-header-search"
                    className="lk-header__search-input"
                    type="text"
                    placeholder="Поиск"
                    tabIndex={0}
                    aria-label="Поиск"
                    aria-keyshortcuts="Control+K Meta+K"
                  />
                  <span className="lk-header__search-shortcut lk-header__search-shortcut_hint" aria-hidden="true">
                    Ctrl K
                  </span>
                </div>
              </div>

              <div className="lk-header__nav" aria-label="Навигация">
              <button
                type="button"
                className={`lk-header__nav-btn ${currentPath === "/lk/news" ? "lk-header__nav-btn_active" : ""}`}
                aria-label="Новости и обновления"
                onClick={() => {
                  setMenuOpen(false);
                  setSupportOpen(false);
                  setPersonalizationOpen(false);
                  setLanguageOpen(false);
                  navigate("/LK/news");
                }}
              >
                <svg
                  className="lk-header__nav-icon"
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <g id="News_0">
                    <path
                      id="news-Vector_1"
                      d="M2 18C2 18.7957 2.31607 19.5587 2.87868 20.1213C3.44129 20.6839 4.20435 21 5 21H18C19.0609 21 20.0783 20.5786 20.8284 19.8284C21.5786 19.0783 22 18.0609 22 17V6.18201H20V17C20 17.5304 19.7893 18.0392 19.4142 18.4142C19.0391 18.7893 18.5304 19 18 19H7.82C7.93642 18.6793 7.9973 18.3412 8 18V6.18201H6V7.00001V9.00001V18C6 18.2652 5.89464 18.5196 5.70711 18.7071C5.51957 18.8947 5.26522 19 5 19C4.73478 19 4.48043 18.8947 4.29289 18.7071C4.10536 18.5196 4 18.2652 4 18V13.0088H2V18Z"
                      fill="currentColor"
                    />
                    <path
                      id="news-Vector_2"
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M17 9H11C10.7348 9 10.4804 8.89464 10.2929 8.70711C10.1054 8.51957 10 8.26522 10 8C10 7.73478 10.1054 7.48043 10.2929 7.29289C10.4804 7.10536 10.7348 7 11 7H17C17.2652 7 17.5196 7.10536 17.7071 7.29289C17.8946 7.48043 18 7.73478 18 8C18 8.26522 17.8946 8.51957 17.7071 8.70711C17.5196 8.89464 17.2652 9 17 9Z"
                      fill="currentColor"
                    />
                    <path
                      id="news-Vector_3"
                      d="M17 13H11C10.7348 13 10.4804 12.8946 10.2929 12.7071C10.1054 12.5196 10 12.2652 10 12C10 11.7348 10.1054 11.4804 10.2929 11.2929C10.4804 11.1054 10.7348 11 11 11H17C17.2652 11 17.5196 11.1054 17.7071 11.2929C17.8946 11.4804 18 11.7348 18 12C18 12.2652 17.8946 12.5196 17.7071 12.7071C17.5196 12.8946 17.2652 13 17 13Z"
                      fill="currentColor"
                    />
                    <path
                      id="news-Vector_4"
                      d="M17 17H11C10.7348 17 10.4804 16.8946 10.2929 16.7071C10.1054 16.5196 10 16.2652 10 16C10 15.7348 10.1054 15.4804 10.2929 15.2929C10.4804 15.1054 10.7348 15 11 15H17C17.2652 15 17.5196 15.1054 17.7071 15.2929C17.8946 15.4804 18 15.7348 18 16C18 16.2652 17.8946 16.5196 17.7071 16.7071C17.5196 16.8946 17.2652 17 17 17Z"
                      fill="currentColor"
                    />
                    <path
                      id="news-Vector_5"
                      d="M7 3H21C21.2652 3 21.5196 3.10536 21.7071 3.29289C21.8946 3.48043 22 3.73478 22 4V13.8622H20V5H8V13.5H6V9V7V4C6 3.73478 6.10536 3.48043 6.29289 3.29289C6.48043 3.10536 6.73478 3 7 3Z"
                      fill="currentColor"
                    />
                    <path
                      id="news-Vector_6"
                      d="M3 7H6V9H4V13.5H2V8C2 7.73478 2.10536 7.48043 2.29289 7.29289C2.48043 7.10536 2.73478 7 3 7Z"
                      fill="currentColor"
                    />
                  </g>
                </svg>
                <span className="lk-header__tooltip" role="tooltip">
                  Новости и обновления
                </span>
              </button>

              <button
                type="button"
                className={`lk-header__nav-btn ${currentPath === "/lk/bug" ? "lk-header__nav-btn_active" : ""}`}
                aria-label="Сообщить о баге"
                onClick={() => {
                  setMenuOpen(false);
                  setSupportOpen(false);
                  setPersonalizationOpen(false);
                  setLanguageOpen(false);
                  navigate("/LK/bug");
                }}
              >
                <svg
                  className="lk-header__nav-icon"
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <g id="Apps_0">
                    <path
                      id="Vector_1"
                      d="M12.0101 7.58936H12.0001C9.31603 7.58936 7.14014 9.76525 7.14014 12.4494V14.8894C7.14014 17.5735 9.31603 19.7494 12.0001 19.7494H12.0101C14.6942 19.7494 16.8701 17.5735 16.8701 14.8894V12.4494C16.8701 9.76525 14.6942 7.58936 12.0101 7.58936Z"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      id="Vector_2"
                      d="M3.49023 7.58936C3.49023 8.39561 3.81052 9.16885 4.38063 9.73896C4.95074 10.3091 5.72398 10.6294 6.53023 10.6294H17.4702C18.2765 10.6294 19.0497 10.3091 19.6198 9.73896C20.1899 9.16885 20.5102 8.39561 20.5102 7.58936"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      id="Vector_3"
                      d="M9.47023 4.54932V5.05932C9.44852 5.40427 9.49771 5.75001 9.61478 6.07522C9.73184 6.40043 9.91431 6.69819 10.1509 6.95016C10.3875 7.20212 10.6732 7.40293 10.9904 7.54021C11.3076 7.67748 11.6496 7.7483 11.9952 7.7483C12.3409 7.7483 12.6828 7.67748 13 7.54021C13.3173 7.40293 13.603 7.20212 13.8396 6.95016C14.0762 6.69819 14.2586 6.40043 14.3757 6.07522C14.4928 5.75001 14.542 5.40427 14.5202 5.05932V4.54932M3.49023 20.3493C3.49023 19.5431 3.81052 18.7698 4.38063 18.1997C4.95074 17.6296 5.72398 17.3093 6.53023 17.3093H7.74023M20.5102 20.3493C20.5102 19.5431 20.1899 18.7698 19.6198 18.1997C19.0497 17.6296 18.2765 17.3093 17.4702 17.3093H16.2502M7.14023 14.0093H4.10023M19.9002 14.0093H16.8602"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </g>
                </svg>
                <span className="lk-header__tooltip" role="tooltip">
                  Сообщить о баге
                </span>
              </button>

              <button
                type="button"
                className={`lk-header__nav-btn ${currentPath === "/lk/idea" ? "lk-header__nav-btn_active" : ""}`}
                aria-label={
                  ideaNavBadgeCount > 0
                    ? `Предложить идею, новых: ${ideaNavBadgeCount > 99 ? "более 99" : ideaNavBadgeCount}`
                    : "Предложить идею"
                }
                onClick={() => {
                  setMenuOpen(false);
                  setSupportOpen(false);
                  setPersonalizationOpen(false);
                  setLanguageOpen(false);
                  navigate("/LK/idea");
                }}
              >
                <span className="lk-header__nav-ideas-wrap">
                  <svg
                    className="lk-header__nav-icon lk-header__nav-icon_ideas"
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      id="ideas-Vector_1"
                      d="M10.0546 17.3371H11.0419V12.5444H12.959V17.3371H13.9463C14.0709 16.1869 14.6556 15.2283 15.6142 14.1931C15.7196 14.0781 16.4098 13.3687 16.4864 13.2633C17.1633 12.4174 17.5874 11.3975 17.71 10.321C17.8326 9.24462 17.6486 8.15546 17.1794 7.179C16.7101 6.20253 15.9745 5.37847 15.0575 4.80171C14.1404 4.22495 13.079 3.91895 11.9956 3.91895C10.9123 3.91895 9.85091 4.22495 8.93381 4.80171C8.01672 5.37847 7.28118 6.20253 6.8119 7.179C6.34262 8.15546 6.15869 9.24462 6.28128 10.321C6.40387 11.3975 6.828 12.4174 7.50483 13.2633L8.3867 14.1931C9.34525 15.2379 9.92996 16.1869 10.0546 17.3371ZM10.0833 19.2542V20.2128H13.9175V19.2542H10.0833ZM6.0095 14.4615C5.10808 13.3333 4.54354 11.9735 4.38085 10.5387C4.21817 9.10378 4.46394 7.65212 5.0899 6.35077C5.71585 5.04942 6.69653 3.95125 7.91908 3.18268C9.14163 2.4141 10.5564 2.00635 12.0004 2.00635C13.4445 2.00635 14.8592 2.4141 16.0818 3.18268C17.3043 3.95125 18.285 5.04942 18.911 6.35077C19.5369 7.65212 19.7827 9.10378 19.62 10.5387C19.4573 11.9735 18.8928 13.3333 17.9914 14.4615C17.3875 15.1996 15.8346 16.3786 15.8346 17.8164V20.2128C15.8346 20.7212 15.6326 21.2089 15.2731 21.5684C14.9136 21.9279 14.426 22.1299 13.9175 22.1299H10.0833C9.57488 22.1299 9.08726 21.9279 8.72774 21.5684C8.36821 21.2089 8.16623 20.7212 8.16623 20.2128V17.8164C8.16623 16.3786 6.6038 15.1996 6.0095 14.4615Z"
                      fill="currentColor"
                    />
                  </svg>
                  {ideaNavBadgeCount > 0 ? (
                    <span className="lk-header__nav-badge" aria-hidden="true">
                      {formatIdeaNavBadgeLabel(ideaNavBadgeCount)}
                    </span>
                  ) : null}
                </span>
                <span className="lk-header__tooltip" role="tooltip">
                  Предложить идею
                </span>
              </button>
              </div>
            </div>

            <div className="lk-header__right">
            <div className="lk-header__support" ref={supportRef}>
                <button
                  type="button"
                className="lk-header__support-btn"
                onClick={() => {
                  setMenuOpen(false);
                  setSupportOpen((v) => !v);
                }}
                aria-haspopup="menu"
                aria-expanded={supportOpen}
                data-test-id="support-menu-btn"
              >
                <span className="lk-header__support-icon" aria-hidden="true">
                  <SupportButtonIcon />
                </span>
                <span className="lk-header__support-label">Поддержка</span>
                <span className={`lk-header__chevron ${supportOpen ? "lk-header__chevron_open" : ""}`} aria-hidden="true">
                  <SupportButtonChevron />
                </span>
              </button>

              {supportOpen && (
                <div className="lk-header__menu" role="menu">
                  <button type="button" className="lk-header__menu-item" role="menuitem" onClick={() => setSupportOpen(false)}>
                    Центр поддержки
                  </button>
                  <button type="button" className="lk-header__menu-item" role="menuitem" onClick={() => setSupportOpen(false)}>
                    Написать в поддержку
                  </button>
                </div>
              )}
            </div>

            <div className="lk-header__account" ref={menuRef}>
            <button
              type="button"
              className="lk-header__account-btn"
              onClick={() => {
                setSupportOpen(false);
                setMenuOpen((v) => !v);
                setPersonalizationOpen(false);
                setLanguageOpen(false);
              }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-test-id="account-menu-btn"
              id="login"
            >
              <span className="lk-header__account-id">{accountId}</span>
              <span className="lk-header__avatar" aria-hidden="true">
                <UserRound size={18} />
              </span>
              <span className={`lk-header__chevron ${menuOpen ? "lk-header__chevron_open" : ""}`} aria-hidden="true">
                <ChevronDown size={18} />
              </span>
            </button>

            {menuOpen && (
              <div className="lk-header__menu" role="menu">
                <button type="button" className="lk-header__menu-item" role="menuitem" onClick={() => navigate("/lk/settings")}>
                  Настройки аккаунта
                </button>
                <button
                  type="button"
                  className="lk-header__menu-item"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setSupportOpen(false);
                    setPersonalizationOpen(true);
                    setLanguageOpen(false);
                  }}
                >
                  Персонализация
                </button>

                <button
                  type="button"
                  className="lk-header__menu-item lk-header__menu-item_muted"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setPersonalizationOpen(false);
                    setLanguageOpen(false);
                    logout();
                  }}
                >
                  Выйти
                </button>
                <div className="lk-header__menu-divider" role="separator" />
                <button
                  type="button"
                  className="lk-header__menu-item lk-header__menu-item_muted"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  Добавить аккаунт
                </button>
              </div>
            )}
            </div>
            </div>
          </div>
        </div>
      </header>

      <LKPageScrollbar scrollerRef={lkRootRef} theme={lkTheme} />

      {personalizationOpen && (
        <div
          className="lk-personalization-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Персонализация"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setPersonalizationOpen(false);
              setLanguageOpen(false);
            }
          }}
        >
          <div
            className="lk-personalization-modal"
            ref={personalizationRef}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="lk-personalization-modal__close"
              aria-label="Закрыть"
              onClick={() => {
                setPersonalizationOpen(false);
                setLanguageOpen(false);
              }}
            >
              ×
            </button>

            <div className="lk-personalization" role="group" aria-label="Персонализация">
              <div className="lk-personalization__title">Персонализация</div>

              <div className="lk-personalization__group">
                <div className="lk-personalization__label">Ширина панели</div>
                  <div className="lk-personalization__cards">
                    <button
                      type="button"
                      className={`lk-personalization__card ${
                        panelWidthMode === "fixed" ? "lk-personalization__card_active" : ""
                      }`}
                      onClick={() => setPanelWidthMode("fixed")}
                    >
                      <div className="lk-personalization__card-icon" aria-hidden="true" />
                      <div className="lk-personalization__card-title">Фиксированная</div>
                    </button>
                    <button
                      type="button"
                      className={`lk-personalization__card ${
                        panelWidthMode === "wide" ? "lk-personalization__card_active" : ""
                      }`}
                      onClick={() => setPanelWidthMode("wide")}
                    >
                      <div className="lk-personalization__card-icon" aria-hidden="true" />
                      <div className="lk-personalization__card-title">Широкая</div>
                    </button>
                  </div>
              </div>

              <div className="lk-personalization__group">
                <div className="lk-personalization__label">Цветовая схема</div>
                  <div className="lk-personalization__segments">
                    <button
                      type="button"
                      className={`lk-personalization__segment ${
                        lkTheme === "dark" ? "lk-personalization__segment_active" : ""
                      }`}
                      onClick={() => setLkTheme("dark")}
                    >
                      Тёмная
                    </button>
                    <button
                      type="button"
                      className={`lk-personalization__segment ${
                        lkTheme === "light" ? "lk-personalization__segment_active" : ""
                      }`}
                      onClick={() => setLkTheme("light")}
                    >
                      Светлая
                    </button>
                  </div>
              </div>

              <div className="lk-personalization__group">
                <div className="lk-personalization__label">Язык интерфейса</div>
                <div className="lk-personalization__lang">
                  <button
                    type="button"
                    className="lk-personalization__lang-btn"
                    onClick={() => setLanguageOpen((v) => !v)}
                  >
                      <span className="lk-personalization__lang-value">
                        {lang === "ru" ? "🇷🇺 Русский" : "🇬🇧 English"}
                      </span>
                      <span className="lk-personalization__lang-chevron" aria-hidden="true">
                        <ChevronDown size={16} />
                      </span>
                  </button>
                  {languageOpen && (
                    <div className="lk-personalization__lang-dd" role="menu" aria-label="Выбор языка">
                      <button
                        type="button"
                        className="lk-personalization__lang-item"
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLang("ru");
                          setLanguageOpen(false);
                        }}
                      >
                        🇷🇺 Русский
                      </button>
                      <button
                        type="button"
                        className="lk-personalization__lang-item"
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLang("en");
                          setLanguageOpen(false);
                        }}
                      >
                        🇬🇧 English
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="lk-layout">
        <LkSidebar />
        <div className="LK-content">
          <Routes>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route
              path="settings/personal"
              element={<AccountPersonalDataPage user={user} fetchUser={fetchUser} />}
            />
            <Route path="settings" element={<Settings user={user} fetchUser={fetchUser} />} />
            <Route path="news" element={<NewsPage />} />
            <Route path="bug" element={<BugPage />} />
            <Route path="idea" element={<IdeaPage />} />
            <Route path="partner" element={<Outlet />}>
              <Route index element={<OwnerSitesListPage />} />
              <Route path="new" element={<CreateOwnerProjectPage />} />
              <Route path="project/:projectId" element={<SiteProjectLayout />}>
                <Route index element={<Navigate to="sites" replace relative="path" />} />
                <Route path="overview" element={<ProjectOverviewPage />} />
                <Route path="sites" element={<ProjectOverviewPage />} />
                <Route path="sites/:sitePublicId/members" element={<ProjectMembersPage />} />
                <Route path="sites/:sitePublicId/settings" element={<ProjectSettingsPage />} />
                <Route path="sites/:sitePublicId/dashboard" element={<SiteDashboardPage />} />
                <Route path="sites/:sitePublicId/history" element={<SiteHistoryPage />} />
                <Route path="sites/:sitePublicId/widget" element={<ProjectSiteManagementScreen />} />
                <Route path="sites/:sitePublicId/referral-block" element={<ProjectReferralBlockScreen />} />
                <Route path="sites/:sitePublicId" element={<SiteShellDefaultToDashboard />} />
                <Route path="info" element={<ProjectInfoPage />} />
                <Route path="site" element={<ProjectSiteManagementScreen legacyTabRoute />} />
                <Route path="widget" element={<ProjectWidgetInstallScreen />} />
                <Route path="members" element={<ProjectMembersPage />} />
                <Route path="settings" element={<ProjectSettingsPage />} />
              </Route>
              <Route path=":sitePublicId/*" element={<LegacyOwnerSiteRedirect />} />
            </Route>
            <Route path="referral-program/:sitePublicId" element={<AgentProgramDetailPage />} />
            <Route path="referral-program" element={<PartnerDashboard />} />
            <Route path="widget-install" element={<WidgetInstallScreen />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default LK;
