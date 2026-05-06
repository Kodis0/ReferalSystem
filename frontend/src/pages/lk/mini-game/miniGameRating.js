import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, ListFilter, Search, ShoppingBag, Trophy, UserPlus } from "lucide-react";
import { SiteFaviconAvatar } from "../owner-programs/SiteFaviconAvatar";
import "../bug/bug.css";
import "../dashboard/dashboard.css";
import "./miniGameRating.css";
import { fetchGamificationReferralLeaderboard } from "./gamificationApi";

/** @typedef {'week' | 'month' | 'all'} ReferralRatingPeriod */

const PERIOD_OPTIONS = [
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
  { id: "all", label: "Всё время" },
];

function formatRub(value) {
  const n = Number(value) || 0;
  return `${n.toLocaleString("ru-RU")} ₽`;
}

/** Напр. «7 мест», «22 места», «1 место» */
function rankPlaceRu(rank) {
  const n = Math.abs(Number(rank) | 0);
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) {
    return `${n.toLocaleString("ru-RU")} мест`;
  }
  if (mod10 === 1) {
    return `${n.toLocaleString("ru-RU")} место`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${n.toLocaleString("ru-RU")} места`;
  }
  return `${n.toLocaleString("ru-RU")} мест`;
}

function ordersCountRu(n) {
  const v = Number(n) || 0;
  const mod10 = v % 10;
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 14) {
    return `${v.toLocaleString("ru-RU")} заказов`;
  }
  if (mod10 === 1) {
    return `${v.toLocaleString("ru-RU")} заказ`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${v.toLocaleString("ru-RU")} заказа`;
  }
  return `${v.toLocaleString("ru-RU")} заказов`;
}

