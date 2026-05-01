import { Routes, Route, Link, useNavigate, Navigate, Outlet, useParams } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  LogOut,
  MessageCircle,
  Palette,
  Search,
  Send,
  Settings as SettingsGearIcon,
  UserPlus,
  UserRound,
} from "lucide-react";
import { LkHeaderBrandMark } from "./LkHeaderBrandMark";
import Dashboard from "./dashboard/dashboard"; // импорт компонента Dashboard
import ProgramsCatalogPage from "./dashboard/ProgramsCatalogPage";
import MyProgramsPage from "./dashboard/MyProgramsPage";
import AgentProgramDetailPage from "./dashboard/AgentProgramDetailPage";
import Settings from "./settings/settings"; // импорт компонента Settings
import AccountPersonalDataPage from "./settings/AccountPersonalDataPage";
import BindAccountPage from "./settings/BindAccountPage";
import AccountAdditionalUsersCreatePage from "./settings/AccountAdditionalUsersCreatePage";
import ChangePasswordPage from "./settings/ChangePasswordPage";
import LkSidebar from "./LkSidebar";
import NewsPage from "./news/news";
import BugPage from "./bug/bug";
import MiniGamePage from "./mini-game/mini-game";
import MiniGameProgressPage from "./mini-game/miniGameProgress";
import MiniGameLeaguesPage from "./mini-game/miniGameLeagues";
import MiniGameRatingPage from "./mini-game/miniGameRating";
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
import SupportHubPage from "./support/SupportHubPage";
import SupportTicketDetailPage from "./support/SupportTicketDetailPage";
import SupportTicketPage from "./support/SupportTicketPage";
import SiteDashboardPage from "./owner-programs/SiteDashboardPage";
import SiteHistoryPage from "./owner-programs/SiteHistoryPage";
import ProjectReferralBlockScreen from "./owner-programs/ProjectReferralBlockScreen";
import useCurrentUser from "../../hooks/useCurrentUser";
import useAuth from "../../hooks/auth";
import {
  accountKeyFromUser,
  applySessionToLocalStorage,
  listSessionsForSwitcher,
  persistCurrentSessionFromLs,
} from "../../utils/lkMultiAccounts";
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
  const { user, setUser, fetchUser } = useCurrentUser();
  const { logout, refreshAccessToken, setUser: setAuthUser } = useAuth();
  const [ideaNavBadgeCount, setIdeaNavBadgeCount] = useState(0);

  const accountId = formatAccountId(user);
  const accountSwitcherSessions = listSessionsForSwitcher(user);
  const currentAccountKey = accountKeyFromUser(user);

  const handleSwitchAccount = useCallback(
    async (session) => {
      if (!session?.key || currentAccountKey === session.key) return;
      persistCurrentSessionFromLs();
      applySessionToLocalStorage(session);
      if (session.user) {
        setUser(session.user);
        setAuthUser(session.user);
      }
      /* Сохранённый access из момента привязки почти всегда истёк — обновляем по refresh до fetchUser и навигации. */
      const newAccess = await refreshAccessToken();
      if (!newAccess) return;
      persistCurrentSessionFromLs();
      setMenuOpen(false);
      setSupportOpen(false);
      setPersonalizationOpen(false);
      setLanguageOpen(false);
      const fresh = await fetchUser();
      if (fresh) {
        try {
          localStorage.setItem("user", JSON.stringify(fresh));
          persistCurrentSessionFromLs();
        } catch {
          /* ignore */
        }
        setAuthUser(fresh);
      }
      navigate("/lk/partner");
    },
    [currentAccountKey, fetchUser, navigate, refreshAccessToken, setAuthUser, setUser],
  );

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
      className="LK"
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
                  <span className="lk-header__search-icon" aria-hidden="true">
                    <Search size={16} strokeWidth={2} />
                  </span>
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
                <div className="lk-header__menu" role="menu" data-test-id="support-dropdown-menu">
                  <button
                    type="button"
                    className="lk-header__menu-item"
                    role="menuitem"
                    onClick={() => {
                      setSupportOpen(false);
                      navigate("/lk/support");
                    }}
                  >
                    <span className="lk-header__menu-item-icon" aria-hidden="true">
                      <MessageCircle size={20} strokeWidth={1.75} />
                    </span>
                    <span className="lk-header__menu-item-text">Центр поддержки</span>
                  </button>
                  <button
                    type="button"
                    className="lk-header__menu-item"
                    role="menuitem"
                    onClick={() => {
                      setSupportOpen(false);
                      navigate("/lk/support/help-question");
                    }}
                  >
                    <span className="lk-header__menu-item-icon" aria-hidden="true">
                      <Send size={20} strokeWidth={1.75} />
                    </span>
                    <span className="lk-header__menu-item-text">Написать в поддержку</span>
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
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2Zm0 5c1.7 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.3-3 3-3Zm0 13c-2.2 0-4.3-.9-5.8-2.5a6.94 6.94 0 0 1 11.5 0A7.56 7.56 0 0 1 12 20Z"
                  />
                </svg>
              </span>
              <span className={`lk-header__chevron ${menuOpen ? "lk-header__chevron_open" : ""}`} aria-hidden="true">
                <ChevronDown size={18} />
              </span>
            </button>

            {menuOpen && (
              <div className="lk-header__menu" role="menu" data-test-id="account-dropdown-menu">
                <button type="button" className="lk-header__menu-item" role="menuitem" onClick={() => navigate("/lk/settings")}>
                  <span className="lk-header__menu-item-icon" aria-hidden="true">
                    <SettingsGearIcon size={20} strokeWidth={1.75} />
                  </span>
                  <span className="lk-header__menu-item-text">Настройки аккаунта</span>
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
                  <span className="lk-header__menu-item-icon" aria-hidden="true">
                    <Palette size={20} strokeWidth={1.75} />
                  </span>
                  <span className="lk-header__menu-item-text">Персонализация</span>
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
                  <span className="lk-header__menu-item-icon" aria-hidden="true">
                    <LogOut size={20} strokeWidth={1.75} />
                  </span>
                  <span className="lk-header__menu-item-text">Выйти</span>
                </button>
                <div className="lk-header__menu-divider" role="separator" />
                <button
                  type="button"
                  className="lk-header__menu-item lk-header__menu-item_muted"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setSupportOpen(false);
                    setPersonalizationOpen(false);
                    setLanguageOpen(false);
                    navigate("/lk/settings/bind-account");
                  }}
                >
                  <span className="lk-header__menu-item-icon" aria-hidden="true">
                    <UserPlus size={20} strokeWidth={1.75} />
                  </span>
                  <span className="lk-header__menu-item-text">Добавить аккаунт</span>
                </button>
                {accountSwitcherSessions.length > 0
                  ? accountSwitcherSessions.map((session) => {
                      const isCurrent = session.key === currentAccountKey;
                      const emailLabel = String(session.user?.email || session.key || "").trim() || session.key;
                      const sid = formatAccountId(session.user);
                      return (
                        <button
                          key={session.key}
                          type="button"
                          className={`lk-header__menu-item lk-header__menu-item_account-switch${
                            isCurrent ? " lk-header__menu-item_account-switch_current" : ""
                          }`}
                          role="menuitem"
                          disabled={isCurrent}
                          onClick={() => handleSwitchAccount(session)}
                        >
                          <span className="lk-header__menu-item-icon" aria-hidden="true">
                            <UserRound size={20} strokeWidth={1.75} />
                          </span>
                          <span className="lk-header__menu-item-text lk-header__menu-item-text_stack">
                            <span className="lk-header__menu-item-text-primary">{emailLabel}</span>
                            <span className="lk-header__menu-item-text-meta">
                              {sid}
                              {isCurrent ? " · текущий" : ""}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  : null}
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
        <LkSidebar
          ownerSessionKey={currentAccountKey}
          ideaNavBadgeCount={ideaNavBadgeCount}
          onHeaderNavNavigate={() => {
            setMenuOpen(false);
            setSupportOpen(false);
            setPersonalizationOpen(false);
            setLanguageOpen(false);
          }}
        />
        <div className="LK-content">
          <Routes>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="programs" element={<ProgramsCatalogPage />} />
            <Route path="my-programs" element={<MyProgramsPage />} />
            <Route path="mini-game/rating" element={<MiniGameRatingPage />} />
            <Route path="mini-game/leagues" element={<MiniGameLeaguesPage />} />
            <Route path="mini-game/progress" element={<MiniGameProgressPage />} />
            <Route path="mini-game" element={<MiniGamePage />} />
            <Route path="settings/users/create" element={<AccountAdditionalUsersCreatePage />} />
            <Route
              path="settings/personal"
              element={<AccountPersonalDataPage user={user} fetchUser={fetchUser} setUser={setUser} />}
            />
            <Route
              path="settings/bind-account"
              element={<BindAccountPage fetchUser={fetchUser} setUser={setUser} setAuthUser={setAuthUser} />}
            />
            <Route path="settings/change-password" element={<ChangePasswordPage user={user} />} />
            <Route path="settings" element={<Settings user={user} fetchUser={fetchUser} setUser={setUser} />} />
            <Route path="news" element={<NewsPage />} />
            <Route path="bug" element={<BugPage />} />
            <Route path="idea" element={<IdeaPage />} />
            <Route path="support" element={<SupportHubPage />}>
              <Route path="tickets/:ticketId" element={<SupportTicketDetailPage />} />
            </Route>
            <Route path="support/:ticketSlug" element={<SupportTicketPage />} />
            <Route path="partner" element={<Outlet key={currentAccountKey || "lk-partner-boot"} />}>
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
