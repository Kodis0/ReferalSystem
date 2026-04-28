import { API_ENDPOINTS } from "../../../config/api";

function authHeaders(token) {
  const h = { "Content-Type": "application/json" };
  if (token) {
    h.Authorization = `Bearer ${token}`;
  }
  return h;
}

/** @returns {{ ok: boolean, tickets?: Array, status?: number, detail?: string }} */
export async function fetchMySupportTickets() {
  const token = localStorage.getItem("access_token");
  if (!token) {
    return { ok: false, tickets: [], status: 401 };
  }
  try {
    const res = await fetch(API_ENDPOINTS.supportTickets, {
      headers: authHeaders(token),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        tickets: [],
        status: res.status,
        detail: typeof data.detail === "string" ? data.detail : "",
      };
    }
    const tickets = Array.isArray(data.tickets) ? data.tickets : [];
    return { ok: true, tickets };
  } catch {
    return { ok: false, tickets: [], detail: "network" };
  }
}

/** @returns {{ ok: boolean, ticket?: object, status?: number }} */
export async function fetchSupportTicketById(ticketId) {
  const token = localStorage.getItem("access_token");
  if (!token) {
    return { ok: false, status: 401 };
  }
  try {
    const res = await fetch(API_ENDPOINTS.supportTicketDetail(ticketId), {
      headers: authHeaders(token),
    });
    const ticket = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, ticket };
    }
    return { ok: true, ticket };
  } catch {
    return { ok: false, detail: "network" };
  }
}

/** @returns {Promise<{ ok: boolean, ticket?: object, status?: number }>} */
export async function patchSupportTicket(ticketId, payload) {
  const token = localStorage.getItem("access_token");
  if (!token) {
    return { ok: false, status: 401 };
  }
  try {
    const res = await fetch(API_ENDPOINTS.supportTicketDetail(ticketId), {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    const ticket = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, ticket };
    }
    return { ok: true, ticket };
  } catch {
    return { ok: false, detail: "network" };
  }
}

/** @returns {Promise<{ ok: boolean, ticket?: object, status?: number }>} */
export async function createSupportTicket(payload) {
  const token = localStorage.getItem("access_token");
  if (!token) {
    return { ok: false, status: 401 };
  }
  try {
    const res = await fetch(API_ENDPOINTS.supportTickets, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    const ticket = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, ticket };
    }
    return { ok: true, ticket };
  } catch {
    return { ok: false, detail: "network" };
  }
}
