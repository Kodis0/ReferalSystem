import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe } from "lucide-react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import useCurrentUser from "../../../hooks/useCurrentUser";
import { dispatchLkProgramListsRefetch, LUMOREF_SITE_STATUS_CHANGED_EVENT } from "../lkProgramListsSync";
import { isUuidString } from "../../registration/postJoinNavigation";
import "../dashboard/dashboard.css";
import "../lk.css";
import "../partner/partner.css";
import "./owner-programs.css";
import { fetchOwnerSitesList } from "./ownerSitesListApi";
import { getSiteLifecycleStatus, sitePrimaryBrowseHref, sitePrimaryDomainLabel } from "./siteDisplay";
import { withSitePublicIdQuery } from "./siteReachability";
import SiteShellToolbarSubscriber from "./SiteShellToolbarSubscriber";
import { emitSiteOwnerActivity } from "./siteOwnerActivityBus";

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// Project-level shell never derives "current site" from a fallback chain. Site-level
// screens read useParams().sitePublicId directly. The shell only knows the route param
// (when on canonical site route) and the project's primary site (for project-level
// fallbacks like members loading), nothing else.
function buildProjectPath(projectId, section) {
  if (!(Number.isInteger(projectId) && projectId > 0)) return "/lk/partner";
  return `/lk/partner/project/${projectId}/${section}`;
}

function buildProjectSitePath(projectId, sitePublicId) {
  if (!(Number.isInteger(projectId) && projectId > 0)) return "/lk/partner";
  if (!sitePublicId) return `/lk/partner/project/${projectId}/sites`;
  return `/lk/partner/project/${projectId}/sites/${encodeURIComponent(sitePublicId)}`;
}

function tabClass({ isActive }) {
  return `owner-programs__tab ${isActive ? "owner-programs__tab_active" : ""}`;
}

function avatarDataUrlFromProject(projectMeta) {
  if (!projectMeta || typeof projectMeta !== "object") return "";
  const raw = projectMeta.avatar_data_url;
  return typeof raw === "string" ? raw.trim() : "";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_decode_failed"));
    img.src = source;
  });
}

async function fileToAvatarDataUrl(file) {
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;

  const srcWidth = image.naturalWidth || image.width || size;
  const srcHeight = image.naturalHeight || image.height || size;
  const scale = Math.max(size / srcWidth, size / srcHeight);
  const drawWidth = srcWidth * scale;
  const drawHeight = srcHeight * scale;
  const dx = (size - drawWidth) / 2;
  const dy = (size - drawHeight) / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
  return canvas.toDataURL("image/jpeg", 0.84);
}

function ProjectShellAvatarIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" viewBox="0 0 28 28" aria-hidden="true">
      <path
        fill="currentColor"
        d="M22.17 6.42h-1.56l-.39-1.22A3.66 3.66 0 0 0 16.75 2.5h-5.5a3.66 3.66 0 0 0-3.47 2.7l-.4 1.22H5.83A3.66 3.66 0 0 0 2.17 10.08v9.09a3.66 3.66 0 0 0 3.66 3.66h16.34a3.66 3.66 0 0 0 3.66-3.66v-9.09a3.66 3.66 0 0 0-3.66-3.66Zm1.22 12.75c0 .67-.55 1.22-1.22 1.22H5.83c-.67 0-1.22-.55-1.22-1.22v-9.09c0-.67.55-1.22 1.22-1.22H8.5c.53 0 1-.34 1.16-.84l.65-1.95c.17-.5.63-.84 1.15-.84h5.08c.52 0 .98.34 1.15.84l.65 1.95c.17.5.63.84 1.15.84h2.68c.67 0 1.22.55 1.22 1.22v9.09Z"
      />
      <path
        fill="currentColor"
        d="M14 9.33a4.67 4.67 0 1 0 0 9.34 4.67 4.67 0 0 0 0-9.34Zm0 6.9a2.23 2.23 0 1 1 0-4.46 2.23 2.23 0 0 1 0 4.46Z"
      />
    </svg>
  );
}

function CreateMenuChevronIcon({ open }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      fill="none"
      viewBox="0 0 14 14"
      aria-hidden="true"
      className={`owner-programs__create-menu-chevron${open ? " owner-programs__create-menu-chevron_open" : ""}`}
    >
      <path
        fill="currentColor"
        d="M7.53 9.4a1 1 0 0 1-.64-.22L3.4 6.38a1 1 0 1 1 1.24-1.58L7 6.66 9.36 4.8a1 1 0 1 1 1.24 1.58L8.13 9.17a1 1 0 0 1-.6.23Z"
      />
    </svg>
  );
}

function RemoveProjectIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20 6h-4V5a3 3 0 0 0-3-3h-2a3 3 0 0 0-3 3v1H4a1 1 0 0 0 0 2h1v11a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V8h1a1 1 0 1 0 0-2ZM10 5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1h-4V5Zm7 14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8h10v11Z"
      />
    </svg>
  );
}

function ProjectAvatarRemoveIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="none" viewBox="0 0 8 8" aria-hidden="true">
      <path
        fill="currentColor"
        d="m5.41 4 1.3-1.29a1 1 0 0 0-1.42-1.42L4 2.59l-1.29-1.3a1 1 0 1 0-1.42 1.42L2.59 4l-1.3 1.29a1 1 0 0 0 0 1.42 1 1 0 0 0 1.42 0L4 5.41l1.29 1.3a1 1 0 0 0 1.42 0 1 1 0 0 0 0-1.42L5.41 4Z"
      />
    </svg>
  );
}

