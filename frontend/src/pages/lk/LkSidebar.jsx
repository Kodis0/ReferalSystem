import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import "./LkSidebar.css";
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

/** Avoid refetch + FLIP layout on every nested tab under the same owner project. */
function ownerProjectsRouteStaleKey(pathname) {
  const p = pathname || "";
  if (p === "/lk/support" || p.startsWith("/lk/support/")) return "/lk/support";
  if (!p.startsWith("/lk/partner")) return p;
  const m = p.match(/^\/lk\/partner\/project\/(\d+)/);
  if (m) return `/lk/partner/project/${m[1]}`;
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

function ProgramsNavIcon() {
  return (
    <svg
      className="lk-sidebar__nav-icon-svg"
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <g id="AiAgents_0">
        <path
          id="Vector_1"
          d="M4 13a3 3 0 0 1 3-3h18a3 3 0 0 1 3 3v7.92a3 3 0 0 1-2.35 2.93l-9 1.98a3 3 0 0 1-1.3 0l-9-1.98A3 3 0 0 1 4 20.92V13Z"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle id="Vector_2" cx="11.73" cy="17.22" r="2.44" fill="currentColor" />
        <circle id="Vector_3" cx="20.27" cy="17.22" r="2.44" fill="currentColor" />
        <path
          id="Vector_4"
          d="m15.8 9.9-3.46-3.45m4.88 3.26 3.46-3.46"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

export default function LkSidebar({ ownerSessionKey = "" }) {
  const projectAvatarClipId = useId().replace(/:/g, "");
  const { pathname, hash, search } = useLocation();
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

  const onDashboard = pathname === "/lk/dashboard";
  const programsActive = onDashboard && hash === "#my-programs";

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
    const { ok, projects = [] } = await fetchOwnerSitesList();
    if (ok) setOwnerProjects(projects);
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
      const { ok, projects = [] } = await fetchOwnerSitesList();
      if (cancelled) return;
      if (ok) setOwnerProjects(projects);
      setOwnerProjectsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerProjectsFetchKey, ownerSessionKey]);

  useEffect(() => {
    function handleProjectAvatarUpdated() {
      loadOwnerProjects();
    }

    window.addEventListener("lk-project-avatar-updated", handleProjectAvatarUpdated);
    window.addEventListener("lk-site-avatar-updated", handleProjectAvatarUpdated);
    return () => {
      window.removeEventListener("lk-project-avatar-updated", handleProjectAvatarUpdated);
      window.removeEventListener("lk-site-avatar-updated", handleProjectAvatarUpdated);
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
                  <g id="Apps_0">
                    <path
                      id="Vector_1"
                      fill="currentColor"
                      d="M10 14H3C2.73478 14 2.48043 14.1054 2.29289 14.2929C2.10536 14.4804 2 14.7348 2 15V21C2 21.2652 2.10536 21.5196 2.29289 21.7071C2.48043 21.8946 2.73478 22 3 22H10C10.2652 22 10.5196 21.8946 10.7071 21.7071C10.8946 21.5196 11 21.2652 11 21V15C11 14.7348 10.8946 14.4804 10.7071 14.2929C10.5196 14.1054 10.2652 14 10 14ZM9 20H4V16H9V20ZM21 2H14C13.7348 2 13.4804 2.10536 13.2929 2.29289C13.1054 2.48043 13 2.73478 13 3V9C13 9.26522 13.1054 9.51957 13.2929 9.70711C13.4804 9.89464 13.7348 10 14 10H21C21.2652 10 21.5196 9.89464 21.7071 9.70711C21.8946 9.51957 22 9.26522 22 9V3C22 2.73478 21.8946 2.48043 21.7071 2.29289C21.5196 2.10536 21.2652 2 21 2ZM20 8H15V4H20V8ZM21 12H14C13.7348 12 13.4804 12.1054 13.2929 12.2929C13.1054 12.4804 13 12.7348 13 13V21C13 21.2652 13.1054 21.5196 13.2929 21.7071C13.4804 21.8946 13.7348 22 14 22H21C21.2652 22 21.5196 21.8946 21.7071 21.7071C21.8946 21.5196 22 21.2652 22 21V13C22 12.7348 21.8946 12.4804 21.7071 12.2929C21.5196 12.1054 21.2652 12 21 12ZM20 20H15V14H20V20ZM10 2H3C2.73478 2 2.48043 2.10536 2.29289 2.29289C2.10536 2.48043 2 2.73478 2 3V11C2 11.2652 2.10536 11.5196 2.29289 11.7071C2.48043 11.8946 2.73478 12 3 12H10C10.2652 12 10.5196 11.8946 10.7071 11.7071C10.8946 11.5196 11 11.2652 11 11V3C11 2.73478 10.8946 2.48043 10.7071 2.29289C10.5196 2.10536 10.2652 2 10 2ZM9 10H4V4H9V10Z"
                    />
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

        <hr className="lk-sidebar__divider" />

        <nav className="lk-sidebar__nav" aria-label="Разделы">
          <Link
            to="/lk/dashboard#my-programs"
            className={itemClass(programsActive)}
            aria-current={programsActive ? "page" : undefined}
          >
            <ProgramsNavIcon />
            <span className="lk-sidebar__nav-text">Агентские программы</span>
          </Link>
        </nav>
      </div>
    </aside>
  );
}
