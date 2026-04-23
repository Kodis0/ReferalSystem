import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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

function DashboardNavIcon() {
  return (
    <svg
      className="lk-sidebar__nav-icon-svg"
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
          fillRule="evenodd"
          clipRule="evenodd"
          d="M6.98013 3H7.04013C7.48013 3 7.86013 3 8.17013 3.02C8.50013 3.04 8.83013 3.09 9.16013 3.22C9.52404 3.37189 9.85442 3.59404 10.1324 3.87373C10.4104 4.15342 10.6305 4.48517 10.7801 4.85C10.9201 5.18 10.9701 5.51 10.9801 5.84C11.0101 6.15 11.0101 6.53 11.0101 6.97V7.03C11.0101 7.47 11.0101 7.85 10.9901 8.16C10.9701 8.49 10.9201 8.82 10.7901 9.15C10.6382 9.5139 10.4161 9.84429 10.1364 10.1223C9.85671 10.4002 9.52496 10.6204 9.16013 10.77C8.84565 10.8983 8.50977 10.9662 8.17013 10.97C7.86013 11 7.48013 11 7.04013 11H6.98013C6.54013 11 6.16013 11 5.85013 10.98C5.51135 10.9684 5.17683 10.9009 4.86013 10.78C4.49623 10.6281 4.16584 10.406 3.88786 10.1263C3.60989 9.84658 3.38978 9.51483 3.24013 9.15C3.11927 8.8333 3.05169 8.49878 3.04013 8.16C3.01013 7.85 3.01013 7.47 3.01013 7.03V6.97C3.01013 6.53 3.01013 6.15 3.03013 5.84C3.05013 5.51 3.10013 5.18 3.23013 4.85C3.38202 4.4861 3.60417 4.15571 3.88386 3.87773C4.16355 3.59976 4.4953 3.37965 4.86013 3.23C5.19013 3.09 5.52013 3.04 5.85013 3.03C6.16013 3 6.54013 3 6.98013 3ZM5.98013 5.02C5.86066 5.01682 5.74173 5.03721 5.63013 5.08C5.38578 5.18147 5.19161 5.37565 5.09013 5.62C5.04734 5.73159 5.02695 5.85052 5.03013 5.97C5.01013 6.21 5.01013 6.52 5.01013 7C5.01013 7.48 5.01013 7.79 5.03013 8.03C5.04013 8.25 5.07013 8.34 5.09013 8.38C5.19013 8.63 5.39013 8.82 5.63013 8.92C5.67013 8.94 5.76013 8.97 5.98013 8.98C6.22013 9 6.53013 9 7.01013 9C7.49013 9 7.80013 9 8.04013 8.98C8.15961 8.98318 8.27854 8.96279 8.39013 8.92C8.63448 8.81853 8.82866 8.62435 8.93013 8.38C8.97292 8.26841 8.99331 8.14947 8.99013 8.03C9.01013 7.79 9.01013 7.48 9.01013 7C9.01013 6.52 9.01013 6.21 8.99013 5.97C8.98821 5.85095 8.96798 5.7329 8.93013 5.62C8.82866 5.37565 8.63448 5.18147 8.39013 5.08C8.27724 5.04216 8.15919 5.02192 8.04013 5.02C7.80013 5 7.49013 5 7.01013 5C6.53013 5 6.22013 5 5.98013 5.02Z"
          fill="currentColor"
        />
        <path
          id="Vector_2"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M16.9599 3H17.0199C17.4599 3 17.8399 3 18.1499 3.02C18.4799 3.04 18.8099 3.09 19.1399 3.22C19.5038 3.37189 19.8342 3.59404 20.1121 3.87373C20.3901 4.15342 20.6102 4.48517 20.7599 4.85C20.8999 5.18 20.9499 5.51 20.9599 5.84C20.9899 6.15 20.9899 6.53 20.9899 6.97V7.03C20.9899 7.47 20.9899 7.85 20.9699 8.16C20.9499 8.49 20.8999 8.82 20.7699 9.15C20.618 9.5139 20.3958 9.84429 20.1161 10.1223C19.8364 10.4002 19.5047 10.6204 19.1399 10.77C18.8254 10.8983 18.4895 10.9662 18.1499 10.97C17.8399 11 17.4599 11 17.0199 11H16.9599C16.5199 11 16.1399 11 15.8299 10.98C15.4911 10.9684 15.1566 10.9009 14.8399 10.78C14.476 10.6281 14.1456 10.406 13.8676 10.1263C13.5896 9.84658 13.3695 9.51483 13.2199 9.15C13.099 8.8333 13.0314 8.49878 13.0199 8.16C12.9899 7.85 12.9899 7.47 12.9899 7.03V6.97C12.9899 6.53 12.9899 6.15 13.0099 5.84C13.0299 5.51 13.0799 5.18 13.2099 4.85C13.3618 4.4861 13.5839 4.15571 13.8636 3.87773C14.1433 3.59976 14.475 3.37965 14.8399 3.23C15.1699 3.09 15.4999 3.04 15.8299 3.03C16.1399 3 16.5199 3 16.9599 3ZM15.9599 5.02C15.8404 5.01682 15.7215 5.03721 15.6099 5.08C15.3655 5.18147 15.1713 5.37565 15.0699 5.62C15.0271 5.73159 15.0067 5.85052 15.0099 5.97C14.9899 6.21 14.9899 6.52 14.9899 7C14.9899 7.48 14.9899 7.79 15.0099 8.03C15.0199 8.25 15.0499 8.34 15.0699 8.38C15.1699 8.63 15.3699 8.82 15.6099 8.92C15.6499 8.94 15.7399 8.97 15.9599 8.98C16.1999 9 16.5099 9 16.9899 9C17.4699 9 17.7799 9 18.0199 8.98C18.1393 8.98318 18.2583 8.96279 18.3699 8.92C18.6142 8.81853 18.8084 8.62435 18.9099 8.38C18.9527 8.26841 18.973 8.14947 18.9699 8.03C18.9899 7.79 18.9899 7.48 18.9899 7C18.9899 6.52 18.9899 6.21 18.9699 5.97C18.9679 5.85095 18.9477 5.7329 18.9099 5.62C18.8084 5.37565 18.6142 5.18147 18.3699 5.08C18.257 5.04216 18.1389 5.02192 18.0199 5.02C17.7799 5 17.4699 5 16.9899 5C16.5099 5 16.1999 5 15.9599 5.02Z"
          fill="currentColor"
        />
        <path
          id="Vector_3"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M6.98013 13H7.04013C7.48013 13 7.86013 13 8.17013 13.02C8.50013 13.04 8.83013 13.09 9.16013 13.22C9.52404 13.3719 9.85442 13.594 10.1324 13.8737C10.4104 14.1534 10.6305 14.4852 10.7801 14.85C10.9201 15.18 10.9701 15.51 10.9801 15.84C11.0101 16.15 11.0101 16.53 11.0101 16.97V17.03C11.0101 17.47 11.0101 17.85 10.9901 18.16C10.9701 18.49 10.9201 18.82 10.7901 19.15C10.6382 19.5139 10.4161 19.8443 10.1364 20.1223C9.85671 20.4002 9.52496 20.6204 9.16013 20.77C8.84565 20.8983 8.50977 20.9662 8.17013 20.97C7.86013 21 7.48013 21 7.04013 21H6.98013C6.54013 21 6.16013 21 5.85013 20.98C5.51135 20.9684 5.17683 20.9009 4.86013 20.78C4.49623 20.6281 4.16584 20.406 3.88786 20.1263C3.60989 19.8466 3.38978 19.5148 3.24013 19.15C3.11927 18.8333 3.05169 18.4988 3.04013 18.16C3.01013 17.85 3.01013 17.47 3.01013 17.03V16.97C3.01013 16.53 3.01013 16.15 3.03013 15.84C3.05013 15.51 3.10013 15.18 3.23013 14.85C3.38202 14.4861 3.60417 14.1557 3.88386 13.8777C4.16355 13.5998 4.4953 13.3797 4.86013 13.23C5.19013 13.09 5.52013 13.04 5.85013 13.03C6.16013 13 6.54013 13 6.98013 13ZM5.98013 15.02C5.86066 15.0168 5.74173 15.0372 5.63013 15.08C5.38578 15.1815 5.19161 15.3757 5.09013 15.62C5.04734 15.7316 5.02695 15.8505 5.03013 15.97C5.01013 16.21 5.01013 16.52 5.01013 17C5.01013 17.48 5.01013 17.79 5.03013 18.03C5.04013 18.25 5.07013 18.34 5.09013 18.38C5.19013 18.63 5.39013 18.82 5.63013 18.92C5.67013 18.94 5.76013 18.97 5.98013 18.98C6.22013 19 6.53013 19 7.01013 19C7.49013 19 7.80013 19 8.04013 18.98C8.15961 18.9832 8.27854 18.9628 8.39013 18.92C8.63448 18.8185 8.82866 18.6243 8.93013 18.38C8.97292 18.2684 8.99331 18.1495 8.99013 18.03C9.01013 17.79 9.01013 17.48 9.01013 17C9.01013 16.52 9.01013 16.21 8.99013 15.97C8.98821 15.8509 8.96798 15.7329 8.93013 15.62C8.82866 15.3757 8.63448 15.1815 8.39013 15.08C8.27724 15.0422 8.15919 15.0219 8.04013 15.02C7.80013 15 7.49013 15 7.01013 15C6.53013 15 6.22013 15 5.98013 15.02Z"
          fill="currentColor"
        />
        <path
          id="Vector_4"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M16.9599 13H17.0199C17.4599 13 17.8399 13 18.1499 13.02C18.4799 13.04 18.8099 13.09 19.1399 13.22C19.5038 13.3719 19.8342 13.594 20.1121 13.8737C20.3901 14.1534 20.6102 14.4852 20.7599 14.85C20.8999 15.18 20.9499 15.51 20.9599 15.84C20.9899 16.15 20.9899 16.53 20.9899 16.97V17.03C20.9899 17.47 20.9899 17.85 20.9699 18.16C20.9499 18.49 20.8999 18.82 20.7699 19.15C20.618 19.5139 20.3958 19.8443 20.1161 20.1223C19.8364 20.4002 19.5047 20.6204 19.1399 20.77C18.8254 20.8983 18.4895 20.9662 18.1499 20.97C17.8399 21 17.4599 21 17.0199 21H16.9599C16.5199 21 16.1399 21 15.8299 20.98C15.4911 20.9684 15.1566 20.9009 14.8399 20.78C14.476 20.6281 14.1456 20.406 13.8676 20.1263C13.5896 19.8466 13.3695 19.5148 13.2199 19.15C13.099 18.8333 13.0314 18.4988 13.0199 18.16C12.9899 17.85 12.9899 17.47 12.9899 17.03V16.97C12.9899 16.53 12.9899 16.15 13.0099 15.84C13.0299 15.51 13.0799 15.18 13.2099 14.85C13.3618 14.4861 13.5839 14.1557 13.8636 13.8777C14.1433 13.5998 14.475 13.3797 14.8399 13.23C15.1699 13.09 15.4999 13.04 15.8299 13.03C16.1399 13 16.5199 13 16.9599 13ZM15.9599 15.02C15.8404 15.0168 15.7215 15.0372 15.6099 15.08C15.3655 15.1815 15.1713 15.3757 15.0699 15.62C15.0271 15.7316 15.0067 15.8505 15.0099 15.97C14.9899 16.21 14.9899 16.52 14.9899 17C14.9899 17.48 14.9899 17.79 15.0099 18.03C15.0199 18.25 15.0499 18.34 15.0699 18.38C15.1699 18.63 15.3699 18.82 15.6099 18.92C15.6499 18.94 15.7399 18.97 15.9599 18.98C16.1999 19 16.5099 19 16.9899 19C17.4699 19 17.7799 19 18.0199 18.98C18.1393 18.9832 18.2583 18.9628 18.3699 18.92C18.6142 18.8185 18.8084 18.6243 18.9099 18.38C18.9527 18.2684 18.973 18.1495 18.9699 18.03C18.9899 17.79 18.9899 17.48 18.9899 17C18.9899 16.52 18.9899 16.21 18.9699 15.97C18.9679 15.8509 18.9477 15.7329 18.9099 15.62C18.8084 15.3757 18.6142 15.1815 18.3699 15.08C18.257 15.0422 18.1389 15.0219 18.0199 15.02C17.7799 15 17.4699 15 16.9899 15C16.5099 15 16.1999 15 15.9599 15.02Z"
          fill="currentColor"
        />
      </g>
    </svg>
  );
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

export default function LkSidebar() {
  const projectAvatarClipId = useId().replace(/:/g, "");
  const { pathname, hash, search } = useLocation();
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [ownerProjects, setOwnerProjects] = useState([]);
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
  const panelActive = onDashboard && hash !== "#my-programs";
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { ok, projects = [] } = await fetchOwnerSitesList();
      if (!cancelled && ok) setOwnerProjects(projects);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

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
              className="lk-sidebar__collapse-inner"
              role="navigation"
              aria-label="Подразделы проектов"
              aria-hidden={!projectsOpen}
            >
              <div className="">
                {ownerProjects.map((project) => {
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
                })}
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

        <hr className="lk-sidebar__divider" />

        <nav className="lk-sidebar__nav" aria-label="Разделы">
          <Link
            to="/lk/dashboard"
            className={itemClass(panelActive)}
            aria-current={panelActive ? "page" : undefined}
          >
            <DashboardNavIcon />
            <span className="lk-sidebar__nav-text">Панель</span>
          </Link>
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
