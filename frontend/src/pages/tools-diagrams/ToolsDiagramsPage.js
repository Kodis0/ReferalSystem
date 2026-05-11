import "./ToolsDiagramsPage.css";

const diagramGroups = [
  {
    title: "Весь инструментарий системы",
    items: [
      { label: "React, Create React App, React Router", value: 18, color: "#7c3aed" },
      { label: "Node.js, npm, frontend-сборка", value: 8, color: "#059669" },
      { label: "Python, Django, Django REST Framework", value: 22, color: "#2563eb" },
      { label: "JWT, CORS, WebAuthn / Passkeys", value: 9, color: "#db2777" },
      { label: "SQLite локально, PostgreSQL production", value: 13, color: "#10b981" },
      { label: "nginx, Gunicorn, systemd, Linux / VPS", value: 12, color: "#f97316" },
      { label: "Git, GitHub, GitHub Actions, SSH deploy", value: 8, color: "#0891b2" },
      { label: "Tilda, Public Widget, webhook заказов", value: 6, color: "#eab308" },
      { label: "Google, VK, Telegram OAuth", value: 3, color: "#0ea5e9" },
      { label: "SMTP, Brevo, RuSender", value: 1, color: "#64748b" },
    ],
  },
];

const architectureNodes = [
  { id: "user", label: "Пользователь", x: 130, y: 34, w: 144 },
  { id: "react", label: "React Frontend", x: 130, y: 116, w: 144 },
  { id: "usersApi", label: "/users/ API", x: 54, y: 226, w: 132 },
  { id: "refApi", label: "/referrals/ API", x: 220, y: 226, w: 146 },

  { id: "tilda", label: "Tilda / внешний сайт", x: 780, y: 34, w: 172 },
  { id: "widget", label: "Виджет / скрипт", x: 652, y: 116, w: 150 },
  { id: "form", label: "Форма / заявка", x: 880, y: 116, w: 154 },
  { id: "publicApi", label: "/public/v1/ API", x: 652, y: 226, w: 150 },
  { id: "capture", label: "/referrals/capture/", x: 880, y: 226, w: 170 },
  { id: "webhook", label: "Webhook заказа", x: 900, y: 334, w: 154 },
  { id: "orderApi", label: "/users/api/orders/", x: 900, y: 416, w: 168 },

  { id: "nginx", label: "nginx", x: 514, y: 204, w: 92 },
  { id: "reactBuild", label: "React build", x: 438, y: 306, w: 126 },
  { id: "gunicorn", label: "Gunicorn", x: 594, y: 306, w: 120 },
  { id: "django", label: "Django Backend", x: 490, y: 432, w: 176 },

  { id: "usersApp", label: "users app", x: 248, y: 508, w: 126 },
  { id: "referralsApp", label: "referrals app", x: 732, y: 508, w: 140 },
  { id: "google", label: "Google / VK / Telegram", x: 40, y: 580, w: 182 },
  { id: "passkeys", label: "WebAuthn / Passkeys", x: 242, y: 580, w: 170 },
  { id: "email", label: "Email: SMTP / Brevo / RuSender", x: 432, y: 580, w: 228 },
  { id: "db", label: "База данных", x: 682, y: 580, w: 132 },
  { id: "partnerCab", label: "Кабинет партнёра", x: 834, y: 580, w: 156 },
  { id: "ownerCab", label: "Кабинет владельца", x: 1008, y: 580, w: 164 },
  { id: "sqlite", label: "SQLite локально", x: 540, y: 642, w: 146 },
  { id: "postgres", label: "PostgreSQL production", x: 704, y: 642, w: 184 },
  { id: "reports", label: "Лиды, заказы, начисления, отчёты", x: 910, y: 642, w: 262 },
];

