import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "./LkSidebar.css";
import { CrownIcon } from "./mini-game/CrownIcon";
import { fetchOwnerSitesList } from "./owner-programs/ownerSitesListApi";
import { formatSiteCardTitle } from "./owner-programs/siteDisplay";

function projectKey(project) {
  if (typeof project?.id === "number") return `project-${project.id}`;
  if (project?.primary_site_public_id) return `project-${project.primary_site_public_id}`;
  return "project-empty";
}

function projectTitle(project) {
  const primarySite = Array.isArray(project?.sites) ? project.sites[0] : null;
  return formatSiteCardTitle(
    project?.primary_site_public_id || primarySite?.public_id || "",
    primarySite?.primary_origin || "",
    project?.project?.name || "",
  );
}

function projectAvatarDataUrl(project) {
  const raw = project?.project?.avatar_data_url;
  return typeof raw === "string" ? raw.trim() : "";
}

/** Один ключ для всего дерева `/lk/partner/*`, чтобы список в сайдбаре не уходил в загрузку при входе в проект или смене вкладки. */
function ownerProjectsRouteStaleKey(pathname) {
  const p = pathname || "";
  if (p.startsWith("/lk/partner")) return "/lk/partner";
  return p;
}

function projectTargetHref(project) {
  if (typeof project?.id === "number") {
    const params = new URLSearchParams();
    if (project?.primary_site_public_id) {
      params.set("site_public_id", project.primary_site_public_id);
    }
    const search = params.toString();
    return `/lk/partner/project/${project.id}/sites${search ? `?${search}` : ""}`;
  }
  return "/lk/partner";
}

function itemClass(active) {
  return `lk-sidebar__nav-link ${active ? "lk-sidebar__nav-link_active" : ""}`;
}

function sidebarItemClass(active) {
  return `lk-sidebar__sidebar-item lk-sidebar__wrapper ${active ? "lk-sidebar__sidebar-item_active" : ""}`;
}

function moveProjectPosition(list, sourceId, targetId, placeAfter) {
  if (!sourceId || !targetId || sourceId === targetId) return list;
  const sourceIndex = list.findIndex((project) => projectKey(project) === sourceId);
  const targetIndex = list.findIndex((project) => projectKey(project) === targetId);
  if (sourceIndex === -1 || targetIndex === -1) return list;

  const next = [...list];
  const [moved] = next.splice(sourceIndex, 1);
  let insertIndex = targetIndex;

  if (sourceIndex < targetIndex) {
    insertIndex -= 1;
  }

  if (placeAfter) {
    insertIndex += 1;
  }

  insertIndex = Math.max(0, Math.min(next.length, insertIndex));
  next.splice(insertIndex, 0, moved);
  return next;
}

function formatIdeaNavBadgeLabel(count) {
  if (count <= 0) return "";
  if (count > 99) return "99+";
  if (count >= 10) return "9+";
  return String(count);
}

function ProgramsNavIcon() {
  return (
    <svg
      className="lk-sidebar__nav-icon-svg lk-sidebar__nav-icon-svg_my-programs"
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <g className="lk-sidebar__my-programs-card lk-sidebar__my-programs-card--back">
        <rect
          x="5"
          y="10"
          width="14"
          height="11"
          rx="2"
          stroke="currentColor"
          strokeWidth="2"
        />
      </g>
      <g className="lk-sidebar__my-programs-card lk-sidebar__my-programs-card--front">
        <rect
          x="5"
          y="5"
          width="14"
          height="11"
          rx="2"
          stroke="currentColor"
          strokeWidth="2"
        />
      </g>
    </svg>
  );
}

function MiniGameRatingNavIcon() {
  return (
    <CrownIcon
      className="lk-sidebar__nav-icon-svg lk-sidebar__nav-icon-svg_mini-game-rating"
      size={24}
      strokeWidth={2}
    />
  );
}

