import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LkHeaderBrandMark } from "../../lk/LkHeaderBrandMark";
import ContactsIcon from "../../../static/images/contacts.svg";
import MoonIcon from "../../../static/images/Moon.svg";
import SunIcon from "../../../static/images/Sun.svg";
import "./Header.css";

const SECTIONS = [
  { label: "О сервисе", href: "#about" },
  { label: "Тарифы", href: "#pricing" },
  { label: "Помощь", href: "#help" },
];

function readStoredHeaderUser() {
  try {
    const token = localStorage.getItem("access_token");
    const raw = localStorage.getItem("user");
    if (!token || !raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function formatHeaderAccountId(user) {
  const publicId = typeof user?.public_id === "string" ? user.public_id.trim().toLowerCase() : "";
  if (/^[a-z0-9]{7}$/.test(publicId)) return publicId;

  const source = String(user?.id ?? user?.email ?? user?.username ?? "").trim();
  if (!source) return "e000000";

  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return `e${hash.toString(16).padStart(6, "0").slice(-6)}`;
}

function Header({ theme = "dark", setTheme, showSections = true }) {
  const [storedUser, setStoredUser] = useState(readStoredHeaderUser);

  useEffect(() => {
    function syncStoredUser() {
      setStoredUser(readStoredHeaderUser());
    }

    window.addEventListener("storage", syncStoredUser);
    window.addEventListener("focus", syncStoredUser);
    return () => {
      window.removeEventListener("storage", syncStoredUser);
      window.removeEventListener("focus", syncStoredUser);
    };
  }, []);

  const accountEmail = typeof storedUser?.email === "string" ? storedUser.email : "";
  const hasStoredAccount = Boolean(storedUser && accountEmail);

  return (
    <header className="main-header">
      <div className="main-header__left">
        <Link to="/" className="main-header__logo" aria-label="LUMO">
          <LkHeaderBrandMark className="main-header__brand-logo" />
        </Link>
        {showSections && (
          <nav className="main-header__nav" aria-label="Разделы">
            {SECTIONS.map((item) => (
              <a key={item.href} href={item.href} className="main-header__nav-link">
                {item.label}
              </a>
            ))}
          </nav>
        )}
      </div>
      <div className="main-header__right">
        <div className="main-header__top-row">
          <a href="#contacts" className="main-header__link">
            <img src={ContactsIcon} alt="" className="main-header__link-icon" aria-hidden />
            Контакты
          </a>
        </div>
        <div className="main-header__actions">
          {hasStoredAccount ? (
            <Link to="/lk/partner" className="main-header__account">
              <span className="main-header__account-avatar" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M12 12C14.2091 12 16 10.2091 16 8C16 5.79086 14.2091 4 12 4C9.79086 4 8 5.79086 8 8C8 10.2091 9.79086 12 12 12Z"
                    fill="currentColor"
                  />
                  <path
                    d="M4.5 20C5.376 16.613 8.455 14.5 12 14.5C15.545 14.5 18.624 16.613 19.5 20H4.5Z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <span className="main-header__account-text">
                <span className="main-header__account-name">Аккаунт {formatHeaderAccountId(storedUser)}</span>
                <span className="main-header__account-email">{accountEmail}</span>
              </span>
              <span className="main-header__account-chevron" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </Link>
          ) : (
            <>
              <Link to="/login" className="main-header__btn main-header__btn_text">
                Войти
              </Link>
              <Link to="/registration" className="main-header__btn main-header__btn_primary">
                Создать аккаунт
              </Link>
            </>
          )}
        </div>
        <div className="main-header__icons">
          <button
            type="button"
            onClick={() => setTheme("dark")}
            className={`main-header__icon-btn ${theme === "dark" ? "main-header__icon-btn_active" : ""}`}
            aria-label="Тёмная тема"
            aria-pressed={theme === "dark"}
          >
            <img src={MoonIcon} alt="" className="main-header__icon" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setTheme("light")}
            className={`main-header__icon-btn ${theme === "light" ? "main-header__icon-btn_active" : ""}`}
            aria-label="Светлая тема"
            aria-pressed={theme === "light"}
          >
            <img src={SunIcon} alt="" className="main-header__icon" aria-hidden />
          </button>
        </div>
      </div>
    </header>
  );
}

export default Header;
