import { Link, NavLink, useLocation } from "react-router-dom";
import { Code2, LayoutDashboard, Link2, ListChecks } from "lucide-react";
import "./LkSidebar.css";

function itemClass(active) {
  return `lk-sidebar__item ${active ? "lk-sidebar__item_active" : ""}`;
}

export default function LkSidebar() {
  const { pathname, hash } = useLocation();
  const onDashboard = pathname === "/lk/dashboard";
  const panelActive = onDashboard && hash !== "#my-programs";
  const programsActive = onDashboard && hash === "#my-programs";

  return (
    <aside className="lk-sidebar" aria-label="Меню личного кабинета">
      <div className="lk-sidebar__frame">
        <nav className="lk-sidebar__nav">
          <Link
            to="/lk/dashboard"
            className={itemClass(panelActive)}
            aria-current={panelActive ? "page" : undefined}
          >
            <span className="lk-sidebar__icon" aria-hidden="true">
              <LayoutDashboard size={18} />
            </span>
            <span className="lk-sidebar__text">Панель</span>
          </Link>
          <Link
            to="/lk/dashboard#my-programs"
            className={itemClass(programsActive)}
            aria-current={programsActive ? "page" : undefined}
          >
            <span className="lk-sidebar__icon" aria-hidden="true">
              <ListChecks size={18} />
            </span>
            <span className="lk-sidebar__text">Мои программы</span>
          </Link>
          <NavLink
            to="/lk/partner"
            className={({ isActive }) => itemClass(isActive)}
          >
            <span className="lk-sidebar__icon" aria-hidden="true">
              <Link2 size={18} />
            </span>
            <span className="lk-sidebar__text">Партнёрка</span>
          </NavLink>
          <NavLink
            to="/lk/widget-install"
            className={({ isActive }) => itemClass(isActive)}
          >
            <span className="lk-sidebar__icon" aria-hidden="true">
              <Code2 size={18} />
            </span>
            <span className="lk-sidebar__text">Виджет</span>
          </NavLink>
        </nav>
      </div>
    </aside>
  );
}

