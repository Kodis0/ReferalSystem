import { useCallback, useEffect, useMemo, useState } from "react";
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

const LEAGUE_LABELS_RU = {
  start: "Старт",
  bronze: "Бронза",
  silver: "Серебро",
  gold: "Золото",
  platinum: "Платина",
  diamond: "Алмаз",
  ultra: "Ультра",
};

function leagueLabelRu(code) {
  if (!code) {
    return "—";
  }
  const k = String(code).toLowerCase();
  return LEAGUE_LABELS_RU[k] || code;
}

function formatRub(value) {
  const n = Number(value) || 0;
  return `${n.toLocaleString("ru-RU")} ₽`;
}

function streakDaysRu(days) {
  const n = Math.abs(Number(days) | 0);
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) {
    return `${n} дней`;
  }
  if (mod10 === 1) {
    return `${n} день`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${n} дня`;
  }
  return `${n} дней`;
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

function mapEntryToRow(entry) {
  return {
    rank: entry.rank,
    name: entry.display_name,
    leagueLabel: leagueLabelRu(entry.league),
    salesRub: entry.sales_amount,
    orders: entry.paid_orders_count,
    xp: entry.xp_total,
    streakDays: entry.streak_days,
    isSelf: Boolean(entry.is_current_user),
  };
}

function ReferralRatingRow({ row, rankClass }) {
  const self = Boolean(row.isSelf);
  return (
    <tr
      className={`mini-game-rating__tr${rankClass ? ` ${rankClass}` : ""}${self ? " mini-game-rating__tr--self" : ""}`}
    >
      <td className="mini-game-rating__td mini-game-rating__td--rank">
        <span className="mini-game-rating__rank-cell">{row.rank}</span>
      </td>
      <td className="mini-game-rating__td mini-game-rating__td--name">
        <span className="mini-game-rating__name-wrap">
          <span className="mini-game-rating__name">{row.name}</span>
          {self ? (
            <span className="mini-game-rating__you-badge" aria-label="Это вы">
              Вы
            </span>
          ) : null}
        </span>
      </td>
      <td className="mini-game-rating__td">{row.leagueLabel}</td>
      <td className="mini-game-rating__td mini-game-rating__td--num">{formatRub(row.salesRub)}</td>
      <td className="mini-game-rating__td mini-game-rating__td--num">{ordersCountRu(row.orders)}</td>
      <td className="mini-game-rating__td mini-game-rating__td--num">{Number(row.xp).toLocaleString("ru-RU")}</td>
      <td className="mini-game-rating__td mini-game-rating__td--num">{streakDaysRu(row.streakDays)}</td>
    </tr>
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

  const currentUser = payload?.current_user ?? null;
  const leaderboardEmpty = Boolean(payload?.leaderboard_empty);

  const topFive = useMemo(() => {
    const list = payload?.entries ?? [];
    return list.slice(0, 5).map(mapEntryToRow);
  }, [payload]);

  const userPinnedRow = useMemo(() => {
    if (!currentUser || currentUser.rank == null) {
      return null;
    }
    if (currentUser.rank <= 5) {
      return null;
    }
    return {
      rank: currentUser.rank,
      name: "Вы",
      leagueLabel: leagueLabelRu(currentUser.league),
      salesRub: currentUser.sales_amount,
      orders: currentUser.paid_orders_count,
      xp: currentUser.xp_total,
      streakDays: currentUser.streak_days,
      isSelf: true,
    };
  }, [currentUser]);

  const showPinnedUser = Boolean(userPinnedRow);

  const rankClassForTop = (rank) => {
    if (rank === 1) {
      return "mini-game-rating__tr--top1";
    }
    if (rank === 2) {
      return "mini-game-rating__tr--top2";
    }
    if (rank === 3) {
      return "mini-game-rating__tr--top3";
    }
    return "";
  };

  const meRankText =
    loadState === "ready" && currentUser
      ? currentUser.rank == null
        ? "Нет профиля реферала"
        : rankPlaceRu(currentUser.rank)
      : "…";

  const gapRub =
    loadState === "ready" && currentUser && currentUser.rank != null && currentUser.rank > 5
      ? Math.max(0, Number(currentUser.gap_to_top_5) || 0)
      : 0;

  return (
    <div className="lk-simple-page">
      <div className="lk-dashboard">
        <section
          className="lk-dashboard__programs lk-dashboard__programs_catalog mini-game-rating__section"
          aria-labelledby="referral-rating-heading"
        >
          <h1 id="referral-rating-heading" className="lk-dashboard__programs-title">
            Рейтинг рефералов
          </h1>
          <p className="lk-dashboard__programs-lead">
            Сравнивайте результаты участников по подтверждённым продажам, заказам и активности.
          </p>

          <div
            className="mini-game-rating__period"
            role="tablist"
            aria-label="Период рейтинга"
          >
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                id={`referral-rating-period-${opt.id}`}
                aria-selected={period === opt.id}
                tabIndex={period === opt.id ? 0 : -1}
                disabled={loadState === "loading"}
                className={`mini-game-rating__period-btn${period === opt.id ? " mini-game-rating__period-btn--active" : ""}`}
                onClick={() => setPeriod(opt.id)}
              >
                {opt.label}
              </button>
            ))}
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
            <div className="mini-game-rating__me-card">
              <p className="mini-game-rating__me-label">Ваша позиция</p>
              <p className="mini-game-rating__me-rank">{meRankText}</p>
              <ul className="mini-game-rating__me-stats">
                <li>
                  <span className="mini-game-rating__me-stat-value">{formatRub(currentUser.sales_amount)}</span>
                  <span className="mini-game-rating__me-stat-label"> продаж</span>
                </li>
                <li>
                  <span className="mini-game-rating__me-stat-value">{ordersCountRu(currentUser.paid_orders_count)}</span>
                </li>
                <li className="mini-game-rating__me-stats-league">
                  Лига:{" "}
                  <span className="mini-game-rating__me-league">{leagueLabelRu(currentUser.league)}</span>
                </li>
              </ul>
              {currentUser.rank != null && currentUser.rank > 5 && gapRub > 0 ? (
                <p className="mini-game-rating__me-gap">
                  До топ-5 осталось {formatRub(gapRub)} продаж
                </p>
              ) : null}
              {currentUser.rank != null && currentUser.rank <= 5 ? (
                <p className="mini-game-rating__me-gap mini-game-rating__me-gap--in-top">
                  Вы в топ-5 по продажам за выбранный период.
                </p>
              ) : null}
            </div>
          ) : null}

          {loadState === "ready" && leaderboardEmpty ? (
            <p className="lk-dashboard__programs-muted mini-game-rating__empty-msg">
              Пока нет подтверждённых продаж за выбранный период.
            </p>
          ) : null}

          {loadState === "ready" && !leaderboardEmpty ? (
            <div className="mini-game-rating__table-scroll">
              <table className="mini-game-rating__table" aria-describedby="referral-rating-footnote">
                <caption className="mini-game-rating__caption">
                  Таблица рейтинга участников за выбранный период
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="mini-game-rating__th mini-game-rating__th--rank">
                      Место
                    </th>
                    <th scope="col" className="mini-game-rating__th mini-game-rating__th--name">
                      Участник
                    </th>
                    <th scope="col" className="mini-game-rating__th">
                      Лига
                    </th>
                    <th scope="col" className="mini-game-rating__th mini-game-rating__th--num">
                      Продажи
                    </th>
                    <th scope="col" className="mini-game-rating__th mini-game-rating__th--num">
                      Заказы
                    </th>
                    <th scope="col" className="mini-game-rating__th mini-game-rating__th--num">
                      XP
                    </th>
                    <th scope="col" className="mini-game-rating__th mini-game-rating__th--num">
                      Серия
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topFive.map((row) => (
                    <ReferralRatingRow
                      key={`${period}-${row.rank}-${row.name}`}
                      row={row}
                      rankClass={rankClassForTop(row.rank)}
                    />
                  ))}
                </tbody>
                {showPinnedUser ? (
                  <tbody className="mini-game-rating__tbody-gap">
                    <tr className="mini-game-rating__tr mini-game-rating__tr--omit">
                      <td colSpan={7} className="mini-game-rating__td mini-game-rating__td--omit">
                        …
                      </td>
                    </tr>
                  </tbody>
                ) : null}
                {showPinnedUser && userPinnedRow ? (
                  <tbody className="mini-game-rating__tbody-pinned">
                    <ReferralRatingRow row={userPinnedRow} rankClass="" />
                  </tbody>
                ) : null}
              </table>
            </div>
          ) : null}

          <p className="mini-game-rating__footnote" id="referral-rating-footnote">
            Позиция считается по сумме подтверждённых продаж за выбранный период. При равенстве учитывается количество
            оплаченных заказов.
          </p>
        </section>
      </div>
    </div>
  );
}
