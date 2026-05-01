import { Children, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "../bug/bug.css";
import "../dashboard/dashboard.css";
import "./blockBlastGame.css";
import "./miniGameProgress.css";
import "./miniGameLeagues.css";
import leagueStartBg from "../../../static/images/mini-game-league-start-bg.png";
import leagueBronzeBg from "../../../static/images/mini-game-league-bronze-bg.png";
import leagueSilverBg from "../../../static/images/mini-game-league-silver-bg.png";
import leagueGoldBg from "../../../static/images/mini-game-league-gold-bg.png";
import leaguePlatinumBg from "../../../static/images/mini-game-league-platinum-bg.png";
import leagueDiamondBg from "../../../static/images/mini-game-league-diamond-bg.png";
import leagueUltraBg from "../../../static/images/mini-game-league-ultra-bg.png";
import { fetchGamificationSummary } from "./gamificationApi";
import { ProgressDonut } from "./ProgressDonut";

/** Пока статически; позже — из API. id используется для стилей карточки прогресса. */
export const MINI_GAME_LEAGUES = [
  { id: "start", name: "Start" },
  { id: "bronze", name: "Bronze" },
  { id: "silver", name: "Silver" },
  { id: "gold", name: "Gold" },
  { id: "platinum", name: "Platinum" },
  { id: "diamond", name: "Diamond" },
  { id: "ultra", name: "Ultra" },
];

/** Группы для страницы «Лиги» — заголовки в стиле каталога программ. */
export const MINI_GAME_LEAGUE_SECTIONS = [
  { id: "base", title: "Базовые лиги", leagueIds: ["start", "bronze", "silver"] },
  { id: "advanced", title: "Продвинутые лиги", leagueIds: ["gold", "platinum"] },
  { id: "elite", title: "Элитные лиги", leagueIds: ["diamond", "ultra"] },
];

/** Индекс лиги в MINI_GAME_LEAGUES: start=0 … ultra=6. */
export function getCurrentLeagueIndexFromSummary(summary) {
  const id = summary?.profile?.league_id ?? "start";
  const idx = MINI_GAME_LEAGUES.findIndex((l) => l.id === id);
  return idx >= 0 ? idx : 0;
}

/** Контент лиги с индексом tierIndex (0…6) показывается без блокировки, если tierIndex ≤ текущая + 1. */
export function isLeagueTierContentUnlocked(summary, tierIndex) {
  const cur = getCurrentLeagueIndexFromSummary(summary);
  return tierIndex <= cur + 1;
}

/** Цели перехода Start → Bronze; текущие продажи/заказы — опционально из summary.league_progress_to_bronze (API). */
export const BRONZE_LEAGUE_SALES_TARGET_RUB = 15000;
export const BRONZE_LEAGUE_ORDERS_TARGET = 3;
export const BRONZE_LEAGUE_STREAK_DAYS_TARGET = 3;

/** Цели перехода Bronze → Silver; опционально summary.league_progress_to_silver (API). */
export const SILVER_LEAGUE_SALES_TARGET_RUB = 75000;
export const SILVER_LEAGUE_ORDERS_TARGET = 10;
export const SILVER_LEAGUE_STREAK_DAYS_TARGET = 7;

/** Цели перехода Silver → Gold; опционально summary.league_progress_to_gold (API). */
export const GOLD_LEAGUE_SALES_TARGET_RUB = 500000;
export const GOLD_LEAGUE_ORDERS_TARGET = 50;
export const GOLD_LEAGUE_STREAK_DAYS_TARGET = 14;

/** Цели перехода Gold → Platinum; опционально summary.league_progress_to_platinum (API). */
export const PLATINUM_LEAGUE_SALES_TARGET_RUB = 1500000;
export const PLATINUM_LEAGUE_ORDERS_TARGET = 150;
export const PLATINUM_LEAGUE_STREAK_DAYS_TARGET = 30;

/** Цели перехода Platinum → Diamond; опционально summary.league_progress_to_diamond (API). */
export const DIAMOND_LEAGUE_SALES_TARGET_RUB = 5000000;
export const DIAMOND_LEAGUE_ORDERS_TARGET = 400;
export const DIAMOND_LEAGUE_STREAK_DAYS_TARGET = 45;

/** Цели перехода Diamond → Ultra; опционально summary.league_progress_to_ultra (API). */
export const ULTRA_LEAGUE_SALES_TARGET_RUB = 15000000;
export const ULTRA_LEAGUE_ORDERS_TARGET = 1000;
export const ULTRA_LEAGUE_STREAK_DAYS_TARGET = 60;

function parseOptionalNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Среднее по трём условиям перехода Start → Bronze (продажи, заказы, дни серии). */
export function computeBronzeTasksOverallPct(summary) {
  if (!summary || typeof summary !== "object") {
    return 0;
  }
  const profile = summary.profile ?? {};
  const lp = summary.league_progress_to_bronze ?? {};
  const salesCurrent = parseOptionalNonNegativeNumber(lp.referral_sales_rub) ?? 0;
  const ordersCurrent = parseOptionalNonNegativeNumber(lp.referral_orders_count) ?? 0;
  const streakDays = parseOptionalNonNegativeNumber(profile.streak_days) ?? 0;
  const salesPct = Math.min(100, (salesCurrent / BRONZE_LEAGUE_SALES_TARGET_RUB) * 100);
  const ordersPct = Math.min(100, (ordersCurrent / BRONZE_LEAGUE_ORDERS_TARGET) * 100);
  const streakPct = Math.min(100, (streakDays / BRONZE_LEAGUE_STREAK_DAYS_TARGET) * 100);
  return Math.min(100, Math.max(0, Math.round((salesPct + ordersPct + streakPct) / 3)));
}

/** Среднее по трём условиям перехода к лиге Silver (сумма продаж, заказы, серия активности). */
export function computeSilverTasksOverallPct(summary) {
  if (!summary || typeof summary !== "object") {
    return 0;
  }
  const profile = summary.profile ?? {};
  const lp = summary.league_progress_to_silver ?? {};
  const salesCurrent = parseOptionalNonNegativeNumber(lp.referral_sales_rub) ?? 0;
  const ordersCurrent = parseOptionalNonNegativeNumber(lp.referral_orders_count) ?? 0;
  const streakDays = parseOptionalNonNegativeNumber(profile.streak_days) ?? 0;
  const salesPct = Math.min(100, (salesCurrent / SILVER_LEAGUE_SALES_TARGET_RUB) * 100);
  const ordersPct = Math.min(100, (ordersCurrent / SILVER_LEAGUE_ORDERS_TARGET) * 100);
  const streakPct = Math.min(100, (streakDays / SILVER_LEAGUE_STREAK_DAYS_TARGET) * 100);
  return Math.min(100, Math.max(0, Math.round((salesPct + ordersPct + streakPct) / 3)));
}

/** Среднее по трём условиям перехода к лиге Gold. */
export function computeGoldTasksOverallPct(summary) {
  if (!summary || typeof summary !== "object") {
    return 0;
  }
  const profile = summary.profile ?? {};
  const lp = summary.league_progress_to_gold ?? {};
  const salesCurrent = parseOptionalNonNegativeNumber(lp.referral_sales_rub) ?? 0;
  const ordersCurrent = parseOptionalNonNegativeNumber(lp.referral_orders_count) ?? 0;
  const streakDays = parseOptionalNonNegativeNumber(profile.streak_days) ?? 0;
  const salesPct = Math.min(100, (salesCurrent / GOLD_LEAGUE_SALES_TARGET_RUB) * 100);
  const ordersPct = Math.min(100, (ordersCurrent / GOLD_LEAGUE_ORDERS_TARGET) * 100);
  const streakPct = Math.min(100, (streakDays / GOLD_LEAGUE_STREAK_DAYS_TARGET) * 100);
  return Math.min(100, Math.max(0, Math.round((salesPct + ordersPct + streakPct) / 3)));
}

/** Среднее по трём условиям перехода к лиге Platinum. */
export function computePlatinumTasksOverallPct(summary) {
  if (!summary || typeof summary !== "object") {
    return 0;
  }
  const profile = summary.profile ?? {};
  const lp = summary.league_progress_to_platinum ?? {};
  const salesCurrent = parseOptionalNonNegativeNumber(lp.referral_sales_rub) ?? 0;
  const ordersCurrent = parseOptionalNonNegativeNumber(lp.referral_orders_count) ?? 0;
  const streakDays = parseOptionalNonNegativeNumber(profile.streak_days) ?? 0;
  const salesPct = Math.min(100, (salesCurrent / PLATINUM_LEAGUE_SALES_TARGET_RUB) * 100);
  const ordersPct = Math.min(100, (ordersCurrent / PLATINUM_LEAGUE_ORDERS_TARGET) * 100);
  const streakPct = Math.min(100, (streakDays / PLATINUM_LEAGUE_STREAK_DAYS_TARGET) * 100);
  return Math.min(100, Math.max(0, Math.round((salesPct + ordersPct + streakPct) / 3)));
}

/** Среднее по трём условиям перехода к лиге Diamond. */
export function computeDiamondTasksOverallPct(summary) {
  if (!summary || typeof summary !== "object") {
    return 0;
  }
  const profile = summary.profile ?? {};
  const lp = summary.league_progress_to_diamond ?? {};
  const salesCurrent = parseOptionalNonNegativeNumber(lp.referral_sales_rub) ?? 0;
  const ordersCurrent = parseOptionalNonNegativeNumber(lp.referral_orders_count) ?? 0;
  const streakDays = parseOptionalNonNegativeNumber(profile.streak_days) ?? 0;
  const salesPct = Math.min(100, (salesCurrent / DIAMOND_LEAGUE_SALES_TARGET_RUB) * 100);
  const ordersPct = Math.min(100, (ordersCurrent / DIAMOND_LEAGUE_ORDERS_TARGET) * 100);
  const streakPct = Math.min(100, (streakDays / DIAMOND_LEAGUE_STREAK_DAYS_TARGET) * 100);
  return Math.min(100, Math.max(0, Math.round((salesPct + ordersPct + streakPct) / 3)));
}

/** Среднее по трём условиям перехода к лиге Ultra. */
export function computeUltraTasksOverallPct(summary) {
  if (!summary || typeof summary !== "object") {
    return 0;
  }
  const profile = summary.profile ?? {};
  const lp = summary.league_progress_to_ultra ?? {};
  const salesCurrent = parseOptionalNonNegativeNumber(lp.referral_sales_rub) ?? 0;
  const ordersCurrent = parseOptionalNonNegativeNumber(lp.referral_orders_count) ?? 0;
  const streakDays = parseOptionalNonNegativeNumber(profile.streak_days) ?? 0;
  const salesPct = Math.min(100, (salesCurrent / ULTRA_LEAGUE_SALES_TARGET_RUB) * 100);
  const ordersPct = Math.min(100, (ordersCurrent / ULTRA_LEAGUE_ORDERS_TARGET) * 100);
  const streakPct = Math.min(100, (streakDays / ULTRA_LEAGUE_STREAK_DAYS_TARGET) * 100);
  return Math.min(100, Math.max(0, Math.round((salesPct + ordersPct + streakPct) / 3)));
}

/** Слайдер «Условия» / «Награда» на всю ширину блока разблокировки (всегда, не только на узком экране). */
function MiniGameLeagueUnlockPair({ ariaLabel, children }) {
  const slides = Children.toArray(children);
  const [slideIndex, setSlideIndex] = useState(0);
  const panelCount = slides.length || 1;
  const trackStyle =
    panelCount > 0 ? { transform: `translate3d(-${(slideIndex * 100) / panelCount}%, 0, 0)` } : undefined;

  return (
    <div className="mini-game-leagues__unlock-pair" role="group" aria-label={ariaLabel}>
      <div className="mini-game-leagues__unlock-pair-stage">
        <div className="mini-game-leagues__unlock-pair-viewport">
          <div className="mini-game-leagues__unlock-pair-track" style={trackStyle}>
            {slides}
          </div>
        </div>
        <div className="mini-game-leagues__unlock-pair-sides">
          <button
            type="button"
            className="mini-game-leagues__unlock-pair-arrow mini-game-leagues__unlock-pair-arrow--prev"
            onClick={() => setSlideIndex(0)}
            disabled={slideIndex === 0}
            aria-label="Условия"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M15 6L9 12L15 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="mini-game-leagues__unlock-pair-arrow mini-game-leagues__unlock-pair-arrow--next"
            onClick={() => setSlideIndex(1)}
            disabled={slideIndex >= panelCount - 1}
            aria-label="Награда"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9 6L15 12L9 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <div className="mini-game-leagues__unlock-pair-dots-wrap">
          <div className="mini-game-leagues__unlock-pair-dots" role="tablist" aria-label="Слайд">
            <button
              type="button"
              role="tab"
              aria-selected={slideIndex === 0}
              className={`mini-game-leagues__unlock-pair-dot${slideIndex === 0 ? " mini-game-leagues__unlock-pair-dot--active" : ""}`}
              onClick={() => setSlideIndex(0)}
              aria-label="Условия"
            />
            <button
              type="button"
              role="tab"
              aria-selected={slideIndex === 1}
              className={`mini-game-leagues__unlock-pair-dot${slideIndex === 1 ? " mini-game-leagues__unlock-pair-dot--active" : ""}`}
              onClick={() => setSlideIndex(1)}
              aria-label="Награда"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function BronzeLeagueRequirementBar({ label, current, target, fractionSuffix, ariaLabel }) {
  const safeTarget = target > 0 ? target : 1;
  const cur = Math.max(0, Number(current) || 0);
  const fillPct = Math.min(100, Math.max(0, Math.round((cur / safeTarget) * 100)));
  const displayLeft = Math.min(cur, safeTarget);
  const ariaText =
    ariaLabel ||
    `${label}: ${displayLeft.toLocaleString("ru-RU")} из ${safeTarget.toLocaleString("ru-RU")}${fractionSuffix ?? ""}`;

  return (
    <li className="mini-game-leagues__bronze-req">
      <div className="mini-game-leagues__bronze-req-head">
        <span className="mini-game-leagues__bronze-req-label">{label}</span>
        <span className="mini-game-leagues__bronze-req-fraction">
          {displayLeft.toLocaleString("ru-RU")} / {safeTarget.toLocaleString("ru-RU")}
          {fractionSuffix ?? ""}
        </span>
      </div>
      <div
        className="block-blast-game__xp-bar mini-game-leagues__bronze-req-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fillPct}
        aria-valuetext={ariaText}
      >
        <div className="block-blast-game__xp-bar-fill" style={{ width: `${fillPct}%` }} />
      </div>
    </li>
  );
}

const LEAGUE_CARD_BG = {
  start: { cssVar: "--mini-game-league-start-bg", bg: leagueStartBg },
  bronze: { cssVar: "--mini-game-league-bronze-bg", bg: leagueBronzeBg },
  silver: { cssVar: "--mini-game-league-silver-bg", bg: leagueSilverBg },
  gold: { cssVar: "--mini-game-league-gold-bg", bg: leagueGoldBg },
  platinum: { cssVar: "--mini-game-league-platinum-bg", bg: leaguePlatinumBg },
  diamond: { cssVar: "--mini-game-league-diamond-bg", bg: leagueDiamondBg },
  ultra: { cssVar: "--mini-game-league-ultra-bg", bg: leagueUltraBg },
};

function MiniGameLeagueTierCard({ league }) {
  const meta = LEAGUE_CARD_BG[league.id];
  if (!meta) {
    return null;
  }
  const style = { [meta.cssVar]: `url(${meta.bg})` };
  const caption = league.id === "start" ? "Текущая лига" : "Лига челленджа";
  return (
    <article
      className={`block-blast-game__profile-card mini-game-progress__league-card mini-game-progress__league-card--${league.id}`}
      style={style}
    >
      <h4 className="block-blast-game__profile-card-label">Лига</h4>
      <p className="mini-game-progress__league-name">{league.name}</p>
      <p className="mini-game-progress__league-caption">{caption}</p>
    </article>
  );
}

function MiniGameLeaguesLockGlyph({ className }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 11V8a5 5 0 0 1 10 0v3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="5"
        y="11"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle cx="12" cy="16" r="1.25" fill="currentColor" />
    </svg>
  );
}

/** Unlock / tier: обёртка с blur. Donut — без лишней оболочки: только слой + скрим внутри `article`. */
function MiniGameLeaguesLockedBlurShell({ variant, children }) {
  const mod =
    variant === "unlock" ? "mini-game-leagues__locked-blur--unlock" : "mini-game-leagues__locked-blur--tier";
  return (
    <div className={`mini-game-leagues__locked-blur ${mod}`} role="presentation" aria-hidden="true">
      <div className="mini-game-leagues__locked-blur-source">{children}</div>
      <div className="mini-game-leagues__locked-blur-scrim">
        <MiniGameLeaguesLockGlyph className="mini-game-leagues__locked-blur-icon" />
        <p className="mini-game-leagues__locked-blur-text">Содержимое откроется по мере продвижения по лигам.</p>
      </div>
    </div>
  );
}

function MiniGameLeaguesDonutLockedLayers({ children }) {
  return (
    <>
      <div className="mini-game-leagues__donut-locked-layer">{children}</div>
      <div className="mini-game-leagues__donut-locked-scrim" aria-hidden="true">
        <MiniGameLeaguesLockGlyph className="mini-game-leagues__donut-locked-icon" />
        <p className="mini-game-leagues__donut-locked-text">Содержимое откроется по мере продвижения по лигам.</p>
      </div>
    </>
  );
}

function MiniGameLeaguesCatalogSectionHeadingFullbleed({ section, locked }) {
  if (!section) {
    return null;
  }
  const headingId = `mini-game-leagues-section-${section.id}`;
  const count = section.leagueIds?.length ?? 0;
  return (
    <div
      className={`mini-game-leagues__catalog-section-heading-fullbleed mini-game-leagues__catalog-section-heading-fullbleed--${section.id} lk-dashboard__programs_catalog${
        locked ? " mini-game-leagues__catalog-section-heading-fullbleed--locked" : ""
      }`}
    >
      <div
        className="lk-dashboard__programs-catalog-section-title"
        data-testid={`mini-game-leagues-section-title-${section.id}`}
      >
        <h2 id={headingId} className="lk-dashboard__programs-catalog-section-heading">
          {section.title}{" "}
          <span className="lk-dashboard__programs-catalog-section-count">{count}</span>
        </h2>
      </div>
    </div>
  );
}

function MiniGameLeagueBronzeUnlockCard({ summary }) {
  const profile = summary?.profile ?? {};
  const lp = summary?.league_progress_to_bronze ?? {};
  const salesRaw = parseOptionalNonNegativeNumber(lp.referral_sales_rub);
  const ordersRaw = parseOptionalNonNegativeNumber(lp.referral_orders_count);
  const salesCurrent = salesRaw ?? 0;
  const ordersCurrent = ordersRaw ?? 0;
  const streakDaysRaw = parseOptionalNonNegativeNumber(profile.streak_days);
  const streakDays = streakDaysRaw ?? 0;

  return (
    <MiniGameLeagueUnlockPair ariaLabel="Переход в Bronze: условия и награды">
      <aside
        className="block-blast-game__profile-card mini-game-leagues__bronze-unlock-card"
        aria-labelledby="mini-game-leagues-bronze-requirements-title"
      >
        <h3 className="mini-game-leagues__bronze-unlock-card-title" id="mini-game-leagues-bronze-requirements-title">
          Условия
        </h3>
        <div className="mini-game-leagues__bronze-req-wrap">
          <div className="mini-game-leagues__bronze-req-headers" aria-hidden="true">
            <span>Условие</span>
            <span>Прогресс</span>
          </div>
          <ul className="mini-game-leagues__bronze-req-list">
            <BronzeLeagueRequirementBar
              label="Продажи от лица реферала"
              current={salesCurrent}
              target={BRONZE_LEAGUE_SALES_TARGET_RUB}
              fractionSuffix=" ₽"
              ariaLabel={`Продажи по рефералам: ${salesCurrent.toLocaleString("ru-RU")} из ${BRONZE_LEAGUE_SALES_TARGET_RUB.toLocaleString("ru-RU")} ₽`}
            />
            <BronzeLeagueRequirementBar
              label="Заказы"
              current={ordersCurrent}
              target={BRONZE_LEAGUE_ORDERS_TARGET}
              ariaLabel={`Заказы: ${Math.min(ordersCurrent, BRONZE_LEAGUE_ORDERS_TARGET).toLocaleString("ru-RU")} из ${BRONZE_LEAGUE_ORDERS_TARGET.toLocaleString("ru-RU")}`}
            />
            <BronzeLeagueRequirementBar
              label="Дни серии"
              current={streakDays}
              target={BRONZE_LEAGUE_STREAK_DAYS_TARGET}
              ariaLabel={`Дни серии для лиги: ${Math.min(streakDays, BRONZE_LEAGUE_STREAK_DAYS_TARGET).toLocaleString("ru-RU")} из ${BRONZE_LEAGUE_STREAK_DAYS_TARGET.toLocaleString("ru-RU")}`}
            />
          </ul>
        </div>
      </aside>
      <aside
        className="block-blast-game__profile-card mini-game-leagues__bronze-unlock-card"
        aria-labelledby="mini-game-leagues-bronze-reward-title"
      >
        <h3 className="mini-game-leagues__bronze-unlock-card-title" id="mini-game-leagues-bronze-reward-title">
          Награда
        </h3>
        <div className="mini-game-leagues__bronze-reward-table-wrap">
          <table
            className="mini-game-leagues__bronze-reward-table"
            aria-labelledby="mini-game-leagues-bronze-reward-title"
          >
            <thead>
              <tr>
                <th className="mini-game-leagues__bronze-reward-table-corner" scope="col">
                  <span className="mini-game-leagues__bronze-reward-table-sr">Показатель</span>
                </th>
                <th scope="col">Сейчас</th>
                <th scope="col">После</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Комиссия</th>
                <td className="mini-game-leagues__bronze-reward-now">без надбавки</td>
                <td className="mini-game-leagues__bronze-reward-after">+0,25% к получаемой комиссии</td>
              </tr>
              <tr>
                <th scope="row">Бейдж</th>
                <td className="mini-game-leagues__bronze-reward-now">нет</td>
                <td className="mini-game-leagues__bronze-reward-after">бронзовый</td>
              </tr>
              <tr>
                <th scope="row">Опыт в мини-игре</th>
                <td className="mini-game-leagues__bronze-reward-now">×1</td>
                <td className="mini-game-leagues__bronze-reward-after">×1,1</td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>
    </MiniGameLeagueUnlockPair>
  );
}

function MiniGameLeagueSilverUnlockCard({ summary }) {
  const profile = summary?.profile ?? {};
  const lp = summary?.league_progress_to_silver ?? {};
  const salesRaw = parseOptionalNonNegativeNumber(lp.referral_sales_rub);
  const ordersRaw = parseOptionalNonNegativeNumber(lp.referral_orders_count);
  const salesCurrent = salesRaw ?? 0;
  const ordersCurrent = ordersRaw ?? 0;
  const streakDaysRaw = parseOptionalNonNegativeNumber(profile.streak_days);
  const streakDays = streakDaysRaw ?? 0;

  return (
    <MiniGameLeagueUnlockPair ariaLabel="Переход в Silver: условия и награды">
      <aside
        className="block-blast-game__profile-card mini-game-leagues__bronze-unlock-card"
        aria-labelledby="mini-game-leagues-silver-requirements-title"
      >
        <h3 className="mini-game-leagues__bronze-unlock-card-title" id="mini-game-leagues-silver-requirements-title">
          Условия
        </h3>
        <div className="mini-game-leagues__bronze-req-wrap">
          <div className="mini-game-leagues__bronze-req-headers" aria-hidden="true">
            <span>Условие</span>
            <span>Прогресс</span>
          </div>
          <ul className="mini-game-leagues__bronze-req-list">
            <BronzeLeagueRequirementBar
              label="Сумма продаж"
              current={salesCurrent}
              target={SILVER_LEAGUE_SALES_TARGET_RUB}
              fractionSuffix=" ₽"
              ariaLabel={`Сумма продаж: ${salesCurrent.toLocaleString("ru-RU")} из ${SILVER_LEAGUE_SALES_TARGET_RUB.toLocaleString("ru-RU")} ₽`}
            />
            <BronzeLeagueRequirementBar
              label="Оплаченные заказы"
              current={ordersCurrent}
              target={SILVER_LEAGUE_ORDERS_TARGET}
              ariaLabel={`Оплаченные заказы: ${Math.min(ordersCurrent, SILVER_LEAGUE_ORDERS_TARGET).toLocaleString("ru-RU")} из ${SILVER_LEAGUE_ORDERS_TARGET.toLocaleString("ru-RU")}`}
            />
            <BronzeLeagueRequirementBar
              label="Серия активности"
              current={streakDays}
              target={SILVER_LEAGUE_STREAK_DAYS_TARGET}
              fractionSuffix=" дней"
              ariaLabel={`Серия активности: ${Math.min(streakDays, SILVER_LEAGUE_STREAK_DAYS_TARGET).toLocaleString("ru-RU")} из ${SILVER_LEAGUE_STREAK_DAYS_TARGET.toLocaleString("ru-RU")} дней`}
            />
          </ul>
        </div>
      </aside>
      <aside
        className="block-blast-game__profile-card mini-game-leagues__bronze-unlock-card"
        aria-labelledby="mini-game-leagues-silver-reward-title"
      >
        <h3 className="mini-game-leagues__bronze-unlock-card-title" id="mini-game-leagues-silver-reward-title">
          Награда
        </h3>
        <div className="mini-game-leagues__bronze-reward-table-wrap">
          <table
            className="mini-game-leagues__bronze-reward-table"
            aria-labelledby="mini-game-leagues-silver-reward-title"
          >
            <thead>
              <tr>
                <th className="mini-game-leagues__bronze-reward-table-corner" scope="col">
                  <span className="mini-game-leagues__bronze-reward-table-sr">Показатель</span>
                </th>
                <th scope="col">Сейчас</th>
                <th scope="col">После</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Бонус</th>
                <td className="mini-game-leagues__bronze-reward-now">+0,25% к получаемой комиссии</td>
                <td className="mini-game-leagues__bronze-reward-after">+0,5% к бонусу</td>
              </tr>
              <tr>
                <th scope="row">Бейдж</th>
                <td className="mini-game-leagues__bronze-reward-now">бронзовый</td>
                <td className="mini-game-leagues__bronze-reward-after">Серебряный бейдж в рейтинге</td>
              </tr>
              <tr>
                <th scope="row">XP за активность</th>
                <td className="mini-game-leagues__bronze-reward-now">×1,1</td>
                <td className="mini-game-leagues__bronze-reward-after">×1,2 XP за активность</td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>
    </MiniGameLeagueUnlockPair>
  );
}

function MiniGameLeagueGoldUnlockCard({ summary }) {
  const profile = summary?.profile ?? {};
  const lp = summary?.league_progress_to_gold ?? {};
  const salesRaw = parseOptionalNonNegativeNumber(lp.referral_sales_rub);
  const ordersRaw = parseOptionalNonNegativeNumber(lp.referral_orders_count);
  const salesCurrent = salesRaw ?? 0;
  const ordersCurrent = ordersRaw ?? 0;
  const streakDaysRaw = parseOptionalNonNegativeNumber(profile.streak_days);
  const streakDays = streakDaysRaw ?? 0;

  return (
    <MiniGameLeagueUnlockPair ariaLabel="Переход в Gold: условия и награды">
      <aside
        className="block-blast-game__profile-card mini-game-leagues__bronze-unlock-card"
        aria-labelledby="mini-game-leagues-gold-requirements-title"
      >
        <h3 className="mini-game-leagues__bronze-unlock-card-title" id="mini-game-leagues-gold-requirements-title">
          Условия
        </h3>
        <div className="mini-game-leagues__bronze-req-wrap">
          <div className="mini-game-leagues__bronze-req-headers" aria-hidden="true">
            <span>Условие</span>
            <span>Прогресс</span>
          </div>
          <ul className="mini-game-leagues__bronze-req-list">
            <BronzeLeagueRequirementBar
              label="Сумма продаж"
              current={salesCurrent}
              target={GOLD_LEAGUE_SALES_TARGET_RUB}
              fractionSuffix=" ₽"
              ariaLabel={`Сумма продаж: ${salesCurrent.toLocaleString("ru-RU")} из ${GOLD_LEAGUE_SALES_TARGET_RUB.toLocaleString("ru-RU")} ₽`}
            />
            <BronzeLeagueRequirementBar
              label="Оплаченные заказы"
              current={ordersCurrent}
              target={GOLD_LEAGUE_ORDERS_TARGET}
              ariaLabel={`Оплаченные заказы: ${Math.min(ordersCurrent, GOLD_LEAGUE_ORDERS_TARGET).toLocaleString("ru-RU")} из ${GOLD_LEAGUE_ORDERS_TARGET.toLocaleString("ru-RU")}`}
            />
            <BronzeLeagueRequirementBar
              label="Серия активности"
              current={streakDays}
              target={GOLD_LEAGUE_STREAK_DAYS_TARGET}
              fractionSuffix=" дней"
              ariaLabel={`Серия активности: ${Math.min(streakDays, GOLD_LEAGUE_STREAK_DAYS_TARGET).toLocaleString("ru-RU")} из ${GOLD_LEAGUE_STREAK_DAYS_TARGET.toLocaleString("ru-RU")} дней`}
            />
          </ul>
        </div>
      </aside>
      <aside
        className="block-blast-game__profile-card mini-game-leagues__bronze-unlock-card"
        aria-labelledby="mini-game-leagues-gold-reward-title"
      >
        <h3 className="mini-game-leagues__bronze-unlock-card-title" id="mini-game-leagues-gold-reward-title">
          Награда
        </h3>
        <div className="mini-game-leagues__bronze-reward-table-wrap">
          <table
            className="mini-game-leagues__bronze-reward-table"
            aria-labelledby="mini-game-leagues-gold-reward-title"
          >
            <thead>
              <tr>
                <th className="mini-game-leagues__bronze-reward-table-corner" scope="col">
                  <span className="mini-game-leagues__bronze-reward-table-sr">Показатель</span>
                </th>
                <th scope="col">Сейчас</th>
                <th scope="col">После</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Бонус</th>
                <td className="mini-game-leagues__bronze-reward-now">+0,5% к бонусу</td>
                <td className="mini-game-leagues__bronze-reward-after">+1% к бонусу</td>
              </tr>
              <tr>
                <th scope="row">Бейдж</th>
                <td className="mini-game-leagues__bronze-reward-now">Серебряный бейдж в рейтинге</td>
                <td className="mini-game-leagues__bronze-reward-after">Золотой бейдж в рейтинге</td>
              </tr>
              <tr>
                <th scope="row">XP за активность</th>
                <td className="mini-game-leagues__bronze-reward-now">×1,2 XP за активность</td>
                <td className="mini-game-leagues__bronze-reward-after">×1,35 XP за активность</td>
              </tr>
              <tr>
                <th scope="row">Приоритет</th>
                <td className="mini-game-leagues__bronze-reward-now">нет</td>
                <td className="mini-game-leagues__bronze-reward-after">Приоритет в рейтинге</td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>
    </MiniGameLeagueUnlockPair>
  );
}

function MiniGameLeaguePlatinumUnlockCard({ summary }) {
  const profile = summary?.profile ?? {};
  const lp = summary?.league_progress_to_platinum ?? {};
  const salesRaw = parseOptionalNonNegativeNumber(lp.referral_sales_rub);
  const ordersRaw = parseOptionalNonNegativeNumber(lp.referral_orders_count);
  const salesCurrent = salesRaw ?? 0;
  const ordersCurrent = ordersRaw ?? 0;
  const streakDaysRaw = parseOptionalNonNegativeNumber(profile.streak_days);
  const streakDays = streakDaysRaw ?? 0;

  return (
    <MiniGameLeagueUnlockPair ariaLabel="Переход в Platinum: условия и награды">
      <aside
        className="block-blast-game__profile-card mini-game-leagues__bronze-unlock-card"
        aria-labelledby="mini-game-leagues-platinum-requirements-title"
      >
        <h3 className="mini-game-leagues__bronze-unlock-card-title" id="mini-game-leagues-platinum-requirements-title">
          Условия
        </h3>
        <div className="mini-game-leagues__bronze-req-wrap">
          <div className="mini-game-leagues__bronze-req-headers" aria-hidden="true">
            <span>Условие</span>
            <span>Прогресс</span>
          </div>
          <ul className="mini-game-leagues__bronze-req-list">
            <BronzeLeagueRequirementBar
              label="Сумма продаж"
              current={salesCurrent}
              target={PLATINUM_LEAGUE_SALES_TARGET_RUB}
              fractionSuffix=" ₽"
              ariaLabel={`Сумма продаж: ${salesCurrent.toLocaleString("ru-RU")} из ${PLATINUM_LEAGUE_SALES_TARGET_RUB.toLocaleString("ru-RU")} ₽`}
            />
            <BronzeLeagueRequirementBar
              label="Оплаченные заказы"
              current={ordersCurrent}
              target={PLATINUM_LEAGUE_ORDERS_TARGET}
              ariaLabel={`Оплаченные заказы: ${Math.min(ordersCurrent, PLATINUM_LEAGUE_ORDERS_TARGET).toLocaleString("ru-RU")} из ${PLATINUM_LEAGUE_ORDERS_TARGET.toLocaleString("ru-RU")}`}
            />
            <BronzeLeagueRequirementBar
              label="Серия активности"
              current={streakDays}
              target={PLATINUM_LEAGUE_STREAK_DAYS_TARGET}
              fractionSuffix=" дней"
              ariaLabel={`Серия активности: ${Math.min(streakDays, PLATINUM_LEAGUE_STREAK_DAYS_TARGET).toLocaleString("ru-RU")} из ${PLATINUM_LEAGUE_STREAK_DAYS_TARGET.toLocaleString("ru-RU")} дней`}
            />
          </ul>
        </div>
      </aside>
      <aside
        className="block-blast-game__profile-card mini-game-leagues__bronze-unlock-card"
        aria-labelledby="mini-game-leagues-platinum-reward-title"
      >
        <h3 className="mini-game-leagues__bronze-unlock-card-title" id="mini-game-leagues-platinum-reward-title">
          Награда
        </h3>
        <div className="mini-game-leagues__bronze-reward-table-wrap">
          <table
            className="mini-game-leagues__bronze-reward-table"
            aria-labelledby="mini-game-leagues-platinum-reward-title"
          >
            <thead>
              <tr>
                <th className="mini-game-leagues__bronze-reward-table-corner" scope="col">
                  <span className="mini-game-leagues__bronze-reward-table-sr">Показатель</span>
                </th>
                <th scope="col">Сейчас</th>
                <th scope="col">После</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Бонус</th>
                <td className="mini-game-leagues__bronze-reward-now">+1% к бонусу</td>
                <td className="mini-game-leagues__bronze-reward-after">+1,5% к бонусу</td>
              </tr>
              <tr>
                <th scope="row">Бейдж</th>
                <td className="mini-game-leagues__bronze-reward-now">Золотой бейдж в рейтинге</td>
                <td className="mini-game-leagues__bronze-reward-after">Платиновый бейдж в рейтинге</td>
              </tr>
              <tr>
                <th scope="row">XP за активность</th>
                <td className="mini-game-leagues__bronze-reward-now">×1,35 XP за активность</td>
                <td className="mini-game-leagues__bronze-reward-after">×1,5 XP за активность</td>
              </tr>
              <tr>
                <th scope="row">Аналитика</th>
                <td className="mini-game-leagues__bronze-reward-now">нет</td>
                <td className="mini-game-leagues__bronze-reward-after">Расширенная аналитика</td>
              </tr>
              <tr>
                <th scope="row">Программы</th>
                <td className="mini-game-leagues__bronze-reward-now">нет</td>
                <td className="mini-game-leagues__bronze-reward-after">Приоритетный статус в программах</td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>
    </MiniGameLeagueUnlockPair>
  );
}

function MiniGameLeagueDiamondUnlockCard({ summary }) {
  const profile = summary?.profile ?? {};
  const lp = summary?.league_progress_to_diamond ?? {};
  const salesRaw = parseOptionalNonNegativeNumber(lp.referral_sales_rub);
  const ordersRaw = parseOptionalNonNegativeNumber(lp.referral_orders_count);
  const salesCurrent = salesRaw ?? 0;
  const ordersCurrent = ordersRaw ?? 0;
  const streakDaysRaw = parseOptionalNonNegativeNumber(profile.streak_days);
  const streakDays = streakDaysRaw ?? 0;

  return (
    <MiniGameLeagueUnlockPair ariaLabel="Переход в Diamond: условия и награды">
      <aside
        className="block-blast-game__profile-card mini-game-leagues__bronze-unlock-card"
        aria-labelledby="mini-game-leagues-diamond-requirements-title"
      >
        <h3 className="mini-game-leagues__bronze-unlock-card-title" id="mini-game-leagues-diamond-requirements-title">
          Условия
        </h3>
        <div className="mini-game-leagues__bronze-req-wrap">
          <div className="mini-game-leagues__bronze-req-headers" aria-hidden="true">
            <span>Условие</span>
            <span>Прогресс</span>
          </div>
          <ul className="mini-game-leagues__bronze-req-list">
            <BronzeLeagueRequirementBar
              label="Сумма продаж"
              current={salesCurrent}
              target={DIAMOND_LEAGUE_SALES_TARGET_RUB}
              fractionSuffix=" ₽"
              ariaLabel={`Сумма продаж: ${salesCurrent.toLocaleString("ru-RU")} из ${DIAMOND_LEAGUE_SALES_TARGET_RUB.toLocaleString("ru-RU")} ₽`}
            />
            <BronzeLeagueRequirementBar
              label="Оплаченные заказы"
              current={ordersCurrent}
              target={DIAMOND_LEAGUE_ORDERS_TARGET}
              ariaLabel={`Оплаченные заказы: ${Math.min(ordersCurrent, DIAMOND_LEAGUE_ORDERS_TARGET).toLocaleString("ru-RU")} из ${DIAMOND_LEAGUE_ORDERS_TARGET.toLocaleString("ru-RU")}`}
            />
            <BronzeLeagueRequirementBar
              label="Серия активности"
              current={streakDays}
              target={DIAMOND_LEAGUE_STREAK_DAYS_TARGET}
              fractionSuffix=" дней"
              ariaLabel={`Серия активности: ${Math.min(streakDays, DIAMOND_LEAGUE_STREAK_DAYS_TARGET).toLocaleString("ru-RU")} из ${DIAMOND_LEAGUE_STREAK_DAYS_TARGET.toLocaleString("ru-RU")} дней`}
            />
          </ul>
        </div>
      </aside>
      <aside
        className="block-blast-game__profile-card mini-game-leagues__bronze-unlock-card"
        aria-labelledby="mini-game-leagues-diamond-reward-title"
      >
        <h3 className="mini-game-leagues__bronze-unlock-card-title" id="mini-game-leagues-diamond-reward-title">
          Награда
        </h3>
        <div className="mini-game-leagues__bronze-reward-table-wrap">
          <table
            className="mini-game-leagues__bronze-reward-table"
            aria-labelledby="mini-game-leagues-diamond-reward-title"
          >
            <thead>
              <tr>
                <th className="mini-game-leagues__bronze-reward-table-corner" scope="col">
                  <span className="mini-game-leagues__bronze-reward-table-sr">Показатель</span>
                </th>
                <th scope="col">Сейчас</th>
                <th scope="col">После</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Бонус</th>
                <td className="mini-game-leagues__bronze-reward-now">+1,5% к бонусу</td>
                <td className="mini-game-leagues__bronze-reward-after">+2% к бонусу</td>
              </tr>
              <tr>
                <th scope="row">Бейдж</th>
                <td className="mini-game-leagues__bronze-reward-now">Платиновый бейдж в рейтинге</td>
                <td className="mini-game-leagues__bronze-reward-after">Алмазный бейдж в рейтинге</td>
              </tr>
              <tr>
                <th scope="row">XP за активность</th>
                <td className="mini-game-leagues__bronze-reward-now">×1,5 XP за активность</td>
                <td className="mini-game-leagues__bronze-reward-after">×1,75 XP за активность</td>
              </tr>
              <tr>
                <th scope="row">Рейтинг</th>
                <td className="mini-game-leagues__bronze-reward-now">Приоритет в рейтинге</td>
                <td className="mini-game-leagues__bronze-reward-after">Приоритетное размещение в рейтинге</td>
              </tr>
              <tr>
                <th scope="row">Аналитика</th>
                <td className="mini-game-leagues__bronze-reward-now">Расширенная аналитика</td>
                <td className="mini-game-leagues__bronze-reward-after">Расширенная аналитика по продажам</td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>
    </MiniGameLeagueUnlockPair>
  );
}

function MiniGameLeagueUltraUnlockCard({ summary }) {
  const profile = summary?.profile ?? {};
  const lp = summary?.league_progress_to_ultra ?? {};
  const salesRaw = parseOptionalNonNegativeNumber(lp.referral_sales_rub);
  const ordersRaw = parseOptionalNonNegativeNumber(lp.referral_orders_count);
  const salesCurrent = salesRaw ?? 0;
  const ordersCurrent = ordersRaw ?? 0;
  const streakDaysRaw = parseOptionalNonNegativeNumber(profile.streak_days);
  const streakDays = streakDaysRaw ?? 0;

  return (
    <MiniGameLeagueUnlockPair ariaLabel="Переход в Ultra: условия и награды">
      <aside
        className="block-blast-game__profile-card mini-game-leagues__bronze-unlock-card"
        aria-labelledby="mini-game-leagues-ultra-requirements-title"
      >
        <h3 className="mini-game-leagues__bronze-unlock-card-title" id="mini-game-leagues-ultra-requirements-title">
          Условия
        </h3>
        <div className="mini-game-leagues__bronze-req-wrap">
          <div className="mini-game-leagues__bronze-req-headers" aria-hidden="true">
            <span>Условие</span>
            <span>Прогресс</span>
          </div>
          <ul className="mini-game-leagues__bronze-req-list">
            <BronzeLeagueRequirementBar
              label="Сумма продаж"
              current={salesCurrent}
              target={ULTRA_LEAGUE_SALES_TARGET_RUB}
              fractionSuffix=" ₽"
              ariaLabel={`Сумма продаж: ${salesCurrent.toLocaleString("ru-RU")} из ${ULTRA_LEAGUE_SALES_TARGET_RUB.toLocaleString("ru-RU")} ₽`}
            />
            <BronzeLeagueRequirementBar
              label="Оплаченные заказы"
              current={ordersCurrent}
              target={ULTRA_LEAGUE_ORDERS_TARGET}
              ariaLabel={`Оплаченные заказы: ${Math.min(ordersCurrent, ULTRA_LEAGUE_ORDERS_TARGET).toLocaleString("ru-RU")} из ${ULTRA_LEAGUE_ORDERS_TARGET.toLocaleString("ru-RU")}`}
            />
            <BronzeLeagueRequirementBar
              label="Серия активности"
              current={streakDays}
              target={ULTRA_LEAGUE_STREAK_DAYS_TARGET}
              fractionSuffix=" дней"
              ariaLabel={`Серия активности: ${Math.min(streakDays, ULTRA_LEAGUE_STREAK_DAYS_TARGET).toLocaleString("ru-RU")} из ${ULTRA_LEAGUE_STREAK_DAYS_TARGET.toLocaleString("ru-RU")} дней`}
            />
          </ul>
        </div>
      </aside>
      <aside
        className="block-blast-game__profile-card mini-game-leagues__bronze-unlock-card"
        aria-labelledby="mini-game-leagues-ultra-reward-title"
      >
        <h3 className="mini-game-leagues__bronze-unlock-card-title" id="mini-game-leagues-ultra-reward-title">
          Награда
        </h3>
        <div className="mini-game-leagues__bronze-reward-table-wrap">
          <table
            className="mini-game-leagues__bronze-reward-table"
            aria-labelledby="mini-game-leagues-ultra-reward-title"
          >
            <thead>
              <tr>
                <th className="mini-game-leagues__bronze-reward-table-corner" scope="col">
                  <span className="mini-game-leagues__bronze-reward-table-sr">Показатель</span>
                </th>
                <th scope="col">Сейчас</th>
                <th scope="col">После</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Бонус</th>
                <td className="mini-game-leagues__bronze-reward-now">+2% к бонусу</td>
                <td className="mini-game-leagues__bronze-reward-after">+3% к бонусу</td>
              </tr>
              <tr>
                <th scope="row">Бейдж</th>
                <td className="mini-game-leagues__bronze-reward-now">Алмазный бейдж в рейтинге</td>
                <td className="mini-game-leagues__bronze-reward-after">Чёрный Ultra-бейдж в рейтинге</td>
              </tr>
              <tr>
                <th scope="row">XP за активность</th>
                <td className="mini-game-leagues__bronze-reward-now">×1,75 XP за активность</td>
                <td className="mini-game-leagues__bronze-reward-after">×2 XP за активность</td>
              </tr>
              <tr>
                <th scope="row">Рейтинг</th>
                <td className="mini-game-leagues__bronze-reward-now">Приоритетное размещение в рейтинге</td>
                <td className="mini-game-leagues__bronze-reward-after">Максимальный приоритет в рейтинге</td>
              </tr>
              <tr>
                <th scope="row">Аналитика</th>
                <td className="mini-game-leagues__bronze-reward-now">Расширенная аналитика по продажам</td>
                <td className="mini-game-leagues__bronze-reward-after">
                  Расширенная аналитика и персональные условия
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>
    </MiniGameLeagueUnlockPair>
  );
}

/** Условия и награды для перехода в лигу `targetLeagueId` — те же карточки, что на странице «Лиги». */
export function MiniGameLeagueUnlockCardForTargetLeague({ summary, targetLeagueId }) {
  switch (targetLeagueId) {
    case "bronze":
      return <MiniGameLeagueBronzeUnlockCard summary={summary} />;
    case "silver":
      return <MiniGameLeagueSilverUnlockCard summary={summary} />;
    case "gold":
      return <MiniGameLeagueGoldUnlockCard summary={summary} />;
    case "platinum":
      return <MiniGameLeaguePlatinumUnlockCard summary={summary} />;
    case "diamond":
      return <MiniGameLeagueDiamondUnlockCard summary={summary} />;
    case "ultra":
      return <MiniGameLeagueUltraUnlockCard summary={summary} />;
    default:
      return null;
  }
}

export default function MiniGameLeaguesPage() {
  const [gamificationSummary, setGamificationSummary] = useState(null);
  const [summaryLoadState, setSummaryLoadState] = useState("loading");
  const [summaryError, setSummaryError] = useState(null);

  const loadGamificationSummary = useCallback(async () => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
    if (!token) {
      setSummaryLoadState("error");
      setSummaryError("no_token");
      return;
    }
    setSummaryLoadState("loading");
    setSummaryError(null);
    try {
      const data = await fetchGamificationSummary(token);
      setGamificationSummary(data);
      setSummaryLoadState("ready");
    } catch (e) {
      setSummaryLoadState("error");
      setSummaryError(e?.message || "fetch_failed");
    }
  }, []);

  useEffect(() => {
    loadGamificationSummary();
  }, [loadGamificationSummary]);

  const bronzeTasksPct =
    summaryLoadState === "ready" ? computeBronzeTasksOverallPct(gamificationSummary) : 0;
  const silverTasksPct =
    summaryLoadState === "ready" ? computeSilverTasksOverallPct(gamificationSummary) : 0;
  const goldTasksPct =
    summaryLoadState === "ready" ? computeGoldTasksOverallPct(gamificationSummary) : 0;
  const platinumTasksPct =
    summaryLoadState === "ready" ? computePlatinumTasksOverallPct(gamificationSummary) : 0;
  const diamondTasksPct =
    summaryLoadState === "ready" ? computeDiamondTasksOverallPct(gamificationSummary) : 0;
  const ultraTasksPct =
    summaryLoadState === "ready" ? computeUltraTasksOverallPct(gamificationSummary) : 0;
  const startLeague = MINI_GAME_LEAGUES.find((l) => l.id === "start");
  const bronzeLeague = MINI_GAME_LEAGUES.find((l) => l.id === "bronze");
  const silverLeague = MINI_GAME_LEAGUES.find((l) => l.id === "silver");
  const goldLeague = MINI_GAME_LEAGUES.find((l) => l.id === "gold");
  const platinumLeague = MINI_GAME_LEAGUES.find((l) => l.id === "platinum");
  const diamondLeague = MINI_GAME_LEAGUES.find((l) => l.id === "diamond");
  const ultraLeague = MINI_GAME_LEAGUES.find((l) => l.id === "ultra");
  const advancedLeagueSection = MINI_GAME_LEAGUE_SECTIONS.find((s) => s.id === "advanced");
  const eliteLeagueSection = MINI_GAME_LEAGUE_SECTIONS.find((s) => s.id === "elite");
  const baseLeagueSection = MINI_GAME_LEAGUE_SECTIONS.find((s) => s.id === "base");
  const tierUnlocked = (tierIdx) => isLeagueTierContentUnlocked(gamificationSummary, tierIdx);

  function renderDonutCardBody() {
    if (summaryLoadState === "loading") {
      return <p className="mini-game-leagues__donut-placeholder">Загрузка…</p>;
    }
    if (summaryLoadState === "error") {
      return (
        <p className="mini-game-leagues__donut-placeholder">
          {summaryError === "no_token"
            ? "Войдите в аккаунт."
            : "Не удалось загрузить данные."}
        </p>
      );
    }
    return (
      <>
        <h4 className="block-blast-game__profile-card-label">Задания к Bronze</h4>
        <div className="mini-game-progress__donut-wrap">
          <ProgressDonut pct={bronzeTasksPct} />
          <div className="mini-game-progress__donut-center">
            <span className="mini-game-progress__donut-pct">{bronzeTasksPct}%</span>
            <span className="mini-game-progress__donut-level mini-game-leagues__donut-caption">3 условия</span>
          </div>
        </div>
      </>
    );
  }

  function renderSilverDonutCardBody() {
    if (summaryLoadState === "loading") {
      return <p className="mini-game-leagues__donut-placeholder">Загрузка…</p>;
    }
    if (summaryLoadState === "error") {
      return (
        <p className="mini-game-leagues__donut-placeholder">
          {summaryError === "no_token"
            ? "Войдите в аккаунт."
            : "Не удалось загрузить данные."}
        </p>
      );
    }
    return (
      <>
        <h4 className="block-blast-game__profile-card-label">Задания к Silver</h4>
        <div className="mini-game-progress__donut-wrap">
          <ProgressDonut pct={silverTasksPct} />
          <div className="mini-game-progress__donut-center">
            <span className="mini-game-progress__donut-pct">{silverTasksPct}%</span>
            <span className="mini-game-progress__donut-level mini-game-leagues__donut-caption">3 условия</span>
          </div>
        </div>
      </>
    );
  }

  function renderGoldDonutCardBody() {
    if (summaryLoadState === "loading") {
      return <p className="mini-game-leagues__donut-placeholder">Загрузка…</p>;
    }
    if (summaryLoadState === "error") {
      return (
        <p className="mini-game-leagues__donut-placeholder">
          {summaryError === "no_token"
            ? "Войдите в аккаунт."
            : "Не удалось загрузить данные."}
        </p>
      );
    }
    return (
      <>
        <h4 className="block-blast-game__profile-card-label">Задания к Gold</h4>
        <div className="mini-game-progress__donut-wrap">
          <ProgressDonut pct={goldTasksPct} />
          <div className="mini-game-progress__donut-center">
            <span className="mini-game-progress__donut-pct">{goldTasksPct}%</span>
            <span className="mini-game-progress__donut-level mini-game-leagues__donut-caption">3 условия</span>
          </div>
        </div>
      </>
    );
  }

  function renderPlatinumDonutCardBody() {
    if (summaryLoadState === "loading") {
      return <p className="mini-game-leagues__donut-placeholder">Загрузка…</p>;
    }
    if (summaryLoadState === "error") {
      return (
        <p className="mini-game-leagues__donut-placeholder">
          {summaryError === "no_token"
            ? "Войдите в аккаунт."
            : "Не удалось загрузить данные."}
        </p>
      );
    }
    return (
      <>
        <h4 className="block-blast-game__profile-card-label">Задания к Platinum</h4>
        <div className="mini-game-progress__donut-wrap">
          <ProgressDonut pct={platinumTasksPct} />
          <div className="mini-game-progress__donut-center">
            <span className="mini-game-progress__donut-pct">{platinumTasksPct}%</span>
            <span className="mini-game-progress__donut-level mini-game-leagues__donut-caption">3 условия</span>
          </div>
        </div>
      </>
    );
  }

  function renderDiamondDonutCardBody() {
    if (summaryLoadState === "loading") {
      return <p className="mini-game-leagues__donut-placeholder">Загрузка…</p>;
    }
    if (summaryLoadState === "error") {
      return (
        <p className="mini-game-leagues__donut-placeholder">
          {summaryError === "no_token"
            ? "Войдите в аккаунт."
            : "Не удалось загрузить данные."}
        </p>
      );
    }
    return (
      <>
        <h4 className="block-blast-game__profile-card-label">Задания к Diamond</h4>
        <div className="mini-game-progress__donut-wrap">
          <ProgressDonut pct={diamondTasksPct} />
          <div className="mini-game-progress__donut-center">
            <span className="mini-game-progress__donut-pct">{diamondTasksPct}%</span>
            <span className="mini-game-progress__donut-level mini-game-leagues__donut-caption">3 условия</span>
          </div>
        </div>
      </>
    );
  }

  function renderUltraDonutCardBody() {
    if (summaryLoadState === "loading") {
      return <p className="mini-game-leagues__donut-placeholder">Загрузка…</p>;
    }
    if (summaryLoadState === "error") {
      return (
        <p className="mini-game-leagues__donut-placeholder">
          {summaryError === "no_token"
            ? "Войдите в аккаунт."
            : "Не удалось загрузить данные."}
        </p>
      );
    }
    return (
      <>
        <h4 className="block-blast-game__profile-card-label">Задания к Ultra</h4>
        <div className="mini-game-progress__donut-wrap">
          <ProgressDonut pct={ultraTasksPct} />
          <div className="mini-game-progress__donut-center">
            <span className="mini-game-progress__donut-pct">{ultraTasksPct}%</span>
            <span className="mini-game-progress__donut-level mini-game-leagues__donut-caption">3 условия</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="lk-simple-page">
      <div className="page__returnButton mini-game-leagues__back">
        <Link className="tw-link link_primary link_s" to="/lk/mini-game/progress">
          <svg xmlns="http://www.w3.org/2000/svg" width="7" height="13" fill="none" viewBox="0 0 7 13" aria-hidden="true">
            <path
              fill="currentColor"
              d="M1 6.99a1 1 0 0 1 .23-.64l4-5a1 1 0 0 1 1.54 1.29L3.29 6.99l3.32 4.35a1 1 0 0 1-.15 1.4A1 1 0 0 1 5 12.62l-3.83-5A1 1 0 0 1 1 7Z"
            />
          </svg>
          Назад
        </Link>
      </div>

      <h1 className="lk-simple-page__title" id="mini-game-leagues-heading">
        Лиги
      </h1>
      <p className="mini-game-leagues__intro">Доступные лиги челленджа.</p>

      <div className="block-blast-game">
        <section
          className="mini-game-progress__hero-row mini-game-leagues__hero-row"
          aria-label="Список лиг и прогресс заданий к Bronze, Silver, Gold, Platinum, Diamond и Ultra"
        >
          <div className="mini-game-leagues__list-head lk-dashboard__programs_catalog">
            <section className="mini-game-leagues__tier-section" aria-labelledby="mini-game-leagues-section-base">
              <div
                className="lk-dashboard__programs-catalog-section-title"
                data-testid="mini-game-leagues-section-title-base"
              >
                <h2 id="mini-game-leagues-section-base" className="lk-dashboard__programs-catalog-section-heading">
                  {baseLeagueSection?.title ?? "Базовые лиги"}{" "}
                  <span className="lk-dashboard__programs-catalog-section-count">
                    {baseLeagueSection?.leagueIds?.length ?? 3}
                  </span>
                </h2>
              </div>
              <ul className="mini-game-leagues__list" aria-labelledby="mini-game-leagues-section-base">
                <li className="mini-game-leagues__list-item-tier-card">
                  {startLeague ? <MiniGameLeagueTierCard league={startLeague} /> : null}
                </li>
              </ul>
            </section>
          </div>

          <article
            className={`block-blast-game__profile-card mini-game-progress__donut-card mini-game-leagues__donut-card mini-game-leagues__donut-card--step-bronze${
              !tierUnlocked(1) ? " mini-game-leagues__donut-card--locked" : ""
            }`}
            aria-label={
              tierUnlocked(1) && summaryLoadState === "ready"
                ? `Прогресс выполнения заданий к Bronze: ${bronzeTasksPct} процентов`
                : undefined
            }
          >
            {tierUnlocked(1) ? renderDonutCardBody() : <MiniGameLeaguesDonutLockedLayers>{renderDonutCardBody()}</MiniGameLeaguesDonutLockedLayers>}
          </article>

          <div className="mini-game-leagues__bronze-unlock-fullbleed">
            {tierUnlocked(1) ? (
              <MiniGameLeagueBronzeUnlockCard summary={gamificationSummary} />
            ) : (
              <MiniGameLeaguesLockedBlurShell variant="unlock">
                <MiniGameLeagueBronzeUnlockCard summary={gamificationSummary} />
              </MiniGameLeaguesLockedBlurShell>
            )}
          </div>

          <div className="mini-game-leagues__silver-step-head lk-dashboard__programs_catalog">
            <section className="mini-game-leagues__tier-section">
              <ul className="mini-game-leagues__list">
                <li className="mini-game-leagues__list-item-tier-card">
                  {tierUnlocked(1) && bronzeLeague ? (
                    <MiniGameLeagueTierCard league={bronzeLeague} />
                  ) : bronzeLeague ? (
                    <MiniGameLeaguesLockedBlurShell variant="tier">
                      <MiniGameLeagueTierCard league={bronzeLeague} />
                    </MiniGameLeaguesLockedBlurShell>
                  ) : null}
                </li>
              </ul>
            </section>
          </div>

          <article
            className={`block-blast-game__profile-card mini-game-progress__donut-card mini-game-leagues__donut-card mini-game-leagues__donut-card--step-silver${
              !tierUnlocked(2) ? " mini-game-leagues__donut-card--locked" : ""
            }`}
            aria-label={
              tierUnlocked(2) && summaryLoadState === "ready"
                ? `Прогресс выполнения заданий к Silver: ${silverTasksPct} процентов`
                : undefined
            }
          >
            {tierUnlocked(2) ? (
              renderSilverDonutCardBody()
            ) : (
              <MiniGameLeaguesDonutLockedLayers>{renderSilverDonutCardBody()}</MiniGameLeaguesDonutLockedLayers>
            )}
          </article>

          <div
            className="mini-game-leagues__silver-unlock-fullbleed mini-game-leagues__league-step-fullbleed"
            aria-label={tierUnlocked(2) ? "Переход в лигу Silver: условия и награды" : undefined}
          >
            {tierUnlocked(2) ? (
              <MiniGameLeagueSilverUnlockCard summary={gamificationSummary} />
            ) : (
              <MiniGameLeaguesLockedBlurShell variant="unlock">
                <MiniGameLeagueSilverUnlockCard summary={gamificationSummary} />
              </MiniGameLeaguesLockedBlurShell>
            )}
          </div>

          <MiniGameLeaguesCatalogSectionHeadingFullbleed section={advancedLeagueSection} locked={!tierUnlocked(2)} />

          <div className="mini-game-leagues__gold-step-head lk-dashboard__programs_catalog">
            <section className="mini-game-leagues__tier-section">
              <ul className="mini-game-leagues__list">
                <li className="mini-game-leagues__list-item-tier-card">
                  {tierUnlocked(2) && silverLeague ? (
                    <MiniGameLeagueTierCard league={silverLeague} />
                  ) : silverLeague ? (
                    <MiniGameLeaguesLockedBlurShell variant="tier">
                      <MiniGameLeagueTierCard league={silverLeague} />
                    </MiniGameLeaguesLockedBlurShell>
                  ) : null}
                </li>
              </ul>
            </section>
          </div>

          <article
            className={`block-blast-game__profile-card mini-game-progress__donut-card mini-game-leagues__donut-card mini-game-leagues__donut-card--step-gold${
              !tierUnlocked(3) ? " mini-game-leagues__donut-card--locked" : ""
            }`}
            aria-label={
              tierUnlocked(3) && summaryLoadState === "ready"
                ? `Прогресс выполнения заданий к Gold: ${goldTasksPct} процентов`
                : undefined
            }
          >
            {tierUnlocked(3) ? (
              renderGoldDonutCardBody()
            ) : (
              <MiniGameLeaguesDonutLockedLayers>{renderGoldDonutCardBody()}</MiniGameLeaguesDonutLockedLayers>
            )}
          </article>

          <div
            className="mini-game-leagues__gold-unlock-fullbleed mini-game-leagues__league-step-fullbleed"
            aria-label={tierUnlocked(3) ? "Переход в лигу Gold: условия и награды" : undefined}
          >
            {tierUnlocked(3) ? (
              <MiniGameLeagueGoldUnlockCard summary={gamificationSummary} />
            ) : (
              <MiniGameLeaguesLockedBlurShell variant="unlock">
                <MiniGameLeagueGoldUnlockCard summary={gamificationSummary} />
              </MiniGameLeaguesLockedBlurShell>
            )}
          </div>

          <div className="mini-game-leagues__platinum-step-head lk-dashboard__programs_catalog">
            <section className="mini-game-leagues__tier-section">
              <ul className="mini-game-leagues__list">
                <li className="mini-game-leagues__list-item-tier-card">
                  {tierUnlocked(3) && goldLeague ? (
                    <MiniGameLeagueTierCard league={goldLeague} />
                  ) : goldLeague ? (
                    <MiniGameLeaguesLockedBlurShell variant="tier">
                      <MiniGameLeagueTierCard league={goldLeague} />
                    </MiniGameLeaguesLockedBlurShell>
                  ) : null}
                </li>
              </ul>
            </section>
          </div>

          <article
            className={`block-blast-game__profile-card mini-game-progress__donut-card mini-game-leagues__donut-card mini-game-leagues__donut-card--step-platinum${
              !tierUnlocked(4) ? " mini-game-leagues__donut-card--locked" : ""
            }`}
            aria-label={
              tierUnlocked(4) && summaryLoadState === "ready"
                ? `Прогресс выполнения заданий к Platinum: ${platinumTasksPct} процентов`
                : undefined
            }
          >
            {tierUnlocked(4) ? (
              renderPlatinumDonutCardBody()
            ) : (
              <MiniGameLeaguesDonutLockedLayers>{renderPlatinumDonutCardBody()}</MiniGameLeaguesDonutLockedLayers>
            )}
          </article>

          <div
            className="mini-game-leagues__platinum-unlock-fullbleed mini-game-leagues__league-step-fullbleed"
            aria-label={tierUnlocked(4) ? "Переход в лигу Platinum: условия и награды" : undefined}
          >
            {tierUnlocked(4) ? (
              <MiniGameLeaguePlatinumUnlockCard summary={gamificationSummary} />
            ) : (
              <MiniGameLeaguesLockedBlurShell variant="unlock">
                <MiniGameLeaguePlatinumUnlockCard summary={gamificationSummary} />
              </MiniGameLeaguesLockedBlurShell>
            )}
          </div>

          <MiniGameLeaguesCatalogSectionHeadingFullbleed section={eliteLeagueSection} locked={!tierUnlocked(4)} />

          <div className="mini-game-leagues__diamond-step-head lk-dashboard__programs_catalog">
            <section className="mini-game-leagues__tier-section">
              <ul className="mini-game-leagues__list">
                <li className="mini-game-leagues__list-item-tier-card">
                  {tierUnlocked(4) && platinumLeague ? (
                    <MiniGameLeagueTierCard league={platinumLeague} />
                  ) : platinumLeague ? (
                    <MiniGameLeaguesLockedBlurShell variant="tier">
                      <MiniGameLeagueTierCard league={platinumLeague} />
                    </MiniGameLeaguesLockedBlurShell>
                  ) : null}
                </li>
              </ul>
            </section>
          </div>

          <article
            className={`block-blast-game__profile-card mini-game-progress__donut-card mini-game-leagues__donut-card mini-game-leagues__donut-card--step-diamond${
              !tierUnlocked(5) ? " mini-game-leagues__donut-card--locked" : ""
            }`}
            aria-label={
              tierUnlocked(5) && summaryLoadState === "ready"
                ? `Прогресс выполнения заданий к Diamond: ${diamondTasksPct} процентов`
                : undefined
            }
          >
            {tierUnlocked(5) ? (
              renderDiamondDonutCardBody()
            ) : (
              <MiniGameLeaguesDonutLockedLayers>{renderDiamondDonutCardBody()}</MiniGameLeaguesDonutLockedLayers>
            )}
          </article>

          <div
            className="mini-game-leagues__diamond-unlock-fullbleed mini-game-leagues__league-step-fullbleed"
            aria-label={tierUnlocked(5) ? "Переход в лигу Diamond: условия и награды" : undefined}
          >
            {tierUnlocked(5) ? (
              <MiniGameLeagueDiamondUnlockCard summary={gamificationSummary} />
            ) : (
              <MiniGameLeaguesLockedBlurShell variant="unlock">
                <MiniGameLeagueDiamondUnlockCard summary={gamificationSummary} />
              </MiniGameLeaguesLockedBlurShell>
            )}
          </div>

          <div className="mini-game-leagues__ultra-step-head lk-dashboard__programs_catalog">
            <section className="mini-game-leagues__tier-section">
              <ul className="mini-game-leagues__list">
                <li className="mini-game-leagues__list-item-tier-card">
                  {tierUnlocked(5) && diamondLeague ? (
                    <MiniGameLeagueTierCard league={diamondLeague} />
                  ) : diamondLeague ? (
                    <MiniGameLeaguesLockedBlurShell variant="tier">
                      <MiniGameLeagueTierCard league={diamondLeague} />
                    </MiniGameLeaguesLockedBlurShell>
                  ) : null}
                </li>
              </ul>
            </section>
          </div>

          <article
            className={`block-blast-game__profile-card mini-game-progress__donut-card mini-game-leagues__donut-card mini-game-leagues__donut-card--step-ultra${
              !tierUnlocked(6) ? " mini-game-leagues__donut-card--locked" : ""
            }`}
            aria-label={
              tierUnlocked(6) && summaryLoadState === "ready"
                ? `Прогресс выполнения заданий к Ultra: ${ultraTasksPct} процентов`
                : undefined
            }
          >
            {tierUnlocked(6) ? (
              renderUltraDonutCardBody()
            ) : (
              <MiniGameLeaguesDonutLockedLayers>{renderUltraDonutCardBody()}</MiniGameLeaguesDonutLockedLayers>
            )}
          </article>

          <div
            className="mini-game-leagues__ultra-unlock-fullbleed mini-game-leagues__league-step-fullbleed"
            aria-label={tierUnlocked(6) ? "Переход в лигу Ultra: условия и награды" : undefined}
          >
            {tierUnlocked(6) ? (
              <MiniGameLeagueUltraUnlockCard summary={gamificationSummary} />
            ) : (
              <MiniGameLeaguesLockedBlurShell variant="unlock">
                <MiniGameLeagueUltraUnlockCard summary={gamificationSummary} />
              </MiniGameLeaguesLockedBlurShell>
            )}
          </div>

          <div className="mini-game-leagues__list-tail-ultra lk-dashboard__programs_catalog">
            <section
              className="mini-game-leagues__tier-section"
              aria-labelledby="mini-game-leagues-section-ultra-tail"
            >
              <h2 id="mini-game-leagues-section-ultra-tail" className="mini-game-leagues__list-tail-ultra-sr-title">
                Ultra
              </h2>
              <ul className="mini-game-leagues__list" aria-labelledby="mini-game-leagues-section-ultra-tail">
                <li className="mini-game-leagues__list-item-tier-card">
                  {tierUnlocked(6) && ultraLeague ? (
                    <MiniGameLeagueTierCard league={ultraLeague} />
                  ) : ultraLeague ? (
                    <MiniGameLeaguesLockedBlurShell variant="tier">
                      <MiniGameLeagueTierCard league={ultraLeague} />
                    </MiniGameLeaguesLockedBlurShell>
                  ) : null}
                </li>
              </ul>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}
