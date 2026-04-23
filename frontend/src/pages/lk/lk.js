import { Routes, Route, Link, useNavigate, Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, UserRound } from "lucide-react";
import LumoLogo from "../../static/images/LUMO2.svg";
import LumoLogoBlack from "../../static/images/LUMOBlack.svg";
import NewsIcon from "../../static/images/News.svg";
import BugIcon from "../../static/images/Bug.svg";
import LampIcon from "../../static/images/Lamp.svg";
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
      fill="none"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M12 2C10.6868 2 9.38642 2.25866 8.17317 2.7612C6.95991 3.26375 5.85752 4.00035 4.92893 4.92893C3.05357 6.8043 2 9.34784 2 12V19C2 19.2652 2.10536 19.5196 2.29289 19.7071C2.48043 19.8946 2.73478 20 3 20H6C6.79565 20 7.55871 19.6839 8.12132 19.1213C8.68393 18.5587 9 17.7956 9 17V15C9 14.2044 8.68393 13.4413 8.12132 12.8787C7.55871 12.3161 6.79565 12 6 12H4C4 9.87827 4.84285 7.84344 6.34315 6.34315C7.84344 4.84285 9.87827 4 12 4C14.1217 4 16.1566 4.84285 17.6569 6.34315C19.1571 7.84344 20 9.87827 20 12H18C17.2044 12 16.4413 12.3161 15.8787 12.8787C15.3161 13.4413 15 14.2044 15 15V17C15 17.7956 15.3161 18.5587 15.8787 19.1213C16.4413 19.6839 17.2044 20 18 20H21C21.2652 20 21.5196 19.8946 21.7071 19.7071C21.8946 19.5196 22 19.2652 22 19V12C22 10.6868 21.7413 9.38642 21.2388 8.17317C20.7362 6.95991 19.9997 5.85752 19.0711 4.92893C18.1425 4.00035 17.0401 3.26375 15.8268 2.7612C14.6136 2.25866 13.3132 2 12 2ZM6 14C6.26522 14 6.51957 14.1054 6.70711 14.2929C6.89464 14.4804 7 14.7348 7 15V17C7 17.2652 6.89464 17.5196 6.70711 17.7071C6.51957 17.8946 6.26522 18 6 18H4V14H6ZM20 18H18C17.7348 18 17.4804 17.8946 17.2929 17.7071C17.1054 17.5196 17 17.2652 17 17V15C17 14.7348 17.1054 14.4804 17.2929 14.2929C17.4804 14.1054 17.7348 14 18 14H20V18Z"
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

function LK() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [personalizationOpen, setPersonalizationOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const searchInputRef = useRef(null);
  const menuRef = useRef(null);
  const supportRef = useRef(null);
  const personalizationRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, fetchUser } = useCurrentUser();
  const { logout } = useAuth();

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
    <div className="LK" style={{ minHeight: "100vh", backgroundColor: lkTheme === "light" ? "#ffffff" : "#17212B" }}>
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
            <Link to="/" aria-label="LUMO" className="lk-header__logo-link">
              <img
                src={lkTheme === "light" ? LumoLogoBlack : LumoLogo}
                alt="LUMO"
                className="lk-header__logo"
              />
            </Link>
          </div>

          <div className="lk-header__center">
            <label className="lk-header__search" aria-label="Поиск">
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="lk-header__search-button"
                onMouseDown={(event) => event.preventDefault()}
              >
                <Search size={16} className="lk-header__search-icon" />
              </button>
              <input
                ref={searchInputRef}
                className="lk-header__search-input"
                type="text"
                placeholder="Поиск"
                aria-keyshortcuts="Control+K Meta+K"
              />
              <span className="lk-header__search-shortcut">Ctrl K</span>
            </label>

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
                <img src={NewsIcon} alt="" aria-hidden="true" className="lk-header__nav-icon" />
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
                <img src={BugIcon} alt="" aria-hidden="true" className="lk-header__nav-icon" />
                <span className="lk-header__tooltip" role="tooltip">
                  Сообщить о баге
                </span>
              </button>

              <button
                type="button"
                className={`lk-header__nav-btn ${currentPath === "/lk/idea" ? "lk-header__nav-btn_active" : ""}`}
                aria-label="Предложить идею"
                onClick={() => {
                  setMenuOpen(false);
                  setSupportOpen(false);
                  setPersonalizationOpen(false);
                  setLanguageOpen(false);
                  navigate("/LK/idea");
                }}
              >
                <img src={LampIcon} alt="" aria-hidden="true" className="lk-header__nav-icon" />
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
      </header>

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
                <Route path="sites/:sitePublicId/widget" element={<ProjectSiteManagementScreen />} />
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