function MiniGameProgressNavIcon() {
  return (
    <svg
      className="lk-sidebar__nav-icon-svg lk-sidebar__nav-icon-svg_mini-game-progress"
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <g className="lk-sidebar__mini-game-progress-bars">
        <path
          d="M4 18V12"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path d="M10 18V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M16 18V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M22 18V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function MiniGameNavIcon() {
  return (
    <svg
      className="lk-sidebar__nav-icon-svg lk-sidebar__nav-icon-svg_mini-game"
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <g className="lk-sidebar__mini-game-dice">
        <rect x="5" y="5" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="2" />
        <circle cx="9" cy="9" r="1.25" fill="currentColor" />
        <circle cx="15" cy="9" r="1.25" fill="currentColor" />
        <circle cx="12" cy="12" r="1.25" fill="currentColor" />
        <circle cx="9" cy="15" r="1.25" fill="currentColor" />
        <circle cx="15" cy="15" r="1.25" fill="currentColor" />
      </g>
    </svg>
  );
}

function ProgramsCatalogNavIcon() {
  const catalogClipId = useId().replace(/:/g, "");
  return (
    <svg
      className="lk-sidebar__nav-icon-svg lk-sidebar__nav-icon-svg_programs-catalog"
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={catalogClipId}>
          <rect x="4" y="3" width="16" height="18" rx="1.5" />
        </clipPath>
      </defs>
      <g className="lk-sidebar__catalog-frame">
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="2"
          stroke="currentColor"
          strokeWidth="2"
        />
      </g>
      <g clipPath={`url(#${catalogClipId})`}>
        <g className="lk-sidebar__catalog-col">
          <path d="M9 3v18" stroke="currentColor" strokeWidth="2" />
        </g>
        <g className="lk-sidebar__catalog-row">
          <path d="M9 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}

export default function LkSidebar({ ownerSessionKey = "", ideaNavBadgeCount = 0, onHeaderNavNavigate }) {
  const projectAvatarClipId = useId().replace(/:/g, "");
  const { pathname, search, state: locationState } = useLocation();
  const navigate = useNavigate();
  const currentPath = pathname.toLowerCase();
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [ownerProjects, setOwnerProjects] = useState([]);
  const [ownerProjectsLoading, setOwnerProjectsLoading] = useState(true);
  const [dragHandleProjectId, setDragHandleProjectId] = useState("");
  const [draggedProjectId, setDraggedProjectId] = useState("");
  const [dragPlaceholderProjectId, setDragPlaceholderProjectId] = useState("");
  const [dragOverProjectId, setDragOverProjectId] = useState("");
  const [dragOverPlacement, setDragOverPlacement] = useState("");
  const dragPlaceholderFrameRef = useRef(0);
  const flipAnimationFrameRef = useRef(0);
  const projectNodeRefs = useRef(new Map());
  const previousProjectPositionsRef = useRef(new Map());

  const referralProgramDetailMatch = pathname.match(/^\/lk\/referral-program\/[^/]+\/?$/i);
  const isReferralProgramDetail = Boolean(referralProgramDetailMatch);
  const navFrom =
    locationState && typeof locationState === "object" && typeof locationState.from === "string"
      ? locationState.from
      : null;

  let programsListActive = currentPath === "/lk/programs";
  let connectedProgramsActive = currentPath === "/lk/my-programs";
  const balanceActive = currentPath === "/lk/balance";
  const documentsActive = currentPath === "/lk/documents";
  const miniGamePlayActive = currentPath === "/lk/mini-game";
  const miniGameProgressActive = currentPath === "/lk/mini-game/progress";
  const miniGameRatingActive = currentPath === "/lk/mini-game/rating";

  if (isReferralProgramDetail) {
    if (navFrom === "/lk/my-programs") {
      programsListActive = false;
      connectedProgramsActive = true;
    } else {
      programsListActive = true;
      connectedProgramsActive = false;
    }
  }

  const onPartnerList = pathname === "/lk/partner";
  const onCreateProject = pathname === "/lk/partner/new";

  const projectsLinkActive = onPartnerList;
  const partnerProjectIdMatch = pathname.match(/^\/lk\/partner\/project\/(\d+)(?:\/|$)/);
  const activePartnerProjectId = partnerProjectIdMatch ? Number(partnerProjectIdMatch[1]) : null;
  const activePartnerSiteId = activePartnerProjectId != null
    ? String(new URLSearchParams(search).get("site_public_id") || "").trim()
    : (() => {
        const partnerSiteIdMatch = pathname.match(/^\/lk\/partner\/([^/]+)/);
        return partnerSiteIdMatch && partnerSiteIdMatch[1] !== "new" && partnerSiteIdMatch[1] !== "project"
          ? partnerSiteIdMatch[1]
          : "";
      })();

  const loadOwnerProjects = useCallback(async () => {
    try {
      const { ok, projects = [] } = await fetchOwnerSitesList();
      if (ok) setOwnerProjects(projects);
    } catch {
      setOwnerProjects([]);
    }
  }, []);

  /** Последний ключ маршрута под `/lk/partner` — при переходе в поддержку/настройки и т.д. не меняем,
   *  чтобы не дергать загрузку списка проектов и не мигать `.lk-sidebar__frame`. */
  const lastPartnerOwnerFetchKeyRef = useRef(null);
  const ownerProjectsFetchKey = useMemo(() => {
    if (pathname.startsWith("/lk/partner")) {
      const k = ownerProjectsRouteStaleKey(pathname);
      lastPartnerOwnerFetchKeyRef.current = k;
      return k;
    }
    return lastPartnerOwnerFetchKeyRef.current ?? "__lk_non_partner_boot__";
  }, [pathname]);

  useLayoutEffect(() => {
    setOwnerProjectsLoading(true);
  }, [ownerProjectsFetchKey, ownerSessionKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ok, projects = [] } = await fetchOwnerSitesList();
        if (cancelled) return;
        if (ok) setOwnerProjects(projects);
      } catch {
        if (!cancelled) setOwnerProjects([]);
      } finally {
        if (!cancelled) setOwnerProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerProjectsFetchKey, ownerSessionKey]);

  useEffect(() => {
    function handleProjectAvatarUpdated() {
      loadOwnerProjects();
    }

    function handleOwnerProjectsUpdated() {
      loadOwnerProjects();
    }

    window.addEventListener("lk-project-avatar-updated", handleProjectAvatarUpdated);
    window.addEventListener("lk-site-avatar-updated", handleProjectAvatarUpdated);
    window.addEventListener("lk-owner-projects-updated", handleOwnerProjectsUpdated);
    return () => {
      window.removeEventListener("lk-project-avatar-updated", handleProjectAvatarUpdated);
      window.removeEventListener("lk-site-avatar-updated", handleProjectAvatarUpdated);
      window.removeEventListener("lk-owner-projects-updated", handleOwnerProjectsUpdated);
    };
  }, [loadOwnerProjects]);

  useEffect(() => {
    return () => {
      if (dragPlaceholderFrameRef.current) {
        cancelAnimationFrame(dragPlaceholderFrameRef.current);
      }
      if (flipAnimationFrameRef.current) {
        cancelAnimationFrame(flipAnimationFrameRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const nextPositions = new Map();

    ownerProjects.forEach((project) => {
      const id = projectKey(project);
      const node = projectNodeRefs.current.get(id);
      if (node) {
        nextPositions.set(id, node.getBoundingClientRect());
      }
    });

    if (previousProjectPositionsRef.current.size > 0) {
      nextPositions.forEach((rect, projectId) => {
        const previousRect = previousProjectPositionsRef.current.get(projectId);
        const node = projectNodeRefs.current.get(projectId);
        if (!previousRect || !node) return;

        const deltaY = previousRect.top - rect.top;
        if (Math.abs(deltaY) < 1) return;

        node.style.transition = "none";
        node.style.transform = `translateY(${deltaY}px)`;
      });

      if (flipAnimationFrameRef.current) {
        cancelAnimationFrame(flipAnimationFrameRef.current);
      }

      flipAnimationFrameRef.current = requestAnimationFrame(() => {
        nextPositions.forEach((_, projectId) => {
          const node = projectNodeRefs.current.get(projectId);
          if (!node || !node.style.transform) return;

          node.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
          node.style.transform = "";
        });
        flipAnimationFrameRef.current = 0;
      });
    }

    previousProjectPositionsRef.current = nextPositions;
  }, [ownerProjects]);

  const setProjectNodeRef = useCallback((projectId, node) => {
    if (node) {
      projectNodeRefs.current.set(projectId, node);
      return;
    }
    projectNodeRefs.current.delete(projectId);
  }, []);

  const resetDragState = useCallback(() => {
    if (dragPlaceholderFrameRef.current) {
      cancelAnimationFrame(dragPlaceholderFrameRef.current);
      dragPlaceholderFrameRef.current = 0;
    }
    setDraggedProjectId("");
    setDragPlaceholderProjectId("");
    setDragOverProjectId("");
    setDragOverPlacement("");
    setDragHandleProjectId("");
  }, []);

  const handleProjectDragStart = useCallback(
    (event, projectId) => {
      if (dragHandleProjectId !== projectId) {
        event.preventDefault();
        return;
      }
      const dragPreviewElement = event.currentTarget.closest?.(".lk-sidebar__project") || event.currentTarget;
      setDraggedProjectId(projectId);
      setDragPlaceholderProjectId("");
      setDragOverProjectId("");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", projectId);
      if (typeof event.dataTransfer.setDragImage === "function" && dragPreviewElement instanceof HTMLElement) {
        const rect = dragPreviewElement.getBoundingClientRect();
        const offsetX = typeof event.clientX === "number" ? Math.max(0, event.clientX - rect.left) : 24;
        const offsetY = typeof event.clientY === "number" ? Math.max(0, event.clientY - rect.top) : rect.height / 2;
        event.dataTransfer.setDragImage(dragPreviewElement, offsetX, offsetY);
      }
      dragPlaceholderFrameRef.current = requestAnimationFrame(() => {
        setDragPlaceholderProjectId(projectId);
        dragPlaceholderFrameRef.current = 0;
      });
    },
    [dragHandleProjectId],
  );

  const handleProjectDragOver = useCallback(
    (event, projectId) => {
      if (!draggedProjectId || draggedProjectId === projectId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      const sourceIndex = ownerProjects.findIndex((project) => projectKey(project) === draggedProjectId);
      const targetIndex = ownerProjects.findIndex((project) => projectKey(project) === projectId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      const rect = event.currentTarget.getBoundingClientRect?.();
      let placeAfter;
      const hasPointerPosition =
        rect &&
        rect.height > 0 &&
        typeof event.clientY === "number" &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (!hasPointerPosition) {
        placeAfter = sourceIndex < targetIndex;
      } else {
        const offsetY = event.clientY - rect.top;
        const upperThreshold = rect.height * 0.35;
        const lowerThreshold = rect.height * 0.65;

        if (sourceIndex < targetIndex) {
          if (offsetY < lowerThreshold) return;
          placeAfter = true;
        } else {
          if (offsetY > upperThreshold) return;
          placeAfter = false;
        }
      }

      const nextPlacement = placeAfter ? "after" : "before";

      if (dragOverProjectId === projectId && dragOverPlacement === nextPlacement) return;

      setOwnerProjects((current) => moveProjectPosition(current, draggedProjectId, projectId, placeAfter));
      setDragOverProjectId(projectId);
      setDragOverPlacement(nextPlacement);
    },
    [draggedProjectId, dragOverPlacement, dragOverProjectId, ownerProjects],
  );

  const handleProjectDrop = useCallback(
    (event) => {
      event.preventDefault();
      resetDragState();
    },
    [resetDragState],
  );

  const handleProjectDragEnd = resetDragState;

  return (
    <aside className="lk-sidebar" aria-label="Меню личного кабинета" id="sidebarMenu">
      <div className="lk-sidebar__frame">
        <div className="lk-sidebar__panel lk-sidebar__panel_section1">
        <div className="lk-sidebar__collapse-container lk-sidebar__collapse-container_projects">
          <div className={`lk-sidebar__collapse ${projectsOpen ? "lk-sidebar__collapse_open" : ""}`}>
            <div className="lk-sidebar__projects-header">
              <Link
                to="/lk/partner"
                data-test-id="projects-btn"
                className={sidebarItemClass(projectsLinkActive)}
                aria-current={projectsLinkActive ? "page" : undefined}
              >
                <svg
                  className="lk-sidebar__nav-item-projects lk-sidebar__icon-svg"
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <g className="lk-sidebar__projects-tiles">
                    <g className="lk-sidebar__projects-tile lk-sidebar__projects-tile--tl">
                      <path
                        fill="currentColor"
                        d="M10 2H3C2.73478 2 2.48043 2.10536 2.29289 2.29289C2.10536 2.48043 2 2.73478 2 3V11C2 11.2652 2.10536 11.5196 2.29289 11.7071C2.48043 11.8946 2.73478 12 3 12H10C10.2652 12 10.5196 11.8946 10.7071 11.7071C10.8946 11.5196 11 11.2652 11 11V3C11 2.73478 10.8946 2.48043 10.7071 2.29289C10.5196 2.10536 10.2652 2 10 2ZM9 10H4V4H9V10Z"
                      />
                    </g>
                    <g className="lk-sidebar__projects-tile lk-sidebar__projects-tile--tr">
                      <path
                        fill="currentColor"
                        d="M21 2H14C13.7348 2 13.4804 2.10536 13.2929 2.29289C13.1054 2.48043 13 2.73478 13 3V9C13 9.26522 13.1054 9.51957 13.2929 9.70711C13.4804 9.89464 13.7348 10 14 10H21C21.2652 10 21.5196 9.89464 21.7071 9.70711C21.8946 9.51957 22 9.26522 22 9V3C22 2.73478 21.8946 2.48043 21.7071 2.29289C21.5196 2.10536 21.2652 2 21 2ZM20 8H15V4H20V8Z"
                      />
                    </g>
                    <g className="lk-sidebar__projects-tile lk-sidebar__projects-tile--bl">
                      <path
                        fill="currentColor"
                        d="M10 14H3C2.73478 14 2.48043 14.1054 2.29289 14.2929C2.10536 14.4804 2 14.7348 2 15V21C2 21.2652 2.10536 21.5196 2.29289 21.7071C2.48043 21.8946 2.73478 22 3 22H10C10.2652 22 10.5196 21.8946 10.7071 21.7071C10.8946 21.5196 11 21.2652 11 21V15C11 14.7348 10.8946 14.4804 10.7071 14.2929C10.5196 14.1054 10.2652 14 10 14ZM9 20H4V16H9V20Z"
                      />
                    </g>
                    <g className="lk-sidebar__projects-tile lk-sidebar__projects-tile--br">
                      <path
                        fill="currentColor"
                        d="M21 12H14C13.7348 12 13.4804 12.1054 13.2929 12.2929C13.1054 12.4804 13 12.7348 13 13V21C13 21.2652 13.1054 21.5196 13.2929 21.7071C13.4804 21.8946 13.7348 22 14 22H21C21.2652 22 21.5196 21.8946 21.7071 21.7071C21.8946 21.5196 22 21.2652 22 21V13C22 12.7348 21.8946 12.4804 21.7071 12.2929C21.5196 12.1054 21.2652 12 21 12ZM20 20H15V14H20V20Z"
                      />
                    </g>
                  </g>
                </svg>
                <span className="lk-sidebar__label lk-sidebar__icon-label lk-sidebar__text_sidebar">
                  Проекты
                </span>
              </Link>
              <button
                type="button"
                className="lk-sidebar__collapse-btn lk-sidebar__collapse-btn_projects"
                role="button"
                aria-expanded={projectsOpen}
                aria-controls="lk-sidebar-projects-block"
                aria-label={projectsOpen ? "Свернуть список проектов" : "Развернуть список проектов"}
                onClick={() => setProjectsOpen((v) => !v)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  fill="none"
                  viewBox="0 0 24 24"
                  className="lk-sidebar__collapse-arrow"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M12 16a1 1 0 0 1-.64-.23l-5-4a1 1 0 0 1 1.28-1.54L12 13.71l4.36-3.32a1 1 0 0 1 1.41.15 1 1 0 0 1-.14 1.46l-5 3.83A1 1 0 0 1 12 16Z"
                  />
                </svg>
              </button>
            </div>
            <div
              id="lk-sidebar-projects-block"
              className="lk-sidebar__collapse-inner lk-sidebar__collapse-inner--projects"
              role="navigation"
              aria-label="Подразделы проектов"
              aria-hidden={!projectsOpen}
            >
              <div className="lk-sidebar__collapse-inner-wrap">
                <div className="lk-sidebar__projects-rows-block">
                {ownerProjectsLoading ? (
                  <div
                    className="lk-sidebar__projects-skel"
                    role="status"
                    aria-label="Загрузка проектов"
                    data-testid="lk-sidebar-projects-skel"
                  >
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="lk-sidebar__projects-skel-row">
                        <span className="lk-sidebar__skel lk-sidebar__projects-skel-avatar" aria-hidden />
                        <span className="lk-sidebar__skel lk-sidebar__projects-skel-label" aria-hidden />
                      </div>
                    ))}
                  </div>
                ) : (
                  ownerProjects.map((project) => {
                  const projectId = projectKey(project);
                  const label = projectTitle(project);
                  const avatarDataUrl = projectAvatarDataUrl(project);
                  const projectSites = Array.isArray(project.sites) ? project.sites : [];
                  const rowActive = projectSites.some((site) => site.public_id === activePartnerSiteId)
                    || (activePartnerProjectId != null && project.id === activePartnerProjectId);
                  const clipSuffix = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
                  const isDragging = dragPlaceholderProjectId === projectId;
                  const isDragOver = dragOverProjectId === projectId && draggedProjectId !== projectId;
                  const targetHref = projectTargetHref(project);
                  return (
                    <div
                      key={projectId}
                      ref={(node) => setProjectNodeRef(projectId, node)}
                      className={`lk-sidebar__project${isDragging ? " lk-sidebar__project--dragging" : ""}${isDragOver ? " lk-sidebar__project--drag-over" : ""}`}
                      data-id={projectId}
                      data-testid={`sidebar-project-${projectId}`}
                      draggable
                      onDragStart={(event) => handleProjectDragStart(event, projectId)}
                      onDragEnd={handleProjectDragEnd}
                      onDragOver={(event) => handleProjectDragOver(event, projectId)}
                      onDrop={(event) => handleProjectDrop(event, projectId)}
                    >
                      <Link
                        to={targetHref}
                        state={{ projectViewMode: "overview" }}
                        className={`lk-sidebar__project-link lk-sidebar__wrapper ${rowActive ? "lk-sidebar__project-link_active" : ""}`}
                        aria-current={rowActive ? "page" : undefined}
                        tabIndex={projectsOpen ? undefined : -1}
                      >
                        <div className="lk-sidebar__status-avatar-wrapper">
                          <div className="lk-sidebar__avatar lk-sidebar__avatar_xs">
                            {avatarDataUrl ? (
                              <img
                                src={avatarDataUrl}
                                alt=""
                                className="lk-sidebar__avatar-image"
                                aria-hidden="true"
                              />
                            ) : (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="24"
                                height="24"
                                fill="none"
                                viewBox="0 0 22 22"
                                aria-hidden="true"
                              >
                                <defs>
                                  <clipPath id={`${projectAvatarClipId}_p_${clipSuffix}`}>
                                    <rect width="22" height="22" fill="#fff" rx="11" />
                                  </clipPath>
                                </defs>
                                <g clipPath={`url(#${projectAvatarClipId}_p_${clipSuffix})`}>
                                  <circle cx="11" cy="11" r="11" fill="#7177F8" />
                                  <circle cx="21" cy="21" r="11" fill="#fff" opacity="0.2" />
                                  <circle cx="-2" cy="1" r="11" fill="#fff" opacity="0.3" />
                                </g>
                              </svg>
                            )}
                          </div>
                        </div>
                        <span className="lk-sidebar__label lk-sidebar__icon-label lk-sidebar__text_sidebar">
                          {label}
                        </span>
                      </Link>
                      <div
                        className="lk-sidebar__drag-handle-wrap lk-sidebar__sortable-handle"
                        data-projects-drag-handle="true"
                        aria-hidden="true"
                        draggable
                        onMouseDown={() => setDragHandleProjectId(projectId)}
                        onMouseUp={() => {
                          if (!draggedProjectId) {
                            setDragHandleProjectId("");
                          }
                        }}
                        onDragStart={(event) => handleProjectDragStart(event, projectId)}
                        onDragEnd={handleProjectDragEnd}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          fill="none"
                          className="lk-sidebar__sortable-handle-icon"
                          aria-hidden="true"
                        >
                          <circle cx="8.8" cy="6.6" r="1.8" fill="currentColor" />
                          <circle cx="15.2" cy="6.6" r="1.8" fill="currentColor" />
                          <circle cx="8.8" cy="12" r="1.8" fill="currentColor" />
                          <circle cx="15.2" cy="12" r="1.8" fill="currentColor" />
                          <circle cx="8.8" cy="17.4" r="1.8" fill="currentColor" />
                          <circle cx="15.2" cy="17.4" r="1.8" fill="currentColor" />
                        </svg>
                      </div>
                    </div>
                  );
                  })
                )}
                </div>
                <Link
                  to="/lk/partner/new"
                  data-test-id="add-project-btn"
                  className={sidebarItemClass(onCreateProject)}
                  aria-current={onCreateProject ? "page" : undefined}
                  tabIndex={projectsOpen ? undefined : -1}
                >
                  <svg
                    className="lk-sidebar__icon-svg"
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M19 11h-6V5a1 1 0 0 0-2 0v6H5a1 1 0 0 0 0 2h6v6a1 1 0 0 0 2 0v-6h6a1 1 0 0 0 0-2Z"
                    />
                  </svg>
                  <span className="lk-sidebar__label lk-sidebar__icon-label lk-sidebar__text_sidebar">
                    Создать проект
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>
        </div>

        <div className="lk-sidebar__panel lk-sidebar__panel_section2 lk-sidebar__panel_nav">
        <nav className="lk-sidebar__nav" aria-label="Разделы и мини-игра">
          <Link
            to="/lk/programs"
            className={itemClass(programsListActive)}
            aria-current={programsListActive ? "page" : undefined}
          >
            <ProgramsCatalogNavIcon />
            <span className="lk-sidebar__nav-text">Каталог программ</span>
          </Link>

          <Link
            to="/lk/my-programs"
            className={itemClass(connectedProgramsActive)}
            aria-current={connectedProgramsActive ? "page" : undefined}
          >
            <ProgramsNavIcon />
            <span className="lk-sidebar__nav-text">Мои программы</span>
          </Link>

          <button
            type="button"
            className={itemClass(currentPath === "/lk/news")}
            aria-current={currentPath === "/lk/news" ? "page" : undefined}
            onClick={() => {
              onHeaderNavNavigate?.();
              navigate("/LK/news");
            }}
          >
            <svg
              className="lk-sidebar__nav-icon-svg lk-sidebar__nav-icon-svg_news"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <g id="News_0">
                <g className="lk-sidebar__news-paper">
                  <path
                    id="news-Vector_1"
                    d="M2 18C2 18.7957 2.31607 19.5587 2.87868 20.1213C3.44129 20.6839 4.20435 21 5 21H18C19.0609 21 20.0783 20.5786 20.8284 19.8284C21.5786 19.0783 22 18.0609 22 17V6.18201H20V17C20 17.5304 19.7893 18.0392 19.4142 18.4142C19.0391 18.7893 18.5304 19 18 19H7.82C7.93642 18.6793 7.9973 18.3412 8 18V6.18201H6V7.00001V9.00001V18C6 18.2652 5.89464 18.5196 5.70711 18.7071C5.51957 18.8947 5.26522 19 5 19C4.73478 19 4.48043 18.8947 4.29289 18.7071C4.10536 18.5196 4 18.2652 4 18V13.0088H2V18Z"
                    fill="currentColor"
                  />
                  <path
                    id="news-Vector_5"
                    d="M7 3H21C21.2652 3 21.5196 3.10536 21.7071 3.29289C21.8946 3.48043 22 3.73478 22 4V13.8622H20V5H8V13.5H6V9V7V4C6 3.73478 6.10536 3.48043 6.29289 3.29289C6.48043 3.10536 6.73478 3 7 3Z"
                    fill="currentColor"
                  />
                  <path
                    id="news-Vector_6"
                    d="M3 7H6V9H4V13.5H2V8C2 7.73478 2.10536 7.48043 2.29289 7.29289C2.48043 7.10536 2.73478 7 3 7Z"
                    fill="currentColor"
                  />
                </g>
                <g className="lk-sidebar__news-lines">
                  <g className="lk-sidebar__news-line lk-sidebar__news-line--1">
                    <path
                      id="news-Vector_2"
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M17 9H11C10.7348 9 10.4804 8.89464 10.2929 8.70711C10.1054 8.51957 10 8.26522 10 8C10 7.73478 10.1054 7.48043 10.2929 7.29289C10.4804 7.10536 10.7348 7 11 7H17C17.2652 7 17.5196 7.10536 17.7071 7.29289C17.8946 7.48043 18 7.73478 18 8C18 8.26522 17.8946 8.51957 17.7071 8.70711C17.5196 8.89464 17.2652 9 17 9Z"
                      fill="currentColor"
                    />
                  </g>
                  <g className="lk-sidebar__news-line lk-sidebar__news-line--2">
                    <path
                      id="news-Vector_3"
                      d="M17 13H11C10.7348 13 10.4804 12.8946 10.2929 12.7071C10.1054 12.5196 10 12.2652 10 12C10 11.7348 10.1054 11.4804 10.2929 11.2929C10.4804 11.1054 10.7348 11 11 11H17C17.2652 11 17.5196 11.1054 17.7071 11.2929C17.8946 11.4804 18 11.7348 18 12C18 12.2652 17.8946 12.5196 17.7071 12.7071C17.5196 12.8946 17.2652 13 17 13Z"
                      fill="currentColor"
                    />
                  </g>
                  <g className="lk-sidebar__news-line lk-sidebar__news-line--3">
                    <path
                      id="news-Vector_4"
                      d="M17 17H11C10.7348 17 10.4804 16.8946 10.2929 16.7071C10.1054 16.5196 10 16.2652 10 16C10 15.7348 10.1054 15.4804 10.2929 15.2929C10.4804 15.1054 10.7348 15 11 15H17C17.2652 15 17.5196 15.1054 17.7071 15.2929C17.8946 15.4804 18 15.7348 18 16C18 16.2652 17.8946 16.5196 17.7071 16.7071C17.5196 16.8946 17.2652 17 17 17Z"
                      fill="currentColor"
                    />
                  </g>
                </g>
              </g>
            </svg>
            <span className="lk-sidebar__nav-label-row">
              <span className="lk-sidebar__nav-text">Новости и обновления</span>
              <span className="lk-sidebar__nav-soon" translate="no">
                SOON
              </span>
            </span>
          </button>

          <button
            type="button"
            className={itemClass(currentPath === "/lk/bug")}
            aria-current={currentPath === "/lk/bug" ? "page" : undefined}
            onClick={() => {
              onHeaderNavNavigate?.();
              navigate("/LK/bug");
            }}
          >
            <svg
              className="lk-sidebar__nav-icon-svg lk-sidebar__nav-icon-svg_bug"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <g id="Apps_0">
                <g className="lk-sidebar__bug-body">
                  <path
                    id="Vector_1"
                    d="M12.0101 7.58936H12.0001C9.31603 7.58936 7.14014 9.76525 7.14014 12.4494V14.8894C7.14014 17.5735 9.31603 19.7494 12.0001 19.7494H12.0101C14.6942 19.7494 16.8701 17.5735 16.8701 14.8894V12.4494C16.8701 9.76525 14.6942 7.58936 12.0101 7.58936Z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </g>
                <g className="lk-sidebar__bug-belt">
                  <path
                    id="Vector_2"
                    d="M3.49023 7.58936C3.49023 8.39561 3.81052 9.16885 4.38063 9.73896C4.95074 10.3091 5.72398 10.6294 6.53023 10.6294H17.4702C18.2765 10.6294 19.0497 10.3091 19.6198 9.73896C20.1899 9.16885 20.5102 8.39561 20.5102 7.58936"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </g>
                <g className="lk-sidebar__bug-limbs">
                  <path
                    id="Vector_3"
                    d="M9.47023 4.54932V5.05932C9.44852 5.40427 9.49771 5.75001 9.61478 6.07522C9.73184 6.40043 9.91431 6.69819 10.1509 6.95016C10.3875 7.20212 10.6732 7.40293 10.9904 7.54021C11.3076 7.67748 11.6496 7.7483 11.9952 7.7483C12.3409 7.7483 12.6828 7.67748 13 7.54021C13.3173 7.40293 13.603 7.20212 13.8396 6.95016C14.0762 6.69819 14.2586 6.40043 14.3757 6.07522C14.4928 5.75001 14.542 5.40427 14.5202 5.05932V4.54932M3.49023 20.3493C3.49023 19.5431 3.81052 18.7698 4.38063 18.1997C4.95074 17.6296 5.72398 17.3093 6.53023 17.3093H7.74023M20.5102 20.3493C20.5102 19.5431 20.1899 18.7698 19.6198 18.1997C19.0497 17.6296 18.2765 17.3093 17.4702 17.3093H16.2502M7.14023 14.0093H4.10023M19.9002 14.0093H16.8602"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </g>
              </g>
            </svg>
            <span className="lk-sidebar__nav-label-row">
              <span className="lk-sidebar__nav-text">Сообщить о баге</span>
              <span className="lk-sidebar__nav-soon" translate="no">
                SOON
              </span>
            </span>
          </button>

          <button
            type="button"
            className={itemClass(currentPath === "/lk/idea")}
            aria-current={currentPath === "/lk/idea" ? "page" : undefined}
            onClick={() => {
              onHeaderNavNavigate?.();
              navigate("/LK/idea");
            }}
          >
            <span className="lk-sidebar__nav-ideas-wrap">
              <svg
                className="lk-sidebar__nav-icon-svg lk-sidebar__nav-icon-svg_ideas"
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <g
                  className="lk-sidebar__ideas-bulb"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
                  <path d="M9 18h6" />
                  <path d="M10 22h4" />
                </g>
              </svg>
              {ideaNavBadgeCount > 0 ? (
                <span className="lk-header__nav-badge" aria-hidden="true">
                  {formatIdeaNavBadgeLabel(ideaNavBadgeCount)}
                </span>
              ) : null}
            </span>
            <span className="lk-sidebar__nav-label-row">
              <span className="lk-sidebar__nav-text">Предложить идею</span>
              <span className="lk-sidebar__nav-soon" translate="no">
                SOON
              </span>
            </span>
          </button>

          <Link
            to="/lk/mini-game"
            className={itemClass(miniGamePlayActive)}
            aria-current={miniGamePlayActive ? "page" : undefined}
          >
            <MiniGameNavIcon />
            <span className="lk-sidebar__nav-text">Мини игра</span>
          </Link>
          <Link
            to="/lk/mini-game/progress"
            className={itemClass(miniGameProgressActive)}
            aria-current={miniGameProgressActive ? "page" : undefined}
          >
            <MiniGameProgressNavIcon />
            <span className="lk-sidebar__nav-text">Прогресс</span>
          </Link>
          <Link
            to="/lk/mini-game/rating"
            className={itemClass(miniGameRatingActive)}
            aria-current={miniGameRatingActive ? "page" : undefined}
          >
            <MiniGameRatingNavIcon />
            <span className="lk-sidebar__nav-text">Рейтинг</span>
          </Link>

          <div className="lk-sidebar__nav-divider" aria-hidden="true" />

          <Link
            to="/lk/balance"
            className={itemClass(balanceActive)}
            aria-current={balanceActive ? "page" : undefined}
          >
            <svg
              className="lk-sidebar__nav-icon-svg lk-sidebar__nav-icon-svg_balance"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 7.5H19C20.1046 7.5 21 8.39543 21 9.5V18C21 19.1046 20.1046 20 19 20H5C3.89543 20 3 19.1046 3 18V6C3 4.89543 3.89543 4 5 4H17"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M16 13.5H21V17.5H16C14.8954 17.5 14 16.6046 14 15.5C14 14.3954 14.8954 13.5 16 13.5Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M17 15.5H17.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="lk-sidebar__nav-text">Баланс и платежи</span>
          </Link>

          <Link
            to="/lk/documents"
            className={itemClass(documentsActive)}
            aria-current={documentsActive ? "page" : undefined}
          >
            <svg
              className="lk-sidebar__nav-icon-svg lk-sidebar__nav-icon-svg_documents"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7 3H14.5L19 7.5V21H7C5.89543 21 5 20.1046 5 19V5C5 3.89543 5.89543 3 7 3Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M14 3V8H19"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M9 13H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M9 17H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="lk-sidebar__nav-text">Документы</span>
          </Link>
        </nav>
        </div>
      </div>
    </aside>
  );
}