const architectureLinks = [
  ["user", "react"],
  ["react", "usersApi"],
  ["react", "refApi"],
  ["tilda", "widget"],
  ["tilda", "form"],
  ["widget", "publicApi"],
  ["form", "capture"],
  ["tilda", "webhook"],
  ["webhook", "orderApi"],
  ["usersApi", "django"],
  ["refApi", "django"],
  ["publicApi", "django"],
  ["capture", "django"],
  ["orderApi", "django"],
  ["nginx", "reactBuild"],
  ["nginx", "gunicorn"],
  ["gunicorn", "django"],
  ["django", "usersApp"],
  ["django", "referralsApp"],
  ["usersApp", "google"],
  ["usersApp", "passkeys"],
  ["usersApp", "email"],
  ["django", "db"],
  ["referralsApp", "partnerCab"],
  ["referralsApp", "ownerCab"],
  ["referralsApp", "reports"],
  ["db", "sqlite"],
  ["db", "postgres"],
];

const nodeById = Object.fromEntries(architectureNodes.map((node) => [node.id, node]));

function nodeCenter(node, edge) {
  const centerX = node.x + node.w / 2;
  const centerY = node.y + 17;

  if (edge === "bottom") {
    return { x: centerX, y: node.y + 34 };
  }
  if (edge === "top") {
    return { x: centerX, y: node.y };
  }
  if (edge === "left") {
    return { x: node.x, y: centerY };
  }
  return { x: node.x + node.w, y: centerY };
}

function linkPoints(fromId, toId) {
  const from = nodeById[fromId];
  const to = nodeById[toId];
  const vertical = Math.abs(from.x - to.x) < 90 || to.y > from.y;

  if (vertical) {
    return {
      from: nodeCenter(from, "bottom"),
      to: nodeCenter(to, "top"),
    };
  }

  return {
    from: nodeCenter(from, from.x < to.x ? "right" : "left"),
    to: nodeCenter(to, from.x < to.x ? "left" : "right"),
  };
}

function linkPath(fromId, toId) {
  const points = linkPoints(fromId, toId);
  const midY = Math.round((points.from.y + points.to.y) / 2);
  const midX = Math.round((points.from.x + points.to.x) / 2);

  if (points.to.y > points.from.y) {
    return `M ${points.from.x} ${points.from.y} V ${midY} H ${points.to.x} V ${points.to.y}`;
  }

  return `M ${points.from.x} ${points.from.y} H ${midX} V ${points.to.y} H ${points.to.x}`;
}

function ArchitectureScheme() {
  return (
    <section className="tools-diagrams__architecture" aria-label="Архитектура системы">
      <div className="architecture-flow">
        <div className="architecture-flow__production" aria-hidden="true">
          <span>Production-сервер</span>
        </div>
        <svg className="architecture-flow__lines" viewBox="0 0 1200 700" aria-hidden="true">
          <defs>
            <marker id="architecture-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" />
            </marker>
          </defs>
          {architectureLinks.map(([fromId, toId]) => {
            return (
              <path
                key={`${fromId}-${toId}`}
                d={linkPath(fromId, toId)}
                markerEnd="url(#architecture-arrow)"
              />
            );
          })}
        </svg>
        {architectureNodes.map((node) => (
          <div
            className="architecture-flow__node"
            key={node.id}
            style={{
              left: `${node.x}px`,
              top: `${node.y}px`,
              width: `${node.w}px`,
            }}
          >
            {node.label}
          </div>
        ))}
      </div>
    </section>
  );
}

function ToolsDonutChart({ group }) {
  const total = group.items.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;

  return (
    <div className="tools-diagrams__chart" aria-label={`Диаграмма: ${group.title}`}>
      <svg className="tools-diagrams__chart-svg" viewBox="0 0 100 100" role="img">
        <title>{group.title}</title>
        <circle className="tools-diagrams__chart-track" cx="50" cy="50" r="39" />
        {group.items.map((item) => {
          const dashOffset = -cursor;
          cursor += item.value;

          return (
            <circle
              key={item.label}
              className="tools-diagrams__chart-segment"
              cx="50"
              cy="50"
              r="39"
              pathLength="100"
              stroke={item.color}
              strokeDasharray={`${Math.max(item.value - 1.2, 1)} ${100 - Math.max(item.value - 1.2, 1)}`}
              strokeDashoffset={dashOffset}
            />
          );
        })}
      </svg>
      <div className="tools-diagrams__chart-center">
        <strong>{total}%</strong>
        <span>стек</span>
      </div>
    </div>
  );
}

