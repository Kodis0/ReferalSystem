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
