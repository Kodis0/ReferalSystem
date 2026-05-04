import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import "./Home.css";
import Header from "./sections/Header";
import { LkHeaderBrandMark } from "../lk/LkHeaderBrandMark";

const THEME_KEY = "lumo-theme";
const LEGAL_DOC_BASE = `${process.env.PUBLIC_URL || ""}/legal`;
const LEGAL_LINKS = [
  { label: "Оферта", href: `${LEGAL_DOC_BASE}/03-publichnaya-oferta-lumo.pdf` },
  { label: "Политика конфиденциальности", href: `${LEGAL_DOC_BASE}/01-politika-obrabotki-personalnyh-dannyh-lumo.pdf` },
  { label: "Согласие на обработку персональных данных", href: `${LEGAL_DOC_BASE}/02-soglasie-na-obrabotku-personalnyh-dannyh-lumo.pdf` },
  { label: "Согласие на рассылки", href: `${LEGAL_DOC_BASE}/04-soglasie-na-rassylki-vsemi-vidami-lumo.pdf` },
];
const FOOTER_COLUMNS = [
  {
    title: "Сервис",
    links: [
      { label: "О сервисе", to: "/" },
      { label: "Создать аккаунт", to: "/registration" },
      { label: "Войти", to: "/login" },
    ],
  },
  {
    title: "Партнёрам",
    links: [
      { label: "Кабинет партнёра", to: "/lk" },
      { label: "Бюджет программы", to: "/lk/balance" },
      { label: "Поддержка", to: "/lk/support" },
    ],
  },
  {
    title: "Документы",
    links: LEGAL_LINKS,
  },
];

function Home() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === "light" ? "light" : "dark";
    }
    return "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return (
    <div className="main-page">
      <Header theme={theme} setTheme={setTheme} />
      <main className="main-page__content">
        <div className="main-page__hero">
          <div className="main-page__hero-text-wrap">
            <h1 className="main-page__hero-title">
              Прозрачный партнёрский рост
            </h1>
            <p className="main-page__hero-subtitle">
              Запускайте партнёрские программы, отслеживайте переходы, считайте регистрации и контролируйте конверсии в одной системе.
            </p>
          </div>
        </div>
      </main>
      <footer id="contacts" className="main-page__footer">
        <div className="main-page__footer-inner">
          <div className="main-page__footer-side">
            <Link to="/" className="main-page__footer-logo" aria-label="LUMO">
              <LkHeaderBrandMark className="main-page__footer-brand-logo" />
            </Link>
            <p className="main-page__footer-text">Сервис для запуска и управления реферальными программами.</p>
            <div className="main-page__footer-contacts" aria-label="Контакты">
              <Link to="/legal/contacts" className="main-page__footer-contact-link">
                Контакты и реквизиты
              </Link>
              <Link to="/lk/support" className="main-page__footer-contact-link">
                Центр поддержки
              </Link>
            </div>
          </div>
          <nav className="main-page__footer-nav" aria-label="Разделы футера">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title} className="main-page__footer-column">
                <h2 className="main-page__footer-title">{column.title}</h2>
                <div className="main-page__footer-links">
                  {column.links.map((link) =>
                    link.href ? (
                      <a key={link.href} href={link.href} className="main-page__footer-link">
                        {link.label}
                      </a>
                    ) : (
                      <Link key={link.to} to={link.to} className="main-page__footer-link">
                        {link.label}
                      </Link>
                    ),
                  )}
                </div>
              </div>
            ))}
          </nav>
        </div>
        <div className="main-page__footer-bottom">
          <span>© 2026 LUMO. Все права защищены.</span>
          <span>Юридические документы доступны в разделе «Документы».</span>
        </div>
      </footer>
    </div>
  );
}

export default Home;
