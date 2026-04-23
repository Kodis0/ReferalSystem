import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";

export function ownerSitesAuthHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** @param {unknown} row */
export function normalizeOwnerSiteListRow(row) {
  if (!row || typeof row !== "object") return null;
  const publicId = String(row.public_id ?? "").trim();
  if (!isUuidString(publicId)) return null;
  const project = row.project && typeof row.project === "object" ? row.project : {};
  return {
    public_id: publicId,
    project_id: typeof row.project_id === "number" ? row.project_id : null,
    status: row.status,
    widget_enabled: Boolean(row.widget_enabled),
    allowed_origins_count: typeof row.allowed_origins_count === "number" ? row.allowed_origins_count : 0,
    primary_origin: typeof row.primary_origin === "string" ? row.primary_origin : "",
    platform_preset: typeof row.platform_preset === "string" ? row.platform_preset : "",
    display_name: typeof row.display_name === "string" ? row.display_name.trim() : "",
    description: typeof project.description === "string" ? project.description.trim() : "",
    project: {
      id: typeof project.id === "number" ? project.id : null,
      name: typeof project.name === "string" ? project.name.trim() : "",
      description: typeof project.description === "string" ? project.description.trim() : "",
      avatar_data_url: typeof project.avatar_data_url === "string" ? project.avatar_data_url.trim() : "",
    },
  };
}

/** @param {unknown} row */
export function normalizeOwnerProjectListRow(row) {
  if (!row || typeof row !== "object") return null;
  const rawProject = row.project && typeof row.project === "object" ? row.project : {};
  const sitesRaw = Array.isArray(row.sites) ? row.sites : [];
  const sites = sitesRaw.map(normalizeOwnerSiteListRow).filter(Boolean);
  const primarySitePublicId = String(row.primary_site_public_id ?? "").trim();
  const projectId =
    typeof row.id === "number"
      ? row.id
      : typeof rawProject.id === "number"
        ? rawProject.id
        : null;
  return {
    id: projectId,
    primary_site_public_id: isUuidString(primarySitePublicId) ? primarySitePublicId : sites[0]?.public_id || "",
    sites_count: typeof row.sites_count === "number" ? row.sites_count : sites.length,
    project: {
      id: projectId,
      name: typeof rawProject.name === "string" ? rawProject.name.trim() : "",
      description: typeof rawProject.description === "string" ? rawProject.description.trim() : "",
      avatar_data_url: typeof rawProject.avatar_data_url === "string" ? rawProject.avatar_data_url.trim() : "",
    },
    sites,
  };
}

export async function fetchOwnerSitesList() {
  const res = await fetch(API_ENDPOINTS.siteOwnerSites, {
    method: "GET",
    headers: ownerSitesAuthHeaders(),
    credentials: "include",
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = payload.detail;
    const detailMsg =
      typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
    return { ok: false, projects: [], sites: [], error: detailMsg || `Ошибка загрузки (${res.status})` };
  }
  const rawProjects = Array.isArray(payload.projects) ? payload.projects : [];
  const rawSites = Array.isArray(payload.sites) ? payload.sites : [];
  const projects = rawProjects.map(normalizeOwnerProjectListRow).filter(Boolean);
  const sites = rawSites.map(normalizeOwnerSiteListRow).filter(Boolean);
  return { ok: true, projects, sites, error: "" };
}
