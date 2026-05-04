import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listAchievements } from "../../../achievements/listAchievements";
import achievementDoneCheck from "../../../static/images/achievement-done-check.svg";
import achievementRevealEye from "../../../static/images/achievement-reveal-eye.svg";
import freezeShieldIcon from "../../../static/images/Freeze.svg";
import shopExtraLifeHero from "../../../static/images/shop-extra-life-hero.png";
import shopFullLivesRefillHero from "../../../static/images/shop-full-lives-refill-hero.png";
import shopStreakShieldHero from "../../../static/images/shop-streak-shield-hero.png";
import shopIncreaseLivesMaxHero from "../../../static/images/shop-increase-lives-max-hero.png";
import shopIncreaseStreakShieldsMaxHero from "../../../static/images/shop-increase-streak-shields-max-hero.png";
import shopFastLifeRegenHero from "../../../static/images/shop-fast-life-regen-hero.png";
import "../bug/bug.css";
import "../dashboard/dashboard.css";
import "../owner-programs/owner-programs.css";
import "./blockBlastGame.css";
import "./miniGameLeagues.css";
import "./miniGameProgress.css";
import "./miniGameRating.css";
import {
  fetchGamificationShop,
  fetchGamificationSummary,
  postGamificationShopRedeem,
  postGamificationShopSelectFrame,
} from "./gamificationApi";
import PixelHeartGlyph from "./PixelHeartGlyph";
import {
  MINI_GAME_LEAGUES,
  computeBronzeTasksOverallPct,
  computeDiamondTasksOverallPct,
  computeGoldTasksOverallPct,
  computePlatinumTasksOverallPct,
  computeSilverTasksOverallPct,
  computeUltraTasksOverallPct,
  formatLeaguePointMultiplierLabel,
  getCurrentLeagueIndexFromSummary,
  getLeagueCardInlineBgStyle,
  MiniGameLeagueUnlockCardForTargetLeague,
} from "./miniGameLeagues";
import { ProgressDonut } from "./ProgressDonut";
import { buildPerimeterGarlandBulbs } from "./garlandBulbs";
import { PixelArcadeFrameTravelSvg } from "./PixelArcadeFrameTravelSvg";
import { NeonLineFrameTravelSvg } from "./NeonLineFrameTravelSvg";
import { PacmanChaseFrameTravelSvg } from "./PacmanChaseFrameTravelSvg";

const MINI_GAME_SHOP_FRAME_GARLAND_BULBS = buildPerimeterGarlandBulbs();

const MINI_GAME_FRAME_SHOP_COPY = {
  frame_garland: {
    title: "Гирлянда",
    description: "Классическая рамка с лампочками по периметру игрового поля.",
  },
  frame_neon_line: {
    title: "Neon Line",
    description: "Узкая неоновая рамка с плавной бегущей волной по линии поля.",
  },
  frame_pixel_arcade: {
    title: "Змейка",
    description: "Классическая пиксельная рамка со змейкой, яблоком и движением по периметру поля.",
  },
  frame_pacman_chase: {
    title: "Pac-Man Chase",
    description: "Аркадная рамка: Пакман открывает рот и гонится за призраком по периметру поля.",
  },
};

function shopItemDisplayTitle(item) {
  return MINI_GAME_FRAME_SHOP_COPY[item?.code]?.title || item?.title || "";
}

function shopItemDisplayDescription(item) {
  return MINI_GAME_FRAME_SHOP_COPY[item?.code]?.description || item?.description || "";
}

function livesRecoveryIntervalAfterRedeem(prev, p) {
  const until = p.fast_life_regen_until ?? prev.profile?.fast_life_regen_until;
  if (!until) return prev.lives?.recovery_interval_hours ?? 4;
  const t = Date.parse(until);
  if (!Number.isFinite(t) || t <= Date.now()) return 4;
  return 2;
}

function applyShopRedeemToGamificationSummary(prev, redeemBody) {
  if (!prev || typeof prev !== "object") {
    return prev;
  }
  const p = redeemBody?.profile || {};
  return {
    ...prev,
    points: redeemBody?.points ?? prev.points,
    profile: {
      ...prev.profile,
      streak_shields_available:
        p.streak_shields_available ?? prev.profile?.streak_shields_available,
      streak_shields_max: p.streak_shields_max ?? prev.profile?.streak_shields_max,
      streak_days: p.streak_days ?? prev.profile?.streak_days,
      fast_life_regen_until: p.fast_life_regen_until ?? prev.profile?.fast_life_regen_until,
      active_minigame_frame:
        p.active_minigame_frame ?? prev.profile?.active_minigame_frame ?? "",
    },
    lives: {
      ...prev.lives,
      current: p.lives_current ?? prev.lives?.current,
      max: p.lives_max ?? prev.lives?.max,
      next_life_at: p.next_life_at ?? prev.lives?.next_life_at,
      recovery_interval_hours: livesRecoveryIntervalAfterRedeem(prev, p),
    },
  };
}

function shopRedeemErrorMessage(err) {
  const code = err?.body?.code ?? err?.message;
  if (code === "not_enough_points") return "Недостаточно баллов";
  if (code === "lives_full") return "Жизни уже полные";
  if (code === "streak_shields_limit") return "Лимит защит достигнут";
  if (code === "max_lives_limit") return "Достигнут максимум жизней";
  if (code === "streak_shields_max_limit") return "Достигнут максимум защит серии";
  if (code === "fast_life_regen_limit") return "Ускорение уже на максимуме";
  if (code === "already_owned") return "Уже куплено";
  if (code === "frame_not_owned") return "Рамка не куплена";
  if (code === "unknown_frame") return "Неизвестная рамка";
  if (code === "not_purchasable") return "Недоступно для покупки";
  if (code === "unknown_reward") return "Неизвестная награда";
  return "Не удалось применить покупку";
}

