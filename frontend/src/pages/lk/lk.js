import { Routes, Route, Link, useNavigate, Navigate, Outlet } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, UserRound } from "lucide-react";
import LumoLogo from "../../static/images/LUMO2.svg";
import LumoLogoBlack from "../../static/images/LUMOBlack.svg";
import NewsIcon from "../../static/images/News.svg";
import BugIcon from "../../static/images/Bug.svg";
import LampIcon from "../../static/images/Lamp.svg";
import SupportIcon from "../../static/images/Support.svg";
import Dashboard from "./dashboard/dashboard"; // импорт компонента Dashboard
import Settings from "./settings/settings"; // импорт компонента Settings
import LkSidebar from "./LkSidebar";
import NewsPage from "./news/news";
import BugPage from "./bug/bug";
import IdeaPage from "./idea/idea";
import PartnerDashboard from "./partner/partner";
import WidgetInstallScreen from "./widget-install/widget-install";
import ProjectWidgetInstallScreen from "./widget-install/ProjectWidgetInstallScreen";
import OwnerSitesListPage from "./owner-programs/OwnerSitesListPage";
import CreateOwnerProjectPage from "./owner-programs/CreateOwnerProjectPage";
import SiteProjectLayout from "./owner-programs/SiteProjectLayout";
import ProjectOverviewPage from "./owner-programs/ProjectOverviewPage";
import ProjectMembersPage from "./owner-programs/ProjectMembersPage";
import ProjectSettingsPage from "./owner-programs/ProjectSettingsPage";
import useCurrentUser from "../../hooks/useCurrentUser";
import useAuth from "../../hooks/auth";
import "./lk.css";

function LK() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [personalizationOpen, setPersonalizationOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const menuRef = useRef(null);
  const supportRef = useRef(null);
  const personalizationRef = useRef(null);
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { logout } = useAuth();

  const accountId = user?.id ?? user?.username ?? user?.email ?? "—";

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

  const horizontalPadding = panelWidthMode === "fixed" ? 240 : 120;
  const lkHeaderBg = lkTheme === "light" ? "rgba(255, 255, 255, 0.95)" : "#242F3D";

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (supportRef.current && !supportRef.current.contains(e.target)) setSupportOpen(false);
      if (personalizationRef.current && !personalizationRef.current.contains(e.target)) {
        setPersonalizationOpen(false);
        setLanguageOpen(false);
      }
    }
    function onKeyDown(e) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setSupportOpen(false);
        setPersonalizationOpen(false);
        setLanguageOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
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
    <div className="LK" style={{ minHeight: "100vh", background: lkTheme === "light" ? "#ffffff" : "#17212B" }}>
      <header
        className="LK-header"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          padding: `24px ${horizontalPadding}px`,
          background: lkHeaderBg,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: "0 0 14px 14px",
        }}
      >
        <div className="lk-header__inner">
            <div className="lk-header__left">
            <Link to="/" aria-label="LUMO" style={{ display: "inline-block", lineHeight: 0 }}>
              <img
                src={lkTheme === "light" ? LumoLogoBlack : LumoLogo}
                alt="LUMO"
                style={{ display: "block", height: 32, width: "auto" }}
              />
            </Link>
            <div className="lk-header__left-icons">
                <button
                  type="button"
                  className="lk-header__news-btn"
                  aria-label="Новости и обновления"
                  onClick={() => {
                    setMenuOpen(false);
                    setSupportOpen(false);
                    setPersonalizationOpen(false);
                    setLanguageOpen(false);
                    navigate("/LK/news");
                  }}
                >
                <img src={NewsIcon} alt="" aria-hidden="true" className="lk-header__news-img" />
                <span className="lk-header__tooltip" role="tooltip">
                  Новости и обновления
                </span>
              </button>
                <button
                  type="button"
                  className="lk-header__news-btn"
                  aria-label="Сообщить о баге"
                  onClick={() => {
                    setMenuOpen(false);
                    setSupportOpen(false);
                    setPersonalizationOpen(false);
                    setLanguageOpen(false);
                    navigate("/LK/bug");
                  }}
                >
                <img src={BugIcon} alt="" aria-hidden="true" className="lk-header__news-img" />
                <span className="lk-header__tooltip" role="tooltip">
                  Сообщить о баге
                </span>
              </button>
                <button
                  type="button"
                  className="lk-header__news-btn"
                  aria-label="Предложить идею"
                  onClick={() => {
                    setMenuOpen(false);
                    setSupportOpen(false);
                    setPersonalizationOpen(false);
                    setLanguageOpen(false);
                    navigate("/LK/idea");
                  }}
                >
                <img src={LampIcon} alt="" aria-hidden="true" className="lk-header__news-img" />
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
              >
                <span className="lk-header__support-icon" aria-hidden="true">
                  <img src={SupportIcon} alt="" aria-hidden="true" className="lk-header__support-img" />
                </span>
                <span className={`lk-header__chevron ${supportOpen ? "lk-header__chevron_open" : ""}`} aria-hidden="true">
                  <ChevronDown size={18} />
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
                <button type="button" className="lk-header__menu-item" role="menuitem" onClick={() => navigate("/LK/settings")}>
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

      <div style={{ display: "flex", alignItems: "stretch", padding: `20px ${horizontalPadding}px 0`, boxSizing: "border-box" }}>
        <LkSidebar />
        <div className="LK-content" style={{ flex: 1, padding: "22px 24px 24px 24px" }}>
          <Routes>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="settings" element={<Settings />} />
            <Route path="news" element={<NewsPage />} />
            <Route path="bug" element={<BugPage />} />
            <Route path="idea" element={<IdeaPage />} />
            <Route path="partner" element={<Outlet />}>
              <Route index element={<OwnerSitesListPage />} />
              <Route path="new" element={<CreateOwnerProjectPage />} />
              <Route path=":sitePublicId" element={<SiteProjectLayout />}>
                <Route index element={<Navigate to="overview" replace relative="path" />} />
                <Route path="overview" element={<ProjectOverviewPage />} />
                <Route path="widget" element={<ProjectWidgetInstallScreen />} />
                <Route path="members" element={<ProjectMembersPage />} />
                <Route path="settings" element={<ProjectSettingsPage />} />
              </Route>
            </Route>
            <Route path="referral-program" element={<PartnerDashboard />} />
            <Route path="widget-install" element={<WidgetInstallScreen />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default LK;
