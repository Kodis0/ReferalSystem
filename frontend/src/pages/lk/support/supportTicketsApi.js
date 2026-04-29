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
  const files = payload.files;
  const rest = { ...payload };
  delete rest.files;
  const hasFiles = Array.isArray(files) && files.length > 0;

  try {
    let res;
    if (hasFiles) {
      const fd = new FormData();
      if (rest.append_body != null) fd.append("append_body", String(rest.append_body));
      if (rest.attachment_names != null) fd.append("attachment_names", String(rest.attachment_names));
      files.forEach((f) => fd.append("files", f));
      res = await fetch(API_ENDPOINTS.supportTicketDetail(ticketId), {
        method: "PATCH",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
    } else {
      res = await fetch(API_ENDPOINTS.supportTicketDetail(ticketId), {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify(rest),
      });
    }
    const ticket = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, ticket };
    }
    return { ok: true, ticket };
  } catch {
    return { ok: false, detail: "network" };
  }
}

/** Удалить вложение тикета (файл на диске + запись в attachment_names). */
export async function deleteSupportTicketAttachment(ticketId, fileName) {
  const token = localStorage.getItem("access_token");
  if (!token) {
    return { ok: false, status: 401 };
  }
  try {
    const res = await fetch(API_ENDPOINTS.supportTicketAttachment(ticketId, fileName), {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  const files = payload.files;
  const rest = { ...payload };
  delete rest.files;
  const hasFiles = Array.isArray(files) && files.length > 0;

  try {
    let res;
    if (hasFiles) {
      const fd = new FormData();
      if (rest.type_slug != null) fd.append("type_slug", String(rest.type_slug));
      if (rest.body != null) fd.append("body", String(rest.body));
      if (rest.target_key != null) fd.append("target_key", String(rest.target_key));
      if (rest.target_label != null) fd.append("target_label", String(rest.target_label));
      if (rest.attachment_names != null) fd.append("attachment_names", String(rest.attachment_names));
      files.forEach((f) => fd.append("files", f));
      res = await fetch(API_ENDPOINTS.supportTickets, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
    } else {
      res = await fetch(API_ENDPOINTS.supportTickets, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify(rest),
      });
    }
    const ticket = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, ticket };
    }
    return { ok: true, ticket };
  } catch {
    return { ok: false, detail: "network" };
  }
}
