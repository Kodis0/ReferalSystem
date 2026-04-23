import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "../partner/partner.css";
import "./owner-programs.css";
import { formatSiteCardTitle } from "./siteDisplay";
import { fetchOwnerSitesList } from "./ownerSitesListApi";

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

function projectTargetHref(project) {
  if (typeof project?.id === "number") {
    const params = new URLSearchParams();
    if (project?.primary_site_public_id) {
      params.set("site_public_id", project.primary_site_public_id);
    }
    const search = params.toString();
    return `/lk/partner/project/${project.id}/overview${search ? `?${search}` : ""}`;
  }
  return "/lk/partner";
}

function DefaultProjectAvatar() {
  const clipId = `owner-proj-av-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      fill="none"
      viewBox="0 0 22 22"
      className="owner-programs__project-card-avatar-svg"
      aria-hidden="true"
    >
      <g clipPath={`url(#${clipId})`}>
        <circle cx="11" cy="11" r="11" fill="#7177F8" />
        <circle cx="21" cy="21" r="11" fill="#fff" opacity="0.2" />
        <circle cx="-2" cy="1" r="11" fill="#fff" opacity="0.3" />
      </g>
      <defs>
        <clipPath id={clipId}>
          <rect width="22" height="22" fill="#fff" rx="11" />
        </clipPath>
      </defs>
    </svg>
  );
}

function ProjectsCardGripIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="8.8" cy="6.6" r="1.8" fill="currentColor" />
      <circle cx="15.2" cy="6.6" r="1.8" fill="currentColor" />
      <circle cx="8.8" cy="12" r="1.8" fill="currentColor" />
      <circle cx="15.2" cy="12" r="1.8" fill="currentColor" />
      <circle cx="8.8" cy="17.4" r="1.8" fill="currentColor" />
      <circle cx="15.2" cy="17.4" r="1.8" fill="currentColor" />
    </svg>
  );
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

