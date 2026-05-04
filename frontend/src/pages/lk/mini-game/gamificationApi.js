import { API_ENDPOINTS } from "../../../config/api";

function bearerHeaders(token) {
  const h = { Accept: "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function jsonHeaders(token) {
  return {
    ...bearerHeaders(token),
    "Content-Type": "application/json",
  };
}

/**
 * GET /referrals/gamification/daily-challenge/leaderboard/
 */
export async function fetchGamificationDailyChallengeLeaderboard(token) {
  const res = await fetch(API_ENDPOINTS.gamificationDailyChallengeLeaderboard, {
    headers: bearerHeaders(token),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.detail || data?.code || "gamification_leaderboard_failed");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * GET /referrals/gamification/leaderboard/?period=week|month|all
 */
export async function fetchGamificationReferralLeaderboard(token, period = "month") {
  const q = new URLSearchParams({ period: String(period || "month") });
  const url = `${API_ENDPOINTS.gamificationReferralLeaderboard}?${q.toString()}`;
  const res = await fetch(url, {
    headers: bearerHeaders(token),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.detail || data?.code || "referral_leaderboard_failed");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * GET /referrals/gamification/shop/
 */
export async function fetchGamificationShop(token, options = {}) {
  const { signal } = options;
  const res = await fetch(API_ENDPOINTS.gamificationShop, {
    headers: bearerHeaders(token),
    cache: "no-store",
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.detail || data?.code || "gamification_shop_failed");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * POST /referrals/gamification/shop/redeem/
 * @param {{ reward_code: string, client_request_id: string }} payload
 */
/**
 * POST /referrals/gamification/shop/select-frame/
 * @param {{ frame_code: string }} payload
 */
export async function postGamificationShopSelectFrame(token, payload) {
  const res = await fetch(API_ENDPOINTS.gamificationShopSelectFrame, {
    method: "POST",
    headers: jsonHeaders(token),
    cache: "no-store",
    body: JSON.stringify({
      frame_code: payload.frame_code,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.detail || data?.code || "gamification_shop_select_frame_failed");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export async function postGamificationShopRedeem(token, payload) {
  const res = await fetch(API_ENDPOINTS.gamificationShopRedeem, {
    method: "POST",
    headers: jsonHeaders(token),
    cache: "no-store",
    body: JSON.stringify({
      reward_code: payload.reward_code,
      client_request_id: payload.client_request_id,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.detail || data?.code || "gamification_shop_redeem_failed");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * GET /referrals/gamification/summary/
 */
export async function fetchGamificationSummary(token) {
  const res = await fetch(API_ENDPOINTS.gamificationSummary, {
    headers: bearerHeaders(token),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.detail || data?.code || "gamification_summary_failed");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * POST /referrals/gamification/daily-challenge/start/
 */
export async function postGamificationDailyChallengeStart(token) {
  const res = await fetch(API_ENDPOINTS.gamificationDailyChallengeStart, {
    method: "POST",
    headers: jsonHeaders(token),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.detail || data?.code || "gamification_start_failed");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * POST /referrals/gamification/daily-challenge/finish/
 * @param {{ attemptId: string, moves: object[], clientScore: number }} payload
 */
export async function postGamificationDailyChallengeFinish(token, payload, options = {}) {
  const { signal } = options;
  const res = await fetch(API_ENDPOINTS.gamificationDailyChallengeFinish, {
    method: "POST",
    headers: jsonHeaders(token),
    cache: "no-store",
    body: JSON.stringify({
      attempt_id: payload.attemptId,
      moves: payload.moves,
      client_score: payload.clientScore,
    }),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.detail || data?.code || "gamification_finish_failed");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}
