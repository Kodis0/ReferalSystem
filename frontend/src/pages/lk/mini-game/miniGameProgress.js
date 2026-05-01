import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "../bug/bug.css";
import "../dashboard/dashboard.css";
import "../owner-programs/owner-programs.css";
import "./blockBlastGame.css";
import "./miniGameLeagues.css";
import "./miniGameProgress.css";
import "./miniGameRating.css";
import leagueStartBg from "../../../static/images/mini-game-league-start-bg.png";
import { fetchGamificationSummary } from "./gamificationApi";
import {
  MINI_GAME_LEAGUES,
  computeBronzeTasksOverallPct,
  computeDiamondTasksOverallPct,
  computeGoldTasksOverallPct,
  computePlatinumTasksOverallPct,
  computeSilverTasksOverallPct,
  computeUltraTasksOverallPct,
  MiniGameLeagueUnlockCardForTargetLeague,
} from "./miniGameLeagues";
import { ProgressDonut } from "./ProgressDonut";

/** Пока первая лига из списка; позже — из API. Фон карточки для лиги Start. */
const currentLeague = MINI_GAME_LEAGUES[0];
const currentLeagueName = currentLeague?.name ?? "Start";

function formatLifeRestoreCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function ruDaysWord(n) {
  const nAbs = Math.floor(Math.abs(Number(n)));
  const d = nAbs % 10;
  const dd = nAbs % 100;
  if (dd >= 11 && dd <= 14) return "дней";
  if (d === 1) return "день";
  if (d >= 2 && d <= 4) return "дня";
  return "дней";
}

