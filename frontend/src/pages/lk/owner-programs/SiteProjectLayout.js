import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./owner-programs.css";
import { fetchOwnerSitesList } from "./ownerSitesListApi";

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function selectedSiteFromSearch(search) {
  try {
    const params = new URLSearchParams(search || "");
    return String(params.get("site_public_id") || "").trim();
  } catch {
    return "";
  }
}

function selectedSiteSearch(sitePublicId, search) {
  const params = new URLSearchParams(search || "");
  if (sitePublicId) {
    params.set("site_public_id", sitePublicId);
  } else {
    params.delete("site_public_id");
  }
  const next = params.toString();
  return next ? `?${next}` : "";
}

function resolveSelectedSitePublicId(projectEntry, requestedSitePublicId) {
  const sites = Array.isArray(projectEntry?.sites) ? projectEntry.sites : [];
  if (requestedSitePublicId && sites.some((site) => site.public_id === requestedSitePublicId)) {
    return requestedSitePublicId;
  }
  const primarySitePublicId =
    typeof projectEntry?.primary_site_public_id === "string" ? projectEntry.primary_site_public_id.trim() : "";
  if (primarySitePublicId && sites.some((site) => site.public_id === primarySitePublicId)) {
    return primarySitePublicId;
  }
  return typeof sites[0]?.public_id === "string" ? sites[0].public_id.trim() : "";
}

