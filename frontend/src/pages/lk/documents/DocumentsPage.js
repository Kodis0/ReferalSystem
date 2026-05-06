import "../dashboard/dashboard.css";
import "./documents.css";

const LEGAL_DOC_BASE = `${process.env.PUBLIC_URL || ""}/legal`;

const PLATFORM_DOCUMENTS = [
  {
    title: "Политика обработки персональных данных",
    description: "Как LUMO обрабатывает и защищает персональные данные пользователей платформы.",
    href: `${LEGAL_DOC_BASE}/01-politika-obrabotki-personalnyh-dannyh-lumo.pdf`,
  },
  {
    title: "Согласие на обработку персональных данных",
    description: "Документ согласия пользователя на обработку персональных данных в сервисе.",
    href: `${LEGAL_DOC_BASE}/02-soglasie-na-obrabotku-personalnyh-dannyh-lumo.pdf`,
  },
  {
    title: "Публичная оферта",
    description: "Правила и условия использования платформы LUMO.",
    href: `${LEGAL_DOC_BASE}/03-publichnaya-oferta-lumo.pdf`,
  },
  {
    title: "Согласие на рассылки",
    description: "Условия получения информационных и маркетинговых сообщений от платформы.",
    href: `${LEGAL_DOC_BASE}/04-soglasie-na-rassylki-vsemi-vidami-lumo.pdf`,
  },
];

export default function DocumentsPage() {
  return (
    <div className="lk-dashboard lk-documents-page">
      <h1 className="lk-dashboard__title">Документы</h1>
      <p className="lk-dashboard__subtitle">Все юридические документы платформы собраны в одном разделе.</p>

      <section className="lk-documents__grid" aria-label="Документы платформы">
        {PLATFORM_DOCUMENTS.map((document) => (
          <article key={document.href} className="lk-documents__card">
            <div className="lk-documents__card-head">
              <div className="lk-documents__card-icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M7 3H14.5L19 7.5V21H7C5.89543 21 5 20.1046 5 19V5C5 3.89543 5.89543 3 7 3Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M14 3V8H19"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M9 13H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M9 17H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="lk-documents__card-title">{document.title}</h2>
            </div>
            <div className="lk-documents__card-copy">
              <p className="lk-documents__card-description">{document.description}</p>
            </div>
            <a
              className="lk-documents__card-link"
              href={document.href}
            >
              Открыть PDF
            </a>
          </article>
        ))}
      </section>
    </div>
  );
}
