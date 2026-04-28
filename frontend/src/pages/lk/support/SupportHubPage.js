import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useMatch, useNavigate, useOutlet } from "react-router-dom";
import { ChevronDown, LifeBuoy, Search } from "lucide-react";
import { SUPPORT_HUB_TICKETS_REFRESH_EVENT } from "./supportConstants";
import { fetchMySupportTickets } from "./supportTicketsApi";
import "./support.css";

function formatTicketListDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function matchesQuery(t, q) {
  if (!q) return true;
  const preview = String(t.preview || "").toLowerCase();
  const lastMsg = String(t.last_message_preview || "").toLowerCase();
  const title = String(t.type_title || "").toLowerCase();
  const target = String(t.target_label || "").toLowerCase();
  return (
    preview.includes(q) || lastMsg.includes(q) || title.includes(q) || target.includes(q)
  );
}

function TicketRowLink({ t, highlighted }) {
  return (
    <Link
      className={`lk-support-hub__ticket-row${highlighted ? " lk-support-hub__ticket-row_highlight" : ""}`}
      to={`/lk/support/tickets/${t.id}`}
      aria-current={highlighted ? "page" : undefined}
    >
      <span className="lk-support-hub__ticket-row-avatar" aria-hidden>
        <LifeBuoy size={20} strokeWidth={1.75} />
      </span>
      <div className="lk-support-hub__ticket-row-body">
        <p className="lk-support-hub__ticket-row-title">{t.preview || "Обращение"}</p>
        <p className="lk-support-hub__ticket-row-meta">
          {String(t.last_message_preview || "").trim() ||
            [t.type_title, t.target_label].filter(Boolean).join(" · ") ||
            "…"}
        </p>
        <p className="lk-support-hub__ticket-row-date">{formatTicketListDate(t.created_at)}</p>
      </div>
    </Link>
  );
}

