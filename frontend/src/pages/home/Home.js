import { useState, useEffect } from "react";
import "./Home.css";
import Header from "./sections/Header";
import HeroDotsBackground from "../../components/HeroDotsBackground/HeroDotsBackground";
import ChevronMorphLiquid from "../../components/ChevronMorphLiquid/ChevronMorphLiquid";
import PeopleIcon from "../../static/images/People.svg";
import PeoplesIcon from "../../static/images/Peoples.svg";
import ResultIcon from "../../static/images/Result.svg";
import PayIcon from "../../static/images/Pay.svg";

const THEME_KEY = "lumo-theme";
const HOW_IT_WORKS_CARDS = [
  {
    title: "Партнер",
    text: "Партнёр получает ссылку\nИ отправляет её своим клиентам.",
    icon: PeopleIcon,
    key: "people",
  },
  {
    title: "Клиенты",
    text: "Клиенты переходят по ней\nСистема показывает, сколько человек пришло.",
    icon: PeoplesIcon,
    key: "peoples",
  },
  {
    title: "Результат",
    text: "Вы видите кто зарегистрировался, кто оставил заявку и какой партнёр привёл клиента.",
    icon: ResultIcon,
    key: "result",
  },
  {
    title: "Оплата",
    text: "Вы сразу видите, кто оплатил, какая сумма пришла и от какого партнёра был клиент.",
    icon: PayIcon,
    key: "pay",
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
          <HeroDotsBackground className="main-page__hero-dots" theme={theme} />
          <div className="main-page__hero-text-wrap">
            <h1 className="main-page__hero-title">
              Прозрачный партнёрский рост
              <ChevronMorphLiquid className="main-page__hero-title-caret" />
            </h1>
            <p className="main-page__hero-subtitle">
              Запускайте партнёрские программы, отслеживайте переходы, считайте регистрации и контролируйте конверсии в одной системе.
            </p>
            <a href="#about" className="main-page__hero-btn">
              Узнать подробнее
            </a>
          </div>
        </div>
      </main>
      <section id="about" className="main-page__block-2" aria-label="Как это работает">
        <div className="main-page__block-2-inner">
          <h2 className="main-page__section-title">Как это работает</h2>
          <div className="main-page__how-grid" role="list" aria-label="Как это работает — шаги">
            {HOW_IT_WORKS_CARDS.map((card) => (
              <div key={card.title} className={`main-page__how-card main-page__how-card--${card.key}`} role="listitem">
                <div className="main-page__how-card-title">{card.title}</div>
                <div className="main-page__how-card-text">{card.text}</div>
                <img
                  className={`main-page__how-card-icon main-page__how-card-icon--${card.key}`}
                  src={card.icon}
                  alt=""
                  aria-hidden="true"
                />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default Home;
