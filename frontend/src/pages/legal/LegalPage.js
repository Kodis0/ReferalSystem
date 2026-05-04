import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import Header from "../home/sections/Header";
import "./LegalPage.css";

const THEME_KEY = "lumo-theme";

const LEGAL_PAGES = {
  offer: {
    title: "Оферта",
    description: "Документ будет опубликован перед подключением платежей.",
  },
  privacy: {
    title: "Политика конфиденциальности",
    description: "Здесь будет размещена политика обработки и защиты персональных данных.",
  },
  "payment-and-refund": {
    title: "Оплата и возврат",
    description: "Здесь появятся условия оплаты, возвратов и отмены платежей.",
  },
  contacts: {
    title: "Контакты и реквизиты",
    description: "Контактная информация и реквизиты будут добавлены после утверждения данных.",
  },
};

function LegalPage() {
  const { legalSlug } = useParams();
  const page = LEGAL_PAGES[legalSlug];
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

  const documentLinks = useMemo(
    () =>
      Object.entries(LEGAL_PAGES).map(([slug, item]) => ({
        slug,
        title: item.title,
      })),
    [],
  );

  if (!page) {
    return <Navigate to="/legal/offer" replace />;
  }

  return (
    <div className="legal-page">
      <Header theme={theme} setTheme={setTheme} showSections={false} />
      <main className="legal-page__content">
        <Link to="/" className="legal-page__back">
          На главную
        </Link>
        <section className="legal-page__card">
          <p className="legal-page__eyebrow">Юридические документы</p>
          <h1 className="legal-page__title">{page.title}</h1>
          <p className="legal-page__description">{page.description}</p>
          <p className="legal-page__placeholder">
            Это временная публичная страница. Полный текст документа будет добавлен отдельно.
          </p>
        </section>
        <nav className="legal-page__docs" aria-label="Документы">
          {documentLinks.map((link) => (
            <Link
              key={link.slug}
              to={`/legal/${link.slug}`}
              className={`legal-page__doc-link ${link.slug === legalSlug ? "legal-page__doc-link_active" : ""}`}
            >
              {link.title}
            </Link>
          ))}
        </nav>
      </main>
    </div>
  );
}

export default LegalPage;
