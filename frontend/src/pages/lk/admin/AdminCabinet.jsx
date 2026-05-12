import { Link, Route, Routes } from "react-router-dom";
import {
  Activity,
  Building2,
  Coins,
  FolderKanban,
  Globe,
  LifeBuoy,
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

const ADMIN_SECTIONS = [
  { to: "/lk/admin/users", title: "Пользователи", Icon: Users },
  { to: "/lk/admin/partners", title: "Партнёры", Icon: Building2 },
  { to: "/lk/admin/projects", title: "Проекты", Icon: FolderKanban },
  { to: "/lk/admin/sites", title: "Сайты", Icon: Globe },
  { to: "/lk/admin/orders", title: "Заказы", Icon: ShoppingCart },
  { to: "/lk/admin/commissions", title: "Комиссии", Icon: Coins },
  { to: "/lk/admin/lead-events", title: "Лиды", Icon: Send },
  { to: "/lk/admin/support", title: "Поддержка", Icon: LifeBuoy },
  { to: "/lk/admin/activity", title: "Активность", Icon: Activity },
];

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
  return (
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
  );
}
