const STORAGE_KEY = "lk_multi_accounts";

export function accountKeyFromUser(user) {
  if (!user || typeof user !== "object") return "";
  const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  if (email) return email;
  const username = typeof user.username === "string" ? user.username.trim().toLowerCase() : "";
  if (username) return username;
  if (user.id != null && user.id !== "") return String(user.id);
  return "";
}

function parseSavedList() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item) => ({
        ...item,
        key: item.key || accountKeyFromUser(item.user),
      }))
      .filter((item) => item.key && item.access_token && item.refresh_token);
  } catch {
    return [];
  }
}

function writeSavedListFromMap(map) {
  const out = [];
  for (const [, item] of map) {
    const key = item.key || accountKeyFromUser(item.user);
    if (!key || !item.access_token || !item.refresh_token) continue;
    out.push({
      key,
      access_token: item.access_token,
      refresh_token: item.refresh_token,
      user: item.user,
    });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
}

export function snapshotSessionFromLocalStorage() {
  const access_token = localStorage.getItem("access_token");
  const refresh_token = localStorage.getItem("refresh_token");
  const userRaw = localStorage.getItem("user");
  if (!access_token || !refresh_token || !userRaw) return null;
  let user;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return null;
  }
  const key = accountKeyFromUser(user);
  if (!key) return null;
  return { key, access_token, refresh_token, user };
}

/**
 * После входа вторым аккаунтом: сохранить предыдущую сессию и новую в списке переключения.
 * Вызывать до записи новых токенов в localStorage.
 */
export function mergeSessionsAfterBind({ newAccess, newRefresh, newUser }) {
  const prevSession = snapshotSessionFromLocalStorage();
  const map = new Map(parseSavedList().map((s) => [s.key, s]));
  if (prevSession) {
    map.set(prevSession.key, prevSession);
  }
  const newKey = accountKeyFromUser(newUser);
  if (newKey && newAccess && newRefresh && newUser) {
    map.set(newKey, {
      key: newKey,
      access_token: newAccess,
      refresh_token: newRefresh,
      user: newUser,
    });
  }
  writeSavedListFromMap(map);
}

/** Слоты для меню переключения (≥2 аккаунта). */
export function listSessionsForSwitcher(currentUser) {
  const list = parseSavedList();
  if (list.length < 2) return [];
  const currentKey = accountKeyFromUser(currentUser);
  return [...list].sort((a, b) => {
    const labelA = String(a.user?.email || a.key || "");
    const labelB = String(b.user?.email || b.key || "");
    const cmp = labelA.localeCompare(labelB, "ru");
    if (cmp !== 0) return cmp;
    if (a.key === currentKey) return 1;
    if (b.key === currentKey) return -1;
    return 0;
  });
}

/** Обновить запись в списке по текущему содержимому localStorage. */
export function persistCurrentSessionFromLs() {
  const s = snapshotSessionFromLocalStorage();
  if (!s) return;
  const map = new Map(parseSavedList().map((x) => [x.key, x]));
  map.set(s.key, s);
  writeSavedListFromMap(map);
}

export function applySessionToLocalStorage(session) {
  localStorage.setItem("access_token", session.access_token);
  localStorage.setItem("refresh_token", session.refresh_token);
  localStorage.setItem("user", JSON.stringify(session.user));
}

export function clearMultiAccounts() {
  localStorage.removeItem(STORAGE_KEY);
}
