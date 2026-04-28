/** Событие `window` для обновления списка тикетов в хабе без перезагрузки страницы. */
export const SUPPORT_HUB_TICKETS_REFRESH_EVENT = "lk-support-tickets-refresh";

export const SUPPORT_TICKET_SLUGS = ["help-question", "help-problem", "help-claim"];

export const SUPPORT_TICKET_TABS = [
  {
    slug: "help-question",
    title: "По общему вопросу",
    time: "до 4 минут",
    fast: true,
  },
  {
    slug: "help-problem",
    title: "По техническому вопросу",
    time: "до 5 минут",
    fast: false,
  },
  {
    slug: "help-claim",
    title: "Для отработки претензии",
    time: "1–3 дня",
    fast: false,
  },
];

/** `label` — короткое имя сервиса в UI; `submissionLabel` — полная строка в текст обращения. */
export const SUPPORT_SERVICE_OPTIONS = [
  { value: "lumo-owner", label: "Кабинет владельца", submissionLabel: "LUMO — кабинет владельца" },
  {
    value: "lumo-widget",
    label: "Сайты и виджет",
    submissionLabel: "LUMO — виджет на сайте",
    iconType: "site",
  },
  { value: "lumo-referral", label: "Реферальная программа", submissionLabel: "LUMO — реферальная программа" },
];