export default function SiteProjectLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId, sitePublicId: routeSitePublicIdParam } = useParams();
  const numericProjectId = Number(projectId);
  const hasProjectId = Number.isInteger(numericProjectId) && numericProjectId > 0;
  const routeSitePublicId = isUuidString(routeSitePublicIdParam) ? routeSitePublicIdParam.trim() : "";
  const isSiteRouteShell = Boolean(routeSitePublicId);
  const projectBasePath = hasProjectId ? `/lk/partner/project/${numericProjectId}` : "/lk/partner";
  const [headLoading, setHeadLoading] = useState(true);
  const [headTitle, setHeadTitle] = useState("Проект");
  const [headComment, setHeadComment] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState("");
  const [avatarSaveState, setAvatarSaveState] = useState("idle");
  const [avatarError, setAvatarError] = useState("");
  const [avatarSuccessMessage, setAvatarSuccessMessage] = useState("");
  const [projectEntry, setProjectEntry] = useState(null);
  const [projectEntryLoading, setProjectEntryLoading] = useState(false);
  const [projectEntryError, setProjectEntryError] = useState("");
  const [addSiteOpen, setAddSiteOpen] = useState(false);
  const [addSiteDisplayName, setAddSiteDisplayName] = useState("");
  const [addSiteOrigin, setAddSiteOrigin] = useState("");
  const [addSitePlatform, setAddSitePlatform] = useState("tilda");
  const [addSiteState, setAddSiteState] = useState("idle");
  const [addSiteError, setAddSiteError] = useState("");
  const [createdSitePublicId, setCreatedSitePublicId] = useState("");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [deleteProjectDialogOpen, setDeleteProjectDialogOpen] = useState(false);
  const [deleteProjectState, setDeleteProjectState] = useState("idle");
  const [deleteProjectError, setDeleteProjectError] = useState("");
  const [siteShellToolbar, setSiteShellToolbarSlot] = useState(null);
  const setSiteShellToolbar = useCallback((node) => {
    setSiteShellToolbarSlot(node);
  }, []);
  const createMenuRef = useRef(null);
  const locationViewMode = location.state?.projectViewMode;
  const { user } = useCurrentUser();
  const partnerAccountAvatarUrl =
    typeof user?.avatar_data_url === "string" ? user.avatar_data_url.trim() : "";
  /** На маршруте сайта: фото сайта или то же фото, что в настройках аккаунта партнёра. */
  const siteShellVisualSrc = isSiteRouteShell ? avatarDataUrl || partnerAccountAvatarUrl : "";
  // Project's primary site: for project-level pages that resolve a default site where
  // the URL does not carry :sitePublicId (e.g. legacy settings). Not used for /members.
  // It must NOT be used as a substitute for canonical :sitePublicId when rendering
  // a site-level screen.
  const primarySitePublicId = useMemo(() => {
    const raw =
      typeof projectEntry?.primary_site_public_id === "string" ? projectEntry.primary_site_public_id.trim() : "";
    return isUuidString(raw) ? raw : "";
  }, [projectEntry]);
  const buildScopedProjectPath = useCallback(
    (section) => buildProjectPath(numericProjectId, section),
    [numericProjectId],
  );
  const buildScopedProjectSitePath = useCallback(
    (sitePublicIdOverride) => buildProjectSitePath(numericProjectId, sitePublicIdOverride),
    [numericProjectId],
  );

  /** Текущий сайт из пути — только для вкладок уровня сервиса (`/sites/:sitePublicId/...`). */
  const shellScopedSitePublicIdForNav = useMemo(() => {
    if (routeSitePublicId) return routeSitePublicId;
    return "";
  }, [routeSitePublicId]);

  /** Вкладка «Дашборд» на маршруте конкретного сайта. */
  const dashboardSiteNavPath = useMemo(() => {
    if (!hasProjectId) return "/lk/partner";
    if (shellScopedSitePublicIdForNav) {
      return `${buildScopedProjectSitePath(shellScopedSitePublicIdForNav)}/dashboard`;
    }
    return buildScopedProjectPath("sites");
  }, [buildScopedProjectPath, buildScopedProjectSitePath, hasProjectId, shellScopedSitePublicIdForNav]);

  /** Вкладка «Виджет» на маршруте конкретного сайта. */
  const widgetSiteNavPath = useMemo(() => {
    if (!hasProjectId) return "/lk/partner";
    if (shellScopedSitePublicIdForNav) return `${buildScopedProjectSitePath(shellScopedSitePublicIdForNav)}/widget`;
    return buildScopedProjectPath("sites");
  }, [buildScopedProjectPath, buildScopedProjectSitePath, hasProjectId, shellScopedSitePublicIdForNav]);

  /** Вкладка «Блок для сайта» — готовый HTML-блок для Tilda и др. */
  const referralBlockSiteNavPath = useMemo(() => {
    if (!hasProjectId) return "/lk/partner";
    if (shellScopedSitePublicIdForNav) {
      return `${buildScopedProjectSitePath(shellScopedSitePublicIdForNav)}/referral-block`;
    }
    return buildScopedProjectPath("sites");
  }, [buildScopedProjectPath, buildScopedProjectSitePath, hasProjectId, shellScopedSitePublicIdForNav]);

  /** Вкладка «Участники» на маршруте конкретного сайта. */
  const membersSiteNavPath = useMemo(() => {
    if (!hasProjectId) return "/lk/partner";
    if (shellScopedSitePublicIdForNav) return `${buildScopedProjectSitePath(shellScopedSitePublicIdForNav)}/members`;
    return buildScopedProjectPath("sites");
  }, [buildScopedProjectPath, buildScopedProjectSitePath, hasProjectId, shellScopedSitePublicIdForNav]);

  /** Вкладка «История» — журнал изменений сайта. */
  const historySiteNavPath = useMemo(() => {
    if (!hasProjectId) return "/lk/partner";
    if (shellScopedSitePublicIdForNav) return `${buildScopedProjectSitePath(shellScopedSitePublicIdForNav)}/history`;
    return buildScopedProjectPath("sites");
  }, [buildScopedProjectPath, buildScopedProjectSitePath, hasProjectId, shellScopedSitePublicIdForNav]);

  /** Вкладка «Настройки» только на маршруте конкретного сайта (в проекте вкладки нет). */
  const settingsSiteNavPath = useMemo(() => {
    if (!hasProjectId) return "/lk/partner";
    if (shellScopedSitePublicIdForNav) return `${buildScopedProjectSitePath(shellScopedSitePublicIdForNav)}/settings`;
    return buildScopedProjectPath("sites");
  }, [buildScopedProjectPath, buildScopedProjectSitePath, hasProjectId, shellScopedSitePublicIdForNav]);

  const projectServicesNavPath = useMemo(() => buildScopedProjectPath("sites"), [buildScopedProjectPath]);
  const projectOverviewNavPath = useMemo(() => buildScopedProjectPath("overview"), [buildScopedProjectPath]);
  const projectMembersNavPath = useMemo(() => buildScopedProjectPath("members"), [buildScopedProjectPath]);

  /** «Назад» из оболочки сайта: например в Настройки → История, если пришли по ссылке из ленты. */
  const siteShellBackLinkTo = useMemo(() => {
    const raw = location.state?.ownerShellBackTo;
    if (typeof raw === "string" && raw.startsWith("/")) return raw;
    return projectServicesNavPath;
  }, [location.state, projectServicesNavPath]);

  const siteTabNavigationState =
    isSiteRouteShell && location.state && typeof location.state === "object" ? location.state : undefined;

  useEffect(() => {
    function handlePointerDown(event) {
      if (!createMenuRef.current || createMenuRef.current.contains(event.target)) return;
      setCreateMenuOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setCreateMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!deleteProjectDialogOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape" && deleteProjectState !== "deleting") {
        setDeleteProjectDialogOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteProjectDialogOpen, deleteProjectState]);

  const loadProjectEntry = useCallback(
    async (projectId, options = {}) => {
      const silent = Boolean(options.silent);
      if (!silent) {
        setProjectEntryLoading(true);
        setProjectEntryError("");
      }
      try {
        const { ok, projects = [], error } = await fetchOwnerSitesList();
        if (!ok) {
          setProjectEntry(null);
          setProjectEntryError(error || "Не удалось загрузить сайты проекта");
          return null;
        }
        const nextEntry = projects.find((project) => (projectId != null ? project.id === projectId : false)) || null;
        setProjectEntry(nextEntry);
        if (silent) {
          setProjectEntryError("");
        }
        return nextEntry;
      } catch (err) {
        console.error(err);
        setProjectEntry(null);
        setProjectEntryError("Не удалось загрузить сайты проекта");
        return null;
      } finally {
        if (!silent) {
          setProjectEntryLoading(false);
        }
      }
    },
    [],
  );

  const loadHead = useCallback(async () => {
    if (!hasProjectId) return;
    setHeadLoading(true);
    setAvatarSuccessMessage("");
    try {
      const { ok, projects = [], error } = await fetchOwnerSitesList();
      if (!ok) {
        setHeadTitle("Проект");
        setHeadComment("");
        setAvatarDataUrl("");
        setProjectEntry(null);
        setAvatarError(error || "Не удалось загрузить проект");
        return;
      }

      const nextEntry = projects.find((project) => project.id === numericProjectId) || null;
      if (!nextEntry) {
        setHeadTitle("Проект");
        setHeadComment("");
        setAvatarDataUrl("");
        setProjectEntry(null);
        setAvatarError("Проект не найден или нет доступа");
        return;
      }

      const projectName = typeof nextEntry?.project?.name === "string" ? nextEntry.project.name.trim() : "";
      const projectDescription =
        typeof nextEntry?.project?.description === "string" ? nextEntry.project.description.trim() : "";
      setProjectEntry(nextEntry);
      if (routeSitePublicId) {
        const row = Array.isArray(nextEntry.sites)
          ? nextEntry.sites.find((s) => s.public_id === routeSitePublicId)
          : null;
        const raw = row && typeof row.avatar_data_url === "string" ? row.avatar_data_url.trim() : "";
        setAvatarDataUrl(raw);
      } else {
        setAvatarDataUrl(avatarDataUrlFromProject(nextEntry.project));
      }
      setHeadTitle(projectName || "Проект");
      setHeadComment(projectDescription);
      setAvatarError("");
    } catch {
      setHeadTitle("Проект");
      setHeadComment("");
      setAvatarDataUrl("");
      setProjectEntry(null);
      setAvatarError("Сетевая ошибка");
    } finally {
      setHeadLoading(false);
    }
  }, [hasProjectId, numericProjectId, routeSitePublicId]);

  useEffect(() => {
    loadHead();
  }, [loadHead]);

  useEffect(() => {
    if (!hasProjectId) return undefined;
    const handleProjectSiteDeleted = (event) => {
      const detail = event instanceof CustomEvent && event.detail ? event.detail : {};
      const eventProjectId = Number(detail.projectId);
      const sitePublicId = typeof detail.sitePublicId === "string" ? detail.sitePublicId.trim() : "";
      if (eventProjectId !== numericProjectId || !isUuidString(sitePublicId)) return;
      setProjectEntry((prev) => {
        if (!prev || !Array.isArray(prev.sites)) return prev;
        const sites = prev.sites.filter((site) => site.public_id !== sitePublicId);
        return sites.length === prev.sites.length ? prev : { ...prev, sites };
      });
    };
    const handleOwnerProjectsUpdated = () => {
      loadHead();
    };
    window.addEventListener("lk-project-site-deleted", handleProjectSiteDeleted);
    window.addEventListener("lk-owner-projects-updated", handleOwnerProjectsUpdated);
    return () => {
      window.removeEventListener("lk-project-site-deleted", handleProjectSiteDeleted);
      window.removeEventListener("lk-owner-projects-updated", handleOwnerProjectsUpdated);
    };
  }, [hasProjectId, loadHead, numericProjectId]);

  useEffect(() => {
    if (!hasProjectId || !isUuidString(createdSitePublicId) || addSiteState === "saving") return;
    const widgetPath = buildScopedProjectPath("widget");
    const onWidgetPath = location.pathname === `${projectBasePath}/widget`;
    const stateConnectId =
      typeof location.state?.sitePublicIdForConnect === "string"
        ? location.state.sitePublicIdForConnect.trim()
        : "";
    if (onWidgetPath && stateConnectId === createdSitePublicId) {
      setCreatedSitePublicId("");
      return;
    }
    navigate(widgetPath, {
      replace: true,
      state: { projectViewMode: "connect-site", sitePublicIdForConnect: createdSitePublicId },
    });
  }, [
    addSiteState,
    buildScopedProjectPath,
    createdSitePublicId,
    hasProjectId,
    location.pathname,
    location.state,
    navigate,
    projectBasePath,
  ]);

  useEffect(() => {
    setAddSiteOpen(false);
    setAddSiteDisplayName("");
    setAddSiteError("");
    setAddSiteState("idle");
    setAvatarSuccessMessage("");
    setCreateMenuOpen(false);
  }, [projectBasePath]);

  useEffect(() => {
    if (locationViewMode === "overview") {
      setAddSiteOpen(false);
      setAddSiteDisplayName("");
      setAddSiteError("");
      setAddSiteState("idle");
      setCreateMenuOpen(false);
      return;
    }
    if (locationViewMode === "create-site") {
      setAddSiteOpen(true);
      setAddSiteError("");
      setAddSiteState("idle");
      setCreateMenuOpen(false);
    }
  }, [location.key, locationViewMode]);

  useEffect(() => {
    if (isSiteRouteShell) setCreateMenuOpen(false);
  }, [isSiteRouteShell]);

  // Site-scoped shell (`/sites/:sitePublicId/...`): path wins over `?site_public_id=`; strip only on mismatch.
  useEffect(() => {
    if (!isSiteRouteShell || !routeSitePublicId) return;
    const params = new URLSearchParams(location.search);
    const raw = params.get("site_public_id");
    const q = typeof raw === "string" ? raw.trim() : "";
    if (!q) return;
    if (q.toLowerCase() === routeSitePublicId.trim().toLowerCase()) return;
    params.delete("site_public_id");
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "" },
      { replace: true, state: location.state },
    );
  }, [isSiteRouteShell, routeSitePublicId, location.pathname, location.search, location.state, navigate]);

  const saveAvatar = useCallback(
    async (nextAvatarDataUrl, successMessage) => {
      const url = API_ENDPOINTS.projectDetail(numericProjectId);
      const res = await fetch(url, {
        method: "PATCH",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ avatar_data_url: nextAvatarDataUrl }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = payload?.code ?? payload?.detail;
        const detailMsg =
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail.join("\n")
              : detail != null
                ? String(detail)
                : "";
        throw new Error(detailMsg || `Не удалось сохранить фото (${res.status})`);
      }

      const project = payload?.project && typeof payload.project === "object" ? payload.project : {};
      const projectName = typeof project.name === "string" ? project.name.trim() : "";
      const projectDescription = typeof project.description === "string" ? project.description.trim() : "";
      const nextAvatar = avatarDataUrlFromProject(project) || nextAvatarDataUrl;

      setProjectEntry(payload && typeof payload === "object" ? payload : null);
      setAvatarDataUrl(nextAvatar);
      setHeadTitle(projectName || "Проект");
      setHeadComment(projectDescription);

      setAvatarSaveState("success");
      setAvatarSuccessMessage(successMessage);
      window.dispatchEvent(new CustomEvent("lk-project-avatar-updated"));
      dispatchLkProgramListsRefetch();
      window.setTimeout(() => {
        setAvatarSaveState("idle");
        setAvatarSuccessMessage("");
      }, 1800);
    },
    [numericProjectId],
  );

  const saveSiteAvatar = useCallback(
    async (nextAvatarDataUrl, successMessage) => {
      if (!routeSitePublicId) {
        throw new Error("Не удалось определить сайт");
      }
      const res = await fetch(withSitePublicIdQuery(API_ENDPOINTS.siteIntegration, routeSitePublicId), {
        method: "PATCH",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ site_avatar_data_url: nextAvatarDataUrl }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = payload?.code ?? payload?.detail;
        const detailMsg =
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail.join("\n")
              : detail != null
                ? String(detail)
                : "";
        throw new Error(detailMsg || `Не удалось сохранить фото (${res.status})`);
      }
      const fromApi =
        typeof payload.site_avatar_data_url === "string" ? payload.site_avatar_data_url.trim() : "";
      setAvatarDataUrl(fromApi || nextAvatarDataUrl);
      await loadHead();
      setAvatarSaveState("success");
      setAvatarSuccessMessage(successMessage);
      window.dispatchEvent(
        new CustomEvent("lk-site-avatar-updated", { detail: { sitePublicId: routeSitePublicId } }),
      );
      emitSiteOwnerActivity(routeSitePublicId);
      dispatchLkProgramListsRefetch();
      window.setTimeout(() => {
        setAvatarSaveState("idle");
        setAvatarSuccessMessage("");
      }, 1800);
    },
    [routeSitePublicId, loadHead],
  );

  const siteRowForShell = useMemo(() => {
    if (!routeSitePublicId || !Array.isArray(projectEntry?.sites)) return null;
    return projectEntry.sites.find((row) => row.public_id === routeSitePublicId) || null;
  }, [projectEntry, routeSitePublicId]);

  useEffect(() => {
    if (!routeSitePublicId) return undefined;
    function onSiteStatusChanged(event) {
      const detail = event?.detail || {};
      const changedSiteId = String(detail.site_public_id || "").trim();
      if (changedSiteId && changedSiteId !== routeSitePublicId) return;
      const nextStatus = typeof detail.site_status === "string" ? detail.site_status.trim() : "";
      const hasWidgetEnabled = typeof detail.widget_enabled === "boolean";
      if (!nextStatus && !hasWidgetEnabled) return;
      setProjectEntry((prev) => {
        if (!prev || !Array.isArray(prev.sites)) return prev;
        let changed = false;
        const sites = prev.sites.map((site) => {
          if (site?.public_id !== routeSitePublicId) return site;
          const nextSite = {
            ...site,
            ...(nextStatus ? { status: nextStatus } : {}),
            ...(hasWidgetEnabled ? { widget_enabled: detail.widget_enabled } : {}),
          };
          changed = changed || nextSite.status !== site.status || nextSite.widget_enabled !== site.widget_enabled;
          return nextSite;
        });
        return changed ? { ...prev, sites } : prev;
      });
    }
    window.addEventListener(LUMOREF_SITE_STATUS_CHANGED_EVENT, onSiteStatusChanged);
    return () => window.removeEventListener(LUMOREF_SITE_STATUS_CHANGED_EVENT, onSiteStatusChanged);
  }, [routeSitePublicId]);

  const handleAvatarChange = useCallback(
    async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      if (!file) return;
      if (!hasProjectId) {
        setAvatarError("Фото сейчас недоступно");
        return;
      }
      if (isSiteRouteShell && !routeSitePublicId) {
        setAvatarError("Не удалось определить сайт");
        return;
      }

      if (!file.type.startsWith("image/")) {
        setAvatarError("Нужен файл изображения");
        return;
      }

      setAvatarSaveState("saving");
      setAvatarError("");
      setAvatarSuccessMessage("");

      try {
        const nextAvatarDataUrl = await fileToAvatarDataUrl(file);
        if (isSiteRouteShell) {
          await saveSiteAvatar(nextAvatarDataUrl, "Фото сохранено");
        } else {
          await saveAvatar(nextAvatarDataUrl, "Фото сохранено");
        }
      } catch (err) {
        console.error(err);
        setAvatarSaveState("error");
        setAvatarSuccessMessage("");
        setAvatarError(err instanceof Error && err.message ? err.message : "Не удалось сохранить фото");
      }
    },
    [hasProjectId, isSiteRouteShell, routeSitePublicId, saveAvatar, saveSiteAvatar],
  );

  const handleAvatarRemove = useCallback(
    async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!hasProjectId || avatarSaveState === "saving") return;
      if (isSiteRouteShell && !routeSitePublicId) return;

      const removeUploadedSiteAvatar = Boolean(isSiteRouteShell && avatarDataUrl);
      const removeUploadedProjectAvatar = !isSiteRouteShell && Boolean(avatarDataUrl);

      if (!removeUploadedSiteAvatar && !removeUploadedProjectAvatar) return;

      setAvatarSaveState("saving");
      setAvatarError("");
      setAvatarSuccessMessage("");

      try {
        if (removeUploadedSiteAvatar) {
          await saveSiteAvatar("", "Фото удалено");
        } else {
          await saveAvatar("", "Фото удалено");
        }
      } catch (err) {
        console.error(err);
        setAvatarSaveState("error");
        setAvatarSuccessMessage("");
        setAvatarError(err instanceof Error && err.message ? err.message : "Не удалось удалить фото");
      }
    },
    [
      avatarDataUrl,
      avatarSaveState,
      hasProjectId,
      isSiteRouteShell,
      routeSitePublicId,
      saveAvatar,
      saveSiteAvatar,
    ],
  );

  const toggleAddSiteForm = useCallback(() => {
    setAddSiteOpen((value) => !value);
    setAddSiteDisplayName("");
    setAddSiteError("");
    setAddSiteState("idle");
  }, []);

  const openCreateSite = useCallback(() => {
    setCreateMenuOpen(false);
    setAddSiteOpen(true);
    setAddSiteDisplayName("");
    setAddSiteError("");
    setAddSiteState("idle");
    if (!location.pathname.endsWith("/sites")) {
      navigate(buildScopedProjectPath("sites"), { state: { projectViewMode: "create-site" } });
    }
  }, [buildScopedProjectPath, location.pathname, navigate]);

  const openProjectInfo = useCallback(() => {
    navigate(buildScopedProjectPath("info"));
  }, [buildScopedProjectPath, navigate]);

  const openSiteSettings = useCallback(() => {
    if (!shellScopedSitePublicIdForNav) return;
    if (location.pathname === settingsSiteNavPath) return;
    navigate(settingsSiteNavPath);
  }, [location.pathname, navigate, settingsSiteNavPath, shellScopedSitePublicIdForNav]);

  const openDeleteProjectDialog = useCallback(() => {
    setDeleteProjectError("");
    setDeleteProjectDialogOpen(true);
  }, []);

  const closeDeleteProjectDialog = useCallback(() => {
    if (deleteProjectState === "deleting") return;
    setDeleteProjectDialogOpen(false);
  }, [deleteProjectState]);

  const handleDeleteProject = useCallback(async () => {
    if (typeof projectEntry?.id !== "number") return;
    setDeleteProjectState("deleting");
    setDeleteProjectError("");
    try {
      const res = await fetch(API_ENDPOINTS.projectDetail(projectEntry.id), {
        method: "DELETE",
        headers: authHeaders(),
        credentials: "include",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = payload?.code ?? payload?.detail;
        const detailMsg =
          typeof detail === "string" ? detail : Array.isArray(detail) ? detail.join("\n") : detail != null ? String(detail) : "";
        throw new Error(detailMsg || `Не удалось удалить проект (${res.status})`);
      }
      setDeleteProjectDialogOpen(false);
      window.dispatchEvent(new Event("lk-owner-projects-updated"));
      navigate("/lk/partner", { replace: true });
    } catch (err) {
      console.error(err);
      setDeleteProjectState("error");
      setDeleteProjectError(err instanceof Error && err.message ? err.message : "Не удалось удалить проект");
    }
  }, [navigate, projectEntry?.id]);

  const handleAddSite = useCallback(
    async (event) => {
      event.preventDefault();
      if (typeof projectEntry?.id !== "number") return;
      setAddSiteState("saving");
      setAddSiteError("");
      setCreatedSitePublicId("");
      try {
        const body = {
          site_display_name: addSiteDisplayName.trim(),
          origin: addSiteOrigin.trim(),
          platform_preset: addSitePlatform,
        };
        const res = await fetch(API_ENDPOINTS.projectSiteCreate(projectEntry.id), {
          method: "POST",
          headers: authHeaders(),
          credentials: "include",
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = payload?.code ?? payload?.detail;
          const detailMsg =
            typeof detail === "string"
              ? detail
              : Array.isArray(detail)
                ? detail.join("\n")
                : detail != null
                  ? String(detail)
                  : "";
          throw new Error(detailMsg || `Не удалось добавить сайт (${res.status})`);
        }
        const nextSiteId = typeof payload?.public_id === "string" ? payload.public_id.trim() : "";
        await loadProjectEntry(projectEntry.id);
        setAddSiteDisplayName("");
        setAddSiteOrigin("");
        setAddSitePlatform("tilda");
        setAddSiteOpen(false);
        setAddSiteState("success");
        if (isUuidString(nextSiteId)) {
          setCreatedSitePublicId(nextSiteId);
          navigate(buildScopedProjectPath("widget"), {
            replace: true,
            state: { projectViewMode: "connect-site", sitePublicIdForConnect: nextSiteId },
          });
        }
      } catch (err) {
        console.error(err);
        setAddSiteState("error");
        setAddSiteError(err instanceof Error && err.message ? err.message : "Не удалось добавить сайт");
      }
    },
    [addSiteDisplayName, addSiteOrigin, addSitePlatform, buildScopedProjectPath, navigate, loadProjectEntry, projectEntry],
  );

  const projectComment =
    (typeof projectEntry?.project?.description === "string" ? projectEntry.project.description.trim() : "") || headComment;

  const shellTitleText = isSiteRouteShell
    ? headLoading && !siteRowForShell
      ? "Сайт…"
      : (typeof siteRowForShell?.display_name === "string" ? siteRowForShell.display_name.trim() : "") || "Сайт"
    : headLoading
      ? "Проект…"
      : headTitle;
  const siteShellOrigin = sitePrimaryDomainLabel(siteRowForShell);
  const siteBrowseHref = useMemo(() => sitePrimaryBrowseHref(siteRowForShell), [siteRowForShell]);
  const openSitePrimaryInNewTab = useCallback(() => {
    if (!siteBrowseHref) return;
    window.open(siteBrowseHref, "_blank", "noopener,noreferrer");
  }, [siteBrowseHref]);
  const isProjectInfoPage = location.pathname === `${projectBasePath}/info`;
  const hideShellChromeForSiteCreate = addSiteOpen;
  const onProjectWidgetConnectPath =
    hasProjectId && location.pathname === `${projectBasePath}/widget` && locationViewMode === "connect-site";
  const hideShellChromeForFocusedConnect = onProjectWidgetConnectPath;
  const hideShellChrome = hideShellChromeForSiteCreate || hideShellChromeForFocusedConnect;

  const isDefaultProject = Boolean(
    projectEntry?.project?.is_default || projectEntry?.is_default || headTitle === "Общий проект",
  );

  useEffect(() => {
    if (!isSiteRouteShell || hideShellChrome || isProjectInfoPage) {
      setSiteShellToolbarSlot(null);
    }
  }, [hideShellChrome, isProjectInfoPage, isSiteRouteShell]);

  const outletContext = useMemo(
    () => ({
      base: projectBasePath,
      // Project-level outlet context never advertises a "current" site id derived from
      // route/query/state/fallback. Site-level pages must read useParams().sitePublicId
      // directly. primarySitePublicId is exposed strictly for project-level pages
      // (members/settings) that need a default site without owning a site route.
      primarySitePublicId,
      projectId: hasProjectId ? numericProjectId : null,
      headLoading,
      projectEntry,
      reloadProjectEntry: loadProjectEntry,
      projectEntryLoading,
      projectEntryError,
      addSiteOpen,
      addSiteDisplayName,
      addSiteOrigin,
      addSitePlatform,
      addSiteState,
      addSiteError,
      setAddSiteDisplayName,
      setAddSiteOrigin,
      setAddSitePlatform,
      reloadProjectHead: loadHead,
      buildProjectPath: buildScopedProjectPath,
      buildProjectSitePath: buildScopedProjectSitePath,
      projectBasePath,
      toggleAddSiteForm,
      handleAddSite,
      setSiteShellToolbar,
    }),
    [
      addSiteError,
      addSiteOpen,
      addSiteOrigin,
      addSitePlatform,
      addSiteState,
      buildScopedProjectPath,
      buildScopedProjectSitePath,
      handleAddSite,
      headLoading,
      hasProjectId,
      primarySitePublicId,
      projectBasePath,
      projectEntry,
      projectEntryError,
      projectEntryLoading,
      loadProjectEntry,
      loadHead,
      numericProjectId,
      toggleAddSiteForm,
      setSiteShellToolbar,
    ],
  );

  if (!hasProjectId) {
    return <Navigate to="/lk/partner" replace />;
  }

  const shellLifecycle = getSiteLifecycleStatus(siteRowForShell);
  const showSiteLifecycle = Boolean(isSiteRouteShell && !headLoading && siteRowForShell);

  const shellBusy = headLoading && !hideShellChrome;

  const shellAvatarHasMedia = isSiteRouteShell ? Boolean(siteShellVisualSrc) : Boolean(avatarDataUrl);
  const shellAvatarShowImage = isSiteRouteShell ? Boolean(siteShellVisualSrc) : Boolean(avatarDataUrl);
  const shellAvatarImageSrc = isSiteRouteShell ? siteShellVisualSrc : avatarDataUrl;
  const shellAvatarShowRemove = isSiteRouteShell ? Boolean(siteShellVisualSrc && avatarDataUrl) : Boolean(avatarDataUrl);

  return (
    <div
      className={`lk-dashboard lk-partner owner-programs__shell${
        hideShellChrome ? " owner-programs__shell_first-site-connect" : ""
      }`}
      aria-busy={shellBusy ? true : undefined}
    >
      {!isProjectInfoPage && !hideShellChrome ? (
        <>
          {isSiteRouteShell ? (
            <div className="page__returnButton owner-programs__shell-site-back">
              <Link
                className="tw-link link_primary link_s"
                to={siteShellBackLinkTo}
                data-testid="project-site-shell-back"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="7" height="13" fill="none" viewBox="0 0 7 13" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M1 6.99a1 1 0 0 1 .23-.64l4-5a1 1 0 0 1 1.54 1.29L3.29 6.99l3.32 4.35a1 1 0 0 1-.15 1.4A1 1 0 0 1 5 12.62l-3.83-5A1 1 0 0 1 1 7Z"
                  />
                </svg>
                Назад
              </Link>
            </div>
          ) : null}
          <header className="owner-programs__shell-header">
            {headLoading ? (
              <>
                <div className="owner-programs__shell-header-skel-main">
                  <span className="owner-programs__skel owner-programs__shell-header-skel-avatar" aria-hidden />
                  <div className="owner-programs__shell-header-skel-copy">
                    <span className="owner-programs__skel owner-programs__shell-header-skel-line_title" aria-hidden />
                    <span className="owner-programs__skel owner-programs__shell-header-skel-line_sub" aria-hidden />
                    {isSiteRouteShell ? (
                      <span className="owner-programs__skel owner-programs__shell-header-skel-line_meta" aria-hidden />
                    ) : null}
                  </div>
                </div>
                <div className="owner-programs__shell-header-skel-actions">
                  <span
                    className={`owner-programs__skel owner-programs__shell-header-skel-pill${
                      isSiteRouteShell ? "" : " owner-programs__shell-header-skel-pill_wide"
                    }`}
                    aria-hidden
                  />
                </div>
              </>
            ) : (
              <>
                <div className="owner-programs__shell-header-main">
                  <div className="owner-programs__shell-avatar-wrap">
                    <label
                      className={`owner-programs__shell-avatar owner-programs__shell-avatar_action${
                        shellAvatarHasMedia ? " owner-programs__shell-avatar_has-media" : ""
                      }${avatarSaveState === "saving" ? " owner-programs__shell-avatar_loading" : ""}`}
                    >
                      <input
                        type="file"
                        accept="image/gif, image/jpeg, image/png, image/webp"
                        className="owner-programs__shell-avatar-input"
                        onChange={handleAvatarChange}
                        disabled={avatarSaveState === "saving" || !hasProjectId || (isSiteRouteShell && !routeSitePublicId)}
                      />
                      {shellAvatarShowImage ? (
                        <img
                          className="owner-programs__shell-avatar-image"
                          src={shellAvatarImageSrc}
                          alt={
                            isSiteRouteShell ? (avatarDataUrl ? "Фото сайта" : "Фото профиля") : "Фото проекта"
                          }
                        />
                      ) : (
                        <span className="owner-programs__shell-avatar-placeholder" aria-hidden="true">
                          <ProjectShellAvatarIcon />
                        </span>
                      )}
                    </label>
                    {shellAvatarShowRemove ? (
                      <button
                        type="button"
                        className="owner-programs__shell-avatar-remove"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={handleAvatarRemove}
                        disabled={avatarSaveState === "saving"}
                        aria-label={isSiteRouteShell ? "Удалить фото сайта" : "Удалить фото проекта"}
                      >
                        <ProjectAvatarRemoveIcon />
                      </button>
                    ) : null}
                  </div>
                  {isSiteRouteShell ? (
                    <div className="owner-programs__shell-header-copy">
                      <div
                        className="owner-programs__shell-header-copy_clickable owner-programs__shell-header-title-hit"
                        role="button"
                        tabIndex={0}
                        onClick={openSiteSettings}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          openSiteSettings();
                        }}
                        aria-label="Открыть настройки сайта"
                      >
                        <h1 className="owner-programs__shell-title">{shellTitleText}</h1>
                      </div>
                      <div
                        className={
                          showSiteLifecycle
                            ? "owner-programs__shell-meta-row owner-programs__shell-meta-row_site"
                            : "owner-programs__shell-meta-row"
                        }
                      >
                        {showSiteLifecycle ? (
                          <p className="owner-programs__shell-reachability" role="status" aria-live="polite">
                            <span
                              className={`owner-programs__service-card-status-dot owner-programs__service-card-status-dot_${shellLifecycle.tone}`}
                              aria-hidden="true"
                            />
                            <span className="owner-programs__shell-reachability-text">{shellLifecycle.label}</span>
                          </p>
                        ) : null}
                        <div
                          className={`owner-programs__shell-header-domain-hit${
                            siteBrowseHref ? " owner-programs__shell-header-copy_clickable" : " owner-programs__shell-header-domain-hit_static"
                          }`}
                          role={siteBrowseHref ? "button" : undefined}
                          tabIndex={siteBrowseHref ? 0 : -1}
                          onClick={siteBrowseHref ? openSitePrimaryInNewTab : undefined}
                          onKeyDown={
                            siteBrowseHref
                              ? (event) => {
                                  if (event.key !== "Enter" && event.key !== " ") return;
                                  event.preventDefault();
                                  openSitePrimaryInNewTab();
                                }
                              : undefined
                          }
                          aria-label={siteBrowseHref ? "Открыть сайт в новой вкладке" : undefined}
                        >
                          <p className="owner-programs__shell-sub">{siteShellOrigin || "Адрес сайта не указан"}</p>
                        </div>
                      </div>
                      {avatarError ? <p className="owner-programs__shell-avatar-note">{avatarError}</p> : null}
                      {!avatarError && avatarSaveState === "success" && avatarSuccessMessage ? (
                        <p className="owner-programs__shell-avatar-note">{avatarSuccessMessage}</p>
                      ) : null}
                      {!avatarError && deleteProjectError ? (
                        <p className="owner-programs__shell-avatar-note">{deleteProjectError}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      className="owner-programs__shell-header-copy owner-programs__shell-header-copy_clickable"
                      role="button"
                      tabIndex={0}
                      onClick={openProjectInfo}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        openProjectInfo();
                      }}
                      aria-label="Открыть информацию о проекте"
                    >
                      <h1 className="owner-programs__shell-title">{shellTitleText}</h1>
                      <div className="owner-programs__shell-meta-row">
                        <p className="owner-programs__shell-sub">
                          {projectComment ? projectComment : "Комментарий к проекту не указан"}
                        </p>
                      </div>
                      {avatarError ? <p className="owner-programs__shell-avatar-note">{avatarError}</p> : null}
                      {!avatarError && avatarSaveState === "success" && avatarSuccessMessage ? (
                        <p className="owner-programs__shell-avatar-note">{avatarSuccessMessage}</p>
                      ) : null}
                      {!avatarError && deleteProjectError ? (
                        <p className="owner-programs__shell-avatar-note">{deleteProjectError}</p>
                      ) : null}
                    </div>
                  )}
                </div>
                <div className="owner-programs__shell-header-actions">
                  {isSiteRouteShell && siteShellToolbar ? (
                    <div className="owner-programs__site-shell-toolbar" role="toolbar" aria-label="Действия по сайту">
                      {siteShellToolbar}
                    </div>
                  ) : null}
                  {!isDefaultProject && Array.isArray(projectEntry?.sites) && projectEntry.sites.length === 0 ? (
                    <button
                      type="button"
                      className="owner-programs__icon-action owner-programs__icon-action_danger"
                      onClick={openDeleteProjectDialog}
                      disabled={deleteProjectState === "deleting"}
                      aria-label="Удалить проект"
                      data-testid="project-delete-empty-button"
                    >
                      <RemoveProjectIcon />
                    </button>
                  ) : null}
                  {!isSiteRouteShell ? (
                    <div className="owner-programs__create-menu" ref={createMenuRef}>
                      <button
                        type="button"
                        className="owner-programs__projects-create-btn owner-programs__create-menu-trigger"
                        onClick={() => setCreateMenuOpen((value) => !value)}
                        aria-haspopup="menu"
                        aria-expanded={createMenuOpen}
                        data-testid="project-create-menu-trigger"
                      >
                        <span>Создать</span>
                        <CreateMenuChevronIcon open={createMenuOpen} />
                      </button>
                      {createMenuOpen ? (
                        <div className="lk-header__menu" role="menu" data-testid="project-create-menu-dropdown">
                          <button
                            type="button"
                            className="lk-header__menu-item"
                            onClick={openCreateSite}
                            role="menuitem"
                            data-testid="project-create-menu-site"
                          >
                            <span className="lk-header__menu-item-icon" aria-hidden="true">
                              <Globe size={20} strokeWidth={1.75} />
                            </span>
                            <span className="lk-header__menu-item-text">Сайт</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </header>

          <nav
            className={`owner-programs__tabs${headLoading ? " owner-programs__tabs_skel" : ""}`}
            aria-label={
              headLoading
                ? "Загрузка"
                : isSiteRouteShell
                  ? "Дашборд, виджет, блок для сайта, настройки, участники и история сайта"
                  : "Сервисы и участники проекта"
            }
          >
            {headLoading ? (
              isSiteRouteShell ? (
                <>
                  <span className="owner-programs__skel owner-programs__tab-skel owner-programs__tab-skel_w80" aria-hidden />
                  <span className="owner-programs__skel owner-programs__tab-skel owner-programs__tab-skel_w72" aria-hidden />
                  <span className="owner-programs__skel owner-programs__tab-skel owner-programs__tab-skel_w104" aria-hidden />
                  <span className="owner-programs__skel owner-programs__tab-skel owner-programs__tab-skel_w96" aria-hidden />
                  <span className="owner-programs__skel owner-programs__tab-skel owner-programs__tab-skel_w104" aria-hidden />
                  <span className="owner-programs__skel owner-programs__tab-skel owner-programs__tab-skel_w76" aria-hidden />
                </>
              ) : (
                <>
                  <span className="owner-programs__skel owner-programs__tab-skel owner-programs__tab-skel_w88" aria-hidden />
                  <span className="owner-programs__skel owner-programs__tab-skel owner-programs__tab-skel_w120" aria-hidden />
                </>
              )
            ) : isSiteRouteShell ? (
              <>
                <NavLink
                  to={dashboardSiteNavPath}
                  end
                  className={tabClass}
                  preventScrollReset
                  state={siteTabNavigationState}
                >
                  Дашборд
                </NavLink>
                <NavLink to={widgetSiteNavPath} end className={tabClass} preventScrollReset state={siteTabNavigationState}>
                  Виджет
                </NavLink>
                <NavLink
                  to={referralBlockSiteNavPath}
                  end
                  className={tabClass}
                  preventScrollReset
                  state={siteTabNavigationState}
                >
                  Блок для сайта
                </NavLink>
                <NavLink
                  to={settingsSiteNavPath}
                  end
                  className={tabClass}
                  preventScrollReset
                  state={siteTabNavigationState}
                >
                  Настройки
                </NavLink>
                <NavLink to={membersSiteNavPath} end className={tabClass} preventScrollReset state={siteTabNavigationState}>
                  Участники
                </NavLink>
                <NavLink to={historySiteNavPath} end className={tabClass} preventScrollReset state={siteTabNavigationState}>
                  История
                </NavLink>
              </>
            ) : (
              <>
                <NavLink
                  to={projectServicesNavPath}
                  end
                  preventScrollReset
                  className={({ isActive }) =>
                    tabClass({
                      isActive: isActive || location.pathname === projectOverviewNavPath,
                    })
                  }
                >
                  Сервисы
                </NavLink>
                <NavLink to={projectMembersNavPath} end className={tabClass} preventScrollReset>
                  Участники проекта
                </NavLink>
              </>
            )}
          </nav>
        </>
      ) : null}

      <Outlet context={outletContext} />
      {isSiteRouteShell && routeSitePublicId && !hideShellChrome && !isProjectInfoPage ? (
        <SiteShellToolbarSubscriber
          key={routeSitePublicId}
          sitePublicId={routeSitePublicId}
          projectId={numericProjectId}
          setSiteShellToolbar={setSiteShellToolbarSlot}
          reloadProjectEntry={loadProjectEntry}
          buildProjectPath={buildScopedProjectPath}
          projectEntry={projectEntry}
        />
      ) : null}
      {deleteProjectDialogOpen ? (
        <div
          className="owner-programs__dialog-backdrop"
          onClick={closeDeleteProjectDialog}
          data-testid="project-delete-dialog-backdrop"
        >
          <div
            className="owner-programs__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-delete-dialog-title"
            aria-describedby="project-delete-dialog-description"
            onClick={(event) => event.stopPropagation()}
            data-testid="project-delete-dialog"
          >
            <button
              type="button"
              className="owner-programs__dialog-close"
              onClick={closeDeleteProjectDialog}
              aria-label="Закрыть"
              disabled={deleteProjectState === "deleting"}
              data-testid="project-delete-dialog-close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="m13.41 12 4.3-4.29a1 1 0 0 0-1.42-1.42L12 10.59l-4.29-4.3a1 1 0 1 0-1.42 1.42l4.3 4.29-4.3 4.29a1 1 0 0 0 0 1.42 1 1 0 0 0 1.42 0l4.29-4.3 4.29 4.3a1 1 0 0 0 1.64-.33 1 1 0 0 0-.22-1.09L13.4 12Z"
                />
              </svg>
            </button>
            <div className="owner-programs__dialog-body">
              <h2 id="project-delete-dialog-title" className="owner-programs__dialog-title">
                Вы действительно хотите удалить проект?
              </h2>
              <p id="project-delete-dialog-description" className="owner-programs__dialog-text">
                Удаление безвозвратно удалит проект
              </p>
              <div className="owner-programs__dialog-actions">
                <button
                  type="button"
                  className="owner-programs__dialog-btn owner-programs__dialog-btn_danger"
                  onClick={handleDeleteProject}
                  disabled={deleteProjectState === "deleting"}
                  data-testid="project-delete-dialog-confirm"
                >
                  {deleteProjectState === "deleting" ? "Удаление..." : "Да, удалить"}
                </button>
                <button
                  type="button"
                  className="owner-programs__dialog-btn owner-programs__dialog-btn_secondary"
                  onClick={closeDeleteProjectDialog}
                  disabled={deleteProjectState === "deleting"}
                  data-testid="project-delete-dialog-cancel"
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
