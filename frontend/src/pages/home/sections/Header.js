import { Link } from "react-router-dom";
import LumoLogo from "../../../static/images/LUMO2.svg";
import LumoLogoBlack from "../../../static/images/LUMOBlack.svg";
import ContactsIcon from "../../../static/images/contacts.svg";
import MoonIcon from "../../../static/images/Moon.svg";
import SunIcon from "../../../static/images/Sun.svg";
import "./Header.css";

const SECTIONS = [
  { label: "О сервисе", href: "#about" },
  { label: "Тарифы", href: "#pricing" },
  { label: "Помощь", href: "#help" },
];

function Header({ theme = "dark", setTheme, showSections = true }) {
  return (
    <header className="main-header">
      <div className="main-header__left">
        <Link to="/" className="main-header__logo" aria-label="LUMO">
          <img src={theme === "light" ? LumoLogoBlack : LumoLogo} alt="LUMO" className="main-header__logo-img" />
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
        <div className="main-header__actions">
          <Link to="/login" className="main-header__btn main-header__btn_text">
            Войти
          </Link>
          <Link to="/registration" className="main-header__btn main-header__btn_primary">
            Создать аккаунт
          </Link>
        </div>
      </div>
    </header>
  );
}

export default Header;
