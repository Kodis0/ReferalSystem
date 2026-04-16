import { NavLink } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";
import "./LkSidebar.css";

export default function LkSidebar() {
  return (
    <aside className="lk-sidebar" aria-label="Меню личного кабинета">
      <div className="lk-sidebar__frame">
        <nav className="lk-sidebar__nav">
          <NavLink
            to="/LK/dashboard"
            className={({ isActive }) => `lk-sidebar__item ${isActive ? "lk-sidebar__item_active" : ""}`}
          >
            <span className="lk-sidebar__icon" aria-hidden="true">
              <LayoutDashboard size={18} />
            </span>
            <span className="lk-sidebar__text">Панель</span>
          </NavLink>
        </nav>
      </div>
    </aside>
  );
}