function formatShopDateTimeRu(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

function shopPointsBalanceNumber(summary) {
  const raw = summary?.points?.balance;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

function getShopItemMaxQty(item, shopPayload) {
  if (!shopPayload?.points) return 0;
  const balance = Math.max(0, Math.floor(Number(shopPayload.points.balance)));
  const cost = Math.max(1, Math.floor(Number(item.cost_points) || 0));
  const byBalance = Math.floor(balance / cost);
  const p = shopPayload.profile;
  if (!p) {
    return item.can_redeem ? Math.min(1, byBalance) : 0;
  }
  if (item.code === "increase_lives_max" || item.code === "increase_streak_shields_max") {
    if (!item.can_redeem) return 0;
    const c = Math.floor(Number(item.cost_points) || 0);
    if (c <= 0) return 0;
    return balance >= c ? 1 : 0;
  }
  if (item.code === "extra_life") {
    const gap = Math.max(0, Number(p.lives_max) - Number(p.lives_current));
    return Math.max(0, Math.min(byBalance, gap));
  }
  if (item.code === "full_lives_refill") {
    if (Number(p.lives_current) >= Number(p.lives_max)) return 0;
    return Math.min(1, byBalance);
  }
  if (item.code === "streak_shield_1_day") {
    const cap = Number(p.streak_shields_max) || 3;
    const slots = cap - Number(p.streak_shields_available ?? 0);
    return Math.max(0, Math.min(byBalance, Math.max(0, slots)));
  }
  if (item.code === "fast_life_regen_24h") {
    if (!item.can_redeem) return 0;
    const c = Math.max(1, Math.floor(Number(item.cost_points) || 0));
    return balance >= c ? 1 : 0;
  }
  if (isShopCosmeticFrameItem(item)) {
    if (item.default_owned) return 0;
    if (item.owned) return 0;
    return item.can_redeem ? 1 : 0;
  }
  return Math.max(0, byBalance);
}

function isShopCosmeticFrameItem(item) {
  return item.item_type === "cosmetic_frame" || item.effect === "cosmetic_frame";
}

/** Порядок блоков на вкладке «Достижения». */
const ACHIEVEMENT_CATEGORY_ORDER = [
  "start",
  "links",
  "leads",
  "earnings",
  "game",
  "activity",
  "rating",
  "other",
];

function categoryBlockTitleRu(category) {
  const c = String(category || "").toLowerCase();
  if (c === "start") return "Стартовые достижения";
  if (c === "links") return "Ссылки и трафик";
  if (c === "leads") return "Клиенты и лиды";
  if (c === "earnings") return "Доход";
  if (c === "game") return "Игра";
  if (c === "activity") return "Активность";
  if (c === "rating") return "Рейтинг";
  return category || "Другое";
}

function sortCategoryKeys(keys) {
  const arr = [...keys];
  arr.sort((a, b) => {
    const ia = ACHIEVEMENT_CATEGORY_ORDER.indexOf(a);
    const ib = ACHIEVEMENT_CATEGORY_ORDER.indexOf(b);
    const sa = ia === -1 ? 999 : ia;
    const sb = ib === -1 ? 999 : ib;
    if (sa !== sb) return sa - sb;
    return String(a).localeCompare(String(b));
  });
  return arr;
}

function sortAchievementsItems(list) {
  return [...list].sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

/**
 * Прогресс выполнения условий перехода к следующей лиге (как на странице «Лиги»).
 * Текущая лига: profile.league_id из API; кольцо — среднее по продажам/уровню/серии (фактический переход считает backend по всем порогам).
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

  const [shopPayload, setShopPayload] = useState(null);
  const [shopLoadState, setShopLoadState] = useState("idle");
  const [redeemLoadingCode, setRedeemLoadingCode] = useState(null);
  const [selectFrameBusyCode, setSelectFrameBusyCode] = useState(null);
  const [shopFeedback, setShopFeedback] = useState(null);
  const [shopQtyByCode, setShopQtyByCode] = useState({});

  const [achievementsData, setAchievementsData] = useState(null);
  const [achievementsLoadState, setAchievementsLoadState] = useState("idle");
  const [achievementsError, setAchievementsError] = useState(null);
  const [achievementsRetryNonce, setAchievementsRetryNonce] = useState(0);
  const [achievementCategoryFilter, setAchievementCategoryFilter] = useState("all");
  const [achievementDetailRevealed, setAchievementDetailRevealed] = useState(() => new Set());

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

  const handleShopRedeem = useCallback(async (code, quantity = 1) => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
    if (!token) {
      setShopFeedback({ type: "error", text: "Войдите в аккаунт." });
      return;
    }
    const q = Math.max(1, Math.floor(Number(quantity) || 1));
    setRedeemLoadingCode(code);
    setShopFeedback(null);
    try {
      for (let i = 0; i < q; i++) {
        const requestId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${i}`;
        const data = await postGamificationShopRedeem(token, {
          reward_code: code,
          client_request_id: requestId,
        });
        setGamificationSummary((prev) => applyShopRedeemToGamificationSummary(prev, data));
        const shop = await fetchGamificationShop(token);
        setShopPayload(shop);
      }
      if (code === "fast_life_regen_24h") {
        setShopFeedback({ type: "success", text: "Ускорение активировано." });
      }
    } catch (e) {
      setShopFeedback({ type: "error", text: shopRedeemErrorMessage(e) });
    } finally {
      setRedeemLoadingCode(null);
    }
  }, []);

  const handleShopSelectFrame = useCallback(async (frameCode) => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
    if (!token) {
      setShopFeedback({ type: "error", text: "Войдите в аккаунт." });
      return;
    }
    setSelectFrameBusyCode(frameCode);
    setShopFeedback(null);
    try {
      const data = await postGamificationShopSelectFrame(token, { frame_code: frameCode });
      setGamificationSummary((prev) => applyShopRedeemToGamificationSummary(prev, data));
      const shop = await fetchGamificationShop(token);
      setShopPayload(shop);
      setShopFeedback({ type: "success", text: "Рамка выбрана." });
    } catch (e) {
      setShopFeedback({ type: "error", text: shopRedeemErrorMessage(e) });
    } finally {
      setSelectFrameBusyCode(null);
    }
  }, []);

  useEffect(() => {
    loadGamificationSummary();
  }, [loadGamificationSummary]);

  useEffect(() => {
    if (progressTab !== "shop" || summaryLoadState !== "ready") {
      return undefined;
    }
    const token = typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
    if (!token) {
      return undefined;
    }
    const ac = new AbortController();
    setShopLoadState("loading");
    (async () => {
      try {
        const data = await fetchGamificationShop(token, { signal: ac.signal });
        if (!ac.signal.aborted) {
          setShopPayload(data);
          setShopLoadState("ready");
        }
      } catch (e) {
        if (e?.name === "AbortError") return;
        if (!ac.signal.aborted) {
          setShopLoadState("error");
          setShopPayload(null);
        }
      }
    })();
    return () => ac.abort();
  }, [progressTab, summaryLoadState]);

  useEffect(() => {
    if (!shopPayload?.items?.length) {
      return undefined;
    }
    setShopQtyByCode((prev) => {
      const next = { ...prev };
      for (const it of shopPayload.items) {
        const m = getShopItemMaxQty(it, shopPayload);
        if (m <= 0) {
          next[it.code] = 0;
        } else {
          const cur = next[it.code];
          const v = cur == null || cur < 1 ? 1 : cur;
          next[it.code] = Math.min(m, v);
        }
      }
      return next;
    });
    return undefined;
  }, [shopPayload]);

  useEffect(() => {
    const id = setInterval(() => setTimerTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (progressTab !== "achievements") {
      return undefined;
    }
    const ac = new AbortController();
    const token = typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
    if (!token) {
      setAchievementsLoadState("error");
      setAchievementsError("no_token");
      setAchievementsData(null);
      return undefined;
    }
    setAchievementsLoadState("loading");
    setAchievementsError(null);
    (async () => {
      try {
        const data = await listAchievements(token, { signal: ac.signal });
        if (!ac.signal.aborted) {
          setAchievementsData(data);
          setAchievementsLoadState("ready");
        }
      } catch (e) {
        if (e?.name === "AbortError") return;
        if (!ac.signal.aborted) {
          setAchievementsLoadState("error");
          setAchievementsError(e?.message || "fetch_failed");
          setAchievementsData(null);
        }
      }
    })();
    return () => ac.abort();
  }, [progressTab, achievementsRetryNonce]);

  useEffect(() => {
    if (achievementCategoryFilter === "all") return;
    const items = Array.isArray(achievementsData?.items) ? achievementsData.items : [];
    const cats = new Set(items.map((it) => String(it.category || "other")));
    if (!cats.has(achievementCategoryFilter)) {
      setAchievementCategoryFilter("all");
    }
  }, [achievementsData, achievementCategoryFilter]);

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

  const currentLeagueCard =
    MINI_GAME_LEAGUES[getCurrentLeagueIndexFromSummary(gamificationSummary)] ?? MINI_GAME_LEAGUES[0];
  const currentLeagueName = currentLeagueCard?.name ?? "Start";

  const shopPointsBalance =
    summaryLoadState === "ready"
      ? progressTab === "shop" && shopLoadState === "ready" && shopPayload?.points?.balance != null
        ? Math.max(0, Math.floor(Number(shopPayload.points.balance)))
        : shopPointsBalanceNumber(gamificationSummary)
      : 0;
  const shopPointsBalanceFormatted =
    summaryLoadState === "ready"
      ? shopPointsBalance.toLocaleString("ru-RU")
      : "0";
  const shopPointsMultiplierLabel =
    summaryLoadState === "ready"
      ? formatLeaguePointMultiplierLabel(gamificationSummary?.profile?.league_id)
      : "x1";

  const heartsFilled =
    summaryLoadState !== "ready" || !Number.isFinite(livesCurrent)
      ? 0
      : Math.max(0, Math.min(livesMaxShown, livesCurrent));

  const livesHeartsAria =
    summaryLoadState !== "ready"
      ? "Загрузка статуса жизней"
      : heartsFilled === 0
        ? `Жизней не осталось, 0 из ${livesMaxShown}`
        : `Жизней осталось: ${heartsFilled} из ${livesMaxShown}`;

  const fastRegenIso = profile.fast_life_regen_until;
  const fastLifeRegenActive =
    timerTick >= 0 &&
    summaryLoadState === "ready" &&
    typeof fastRegenIso === "string" &&
    Number.isFinite(Date.parse(fastRegenIso)) &&
    Date.parse(fastRegenIso) > Date.now();

  const streakShieldsAvailable = Number(profile.streak_shields_available) || 0;
  const streakShieldSlotsMax = Number(profile.streak_shields_max) || 3;

  const streakShieldsFilledSlots = Math.min(
    streakShieldSlotsMax,
    Math.max(0, streakShieldsAvailable),
  );

  const shopFreezeShieldsAria =
    summaryLoadState !== "ready"
      ? "Загрузка защит серии"
      : `Доступно защит серии: ${streakShieldsAvailable} из ${streakShieldSlotsMax}`;

  const shopItemsBoosters =
    shopPayload?.items?.filter((it) => !isShopCosmeticFrameItem(it)) ?? [];
  const shopItemsFrames = shopPayload?.items?.filter(isShopCosmeticFrameItem) ?? [];

  function renderShopCatalogItem(item) {
    const isCosmeticFrame = isShopCosmeticFrameItem(item);
    const itemDisplayTitle = shopItemDisplayTitle(item);
    const itemDisplayDescription = shopItemDisplayDescription(item);
    const costNum = Math.max(0, Math.floor(Number(item.cost_points) || 0));
    const maxQty = getShopItemMaxQty(item, shopPayload);
    const qtyRaw = shopQtyByCode[item.code];
    const qty =
      maxQty <= 0 ? 0 : Math.min(maxQty, Math.max(1, qtyRaw == null || qtyRaw < 1 ? 1 : qtyRaw));
    const totalPts = qty * costNum;
    const totalFormatted = totalPts.toLocaleString("ru-RU");
    const shopBusy = redeemLoadingCode != null || selectFrameBusyCode != null;
    const buyDisabled = maxQty <= 0 || qty <= 0 || shopBusy;
    const minusDisabled = maxQty <= 0 || qty <= 1 || shopBusy;
    const plusDisabled = maxQty <= 0 || qty >= maxQty || shopBusy;
    const costFormatted = costNum.toLocaleString("ru-RU");
    let frameBtnLabel = "Купить";
    let frameBtnDisabled = shopBusy;
    let frameBtnAction = "buy";
    if (isCosmeticFrame) {
      if (!item.owned) {
        if (!item.can_redeem) {
          frameBtnLabel = "Недостаточно баллов";
          frameBtnDisabled = true;
          frameBtnAction = "none";
        } else {
          frameBtnLabel = redeemLoadingCode === item.code ? "Подождите…" : "Купить";
          frameBtnDisabled = shopBusy;
          frameBtnAction = "buy";
        }
      } else if (item.active) {
        frameBtnLabel = "Активна";
        frameBtnDisabled = true;
        frameBtnAction = "none";
      } else {
        frameBtnLabel = selectFrameBusyCode === item.code ? "Подождите…" : "Выбрать";
        frameBtnDisabled = shopBusy;
        frameBtnAction = "select";
      }
    }
    return (
      <article
        key={item.code}
        className={
          "block-blast-game__profile-card mini-game-progress__shop-item mini-game-progress__shop-item--tile" +
          (item.code === "extra_life" ? " mini-game-progress__shop-item--tile-extra-life" : "") +
          (item.code === "full_lives_refill"
            ? " mini-game-progress__shop-item--tile-full-lives-refill"
            : "") +
          (item.code === "streak_shield_1_day"
            ? " mini-game-progress__shop-item--tile-streak-shield"
            : "") +
          (item.code === "increase_lives_max"
            ? " mini-game-progress__shop-item--tile-upgrade-lives"
            : "") +
          (item.code === "increase_streak_shields_max"
            ? " mini-game-progress__shop-item--tile-upgrade-shields"
            : "") +
          (item.code === "fast_life_regen_24h"
            ? " mini-game-progress__shop-item--tile-fast-life-regen"
            : "") +
          (item.code === "frame_neon_line" ? " mini-game-progress__shop-item--tile-frame-neon" : "") +
          (item.code === "frame_garland" ? " mini-game-progress__shop-item--tile-frame-garland" : "") +
          (item.code === "frame_pixel_arcade"
            ? " mini-game-progress__shop-item--tile-frame-pixel-arcade"
            : "") +
          (item.code === "frame_pacman_chase"
            ? " mini-game-progress__shop-item--tile-frame-pacman-chase"
            : "")
        }
      >
        <div className="mini-game-progress__shop-item-head">
          <p className="mini-game-progress__shop-item-caption">{itemDisplayTitle}</p>
        </div>

        <div className="mini-game-progress__shop-item-help-anchor">
          <button
            type="button"
            className="mini-game-progress__shop-item-help"
            aria-label={`О товаре «${itemDisplayTitle}»: ${itemDisplayDescription}`}
          >
            ?
          </button>
          <span role="tooltip" className="mini-game-progress__shop-item-tooltip">
            {itemDisplayDescription}
          </span>
        </div>

        <div className="mini-game-progress__shop-item-hero">
          {item.code === "extra_life" ? (
            <img
              src={shopExtraLifeHero}
              alt={itemDisplayTitle}
              className="mini-game-progress__shop-item-hero-img mini-game-progress__shop-item-hero-img--extra-life"
              decoding="async"
            />
          ) : item.code === "full_lives_refill" ? (
            <img
              src={shopFullLivesRefillHero}
              alt={itemDisplayTitle}
              className="mini-game-progress__shop-item-hero-img mini-game-progress__shop-item-hero-img--full-lives-refill"
              decoding="async"
            />
          ) : item.code === "streak_shield_1_day" ? (
            <img
              src={shopStreakShieldHero}
              alt={itemDisplayTitle}
              className="mini-game-progress__shop-item-hero-img mini-game-progress__shop-item-hero-img--streak-shield"
              decoding="async"
            />
          ) : item.code === "increase_lives_max" ? (
            <img
              src={shopIncreaseLivesMaxHero}
              alt={itemDisplayTitle}
              className="mini-game-progress__shop-item-hero-img mini-game-progress__shop-item-hero-img--upgrade-lives"
              decoding="async"
            />
          ) : item.code === "increase_streak_shields_max" ? (
            <img
              src={shopIncreaseStreakShieldsMaxHero}
              alt={itemDisplayTitle}
              className="mini-game-progress__shop-item-hero-img mini-game-progress__shop-item-hero-img--upgrade-shields"
              decoding="async"
            />
          ) : item.code === "fast_life_regen_24h" ? (
            <img
              src={shopFastLifeRegenHero}
              alt={itemDisplayTitle}
              className="mini-game-progress__shop-item-hero-img mini-game-progress__shop-item-hero-img--fast-life-regen"
              decoding="async"
            />
          ) : item.code === "frame_garland" ? (
            <div className="mini-game-progress__shop-item-hero-square mini-game-progress__shop-item-garland-preview">
              <div className="mini-game-progress__shop-item-garland-preview-board" aria-hidden="true" />
              <div
                className="block-blast-game__garland-bulbs mini-game-progress__shop-item-garland-bulbs"
                aria-hidden="true"
              >
                {MINI_GAME_SHOP_FRAME_GARLAND_BULBS.map((b) => (
                  <span
                    key={b.key}
                    className={`block-blast-game__garland-bulb block-blast-game__garland-bulb--c${b.colorMod}`}
                    style={{
                      left: `${b.leftPct}%`,
                      top: `${b.topPct}%`,
                      transform: "translate(-50%, -50%)",
                      ["--garland-delay"]: `${b.ord * 0.068}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          ) : item.code === "frame_pixel_arcade" ? (
            <div className="mini-game-progress__shop-item-hero-square mini-game-progress__shop-item-pixel-arcade-preview">
              <div className="mini-game-progress__shop-item-pixel-arcade-preview-board" aria-hidden="true" />
              <PixelArcadeFrameTravelSvg variant="shop" />
            </div>
          ) : item.code === "frame_pacman_chase" ? (
            <div className="mini-game-progress__shop-item-hero-square mini-game-progress__shop-item-pacman-chase-preview">
              <div className="mini-game-progress__shop-item-pacman-chase-preview-board" aria-hidden="true" />
              <PacmanChaseFrameTravelSvg variant="shop" />
            </div>
          ) : item.code === "frame_neon_line" ? (
            <div className="mini-game-progress__shop-item-hero-square mini-game-progress__shop-item-neon-preview">
              <div className="mini-game-progress__shop-item-neon-preview-board" aria-hidden="true" />
              <NeonLineFrameTravelSvg variant="shop" />
            </div>
          ) : isCosmeticFrame ? (
            <div className="mini-game-progress__shop-item-hero-square">
              <p className="mini-game-progress__shop-item-desc">{itemDisplayDescription}</p>
            </div>
          ) : (
            <div className="mini-game-progress__shop-item-hero-square">
              <p className="mini-game-progress__shop-item-desc">{itemDisplayDescription}</p>
            </div>
          )}
        </div>

        {item.code === "fast_life_regen_24h" && item.is_active && item.active_until ? (
          <p className="mini-game-progress__shop-item-streak-meta">
            Активно до: {formatShopDateTimeRu(item.active_until)}
          </p>
        ) : null}

        {isCosmeticFrame ? (
          <div className="mini-game-progress__shop-item-footer mini-game-progress__shop-item-footer--frame">
            <div
              className="mini-game-progress__shop-item-footer-total mini-game-progress__shop-item-footer-total--frame"
              aria-label={item.default_owned ? "В комплекте" : `${costFormatted} баллов`}
            >
              {item.default_owned ? (
                <span className="mini-game-progress__shop-item-footer-included">В комплекте</span>
              ) : (
                <>
                  <span className="mini-game-progress__shop-item-footer-total-num">{costFormatted}</span>
                  <span className="mini-game-progress__shop-item-footer-total-unit"> баллов</span>
                </>
              )}
            </div>
            <button
              type="button"
              className="mini-game-progress__shop-item-buy"
              disabled={frameBtnDisabled}
              onClick={() => {
                if (frameBtnAction === "buy") {
                  void handleShopRedeem(item.code, 1);
                } else if (frameBtnAction === "select") {
                  void handleShopSelectFrame(item.code);
                }
              }}
            >
              {frameBtnLabel}
            </button>
          </div>
        ) : (
          <div className="mini-game-progress__shop-item-footer">
            <div className="mini-game-progress__shop-item-footer-steps">
              <button
                type="button"
                className="mini-game-progress__shop-item-step mini-game-progress__shop-item-step--minus"
                disabled={minusDisabled}
                aria-label="Уменьшить количество"
                onClick={() => {
                  setShopQtyByCode((prev) => {
                    const m = getShopItemMaxQty(item, shopPayload);
                    if (m <= 0) return { ...prev, [item.code]: 0 };
                    const cur = prev[item.code] == null || prev[item.code] < 1 ? 1 : prev[item.code];
                    return {
                      ...prev,
                      [item.code]: Math.min(m, Math.max(1, cur - 1)),
                    };
                  });
                }}
              >
                −
              </button>
              <div
                className="mini-game-progress__shop-item-footer-total"
                aria-label={`${totalFormatted} баллов`}
              >
                <span className="mini-game-progress__shop-item-footer-total-num">{totalFormatted}</span>
                <span className="mini-game-progress__shop-item-footer-total-unit"> баллов</span>
              </div>
              <button
                type="button"
                className="mini-game-progress__shop-item-step mini-game-progress__shop-item-step--plus"
                disabled={plusDisabled}
                aria-label="Увеличить количество"
                onClick={() => {
                  setShopQtyByCode((prev) => {
                    const m = getShopItemMaxQty(item, shopPayload);
                    if (m <= 0) return { ...prev, [item.code]: 0 };
                    const cur = prev[item.code] == null || prev[item.code] < 1 ? 1 : prev[item.code];
                    return {
                      ...prev,
                      [item.code]: Math.min(m, Math.max(1, cur + 1)),
                    };
                  });
                }}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className="mini-game-progress__shop-item-buy"
              disabled={buyDisabled}
              onClick={() => handleShopRedeem(item.code, qty)}
            >
              {redeemLoadingCode === item.code
                ? "Подождите…"
                : item.code === "fast_life_regen_24h" && item.is_active
                  ? "Продлить"
                  : "Купить"}
            </button>
          </div>
        )}
      </article>
    );
  }

  return (
    <div className="lk-simple-page">
      <h1 className="lk-simple-page__title" id="mini-game-progress-heading">
        Прогресс
      </h1>

      <nav
        className="owner-programs__tabs"
        role="tablist"
        aria-label="Прогресс, магазин и достижения"
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
                  currentLeagueCard?.id
                    ? `mini-game-progress__league-card--${currentLeagueCard.id}`
                    : "mini-game-progress__league-card--start",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={getLeagueCardInlineBgStyle(currentLeagueCard?.id)}
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

            <section
              className="block-blast-game__profile-cards mini-game-progress__progress-profile-cards"
              aria-labelledby="mini-game-progress-heading"
            >
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
                {summaryLoadState !== "ready" ? (
                  <p className="block-blast-game__profile-card-value block-blast-game__profile-card-value--compact">
                    —
                  </p>
                ) : (
                  <div
                    className="block-blast-game__attempts-hearts"
                    role="img"
                    aria-label={livesHeartsAria}
                  >
                    {Array.from({ length: livesMaxShown }, (_, i) => (
                      <span
                        key={i}
                        className={[
                          "block-blast-game__attempt-heart",
                          i < heartsFilled
                            ? "block-blast-game__attempt-heart_filled"
                            : "block-blast-game__attempt-heart_empty",
                        ].join(" ")}
                      >
                        <PixelHeartGlyph />
                      </span>
                    ))}
                  </div>
                )}
                {fastLifeRegenActive ? (
                  <p className="block-blast-game__profile-card-caption block-blast-game__profile-card-caption--muted mini-game-progress__fast-regen-caption">
                    Ускорение активно
                  </p>
                ) : null}
              </div>
            </article>
            <article className="block-blast-game__profile-card">
              <h4 className="block-blast-game__profile-card-label">Защиты серии</h4>
              <div className="block-blast-game__profile-card-body">
                {summaryLoadState !== "ready" ? (
                  <p className="block-blast-game__profile-card-value block-blast-game__profile-card-value--compact">
                    —
                  </p>
                ) : (
                  <div
                    className="mini-game-progress__freeze-shields"
                    role="img"
                    aria-label={shopFreezeShieldsAria}
                  >
                    {Array.from({ length: streakShieldSlotsMax }, (_, i) => (
                      <span
                        key={i}
                        className={[
                          "mini-game-progress__freeze-shield",
                          i < streakShieldsFilledSlots
                            ? "mini-game-progress__freeze-shield_filled"
                            : "mini-game-progress__freeze-shield_empty",
                        ].join(" ")}
                      >
                        <img src={freezeShieldIcon} alt="" aria-hidden />
                      </span>
                    ))}
                  </div>
                )}
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
        id="mini-game-progress-panel-shop"
        role="tabpanel"
        aria-labelledby="mini-game-progress-tab-shop"
        hidden={progressTab !== "shop"}
        className="mini-game-progress__tab-panel"
      >
        {summaryLoadState === "loading" ? (
          <p className="mini-game-rating__note">Загрузка…</p>
        ) : null}
        {summaryLoadState === "error" ? (
          <>
            <p className="mini-game-rating__note">
              {summaryError === "no_token"
                ? "Войдите в аккаунт, чтобы видеть баланс и множитель."
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
          <div className="mini-game-progress__shop-wrap">
            <div className="block-blast-game">
            <section
              className="block-blast-game__profile-cards mini-game-progress__shop-cards"
              aria-label="Баллы магазина и множитель лиги"
            >
              <article className="block-blast-game__profile-card">
                <h4 className="block-blast-game__profile-card-label">Баллы магазина</h4>
                <p
                  className="block-blast-game__profile-card-value block-blast-game__profile-card-value--compact"
                  aria-label={`${shopPointsBalance.toLocaleString("ru-RU")} баллов`}
                >
                  {shopPointsBalanceFormatted}
                </p>
              </article>
              <article className="block-blast-game__profile-card">
                <h4 className="block-blast-game__profile-card-label">Множитель баллов</h4>
                <p className="block-blast-game__profile-card-value block-blast-game__profile-card-value--compact">
                  {shopPointsMultiplierLabel}
                </p>
              </article>
            </section>

            <section
              className="block-blast-game__profile-cards mini-game-progress__shop-status-cards"
              aria-label="Жизни и защиты серии"
            >
              <article className="block-blast-game__profile-card">
                <h4 className="block-blast-game__profile-card-label">Жизни</h4>
                <div className="block-blast-game__profile-card-body">
                  {summaryLoadState !== "ready" ? (
                    <p className="block-blast-game__profile-card-value block-blast-game__profile-card-value--compact">
                      —
                    </p>
                  ) : (
                    <div
                      className="block-blast-game__attempts-hearts"
                      role="img"
                      aria-label={livesHeartsAria}
                    >
                      {Array.from({ length: livesMaxShown }, (_, i) => (
                        <span
                          key={i}
                          className={[
                            "block-blast-game__attempt-heart",
                            i < heartsFilled
                              ? "block-blast-game__attempt-heart_filled"
                              : "block-blast-game__attempt-heart_empty",
                          ].join(" ")}
                        >
                          <PixelHeartGlyph />
                        </span>
                      ))}
                    </div>
                  )}
                  {fastLifeRegenActive ? (
                    <p className="block-blast-game__profile-card-caption block-blast-game__profile-card-caption--muted mini-game-progress__fast-regen-caption">
                      Ускорение активно
                    </p>
                  ) : null}
                </div>
              </article>
              <article className="block-blast-game__profile-card">
                <h4 className="block-blast-game__profile-card-label">Защиты серии</h4>
                <div className="block-blast-game__profile-card-body">
                  {summaryLoadState !== "ready" ? (
                    <p className="block-blast-game__profile-card-value block-blast-game__profile-card-value--compact">
                      —
                    </p>
                  ) : (
                    <div
                      className="mini-game-progress__freeze-shields"
                      role="img"
                      aria-label={shopFreezeShieldsAria}
                    >
                      {Array.from({ length: streakShieldSlotsMax }, (_, i) => (
                        <span
                          key={i}
                          className={[
                            "mini-game-progress__freeze-shield",
                            i < streakShieldsFilledSlots
                              ? "mini-game-progress__freeze-shield_filled"
                              : "mini-game-progress__freeze-shield_empty",
                          ].join(" ")}
                        >
                          <img src={freezeShieldIcon} alt="" aria-hidden />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            </section>

            {shopLoadState === "loading" ? (
              <p className="mini-game-rating__note mini-game-progress__shop-catalog-note">Загрузка каталога…</p>
            ) : null}
            {shopLoadState === "error" ? (
              <>
                <p className="mini-game-rating__note mini-game-progress__shop-catalog-note">
                  Не удалось загрузить каталог магазина.
                </p>
                <button
                  type="button"
                  className="lk-dashboard__my-programs-catalog-banner-cta"
                  onClick={() => {
                    setShopLoadState("loading");
                    const token =
                      typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
                    if (!token) return;
                    fetchGamificationShop(token)
                      .then((data) => {
                        setShopPayload(data);
                        setShopLoadState("ready");
                      })
                      .catch(() => {
                        setShopLoadState("error");
                      });
                  }}
                >
                  Повторить
                </button>
              </>
            ) : null}

            {shopLoadState === "ready" && shopPayload?.items?.length ? (
              <div className="mini-game-progress__shop-catalog-sections">
                {shopItemsBoosters.length > 0 ? (
                  <section
                    className="mini-game-progress__shop-catalog-section"
                    aria-labelledby="mini-game-shop-boosters-heading"
                  >
                    <h3 id="mini-game-shop-boosters-heading" className="mini-game-progress__shop-section-heading">
                      Бустеры
                    </h3>
                    <div
                      className="block-blast-game__profile-cards mini-game-progress__shop-items"
                      role="list"
                      aria-label="Бустеры за баллы"
                    >
                      {shopItemsBoosters.map(renderShopCatalogItem)}
                    </div>
                  </section>
                ) : null}
                {shopItemsFrames.length > 0 ? (
                  <section
                    className="mini-game-progress__shop-catalog-section"
                    aria-labelledby="mini-game-shop-frames-heading"
                  >
                    <h3 id="mini-game-shop-frames-heading" className="mini-game-progress__shop-section-heading">
                      Рамки
                    </h3>
                    <div
                      className="block-blast-game__profile-cards mini-game-progress__shop-items"
                      role="list"
                      aria-label="Рамки поля мини-игры"
                    >
                      {shopItemsFrames.map(renderShopCatalogItem)}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}

            {shopFeedback?.type === "error" ? (
              <p
                className="mini-game-progress__shop-feedback mini-game-progress__shop-feedback--error"
                role="alert"
              >
                {shopFeedback.text}
              </p>
            ) : null}
            {shopFeedback?.type === "success" ? (
              <p className="mini-game-progress__shop-feedback mini-game-progress__shop-feedback--success" role="status">
                {shopFeedback.text}
              </p>
            ) : null}
            </div>
            {redeemLoadingCode != null || selectFrameBusyCode != null ? (
              <div
                className="mini-game-progress__shop-redeem-overlay"
                aria-live="polite"
                aria-busy="true"
                aria-label={selectFrameBusyCode != null ? "Смена рамки" : "Оформление покупки"}
              >
                <div className="mini-game-progress__shop-redeem-spinner" aria-hidden />
                <p className="mini-game-progress__shop-redeem-label">
                  {selectFrameBusyCode != null ? "Рамка…" : "Покупка…"}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        id="mini-game-progress-panel-achievements"
        role="tabpanel"
        aria-labelledby="mini-game-progress-tab-achievements"
        hidden={progressTab !== "achievements"}
        className="mini-game-progress__tab-panel mini-game-progress__tab-panel--achievements"
      >
        {achievementsLoadState === "loading" ? (
          <p className="mini-game-achievements__status">Загружаем достижения…</p>
        ) : null}
        {achievementsLoadState === "error" ? (
          <>
            <p className="mini-game-achievements__status mini-game-achievements__status--error">
              {achievementsError === "no_token"
                ? "Войдите в аккаунт, чтобы видеть достижения."
                : "Не удалось загрузить достижения."}
            </p>
            {achievementsError !== "no_token" ? (
              <button
                type="button"
                className="lk-dashboard__my-programs-catalog-banner-cta"
                onClick={() => setAchievementsRetryNonce((n) => n + 1)}
              >
                Повторить
              </button>
            ) : null}
          </>
        ) : null}
        {achievementsLoadState === "ready" && achievementsData ? (
          <div className="mini-game-achievements">
            <header className="mini-game-achievements__summary">
              {(() => {
                const x = Number(achievementsData.summary?.unlocked ?? 0);
                const y = Number(achievementsData.summary?.total ?? 0);
                const xp = Number(achievementsData.summary?.xp_from_achievements ?? 0);
                return (
                  <div className="mini-game-achievements__summary-rows">
                    <p className="mini-game-achievements__summary-line">
                      Получено:{" "}
                      <strong>
                        {x.toLocaleString("ru-RU")} из {y.toLocaleString("ru-RU")}
                      </strong>
                    </p>
                    <p className="mini-game-achievements__summary-line">
                      XP собрано:{" "}
                      <span className="mini-game-achievements__summary-xp-value">
                        {xp.toLocaleString("ru-RU")} XP
                      </span>
                    </p>
                  </div>
                );
              })()}
            </header>

            <nav className="mini-game-achievements__sections-nav" aria-label="Разделы достижений">
              {(() => {
                const items = Array.isArray(achievementsData.items) ? achievementsData.items : [];
                const cats = new Set();
                for (const it of items) {
                  cats.add(String(it.category || "other"));
                }
                const ordered = sortCategoryKeys(Array.from(cats));
                const chipClass = (active) =>
                  `mini-game-achievements__section-chip${active ? " mini-game-achievements__section-chip--active" : ""}`;
                return (
                  <>
                    <button
                      type="button"
                      className={chipClass(achievementCategoryFilter === "all")}
                      aria-pressed={achievementCategoryFilter === "all"}
                      onClick={() => setAchievementCategoryFilter("all")}
                    >
                      Все
                    </button>
                    {ordered.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        className={chipClass(achievementCategoryFilter === cat)}
                        aria-pressed={achievementCategoryFilter === cat}
                        onClick={() => setAchievementCategoryFilter(cat)}
                      >
                        {categoryBlockTitleRu(cat)}
                      </button>
                    ))}
                  </>
                );
              })()}
            </nav>

            <div className="mini-game-achievements__list">
              {(() => {
                const items = Array.isArray(achievementsData.items) ? achievementsData.items : [];
                const byCat = new Map();
                for (const it of items) {
                  const cat = String(it.category || "other");
                  if (!byCat.has(cat)) byCat.set(cat, []);
                  byCat.get(cat).push(it);
                }
                const keys = sortCategoryKeys(Array.from(byCat.keys()));
                const sections = keys
                  .map((cat) => [cat, sortAchievementsItems(byCat.get(cat) || [])])
                  .filter(([cat]) => achievementCategoryFilter === "all" || achievementCategoryFilter === cat);
                return sections.map(([cat, list]) => (
                  <section key={cat} className="mini-game-achievements__section" aria-label={categoryBlockTitleRu(cat)}>
                    <h2 className="mini-game-achievements__section-title">{categoryBlockTitleRu(cat)}</h2>
                    <ul className="mini-game-achievements__grid">
                      {list.map((a) => {
                        const target = Math.max(1, Number(a.target) || 1);
                        const current = Math.min(target, Math.max(0, Number(a.current) || 0));
                        const pct = Math.round((current / target) * 100);
                        const unlocked = Boolean(a.unlocked);
                        const xpReward = Number(a.xp_reward ?? 0);
                        const overlayDismissed = achievementDetailRevealed.has(a.code);
                        const showCompleteOverlay = unlocked && !overlayDismissed;
                        return (
                          <li key={a.code} className="mini-game-achievements__card-wrap">
                            <article
                              className={[
                                "mini-game-achievements__card",
                                unlocked ? "mini-game-achievements__card--unlocked" : "mini-game-achievements__card--locked",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              <div
                                className={[
                                  "mini-game-achievements__card-body",
                                  showCompleteOverlay ? "mini-game-achievements__card-body--blurred" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                              >
                                <h3 className="mini-game-achievements__card-title">{a.title}</h3>
                                <p className="mini-game-achievements__card-desc">{a.description}</p>
                                <div className="mini-game-achievements__facts">
                                  <p className="mini-game-achievements__fact">
                                    Прогресс:{" "}
                                    <span className="mini-game-achievements__fact-value">
                                      {current.toLocaleString("ru-RU")} / {target.toLocaleString("ru-RU")}
                                    </span>
                                  </p>
                                  <p className="mini-game-achievements__fact">
                                    Награда:{" "}
                                    <span className="mini-game-achievements__fact-value">
                                      +{xpReward.toLocaleString("ru-RU")} XP
                                    </span>
                                  </p>
                                </div>
                                <div
                                  className="mini-game-achievements__bar"
                                  role="progressbar"
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-valuenow={pct}
                                  aria-valuetext={`Прогресс ${current} из ${target}`}
                                >
                                  <div className="mini-game-achievements__bar-fill" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                              {showCompleteOverlay ? (
                                <div className="mini-game-achievements__card-complete-overlay">
                                  <div className="mini-game-achievements__card-complete-mark-slot">
                                    <img
                                      src={achievementDoneCheck}
                                      alt=""
                                      className="mini-game-achievements__card-complete-check-img"
                                      width={48}
                                      height={48}
                                      decoding="async"
                                    />
                                    <button
                                      type="button"
                                      className="mini-game-achievements__card-complete-reveal"
                                      aria-label="Показать детали достижения"
                                      onClick={() => {
                                        setAchievementDetailRevealed((prev) => new Set(prev).add(a.code));
                                      }}
                                    >
                                      <img src={achievementRevealEye} alt="" width={36} height={24} decoding="async" />
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </article>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ));
              })()}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