function parseMultiplier(str) {
  const n = Number.parseFloat(String(str ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 1;
}

function formatStreakMultiplier(mult) {
  return `x${mult.toFixed(1)}`;
}

/**
 * Прогресс выполнения условий перехода к следующей лиге (как на странице «Лиги»).
 * Текущая лига: profile.league_id из API, иначе Start.
 */
function getNextLeagueDonutState(summary) {
  if (!summary || typeof summary !== "object") {
    return { pct: 0, nextLeague: null, isMax: false };
  }
  const currentId = summary.profile?.league_id ?? "start";
  const idx = MINI_GAME_LEAGUES.findIndex((l) => l.id === currentId);
  const curIdx = idx >= 0 ? idx : 0;
  const nextLeague = MINI_GAME_LEAGUES[curIdx + 1];
  if (!nextLeague) {
    return { pct: 100, nextLeague: null, isMax: true };
  }
  let pct = 0;
  switch (nextLeague.id) {
    case "bronze":
      pct = computeBronzeTasksOverallPct(summary);
      break;
    case "silver":
      pct = computeSilverTasksOverallPct(summary);
      break;
    case "gold":
      pct = computeGoldTasksOverallPct(summary);
      break;
    case "platinum":
      pct = computePlatinumTasksOverallPct(summary);
      break;
    case "diamond":
      pct = computeDiamondTasksOverallPct(summary);
      break;
    case "ultra":
      pct = computeUltraTasksOverallPct(summary);
      break;
    default:
      pct = 0;
  }
  return { pct, nextLeague, isMax: false };
}

/** ЛК: отдельная страница прогресса челленджа (те же данные, что карточки под полем в игре). */
export default function MiniGameProgressPage() {
  const [gamificationSummary, setGamificationSummary] = useState(null);
  const [summaryLoadState, setSummaryLoadState] = useState("loading");
  const [summaryError, setSummaryError] = useState(null);
  const [timerTick, setTimerTick] = useState(0);
  const [progressTab, setProgressTab] = useState("progress");

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

  useEffect(() => {
    const id = setInterval(() => setTimerTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const profile = gamificationSummary?.profile ?? {};
  const livesInfo = gamificationSummary?.lives ?? {};
  const xpInto = Number(profile.level_progress?.xp_into_level) || 0;
  const xpSpanRaw = Number(profile.level_progress?.xp_for_current_level_span);
  const xpSpan = Number.isFinite(xpSpanRaw) && xpSpanRaw > 0 ? xpSpanRaw : 1;
  const profileXpPct = Math.min(100, Math.max(0, Math.round((xpInto / xpSpan) * 100)));
  const streakDaysShown = Number(profile.streak_days) || 0;
  const streakMultLabel = formatStreakMultiplier(parseMultiplier(profile.streak_multiplier));
  const levelShown = Number(profile.level) || 1;
  const xpTotalShown = Number(profile.xp_total) || 0;
  const bestChallenge = Number(profile.best_challenge_score) || 0;
  const livesCurrent = Number(livesInfo.current);
  const livesMaxShown = Number(livesInfo.max) || 5;
  const xpBarAriaText =
    summaryLoadState === "ready"
      ? `Прогресс уровня: ${xpInto.toLocaleString("ru-RU")} из ${xpSpan.toLocaleString("ru-RU")} XP, всего ${xpTotalShown.toLocaleString("ru-RU")} XP`
      : "";

  const leagueDonut =
    summaryLoadState === "ready" && gamificationSummary
      ? getNextLeagueDonutState(gamificationSummary)
      : { pct: 0, nextLeague: null, isMax: false };
  const nextLeaguePct = leagueDonut.pct;
  const nextLeagueDonutAria =
    summaryLoadState === "ready"
      ? leagueDonut.isMax
        ? "Достигнута высшая лига"
        : `Прогресс к следующей лиге ${leagueDonut.nextLeague?.name ?? ""}: ${nextLeaguePct} процентов`
      : undefined;

  const nextLifeAtMs = livesInfo.next_life_at ? Date.parse(livesInfo.next_life_at) : NaN;
  const nextLifeRestoreRemainingMs =
    summaryLoadState === "ready" &&
    Number.isFinite(livesCurrent) &&
    livesCurrent < livesMaxShown &&
    Number.isFinite(nextLifeAtMs)
      ? Math.max(0, nextLifeAtMs - Date.now()) + 0 * timerTick
      : null;

  const tabClass = (active) =>
    `owner-programs__tab${active ? " owner-programs__tab_active" : ""}`.trim();

  return (
    <div className="lk-simple-page">
      <h1 className="lk-simple-page__title" id="mini-game-progress-heading">
        Прогресс
      </h1>

      <nav
        className="owner-programs__tabs"
        role="tablist"
        aria-label="Прогресс, достижения и магазин"
      >
        <button
          type="button"
          id="mini-game-progress-tab-progress"
          role="tab"
          aria-selected={progressTab === "progress"}
          aria-controls="mini-game-progress-panel-progress"
          tabIndex={progressTab === "progress" ? 0 : -1}
          className={tabClass(progressTab === "progress")}
          onClick={() => setProgressTab("progress")}
        >
          Прогресс
        </button>
        <button
          type="button"
          id="mini-game-progress-tab-achievements"
          role="tab"
          aria-selected={progressTab === "achievements"}
          aria-controls="mini-game-progress-panel-achievements"
          tabIndex={progressTab === "achievements" ? 0 : -1}
          className={tabClass(progressTab === "achievements")}
          onClick={() => setProgressTab("achievements")}
        >
          Достижения
        </button>
        <button
          type="button"
          id="mini-game-progress-tab-shop"
          role="tab"
          aria-selected={progressTab === "shop"}
          aria-controls="mini-game-progress-panel-shop"
          tabIndex={progressTab === "shop" ? 0 : -1}
          className={tabClass(progressTab === "shop")}
          onClick={() => setProgressTab("shop")}
        >
          Магазин
        </button>
      </nav>

      <div
        id="mini-game-progress-panel-progress"
        role="tabpanel"
        aria-labelledby="mini-game-progress-tab-progress"
        hidden={progressTab !== "progress"}
        className="mini-game-progress__tab-panel"
      >
        {summaryLoadState === "loading" ? (
          <p className="mini-game-rating__note">Загрузка…</p>
        ) : null}
        {summaryLoadState === "error" ? (
          <>
            <p className="mini-game-rating__note">
              {summaryError === "no_token"
                ? "Войдите в аккаунт, чтобы видеть прогресс."
                : "Не удалось загрузить данные. Попробуйте обновить страницу."}
            </p>
            {summaryError !== "no_token" ? (
              <button
                type="button"
                className="lk-dashboard__my-programs-catalog-banner-cta"
                onClick={() => loadGamificationSummary()}
              >
                Повторить
              </button>
            ) : null}
          </>
        ) : null}

        {summaryLoadState === "ready" ? (
          <div className="block-blast-game">
            <section className="mini-game-progress__hero-row" aria-label="Лига и прогресс к следующей лиге">
              <article
                className={[
                  "block-blast-game__profile-card mini-game-progress__league-card",
                  currentLeague?.id === "start" ? "mini-game-progress__league-card--start" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={
                  currentLeague?.id === "start"
                    ? { "--mini-game-league-start-bg": `url(${leagueStartBg})` }
                    : undefined
                }
              >
                <Link
                  className="mini-game-progress__leagues-list-link"
                  to="/lk/mini-game/leagues"
                >
                  Список
                </Link>
                <h4 className="block-blast-game__profile-card-label">Лига</h4>
                <p className="mini-game-progress__league-name">{currentLeagueName}</p>
                <p className="mini-game-progress__league-caption">Текущая лига</p>
              </article>
              <article
                className="block-blast-game__profile-card mini-game-progress__donut-card"
                aria-label={nextLeagueDonutAria}
              >
                <h4 className="block-blast-game__profile-card-label">Следующая лига</h4>
                <div className="mini-game-progress__donut-wrap">
                  <ProgressDonut pct={nextLeaguePct} />
                  <div className="mini-game-progress__donut-center">
                    <span className="mini-game-progress__donut-pct">{nextLeaguePct}%</span>
                    <span className="mini-game-progress__donut-level">
                      {leagueDonut.isMax
                        ? "Максимум"
                        : `до ${leagueDonut.nextLeague?.name ?? ""}`}
                    </span>
                  </div>
                </div>
              </article>
            </section>

            {leagueDonut.nextLeague ? (
              <article
                className="mini-game-progress__next-league-card"
                aria-label={`Условия и награды перехода в лигу ${leagueDonut.nextLeague.name}`}
              >
                <MiniGameLeagueUnlockCardForTargetLeague
                  summary={gamificationSummary}
                  targetLeagueId={leagueDonut.nextLeague.id}
                />
              </article>
            ) : null}

            <section className="block-blast-game__profile-cards" aria-labelledby="mini-game-progress-heading">
            <article className="block-blast-game__profile-card block-blast-game__profile-card_xp">
              <h4 className="block-blast-game__profile-card-label">Опыт</h4>
              <p
                className="block-blast-game__profile-card-value block-blast-game__profile-card-value--compact block-blast-game__profile-card-value--xp-line"
                aria-label={`${xpTotalShown.toLocaleString("ru-RU")} XP, уровень ${levelShown.toLocaleString("ru-RU")}`}
              >
                <span>{xpTotalShown.toLocaleString("ru-RU")} XP</span>
                <span className="block-blast-game__xp-level-label">
                  уровень {levelShown.toLocaleString("ru-RU")}
                </span>
              </p>
              <p className="block-blast-game__profile-card-caption">
                В уровне: {xpInto.toLocaleString("ru-RU")} / {xpSpan.toLocaleString("ru-RU")}
              </p>
              <div
                className="block-blast-game__xp-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={profileXpPct}
                aria-valuetext={xpBarAriaText}
              >
                <div className="block-blast-game__xp-bar-fill" style={{ width: `${profileXpPct}%` }} />
              </div>
            </article>
            <article className="block-blast-game__profile-card">
              <h4 className="block-blast-game__profile-card-label">Лучший счёт</h4>
              <p className="block-blast-game__profile-card-value block-blast-game__profile-card-value--compact">
                {bestChallenge.toLocaleString("ru-RU")}
              </p>
            </article>
            <article className="block-blast-game__profile-card">
              <h4 className="block-blast-game__profile-card-label">Серия</h4>
              <div className="block-blast-game__profile-card-body">
                <p
                  className="block-blast-game__profile-card-value block-blast-game__profile-card-value--streak"
                  aria-label={`Серия ${streakDaysShown} ${ruDaysWord(streakDaysShown)}, множитель ${streakMultLabel}`}
                >
                  <span>
                    {streakDaysShown.toLocaleString("ru-RU")} {ruDaysWord(streakDaysShown)}
                  </span>
                  <span className="block-blast-game__streak-mult">{streakMultLabel}</span>
                </p>
              </div>
            </article>
            <article className="block-blast-game__profile-card">
              <h4 className="block-blast-game__profile-card-label">Жизни</h4>
              <div className="block-blast-game__profile-card-body">
                <p className="block-blast-game__profile-card-value block-blast-game__profile-card-value--compact">
                  {Number.isFinite(livesCurrent)
                    ? `${Math.max(0, Math.min(livesMaxShown, livesCurrent)).toLocaleString("ru-RU")} / ${livesMaxShown.toLocaleString("ru-RU")}`
                    : "—"}
                </p>
              </div>
            </article>
            <article className="block-blast-game__profile-card" style={{ gridColumn: "1 / -1" }}>
              <h4 className="block-blast-game__profile-card-label">Восстановление</h4>
              <div className="block-blast-game__profile-card-body">
                {Number.isFinite(livesCurrent) && livesCurrent >= livesMaxShown ? (
                  <p className="block-blast-game__profile-card-caption block-blast-game__profile-card-caption--muted">
                    Все жизни доступны
                  </p>
                ) : (
                  <p
                    className="block-blast-game__life-restore-timer"
                    aria-live="polite"
                    aria-atomic="true"
                    aria-label={
                      nextLifeRestoreRemainingMs != null
                        ? `До следующей жизни осталось ${formatLifeRestoreCountdown(nextLifeRestoreRemainingMs)}`
                        : undefined
                    }
                  >
                    {formatLifeRestoreCountdown(nextLifeRestoreRemainingMs ?? 0)}
                  </p>
                )}
              </div>
            </article>
          </section>
        </div>
        ) : null}
      </div>

      <div
        id="mini-game-progress-panel-achievements"
        role="tabpanel"
        aria-labelledby="mini-game-progress-tab-achievements"
        hidden={progressTab !== "achievements"}
        className="mini-game-progress__tab-panel"
      >
        <p className="mini-game-rating__note">
          Здесь появятся достижения за игру и челлендж.
        </p>
      </div>

      <div
        id="mini-game-progress-panel-shop"
        role="tabpanel"
        aria-labelledby="mini-game-progress-tab-shop"
        hidden={progressTab !== "shop"}
        className="mini-game-progress__tab-panel"
      >
        <p className="mini-game-rating__note">Магазин скоро будет доступен.</p>
      </div>
    </div>
  );
}
