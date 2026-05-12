/**
 * Изолированный auth-слой для админ-консоли.
 *
 * Токены ``admin_access_token``/``admin_refresh_token`` живут в localStorage отдельно
 * от обычных ``access_token``/``refresh_token`` — чтобы у админа не было «общего» LK access.
 *
 * ``adminFetch`` — тонкая обёртка над ``fetch``: автоматически проставляет Bearer-заголовок
 * с админским access-токеном. При ответе 401 чистит admin-токены и оповещает подписчиков
 * (``onAdminAuthExpired``) — AdminAccessGate ловит это и переводит UI в фазу login.
 */

const ACCESS_KEY = "admin_access_token";
const REFRESH_KEY = "admin_refresh_token";

function safeStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (_) {
    return null;
  }
}

export function getAdminAccessToken() {
  const s = safeStorage();
  if (!s) return null;
  try {
    return s.getItem(ACCESS_KEY) || null;
  } catch (_) {
    return null;
  }
}

export function setAdminAccessToken(token) {
  const s = safeStorage();
  if (!s) return;
  try {
    if (token) s.setItem(ACCESS_KEY, token);
    else s.removeItem(ACCESS_KEY);
  } catch (_) {
    /* ignore */
  }
}

export function getAdminRefreshToken() {
  const s = safeStorage();
  if (!s) return null;
  try {
    return s.getItem(REFRESH_KEY) || null;
  } catch (_) {
    return null;
  }
}

export function setAdminRefreshToken(token) {
  const s = safeStorage();
  if (!s) return;
  try {
    if (token) s.setItem(REFRESH_KEY, token);
    else s.removeItem(REFRESH_KEY);
  } catch (_) {
    /* ignore */
  }
}

export function clearAdminTokens() {
  setAdminAccessToken(null);
  setAdminRefreshToken(null);
}

const authExpiredListeners = new Set();

/** Подписка на «admin-token протух / отозван» (любой adminFetch получил 401). */
export function onAdminAuthExpired(listener) {
  if (typeof listener !== "function") return () => {};
  authExpiredListeners.add(listener);
  return () => {
    authExpiredListeners.delete(listener);
  };
}

function notifyAuthExpired() {
  authExpiredListeners.forEach((fn) => {
    try {
      fn();
    } catch (_) {
      /* ignore */
    }
  });
}

/**
 * Wrapper над ``fetch``: добавляет ``Authorization: Bearer <admin_access_token>``.
 *
 * При HTTP 401 вызывает ``clearAdminTokens`` + оповещает подписчиков (``onAdminAuthExpired``).
 * Возвращает оригинальный ``Response`` — вызывающий код решает, как реагировать (как и обычный ``fetch``).
 */
export async function adminFetch(url, options = {}) {
  const token = getAdminAccessToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    clearAdminTokens();
    notifyAuthExpired();
  }
  return response;
}