function buildProjectPath(projectId, section, sitePublicId, search) {
  if (!(Number.isInteger(projectId) && projectId > 0)) return "/lk/partner";
  return `/lk/partner/project/${projectId}/${section}${selectedSiteSearch(sitePublicId, search)}`;
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
    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 8 8" aria-hidden="true">
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
  const { projectId } = useParams();
  const numericProjectId = Number(projectId);
  const hasProjectId = Number.isInteger(numericProjectId) && numericProjectId > 0;
  const requestedSitePublicId = selectedSiteFromSearch(location.search);
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
  const createMenuRef = useRef(null);
  const locationViewMode = location.state?.projectViewMode;
  const selectedSitePublicId = useMemo(
    () => resolveSelectedSitePublicId(projectEntry, requestedSitePublicId),
    [projectEntry, requestedSitePublicId],
  );
  const buildScopedProjectPath = useCallback(
    (section, sitePublicIdOverride = selectedSitePublicId) =>
      buildProjectPath(numericProjectId, section, sitePublicIdOverride, location.search),
    [location.search, numericProjectId, selectedSitePublicId],
  );

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
    async (projectId) => {
      setProjectEntryLoading(true);
      setProjectEntryError("");
      try {
        const { ok, projects = [], error } = await fetchOwnerSitesList();
        if (!ok) {
          setProjectEntry(null);
          setProjectEntryError(error || "Не удалось загрузить сайты проекта");
          return null;
        }
        const nextEntry = projects.find((project) => (projectId != null ? project.id === projectId : false)) || null;
        setProjectEntry(nextEntry);
        return nextEntry;
      } catch (err) {
        console.error(err);
        setProjectEntry(null);
        setProjectEntryError("Не удалось загрузить сайты проекта");
        return null;
      } finally {
        setProjectEntryLoading(false);
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
      setAvatarDataUrl(avatarDataUrlFromProject(nextEntry.project));
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
  }, [hasProjectId, numericProjectId]);

  useEffect(() => {
    loadHead();
  }, [loadHead]);

  useEffect(() => {
    if (!hasProjectId || headLoading) return;
    if (addSiteState === "saving") return;
    const nextSearch = selectedSiteSearch(selectedSitePublicId, location.search);
    if (nextSearch === (location.search || "")) return;
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch,
      },
      { replace: true, state: location.state },
    );
  }, [addSiteState, hasProjectId, headLoading, location.pathname, location.search, location.state, navigate, selectedSitePublicId]);

  useEffect(() => {
    if (!hasProjectId || !isUuidString(createdSitePublicId) || addSiteState === "saving") return;
    const widgetPath = buildScopedProjectPath("widget", createdSitePublicId);
    const onWidgetPath = location.pathname === `${projectBasePath}/widget`;
    const selectedFromUrl = selectedSiteFromSearch(location.search);
    if (onWidgetPath && selectedFromUrl === createdSitePublicId) {
      setCreatedSitePublicId("");
      return;
    }
    navigate(widgetPath, {
      replace: true,
      state: { projectViewMode: "connect-site" },
    });
  }, [
    addSiteState,
    buildScopedProjectPath,
    createdSitePublicId,
    hasProjectId,
    location.pathname,
    location.search,
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
        const detail = payload?.detail;
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
      window.setTimeout(() => {
        setAvatarSaveState("idle");
        setAvatarSuccessMessage("");
      }, 1800);
    },
    [numericProjectId],
  );

  const handleAvatarChange = useCallback(
    async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      if (!file) return;
      if (!hasProjectId) {
        setAvatarError("Фото проекта сейчас недоступно");
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
        await saveAvatar(nextAvatarDataUrl, "Фото сохранено");
      } catch (err) {
        console.error(err);
        setAvatarSaveState("error");
        setAvatarSuccessMessage("");
        setAvatarError(err instanceof Error && err.message ? err.message : "Не удалось сохранить фото");
      }
    },
    [hasProjectId, saveAvatar],
  );

  const handleAvatarRemove = useCallback(
    async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!hasProjectId || !avatarDataUrl || avatarSaveState === "saving") return;

      setAvatarSaveState("saving");
      setAvatarError("");
      setAvatarSuccessMessage("");

      try {
        await saveAvatar("", "Фото удалено");
      } catch (err) {
        console.error(err);
        setAvatarSaveState("error");
        setAvatarSuccessMessage("");
        setAvatarError(err instanceof Error && err.message ? err.message : "Не удалось удалить фото");
      }
    },
    [avatarDataUrl, avatarSaveState, hasProjectId, saveAvatar],
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
    if (!location.pathname.endsWith("/overview")) {
      navigate(buildScopedProjectPath("overview"), { state: { projectViewMode: "create-site" } });
    }
  }, [buildScopedProjectPath, location.pathname, navigate]);

  const openProjectInfo = useCallback(() => {
    navigate(buildScopedProjectPath("info"));
  }, [buildScopedProjectPath, navigate]);

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
        const detail = payload?.detail;
        const detailMsg =
          typeof detail === "string" ? detail : Array.isArray(detail) ? detail.join("\n") : detail != null ? String(detail) : "";
        throw new Error(detailMsg || `Не удалось удалить проект (${res.status})`);
      }
      setDeleteProjectDialogOpen(false);
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
          const detail = payload?.detail;
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
          navigate(buildScopedProjectPath("widget", nextSiteId), {
            replace: true,
            state: { projectViewMode: "connect-site" },
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
  const isDefaultProject = Boolean(
    projectEntry?.project?.is_default || projectEntry?.is_default || headTitle === "Общий проект",
  );
  const isProjectInfoPage = location.pathname === `${projectBasePath}/info`;
  const hideShellChromeForSiteCreate = addSiteOpen;
  const hideShellChromeForFocusedConnect = locationViewMode === "connect-site";
  const hideShellChrome = hideShellChromeForSiteCreate || hideShellChromeForFocusedConnect;
  const membersSitePublicId = selectedSitePublicId;
  const outletContext = useMemo(
    () => ({
      base: projectBasePath,
      sitePublicId: selectedSitePublicId,
      selectedSitePublicId,
      membersSitePublicId,
      projectId: hasProjectId ? numericProjectId : null,
      hasSiteId: Boolean(selectedSitePublicId),
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
      projectBasePath,
      toggleAddSiteForm,
      handleAddSite,
    }),
    [
      addSiteError,
      addSiteOpen,
      addSiteOrigin,
      addSitePlatform,
      addSiteState,
      buildScopedProjectPath,
      handleAddSite,
      headLoading,
      hasProjectId,
      membersSitePublicId,
      projectBasePath,
      projectEntry,
      projectEntryError,
      projectEntryLoading,
      loadProjectEntry,
      loadHead,
      numericProjectId,
      selectedSitePublicId,
      toggleAddSiteForm,
    ],
  );

  if (!hasProjectId) {
    return <Navigate to="/lk/partner" replace />;
  }

  return (
    <div
      className={`lk-dashboard lk-partner owner-programs__shell${
        hideShellChrome ? " owner-programs__shell_first-site-connect" : ""
      }`}
    >
      {!isProjectInfoPage && !hideShellChrome ? (
        <>
          <header className="owner-programs__shell-header">
            <div className="owner-programs__shell-header-main">
              <label
                className={`owner-programs__shell-avatar owner-programs__shell-avatar_action${avatarSaveState === "saving" ? " owner-programs__shell-avatar_loading" : ""}`}
              >
                <input
                  type="file"
                  accept="image/gif, image/jpeg, image/png, image/webp"
                  className="owner-programs__shell-avatar-input"
                  onChange={handleAvatarChange}
                  disabled={avatarSaveState === "saving" || !hasProjectId}
                />
                {avatarDataUrl ? (
                  <>
                    <img className="owner-programs__shell-avatar-image" src={avatarDataUrl} alt="Фото проекта" />
                    <button
                      type="button"
                      className="owner-programs__shell-avatar-remove"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={handleAvatarRemove}
                      disabled={avatarSaveState === "saving"}
                      aria-label="Удалить фото проекта"
                    >
                      <ProjectAvatarRemoveIcon />
                    </button>
                  </>
                ) : (
                  <span className="owner-programs__shell-avatar-placeholder" aria-hidden="true">
                    <ProjectShellAvatarIcon />
                  </span>
                )}
              </label>
              <div
                className="owner-programs__shell-header-copy owner-programs__shell-header-copy_clickable"
                role="button"
                tabIndex={0}
                onClick={openProjectInfo}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openProjectInfo();
                  }
                }}
              >
                <h1 className="owner-programs__shell-title">{headLoading ? "Проект…" : headTitle}</h1>
                <p className="owner-programs__shell-sub">
                  {headLoading ? (
                    <span className="lk-partner__muted">Загрузка…</span>
                  ) : projectComment ? (
                    projectComment
                  ) : (
                    "Комментарий к проекту не указан"
                  )}
                </p>
                {avatarError ? <p className="owner-programs__shell-avatar-note">{avatarError}</p> : null}
                {!avatarError && avatarSaveState === "success" && avatarSuccessMessage ? (
                  <p className="owner-programs__shell-avatar-note">{avatarSuccessMessage}</p>
                ) : null}
                {!avatarError && deleteProjectError ? <p className="owner-programs__shell-avatar-note">{deleteProjectError}</p> : null}
              </div>
            </div>
            <div className="owner-programs__shell-header-actions">
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
                  <div className="owner-programs__create-menu-dropdown" role="menu" data-testid="project-create-menu-dropdown">
                    <button
                      type="button"
                      className="owner-programs__create-menu-item"
                      onClick={openCreateSite}
                      role="menuitem"
                      data-testid="project-create-menu-site"
                    >
                      Сайт
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <nav className="owner-programs__tabs" aria-label="Разделы проекта">
            <NavLink to={buildScopedProjectPath("overview")} state={{ projectViewMode: "overview" }} className={tabClass} end>
              Сервисы
            </NavLink>
            <NavLink to={buildScopedProjectPath("members")} className={tabClass}>
              Пользователи
            </NavLink>
          </nav>
        </>
      ) : null}

      <Outlet context={outletContext} />
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
