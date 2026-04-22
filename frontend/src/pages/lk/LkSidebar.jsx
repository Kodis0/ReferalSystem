import { useId, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, ListChecks } from "lucide-react";
import "./LkSidebar.css";

function itemClass(active) {
  return `lk-sidebar__item ${active ? "lk-sidebar__item_active" : ""}`;
}

function projectsIconClass(active) {
  return `lk-sidebar__item lk-sidebar__item_row lk-sidebar__item_iconed ${active ? "lk-sidebar__item_active" : ""}`;
}

export default function LkSidebar() {
  const projectAvatarClipId = useId().replace(/:/g, "");
  const { pathname, hash } = useLocation();
  const [projectsOpen, setProjectsOpen] = useState(true);

  const onDashboard = pathname === "/lk/dashboard";
  const panelActive = onDashboard && hash !== "#my-programs";
  const programsActive = onDashboard && hash === "#my-programs";

  const onPartnerList = pathname === "/lk/partner";
  const onCreateProject = pathname === "/lk/partner/new";
  const inPartnerProject =
    /^\/lk\/partner\/[^/]+/.test(pathname) && pathname !== "/lk/partner/new";

  const projectsLinkActive = onPartnerList;
  const generalProjectActive = inPartnerProject;

  return (
    <aside className="lk-sidebar" aria-label="Меню личного кабинета" id="sidebarMenu">
      <div className="lk-sidebar__frame">
        <div className={`lk-sidebar__collapse ${projectsOpen ? "lk-sidebar__collapse_open" : ""}`}>
          <button
            type="button"
            className="lk-sidebar__collapse-toggle"
            aria-expanded={projectsOpen}
            aria-controls="lk-sidebar-projects-block"
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
          <div id="lk-sidebar-projects-block" className="lk-sidebar__collapse-body">
            <nav className="lk-sidebar__projects-nav" aria-label="Проекты" aria-hidden={!projectsOpen}>
              <Link
                to="/lk/partner"
                data-test-id="projects-btn"
                className={projectsIconClass(projectsLinkActive)}
                aria-current={projectsLinkActive ? "page" : undefined}
                tabIndex={projectsOpen ? undefined : -1}
              >
                <span className="lk-sidebar__icon lk-sidebar__icon_nav" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path
                      fill="currentColor"
                      d="M10 14H3C2.73478 14 2.48043 14.1054 2.29289 14.2929C2.10536 14.4804 2 14.7348 2 15V21C2 21.2652 2.10536 21.5196 2.29289 21.7071C2.48043 21.8946 2.73478 22 3 22H10C10.2652 22 10.5196 21.8946 10.7071 21.7071C10.8946 21.5196 11 21.2652 11 21V15C11 14.7348 10.8946 14.4804 10.7071 14.2929C10.5196 14.1054 10.2652 14 10 14ZM9 20H4V16H9V20ZM21 2H14C13.7348 2 13.4804 2.10536 13.2929 2.29289C13.1054 2.48043 13 2.73478 13 3V9C13 9.26522 13.1054 9.51957 13.2929 9.70711C13.4804 9.89464 13.7348 10 14 10H21C21.2652 10 21.5196 9.89464 21.7071 9.70711C21.8946 9.51957 22 9.26522 22 9V3C22 2.73478 21.8946 2.48043 21.7071 2.29289C21.5196 2.10536 21.2652 2 21 2ZM20 8H15V4H20V8ZM21 12H14C13.7348 12 13.4804 12.1054 13.2929 12.2929C13.1054 12.4804 13 12.7348 13 13V21C13 21.2652 13.1054 21.5196 13.2929 21.7071C13.4804 21.8946 13.7348 22 14 22H21C21.2652 22 21.5196 21.8946 21.7071 21.7071C21.8946 21.5196 22 21.2652 22 21V13C22 12.7348 21.8946 12.4804 21.7071 12.2929C21.5196 12.1054 21.2652 12 21 12ZM20 20H15V14H20V20ZM10 2H3C2.73478 2 2.48043 2.10536 2.29289 2.29289C2.10536 2.48043 2 2.73478 2 3V11C2 11.2652 2.10536 11.5196 2.29289 11.7071C2.48043 11.8946 2.73478 12 3 12H10C10.2652 12 10.5196 11.8946 10.7071 11.7071C10.8946 11.5196 11 11.2652 11 11V3C11 2.73478 10.8946 2.48043 10.7071 2.29289C10.5196 2.10536 10.2652 2 10 2ZM9 10H4V4H9V10Z"
                    />
                  </svg>
                </span>
                <span className="lk-sidebar__text">Проекты</span>
              </Link>

              <div className="lk-sidebar__project-slot">
                <Link
                  to="/lk/partner"
                  data-test-id="default-project-link"
                  className={`lk-sidebar__item lk-sidebar__item_row lk-sidebar__item_project ${generalProjectActive ? "lk-sidebar__item_active" : ""}`}
                  aria-current={generalProjectActive ? "page" : undefined}
                  tabIndex={projectsOpen ? undefined : -1}
                >
                  <span className="lk-sidebar__project-avatar" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 22 22">
                      <defs>
                        <clipPath id={projectAvatarClipId}>
                          <rect width="22" height="22" fill="#fff" rx="11" />
                        </clipPath>
                      </defs>
                      <g clipPath={`url(#${projectAvatarClipId})`}>
                        <circle cx="11" cy="11" r="11" fill="#7177F8" />
                        <circle cx="21" cy="21" r="11" fill="#fff" opacity="0.2" />
                        <circle cx="-2" cy="1" r="11" fill="#fff" opacity="0.3" />
                      </g>
                    </svg>
                  </span>
                  <span className="lk-sidebar__text">Общий проект</span>
                </Link>
              </div>

              <Link
                to="/lk/partner/new"
                data-test-id="add-project-btn"
                className={projectsIconClass(onCreateProject)}
                aria-current={onCreateProject ? "page" : undefined}
                tabIndex={projectsOpen ? undefined : -1}
              >
                <span className="lk-sidebar__icon lk-sidebar__icon_nav" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M19 11h-6V5a1 1 0 0 0-2 0v6H5a1 1 0 0 0 0 2h6v6a1 1 0 0 0 2 0v-6h6a1 1 0 0 0 0-2Z"
                    />
                  </svg>
                </span>
                <span className="lk-sidebar__text">Создать проект</span>
              </Link>
            </nav>
          </div>
        </div>

        <hr className="lk-sidebar__divider" />

        <nav className="lk-sidebar__nav" aria-label="Разделы">
          <Link
            to="/lk/dashboard"
            className={itemClass(panelActive)}
            aria-current={panelActive ? "page" : undefined}
          >
            <span className="lk-sidebar__icon lk-sidebar__icon_nav" aria-hidden="true">
              <LayoutDashboard size={20} strokeWidth={1.75} />
            </span>
            <span className="lk-sidebar__text">Панель</span>
          </Link>
          <Link
            to="/lk/dashboard#my-programs"
            className={itemClass(programsActive)}
            aria-current={programsActive ? "page" : undefined}
          >
            <span className="lk-sidebar__icon lk-sidebar__icon_nav" aria-hidden="true">
              <ListChecks size={20} strokeWidth={1.75} />
            </span>
            <span className="lk-sidebar__text">Агентские программы</span>
          </Link>
        </nav>
      </div>
    </aside>
  );
}