export default function SupportHubPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const ticketRouteMatch = useMatch({ path: "/lk/support/tickets/:ticketId", end: true });
  const routeTicketId = ticketRouteMatch?.params?.ticketId ? String(ticketRouteMatch.params.ticketId) : null;
  const [query, setQuery] = useState("");
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [highlightTicketId, setHighlightTicketId] = useState(null);

  const applyListResult = useCallback((res, silent) => {
    if (!res.ok) {
      if (!silent) {
        setTickets([]);
        if (res.status === 401) {
          setLoadError("Войдите в аккаунт, чтобы видеть обращения.");
        } else {
          setLoadError(res.detail === "network" ? "Не удалось загрузить список. Проверьте соединение." : "Не удалось загрузить список.");
        }
      }
      return;
    }
    setTickets(res.tickets);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      const res = await fetchMySupportTickets();
      if (cancelled) return;
      setLoading(false);
      applyListResult(res, false);
    })();
    return () => {
      cancelled = true;
    };
  }, [applyListResult]);

  useEffect(() => {
    let cancelled = false;
    const onRefresh = (e) => {
      const d = e && e.detail;
      if (d && d.closedTicketId) {
        setClosedExpanded(true);
      }
      (async () => {
        const res = await fetchMySupportTickets();
        if (cancelled) return;
        applyListResult(res, true);
      })();
    };
    window.addEventListener(SUPPORT_HUB_TICKETS_REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(SUPPORT_HUB_TICKETS_REFRESH_EVENT, onRefresh);
    };
  }, [applyListResult]);

  useEffect(() => {
    const fidRaw = location.state && location.state.focusTicketId;
    const fid = typeof fidRaw === "string" && fidRaw.trim() ? fidRaw.trim() : null;
    if (!fid || loading || tickets.length === 0) {
      return undefined;
    }
    const ticket = tickets.find((x) => String(x.id) === fid);
    if (!ticket) {
      return undefined;
    }

    navigate(location.pathname, { replace: true, state: {} });
    setQuery("");
    if (ticket.is_closed === true) {
      setClosedExpanded(true);
    }
    setHighlightTicketId(fid);

    const scrollToRow = () => {
      document.querySelector(`li[data-support-ticket-row="${fid}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    requestAnimationFrame(() => requestAnimationFrame(scrollToRow));
    const delayed =
      ticket.is_closed === true
        ? [window.setTimeout(scrollToRow, 120), window.setTimeout(scrollToRow, 400)]
        : [];
    const clearHighlight = window.setTimeout(() => setHighlightTicketId(null), 4500);

    return () => {
      delayed.forEach((id) => clearTimeout(id));
      clearTimeout(clearHighlight);
    };
  }, [loading, tickets, location.state?.focusTicketId, navigate, location.pathname]);

  const q = query.trim().toLowerCase();

  const openTickets = useMemo(() => tickets.filter((t) => !t.is_closed), [tickets]);
  const closedTickets = useMemo(() => tickets.filter((t) => t.is_closed), [tickets]);

  const filteredOpen = useMemo(() => openTickets.filter((t) => matchesQuery(t, q)), [openTickets, q]);
  const filteredClosed = useMemo(() => closedTickets.filter((t) => matchesQuery(t, q)), [closedTickets, q]);

  return (
    <main className="lk-support-hub" id="lk-support-hub">
      <header className="lk-support-hub__page-header">
        <div className="lk-support-hub__page-header-inner">
          <div className="lk-support-hub__page-title-wrap">
            <h1 className="lk-support-hub__h1">Центр поддержки</h1>
          </div>
          <div className="lk-support-hub__page-actions">
            <Link
              className="baseButton button button_size_medium baseButton__size_medium baseButton__color_primary"
              to="/lk/support/help-question"
            >
              Создать тикет
            </Link>
          </div>
        </div>
      </header>

      <div className="lk-support-hub__split">
        <div className="lk-support-hub__list-pane">
          <label className="lk-support-hub__search">
            <span className="lk-support-hub__search-inner">
              <input
                className="lk-support-hub__search-input"
                type="search"
                placeholder="Поиск"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Search className="lk-support-hub__search-icon" size={24} strokeWidth={1.5} aria-hidden />
            </span>
          </label>

          <div className="lk-support-hub__list-scroll">
            {loadError ? (
              <p className="lk-support-hub__list-error" role="alert">
                {loadError}
              </p>
            ) : null}
            {!loadError && loading ? (
              <p className="lk-support-hub__list-loading" aria-live="polite">
                Загрузка…
              </p>
            ) : null}
            {!loadError && !loading ? (
              <ul className="lk-support-hub__ticket-rows">
                {filteredOpen.map((t) => (
                  <li key={t.id} data-support-ticket-row={t.id}>
                    <TicketRowLink t={t} highlighted={highlightTicketId === t.id || routeTicketId === String(t.id)} />
                  </li>
                ))}
              </ul>
            ) : null}
            {!loadError && !loading && filteredOpen.length === 0 ? (
              <p className="lk-support-hub__list-empty">
                {tickets.length === 0
                  ? "У вас пока нет сохранённых обращений."
                  : openTickets.length === 0 && closedTickets.length > 0
                    ? "Нет активных обращений — откройте закрытые ниже."
                    : "Ничего не найдено"}
              </p>
            ) : null}
          </div>

          {!loadError && !loading ? (
            <>
              <button
                type="button"
                className="lk-support-hub__closed-bar"
                aria-expanded={closedExpanded}
                onClick={() => setClosedExpanded((v) => !v)}
              >
                <span className="lk-support-hub__closed-bar-label">Закрытые тикеты</span>
                <span className="lk-support-hub__closed-count">{closedTickets.length}</span>
                <ChevronDown
                  className={`lk-support-hub__closed-chevron${closedExpanded ? " lk-support-hub__closed-chevron_open" : ""}`}
                  size={24}
                  aria-hidden
                />
              </button>
              {closedExpanded ? (
                <div className="lk-support-hub__closed-scroll">
                  <ul className="lk-support-hub__ticket-rows lk-support-hub__ticket-rows_closed">
                    {filteredClosed.map((t) => (
                      <li key={t.id} data-support-ticket-row={t.id}>
                        <TicketRowLink t={t} highlighted={highlightTicketId === t.id || routeTicketId === String(t.id)} />
                      </li>
                    ))}
                  </ul>
                  {filteredClosed.length === 0 ? (
                    <p className="lk-support-hub__list-empty lk-support-hub__list-empty_nested">
                      {closedTickets.length === 0 ? "Нет закрытых обращений." : "Ничего не найдено"}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="lk-support-hub__detail-pane">
          <div className="lk-support-hub__detail-card">
            {outlet ?? (
              <div className="lk-support-hub__detail-empty">
                <p className="lk-support-hub__detail-empty-line lk-support-hub__detail-empty-line_muted">
                  Выберите обращение слева или
                </p>
                <Link className="tw-link link_primary link_s" to="/lk/support/help-question">
                  создайте новый тикет
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
