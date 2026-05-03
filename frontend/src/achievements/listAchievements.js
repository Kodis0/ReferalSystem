import { API_ENDPOINTS } from "../config/api";

function bearerHeaders(token) {
  const h = { Accept: "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * GET /users/api/achievements/
 * @param {string} token JWT access token
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ items: object[], summary: { total: number, unlocked: number, xp_from_achievements: number } }>}
 */
export async function listAchievements(token, options = {}) {
  const { signal } = options;
  const res = await fetch(API_ENDPOINTS.usersAchievements, {
    headers: bearerHeaders(token),
    cache: "no-store",
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.detail || data?.code || "achievements_load_failed");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}
