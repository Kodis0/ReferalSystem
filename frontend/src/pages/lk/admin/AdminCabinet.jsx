import { Link, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import {
  Activity,
  Building2,
  ClipboardList,
  Coins,
  FolderKanban,
  Globe,
  LifeBuoy,
  LogOut,
  Send,
  ShoppingCart,
  Users,
} from "lucide-react";
import "./admin.css";
import AdminMfaGate from "./AdminMfaGate";
import AdminUsersPage from "./AdminUsersPage";
import AdminUserDetailPage from "./AdminUserDetailPage";
import AdminPartnersPage from "./AdminPartnersPage";
import AdminPartnerDetailPage from "./AdminPartnerDetailPage";
import AdminProjectsPage from "./AdminProjectsPage";
import AdminProjectDetailPage from "./AdminProjectDetailPage";
import AdminSitesPage from "./AdminSitesPage";
import AdminSiteDetailPage from "./AdminSiteDetailPage";
import AdminSupportTicketsPage from "./AdminSupportTicketsPage";
import AdminSupportTicketDetailPage from "./AdminSupportTicketDetailPage";
import AdminOrdersPage from "./AdminOrdersPage";
import AdminOrderDetailPage from "./AdminOrderDetailPage";
import AdminCommissionsPage from "./AdminCommissionsPage";
import AdminCommissionDetailPage from "./AdminCommissionDetailPage";
import AdminLeadEventsPage from "./AdminLeadEventsPage";
import AdminLeadEventDetailPage from "./AdminLeadEventDetailPage";
import AdminIngestAuditsPage from "./AdminIngestAuditsPage";
import AdminIngestAuditDetailPage from "./AdminIngestAuditDetailPage";
import AdminActivityPage from "./AdminActivityPage";
import AdminActivityDetailPage from "./AdminActivityDetailPage";
import useCurrentUser from "../../../hooks/useCurrentUser";

const ADMIN_SECTIONS = [
  { to: "/admin-console/users", title: "Пользователи", Icon: Users },
  { to: "/admin-console/partners", title: "Партнёры", Icon: Building2 },
  { to: "/admin-console/support", title: "Поддержка", Icon: LifeBuoy },
  { to: "/admin-console/projects", title: "Проекты", Icon: FolderKanban },
  { to: "/admin-console/sites", title: "Сайты", Icon: Globe },
  { to: "/admin-console/orders", title: "Заказы", Icon: ShoppingCart },
  { to: "/admin-console/commissions", title: "Комиссии", Icon: Coins },
  { to: "/admin-console/lead-events", title: "Лиды", Icon: Send },
  { to: "/admin-console/ingest-audits", title: "Ingest audits", Icon: ClipboardList },
  { to: "/admin-console/activity", title: "Активность", Icon: Activity },
];

function navLinkClassName({ isActive }) {
  return `admin-portal__nav-item${isActive ? " admin-portal__nav-item--active" : ""}`;
}

function AdminCabinetOverview() {
  return (
    <section className="lk-admin-cabinet" aria-labelledby="lk-admin-cabinet-title">
      <header className="lk-admin-cabinet__header">
        <h1 id="lk-admin-cabinet-title" className="lk-admin-cabinet__title">
          Админ кабинет
        </h1>
        <p className="lk-admin-cabinet__subtitle">
          Управление пользователями, партнёрами, сайтами и заказами.
        </p>
      </header>
      <div className="lk-admin-cabinet__grid" role="list">
        {ADMIN_SECTIONS.map(({ to, title, Icon }) => (
          <Link
            key={to}
            to={to}
            className="lk-admin-cabinet__card"
            role="listitem"
            data-testid={`lk-admin-card-${to.split("/").pop()}`}
          >
            <span className="lk-admin-cabinet__card-icon" aria-hidden="true">
              <Icon size={20} strokeWidth={1.75} />
            </span>
            <span className="lk-admin-cabinet__card-title">{title}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function AdminCabinet() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const userEmail = typeof user?.email === "string" ? user.email : "";

  const handleLogout = () => {
    try {
      window.localStorage.removeItem("access_token");
      window.localStorage.removeItem("refresh_token");
    } catch {
      /* ignore */
    }
    navigate("/login");
  };

  return (
    <div className="admin-portal">
      <header className="admin-portal__header">
        <Link to="/admin-console" className="admin-portal__brand">
          Lumoref Admin
        </Link>
        <div className="admin-portal__user">
          {userEmail ? (
            <span className="admin-portal__user-email" data-testid="admin-portal-user-email">
              {userEmail}
            </span>
          ) : null}
          <button
            type="button"
            className="admin-portal__logout"
            onClick={handleLogout}
            data-testid="admin-portal-logout"
          >
            <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>Выйти</span>
          </button>
        </div>
      </header>
      <div className="admin-portal__body">
        <nav className="admin-portal__nav" aria-label="Разделы админ-портала">
          {ADMIN_SECTIONS.map(({ to, title, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={navLinkClassName}
              end={false}
              data-testid={`admin-portal-nav-${to.split("/").pop()}`}
            >
              <span className="admin-portal__nav-item-icon" aria-hidden="true">
                <Icon size={18} strokeWidth={1.75} />
              </span>
              <span>{title}</span>
            </NavLink>
          ))}
        </nav>
        <main className="admin-portal__content lk-admin">
          <AdminMfaGate>
            <Routes>
              <Route index element={<AdminCabinetOverview />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="users/:userId" element={<AdminUserDetailPage />} />
              <Route path="partners" element={<AdminPartnersPage />} />
              <Route path="partners/:partnerId" element={<AdminPartnerDetailPage />} />
              <Route path="projects" element={<AdminProjectsPage />} />
              <Route path="projects/:projectId" element={<AdminProjectDetailPage />} />
              <Route path="sites" element={<AdminSitesPage />} />
              <Route path="sites/:siteId" element={<AdminSiteDetailPage />} />
              <Route path="support" element={<AdminSupportTicketsPage />} />
              <Route path="support/:ticketId" element={<AdminSupportTicketDetailPage />} />
              <Route path="orders" element={<AdminOrdersPage />} />
              <Route path="orders/:orderId" element={<AdminOrderDetailPage />} />
              <Route path="commissions" element={<AdminCommissionsPage />} />
              <Route
                path="commissions/:commissionId"
                element={<AdminCommissionDetailPage />}
              />
              <Route path="lead-events" element={<AdminLeadEventsPage />} />
              <Route
                path="lead-events/:leadEventId"
                element={<AdminLeadEventDetailPage />}
              />
              <Route path="ingest-audits" element={<AdminIngestAuditsPage />} />
              <Route
                path="ingest-audits/:auditId"
                element={<AdminIngestAuditDetailPage />}
              />
              <Route path="activity" element={<AdminActivityPage />} />
              <Route path="activity/:auditId" element={<AdminActivityDetailPage />} />
            </Routes>
          </AdminMfaGate>
        </main>
      </div>
    </div>
  );
}