function programsCountRu(n) {
  const v = Number(n) || 0;
  const mod10 = v % 10;
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 14) {
    return `${v.toLocaleString("ru-RU")} программ`;
  }
  if (mod10 === 1) {
    return `${v.toLocaleString("ru-RU")} программа`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${v.toLocaleString("ru-RU")} программы`;
  }
  return `${v.toLocaleString("ru-RU")} программ`;
}

function ratingAvatarLetter(displayName) {
  const value = typeof displayName === "string" ? displayName.trim() : "";
  return value.slice(0, 1).toUpperCase() || "?";
}

/** Классы короны для 1 / 2 / 3 места: золото, серебро, бронза */
function rankCrownClass(rankNum) {
  const n = Number(rankNum);
  if (n === 1) return "mini-game-rating__rank-crown--1";
  if (n === 2) return "mini-game-rating__rank-crown--2";
  if (n === 3) return "mini-game-rating__rank-crown--3";
  return "";
}

function mapEntryToRow(entry) {
  return {
    userId: entry.user_id,
    rank: entry.rank,
    name: entry.display_name,
    displayName: typeof entry.display_name === "string" ? entry.display_name : "",
    salesRub: entry.sales_amount,
    orders: entry.paid_orders_count,
    programsCount: Number(entry.joined_programs_count) || 0,
    avatarUrl: typeof entry.avatar_data_url === "string" ? entry.avatar_data_url.trim() : "",
  };
}

/**
 * @param {{
 *   displayName: string;
 *   avatarUrl: string;
 *   salesRub: number;
 *   rankHighlight: string;
 *   detailLine: string;
 *   rankNumber?: number | null;
 * }} props
 */
function ReferralLeaderboardCatalogRow({ displayName, avatarUrl, salesRub, rankHighlight, detailLine, rankNumber }) {
  const profit = formatRub(salesRub);
  const rankText = typeof rankHighlight === "string" ? rankHighlight.trim() : "";
  const detailText = typeof detailLine === "string" ? detailLine.trim() : "";
  const crownCls = rankCrownClass(rankNumber);

  return (
    <div className="lk-dashboard__programs-catalog-row mini-game-rating__top-catalog-row">
      <div className="lk-dashboard__programs-item-top">
        <div className="lk-dashboard__programs-avatar" aria-hidden="true">
          <SiteFaviconAvatar
            key={`rl-${displayName}-${String(avatarUrl || "").slice(0, 24)}`}
            manualUrl={avatarUrl}
            letter={ratingAvatarLetter(displayName)}
            imgClassName="lk-dashboard__programs-avatar-img"
            useExternalFavicon={false}
          />
        </div>
      </div>
      <div className="lk-dashboard__programs-catalog-row-middle">
        <div className="lk-dashboard__programs-catalog-row-text mini-game-rating__rating-catalog-text">
          <div className="mini-game-rating__rating-left">
            <span className="lk-dashboard__programs-catalog-title">
              <span className="mini-game-rating__catalog-title-text">{displayName || "—"}</span>
            </span>
            {detailText ? (
              <span className="mini-game-rating__rating-detail">{detailText}</span>
            ) : null}
          </div>
          <span className="mini-game-rating__rating-sum" aria-label={`Прибыль ${profit}`}>
            {profit}
          </span>
          <div className="mini-game-rating__rating-right">
            {rankText ? (
              <span className="mini-game-rating__rating-rank">
                {crownCls ? (
                  <Crown
                    className={`mini-game-rating__rank-crown ${crownCls}`}
                    size={18}
                    strokeWidth={2}
                    aria-hidden
                  />
                ) : null}
                <span className="mini-game-rating__rank-label">{rankText}</span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="lk-dashboard__programs-catalog-row-actions" aria-hidden="true" />
    </div>
  );
}

export default function MiniGameRatingPage() {
  const [period, setPeriod] = useState(
    /** @type {ReferralRatingPeriod} */ ("month"),
  );
  const [payload, setPayload] = useState(null);
  const [loadState, setLoadState] = useState(
    /** @type {"idle" | "loading" | "ready" | "error"} */ ("idle"),
  );
  const [errorText, setErrorText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersPanelOpen, setFiltersPanelOpen] = useState(false);
  const filtersWrapRef = useRef(null);

  const load = useCallback(async () => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
    if (!token) {
      setLoadState("error");
      setErrorText("Нужна авторизация.");
      return;
    }
    setLoadState("loading");
    setErrorText("");
    try {
      const data = await fetchGamificationReferralLeaderboard(token, period);
      setPayload(data);
      setLoadState("ready");
    } catch (e) {
      setPayload(null);
      setLoadState("error");
      setErrorText(e?.message || "Не удалось загрузить рейтинг.");
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!filtersPanelOpen) return undefined;
    function onPointerDown(event) {
      if (filtersWrapRef.current && !filtersWrapRef.current.contains(event.target)) {
        setFiltersPanelOpen(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setFiltersPanelOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filtersPanelOpen]);

  const currentUser = payload?.current_user ?? null;
  const leaderboardEmpty = Boolean(payload?.leaderboard_empty);

  const filteredEntries = useMemo(() => {
    const list = Array.isArray(payload?.entries) ? payload.entries : [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) => String(e.display_name || "").toLowerCase().includes(q));
  }, [payload, searchQuery]);

  const topFive = useMemo(() => filteredEntries.slice(0, 5).map(mapEntryToRow), [filteredEntries]);

  const userPinnedRow = useMemo(() => {
    if (!currentUser || currentUser.rank == null) {
      return null;
    }
    if (currentUser.rank <= 5) {
      return null;
    }
    const displayName =
      typeof currentUser.display_name === "string" && currentUser.display_name.trim()
        ? currentUser.display_name.trim()
        : "Вы";
    return {
      userId: currentUser.user_id,
      rank: currentUser.rank,
      name: displayName,
      displayName,
      salesRub: currentUser.sales_amount,
      orders: currentUser.paid_orders_count,
      programsCount: Number(currentUser.joined_programs_count) || 0,
      avatarUrl: typeof currentUser.avatar_data_url === "string" ? currentUser.avatar_data_url.trim() : "",
    };
  }, [currentUser]);

  const showPinnedUser = Boolean(userPinnedRow) && !searchQuery.trim();

  const mePrograms = Number(currentUser?.joined_programs_count) || 0;

  const meRankHighlight =
    loadState === "ready" && currentUser
      ? currentUser.rank == null
        ? "Нет профиля реферала"
        : rankPlaceRu(currentUser.rank)
      : "";

  const meDetailLine =
    loadState === "ready" && currentUser
      ? `${programsCountRu(mePrograms)} · ${ordersCountRu(currentUser.paid_orders_count)}`
      : "";

  const gapRub =
    loadState === "ready" && currentUser && currentUser.rank != null && currentUser.rank > 5
      ? Math.max(0, Number(currentUser.gap_to_top_5) || 0)
      : 0;

  const meDisplayName =
    loadState === "ready" && currentUser && typeof currentUser.display_name === "string"
      ? currentUser.display_name.trim()
      : "";

  const meAvatarUrl =
    loadState === "ready" && currentUser && typeof currentUser.avatar_data_url === "string"
      ? currentUser.avatar_data_url.trim()
      : "";

  return (
    <div className="lk-simple-page">
      <div className="lk-dashboard">
        <section
          className="lk-dashboard__programs lk-dashboard__programs_catalog mini-game-rating__section"
          aria-labelledby="referral-rating-heading"
        >
          <div className="lk-dashboard__programs-catalog-hero-collapse lk-dashboard__programs-catalog-hero-collapse--open mini-game-rating__referral-hero-collapse">
            <div className="lk-dashboard__programs-catalog-hero-collapse-sizer">
              <div className="lk-dashboard__my-programs-hero-stack mini-game-rating__referral-hero-stack">
                <div className="lk-dashboard__my-programs-catalog-banner lk-dashboard__programs-catalog-hero mini-game-rating__referral-hero-banner">
                  <div className="lk-dashboard__my-programs-catalog-banner-inner mini-game-rating__referral-hero-banner-inner">
                    <div className="lk-dashboard__my-programs-catalog-banner-copy">
                      <p className="lk-dashboard__my-programs-catalog-banner-title">Станьте лидером месяца</p>
                      <p className="lk-dashboard__my-programs-catalog-banner-sub">
                        Приводите клиентов, получайте подтверждённые продажи и поднимайтесь в рейтинге рефералов. Чем
                        больше сумма продаж за месяц, тем выше ваша позиция.
                      </p>
                      <Link className="lk-dashboard__my-programs-catalog-banner-cta" to="/lk/my-programs">
                        Мои программы
                      </Link>
                    </div>
                  </div>
                </div>

                <div
                  className="lk-dashboard__my-programs-catalog-cards mini-game-rating__referral-hero-cards"
                  role="list"
                  aria-label="Как устроен рейтинг рефералов"
                >
                  <div
                    className="lk-dashboard__my-programs-catalog-card lk-dashboard__my-programs-catalog-card_has-body"
                    role="listitem"
                  >
                    <div className="lk-dashboard__my-programs-catalog-card-icon" aria-hidden="true">
                      <UserPlus size={22} strokeWidth={1.75} />
                    </div>
                    <p className="lk-dashboard__my-programs-catalog-card-title">Приглашайте клиентов</p>
                    <p className="lk-dashboard__my-programs-catalog-card-desc">
                      Делитесь своей реферальной ссылкой и приводите новых покупателей на платформу.
                    </p>
                  </div>
                  <div
                    className="lk-dashboard__my-programs-catalog-card lk-dashboard__my-programs-catalog-card_has-body"
                    role="listitem"
                  >
                    <div className="lk-dashboard__my-programs-catalog-card-icon" aria-hidden="true">
                      <ShoppingBag size={22} strokeWidth={1.75} />
                    </div>
                    <p className="lk-dashboard__my-programs-catalog-card-title">Получайте продажи</p>
                    <p className="lk-dashboard__my-programs-catalog-card-desc">
                      Когда клиент оформляет и оплачивает заказ, продажа попадает в статистику после подтверждения.
                    </p>
                  </div>
                  <div
                    className="lk-dashboard__my-programs-catalog-card lk-dashboard__my-programs-catalog-card_has-body"
                    role="listitem"
                  >
                    <div className="lk-dashboard__my-programs-catalog-card-icon" aria-hidden="true">
                      <Trophy size={22} strokeWidth={1.75} />
                    </div>
                    <p className="lk-dashboard__my-programs-catalog-card-title">Поднимайтесь в рейтинге</p>
                    <p className="lk-dashboard__my-programs-catalog-card-desc">
                      Чем больше сумма подтверждённых продаж за месяц, тем выше ваше место среди участников.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <h1 id="referral-rating-heading" className="lk-dashboard__programs-title mini-game-rating__page-title">
            Рейтинг рефералов
          </h1>

          <div className="lk-dashboard__programs-toolbar">
            <label className="lk-dashboard__programs-search" aria-label="Поиск по участникам">
              <span className="lk-dashboard__programs-search-icon" aria-hidden="true">
                <Search size={16} />
              </span>
              <input
                type="search"
                className="lk-dashboard__programs-search-input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Поиск"
                autoComplete="off"
                disabled={loadState === "loading"}
              />
            </label>
            <div className="lk-dashboard__programs-filters-wrap" ref={filtersWrapRef}>
              <button
                type="button"
                className="lk-dashboard__programs-filters-btn"
                aria-expanded={filtersPanelOpen}
                aria-controls="referral-rating-filters-panel"
                aria-haspopup="true"
                disabled={loadState === "loading"}
                onClick={() => setFiltersPanelOpen((open) => !open)}
              >
                <ListFilter size={18} strokeWidth={2} aria-hidden />
                <span>Фильтры</span>
                {period !== "month" ? <span className="lk-dashboard__programs-filters-btn-dot" aria-hidden /> : null}
              </button>
              {filtersPanelOpen ? (
                <div
                  id="referral-rating-filters-panel"
                  className="lk-dashboard__programs-filters-panel"
                  role="group"
                  aria-label="Фильтры рейтинга"
                >
                  <div className="lk-dashboard__programs-filter">
                    <p className="lk-dashboard__programs-filter-label" id="referral-rating-period-label">
                      Период
                    </p>
                    <div
                      className="mini-game-rating__period-panel"
                      role="radiogroup"
                      aria-labelledby="referral-rating-period-label"
                    >
                      {PERIOD_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          role="radio"
                          aria-checked={period === opt.id}
                          disabled={loadState === "loading"}
                          className={`mini-game-rating__period-panel-option${
                            period === opt.id ? " mini-game-rating__period-panel-option--active" : ""
                          }`}
                          onClick={() => {
                            setPeriod(opt.id);
                            setFiltersPanelOpen(false);
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {loadState === "error" ? (
            <p className="lk-dashboard__programs-muted" role="alert">
              {errorText}
            </p>
          ) : null}

          {loadState === "loading" ? (
            <p className="lk-dashboard__programs-muted">Загрузка…</p>
          ) : null}

          {loadState === "ready" && currentUser ? (
            <div className="mini-game-rating__me-block">
              <p className="mini-game-rating__me-label">Ваша позиция</p>
              <ul className="lk-dashboard__programs-list">
                <li className="lk-dashboard__programs-item">
                  <ReferralLeaderboardCatalogRow
                    displayName={meDisplayName || "Вы"}
                    avatarUrl={meAvatarUrl}
                    salesRub={currentUser.sales_amount}
                    rankHighlight={meRankHighlight}
                    detailLine={meDetailLine}
                    rankNumber={currentUser.rank}
                  />
                </li>
              </ul>
              {currentUser.rank != null && currentUser.rank > 5 && gapRub > 0 ? (
                <p className="mini-game-rating__me-gap">
                  До топ-5 осталось {formatRub(gapRub)} продаж
                </p>
              ) : null}
            </div>
          ) : null}

          {loadState === "ready" && !leaderboardEmpty && filteredEntries.length === 0 && searchQuery.trim() ? (
            <p className="lk-dashboard__programs-muted mini-game-rating__empty-msg">
              По запросу никого не найдено.
            </p>
          ) : null}

          {loadState === "ready" && !leaderboardEmpty && filteredEntries.length > 0 ? (
            <ul className="lk-dashboard__programs-list" aria-label="Топ участников рейтинга">
              {topFive.map((row, idx) => (
                <li key={`${period}-${row.userId}-${idx}`} className="lk-dashboard__programs-item">
                  <ReferralLeaderboardCatalogRow
                    displayName={row.displayName || row.name}
                    avatarUrl={row.avatarUrl}
                    salesRub={row.salesRub}
                    rankHighlight={rankPlaceRu(row.rank)}
                    detailLine={`${programsCountRu(row.programsCount)} · ${ordersCountRu(row.orders)}`}
                    rankNumber={row.rank}
                  />
                </li>
              ))}
              {showPinnedUser ? (
                <li className="lk-dashboard__programs-item">
                  <div className="mini-game-rating__catalog-omit" aria-hidden="true">
                    …
                  </div>
                </li>
              ) : null}
              {showPinnedUser && userPinnedRow ? (
                <li className={`lk-dashboard__programs-item mini-game-rating__catalog-item--pinned`}>
                  <ReferralLeaderboardCatalogRow
                    displayName={userPinnedRow.displayName}
                    avatarUrl={userPinnedRow.avatarUrl}
                    salesRub={userPinnedRow.salesRub}
                    rankHighlight={rankPlaceRu(userPinnedRow.rank)}
                    detailLine={`${programsCountRu(userPinnedRow.programsCount)} · ${ordersCountRu(userPinnedRow.orders)}`}
                    rankNumber={userPinnedRow.rank}
                  />
                </li>
              ) : null}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  );
}