export default function OwnerSitesListPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState([]);
  const [dragHandleProjectId, setDragHandleProjectId] = useState("");
  const [draggedProjectId, setDraggedProjectId] = useState("");
  const [dragPlaceholderProjectId, setDragPlaceholderProjectId] = useState("");
  const [dragOverProjectId, setDragOverProjectId] = useState("");
  const [dragOverPlacement, setDragOverPlacement] = useState("");
  const dragPlaceholderFrameRef = useRef(0);
  const flipAnimationFrameRef = useRef(0);
  const cardNodeRefs = useRef(new Map());
  const previousCardPositionsRef = useRef(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { ok, projects: nextProjects = [], error: err } = await fetchOwnerSitesList();
      if (!ok) {
        setProjects([]);
        setError(err || "Ошибка загрузки");
        return;
      }
      setProjects(nextProjects);
    } catch (e) {
      console.error(e);
      setProjects([]);
      setError("Сетевая ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

    projects.forEach((project) => {
      const id = projectKey(project);
      const node = cardNodeRefs.current.get(id);
      if (node) {
        nextPositions.set(id, node.getBoundingClientRect());
      }
    });

    if (draggedProjectId) {
      nextPositions.forEach((_, projectId) => {
        const node = cardNodeRefs.current.get(projectId);
        if (!node) return;
        node.style.transition = "";
        node.style.transform = "";
      });
      previousCardPositionsRef.current = nextPositions;
      return;
    }

    if (previousCardPositionsRef.current.size > 0) {
      nextPositions.forEach((rect, projectId) => {
        const previousRect = previousCardPositionsRef.current.get(projectId);
        const node = cardNodeRefs.current.get(projectId);
        if (!previousRect || !node) return;

        const deltaX = previousRect.left - rect.left;
        const deltaY = previousRect.top - rect.top;
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

        node.style.transition = "none";
        node.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      });

      if (flipAnimationFrameRef.current) {
        cancelAnimationFrame(flipAnimationFrameRef.current);
      }

      flipAnimationFrameRef.current = requestAnimationFrame(() => {
        nextPositions.forEach((_, projectId) => {
          const node = cardNodeRefs.current.get(projectId);
          if (!node || !node.style.transform) return;

          node.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
          node.style.transform = "";
        });
        flipAnimationFrameRef.current = 0;
      });
    }

    previousCardPositionsRef.current = nextPositions;
  }, [draggedProjectId, projects]);

  const setCardNodeRef = useCallback((projectId, node) => {
    if (node) {
      cardNodeRefs.current.set(projectId, node);
      return;
    }
    cardNodeRefs.current.delete(projectId);
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

  const handleCardDragStart = useCallback(
    (event, projectId) => {
      if (dragHandleProjectId !== projectId) {
        event.preventDefault();
        return;
      }
      const dragPreviewElement =
        event.currentTarget.closest?.(".owner-programs__project-card-container") || event.currentTarget;
      setDraggedProjectId(projectId);
      setDragPlaceholderProjectId("");
      setDragOverProjectId("");
      setDragOverPlacement("");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", projectId);
      if (typeof event.dataTransfer.setDragImage === "function" && dragPreviewElement instanceof HTMLElement) {
        const rect = dragPreviewElement.getBoundingClientRect();
        const offsetX = typeof event.clientX === "number" ? Math.max(0, event.clientX - rect.left) : rect.width / 2;
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

  const handleCardDragOver = useCallback(
    (event, projectId) => {
      if (!draggedProjectId || draggedProjectId === projectId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      const sourceIndex = projects.findIndex((project) => projectKey(project) === draggedProjectId);
      const targetIndex = projects.findIndex((project) => projectKey(project) === projectId);
      if (sourceIndex === -1 || targetIndex === -1) return;

      const rect = event.currentTarget.getBoundingClientRect?.();
      const sourceNode = cardNodeRefs.current.get(draggedProjectId);
      const sourceRect = sourceNode?.getBoundingClientRect?.();

      let placeAfter;
      const hasPointerPosition =
        rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        typeof event.clientX === "number" &&
        typeof event.clientY === "number" &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (!hasPointerPosition) {
        placeAfter = sourceIndex < targetIndex;
      } else {
        const sameRow = sourceRect ? Math.abs(sourceRect.top - rect.top) < rect.height / 2 : false;
        if (sameRow) {
          const offsetX = event.clientX - rect.left;
          const upperThreshold = rect.width * 0.35;
          const lowerThreshold = rect.width * 0.65;

          if (sourceIndex < targetIndex) {
            if (offsetX < lowerThreshold) return;
            placeAfter = true;
          } else {
            if (offsetX > upperThreshold) return;
            placeAfter = false;
          }
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
      }

      const nextPlacement = placeAfter ? "after" : "before";
      if (dragOverProjectId === projectId && dragOverPlacement === nextPlacement) return;

      setProjects((current) => moveProjectPosition(current, draggedProjectId, projectId, placeAfter));
      setDragOverProjectId(projectId);
      setDragOverPlacement(nextPlacement);
    },
    [draggedProjectId, dragOverPlacement, dragOverProjectId, projects],
  );

  const handleCardDrop = useCallback(
    (event) => {
      event.preventDefault();
      resetDragState();
    },
    [resetDragState],
  );

  const handleCardDragEnd = resetDragState;

  return (
    <div className="owner-programs__projects-page lk-partner">
      <header className="owner-programs__projects-header">
        <div className="owner-programs__projects-header-info">
          <h1 className="owner-programs__projects-h1">Проекты</h1>
        </div>
        <div className="owner-programs__projects-header-actions">
          <Link className="owner-programs__projects-create-btn" to="/lk/partner/new">
            Создать
          </Link>
        </div>
      </header>

      {loading && (
        <div className="owner-programs__projects-loader" role="status" aria-live="polite" aria-label="Загрузка">
          <div className="owner-programs__projects-loader-inner">
            <div className="owner-programs__projects-loader-icon" data-test-id="loader" />
          </div>
        </div>
      )}

      {!loading && error && <div className="owner-programs__error owner-programs__projects-body-error">{error}</div>}

      {!loading && !error && projects.length === 0 && (
        <div className="owner-programs__projects-list">
          <p className="owner-programs__projects-empty owner-programs__muted" data-testid="projects-empty">
            У вас ещё нет ни одного проекта. Нажмите «Создать» — появятся первый сайт, ключи, сниппет виджета и диагностика.
          </p>
        </div>
      )}

      {!loading && !error && projects.length > 0 && (
        <div
          className="owner-programs__projects-list owner-programs__projects-list--tw-cards"
          data-testid="projects-cards"
        >
          {projects.map((project) => {
            const id = projectKey(project);
            const title = projectTitle(project);
            const desc = typeof project?.project?.description === "string" ? project.project.description.trim() : "";
            const avatarDataUrl = projectAvatarDataUrl(project);
            const isDragging = dragPlaceholderProjectId === id;
            const isDragOver = dragOverProjectId === id && draggedProjectId !== id;
            const targetHref = projectTargetHref(project);
            return (
              <div
                key={id}
                ref={(node) => setCardNodeRef(id, node)}
                className={`owner-programs__project-card-container${isDragging ? " owner-programs__project-card-container--dragging" : ""}${isDragOver ? " owner-programs__project-card-container--drag-over" : ""}`}
                data-id={id}
                data-testid={`project-card-${id}`}
                onDragOver={(event) => handleCardDragOver(event, id)}
                onDrop={(event) => handleCardDrop(event, id)}
              >
                <Link
                  to={targetHref}
                  state={{ projectViewMode: "overview" }}
                  className="owner-programs__project-card-link owner-programs__project-card-link_primary owner-programs__project-card-link_s"
                  draggable
                  onDragStart={(event) => handleCardDragStart(event, id)}
                  onDragEnd={handleCardDragEnd}
                >
                  <div className="owner-programs__project-card-avatar">
                    {avatarDataUrl ? (
                      <img
                        src={avatarDataUrl}
                        alt=""
                        className="owner-programs__project-card-avatar-image"
                        aria-hidden="true"
                      />
                    ) : (
                      <DefaultProjectAvatar />
                    )}
                  </div>
                  <p className="owner-programs__project-card-name">{title}</p>
                  <div className="owner-programs__project-card-meta">
                    {desc ? <p className="owner-programs__project-card-desc">{desc}</p> : null}
                    <p className="owner-programs__project-card-desc" data-testid={`project-card-sites-${id}`}>
                      Сервисов: {project.sites_count}
                    </p>
                  </div>
                  <div className="owner-programs__project-card-top-right">
                    <div
                      className="owner-programs__project-card-drag"
                      data-projects-drag-handle="true"
                      aria-hidden="true"
                      onMouseDown={() => setDragHandleProjectId(id)}
                      onMouseUp={() => {
                        if (!draggedProjectId) {
                          setDragHandleProjectId("");
                        }
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <ProjectsCardGripIcon className="owner-programs__project-card-drag-icon" />
                    </div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