function ToolsPieCard({ group }) {
  return (
    <article className="tools-diagrams__card">
      <div className="tools-diagrams__chart-wrap">
        <ToolsDonutChart group={group} />
      </div>

      <div className="tools-diagrams__content">
        <ul className="tools-diagrams__legend">
          {group.items.map((item) => (
            <li key={item.label}>
              <span
                className="tools-diagrams__legend-dot"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              <span className="tools-diagrams__legend-label">{item.label}</span>
              <strong>{item.value}%</strong>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function ProcessPresentationBlock() {
  return (
    <section className="presentation-process" aria-label="Процесс работы реферальной системы">
      <div className="presentation-process__steps">
        <article className="presentation-process__card">
          <small>01</small>
          <strong>Подключение сайта</strong>
          <span>Владелец добавляет сайт и получает настройки интеграции</span>
        </article>
        <article className="presentation-process__card">
          <small>02</small>
          <strong>Виджет на сайте</strong>
          <span>Виджет или скрипт вставляется на Tilda / внешний сайт</span>
        </article>
        <article className="presentation-process__card">
          <small>03</small>
          <strong>Партнёры</strong>
          <span>Партнёры получают ref-ссылки и приводят пользователей</span>
        </article>
        <article className="presentation-process__card">
          <small>04</small>
          <strong>Лиды и заказы</strong>
          <span>Система принимает заявки, заказы и сохраняет источник перехода</span>
        </article>
      </div>

      <div className="presentation-process__bottom">
        <div className="presentation-process__rules">
          <h2>Ключевые правила MVP</h2>
          <ul className="presentation-process__rules-list">
            <li>
              <span className="presentation-process__rule-dot" />
              <span>Атрибуция партнёра сохраняется после перехода по ref-ссылке</span>
            </li>
            <li>
              <span className="presentation-process__rule-dot" />
              <span>Лиды и заказы привязываются к сайту, пользователю и партнёру</span>
            </li>
            <li>
              <span className="presentation-process__rule-dot" />
              <span>Повторы защищаются через dedupe-ключи и аудит публичных запросов</span>
            </li>
            <li>
              <span className="presentation-process__rule-dot" />
              <span>Статистика видна в кабинетах партнёра и владельца сайта</span>
            </li>
          </ul>
        </div>

        <div className="presentation-process__result-wrap">
          <article className="presentation-process__result">
            <small>05</small>
            <strong>Статистика и начисления</strong>
            <span>В кабинетах отображаются переходы, лиды, заказы, комиссии и отчёты</span>
          </article>
        </div>
      </div>
    </section>
  );
}

function MarketGroupsBlock() {
  return (
    <section className="market-groups" aria-label="Группы решений на рынке">
      <h2>Группы решений на рынке</h2>
      <div className="market-groups__cards">
        <article className="market-groups__card">
          <h3>CPA / партнёрские сети</h3>
          <ul className="market-groups__list">
            <li><span className="market-groups__dot" /><span>Сети офферов и вебмастеров</span></li>
            <li><span className="market-groups__dot" /><span>Часто ориентированы на крупные интеграции</span></li>
            <li><span className="market-groups__dot" /><span>Не фокусируются на быстром подключении магазина на Tilda</span></li>
          </ul>
        </article>

        <article className="market-groups__card">
          <h3>Реферальные SaaS</h3>
          <ul className="market-groups__list">
            <li><span className="market-groups__dot" /><span>Запуск реферальных программ, бонусов и аналитики</span></li>
            <li><span className="market-groups__dot" /><span>Часто требуют CRM-события или отдельную настройку</span></li>
            <li><span className="market-groups__dot" /><span>Tilda-интеграция не всегда является ключевым фокусом</span></li>
          </ul>
        </article>

        <article className="market-groups__card">
          <h3>Tilda</h3>
          <ul className="market-groups__list">
            <li><span className="market-groups__dot" /><span>Отдельные конструкторы и решения под Tilda</span></li>
            <li><span className="market-groups__dot" /><span>Покрывают спрос на нишу Tilda-first</span></li>
            <li><span className="market-groups__dot" /><span>Окно для конкуренции: автоматизация оплат, дизайн-внедрение и геймификация</span></li>
          </ul>
        </article>
      </div>
    </section>
  );
}

function GoalTasksBlock() {
  return (
    <section className="goal-tasks" aria-label="Цель и задачи MVP">
      <article className="goal-tasks__card goal-tasks__card--goal">
        <h2>Цель</h2>
        <p>
          Создать MVP реферальной платформы, которая быстро подключается к
          магазинам на Tilda, фиксирует лиды и оплаченные заказы по реферальным
          ссылкам, считает комиссии и показывает статистику в кабинетах.
        </p>
      </article>

      <article className="goal-tasks__card">
        <h2>Задачи MVP</h2>
        <ul className="goal-tasks__list">
          <li><span className="goal-tasks__dot" /><span>Спроектировать архитектуру: кабинеты, API, БД и интеграцию с Tilda</span></li>
          <li><span className="goal-tasks__dot" /><span>Реализовать генерацию реферальных ссылок и учёт партнёров</span></li>
          <li><span className="goal-tasks__dot" /><span>Настроить сбор лидов, заказов и атрибуцию партнёра</span></li>
          <li><span className="goal-tasks__dot" /><span>Реализовать расчёт комиссий и отображение статистики</span></li>
          <li><span className="goal-tasks__dot" /><span>Добавить базовые антифрод-меры, аудит запросов и геймификацию</span></li>
        </ul>
      </article>
    </section>
  );
}

function RelevanceNoveltyBlock() {
  return (
    <section className="relevance-novelty" aria-label="Актуальность и новизна">
      <article className="relevance-novelty__card">
        <h2>Актуальность</h2>
        <ul className="relevance-novelty__list">
          <li><span className="relevance-novelty__dot" /><span>Малому бизнесу нужен канал продаж за результат, а не за показы</span></li>
          <li><span className="relevance-novelty__dot" /><span>На конструкторах, включая Tilda, много магазинов без штатного разработчика</span></li>
          <li><span className="relevance-novelty__dot" /><span>Сложные интеграции снижают конверсию подключения: важно, чтобы система работала быстро</span></li>
        </ul>
      </article>

      <article className="relevance-novelty__card">
        <h2>Новизна / отличия</h2>
        <ul className="relevance-novelty__list">
          <li><span className="relevance-novelty__dot" /><span>Tilda-first: подключение через виджет, скрипт и webhook форм</span></li>
          <li><span className="relevance-novelty__dot" /><span>Конверсия считается по лидам и оплаченным заказам, а не только по отправке формы</span></li>
          <li><span className="relevance-novelty__dot" /><span>Хранятся только минимально необходимые данные для аналитики и начислений</span></li>
          <li><span className="relevance-novelty__dot" /><span>Геймификация встроена как мотивация партнёров</span></li>
        </ul>
      </article>
    </section>
  );
}

function DoneWorkBlock() {
  return (
    <section className="done-work" aria-label="Выполненные задачи">
      <h2>Выполненные задачи</h2>
      <div className="done-work__grid">
        <article className="done-work__card">
          <h3>Архитектура</h3>
          <ul className="done-work__list">
            <li><span className="done-work__dot" /><span>Спроектирована структура системы: React frontend, Django REST API, БД и production-инфраструктура</span></li>
            <li><span className="done-work__dot" /><span>Разделены ключевые зоны API: пользователи, рефералка, публичный widget API и webhook заказов</span></li>
            <li><span className="done-work__dot" /><span>Подготовлена схема хранения данных для пользователей, сайтов, лидов, заказов и комиссий</span></li>
          </ul>
        </article>

        <article className="done-work__card">
          <h3>Кабинеты и пользователи</h3>
          <ul className="done-work__list">
            <li><span className="done-work__dot" /><span>Реализованы кабинеты партнёра и владельца сайта для работы со статистикой и настройками</span></li>
            <li><span className="done-work__dot" /><span>Добавлены регистрация, вход, JWT-авторизация и управление профилем пользователя</span></li>
            <li><span className="done-work__dot" /><span>Подключены дополнительные сценарии входа: Google, VK, Telegram и WebAuthn / Passkeys</span></li>
          </ul>
        </article>

        <article className="done-work__card">
          <h3>Реферальная логика</h3>
          <ul className="done-work__list">
            <li><span className="done-work__dot" /><span>Реализованы ref-коды, реферальные ссылки, переходы и атрибуция партнёра</span></li>
            <li><span className="done-work__dot" /><span>Сделана привязка лидов и заказов к сайту, партнёру и пользователю</span></li>
            <li><span className="done-work__dot" /><span>Добавлен расчёт комиссий и отображение начислений в кабинетах</span></li>
          </ul>
        </article>

        <article className="done-work__card">
          <h3>Tilda и события</h3>
          <ul className="done-work__list">
            <li><span className="done-work__dot" /><span>Подготовлено подключение сайта через виджет / скрипт и публичный API</span></li>
            <li><span className="done-work__dot" /><span>Реализован приём лидов с внешних страниц и capture endpoint для ref-сессии</span></li>
            <li><span className="done-work__dot" /><span>Добавлен webhook заказов и обработка оплаты для подтверждения конверсии</span></li>
          </ul>
        </article>

        <article className="done-work__card">
          <h3>Геймификация и защита</h3>
          <ul className="done-work__list">
            <li><span className="done-work__dot" /><span>Добавлены игровые механики: XP, очки, достижения, магазин наград и ежедневный челлендж</span></li>
            <li><span className="done-work__dot" /><span>Сделаны базовые антифрод-механизмы: dedupe-ключи, аудит публичных запросов и лимиты</span></li>
            <li><span className="done-work__dot" /><span>Подготовлена диагностика интеграций и история действий владельца сайта</span></li>
          </ul>
        </article>

        <article className="done-work__card done-work__card--extra">
          <h3>Сделано сверх поставленных задач</h3>
          <ul className="done-work__list">
            <li><span className="done-work__dot" /><span>Добавлены поддержка пользователей, обращения и вложения в кабинете</span></li>
            <li><span className="done-work__dot" /><span>Подготовлены production-настройки: PostgreSQL, nginx, Gunicorn, systemd и GitHub Actions deploy</span></li>
            <li><span className="done-work__dot" /><span>Реализованы OAuth-провайдеры, passkeys, восстановление пароля и расширенная безопасность аккаунта</span></li>
            <li><span className="done-work__dot" /><span>Сделаны презентационные схемы архитектуры, БД, инструментария и сценариев работы системы</span></li>
          </ul>
        </article>
      </div>
    </section>
  );
}

export default function ToolsDiagramsPage() {
  return (
    <main className="tools-diagrams">
      <ArchitectureScheme />

      <section className="tools-diagrams__grid" aria-label="Круговые диаграммы инструментов">
        {diagramGroups.map((group) => (
          <ToolsPieCard key={group.title} group={group} />
        ))}
      </section>

      <ProcessPresentationBlock />

      <MarketGroupsBlock />

      <GoalTasksBlock />

      <RelevanceNoveltyBlock />

      <DoneWorkBlock />
    </main>
  );
}
