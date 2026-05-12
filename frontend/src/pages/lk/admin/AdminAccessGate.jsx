import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import {
  Activity,
  Building2,
  ClipboardList,
  Coins,
  FolderKanban,
  Globe,
  LifeBuoy,
  Send,
  ShoppingCart,
  Users,
} from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
import {
  adminFetch,
  getAdminAccessToken,
  onAdminAuthExpired,
  setAdminAccessToken,
  setAdminRefreshToken,
} from "../../../components/adminAuth";
import AdminMfaGate from "./AdminMfaGate";
import AdminLoginForm from "./AdminLoginForm";
import AdminDashboardPage from "./AdminDashboardPage";
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

function AdminCabinetContent() {
  return (
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
        <Routes>
          <Route index element={<AdminDashboardPage />} />
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
      </main>
    </div>
  );
}

/**
 * Гейт для `/admin-console/*`: показывает либо login-форму, либо MFA-pending, либо разделы.
 *
 * Фазы:
 *   - "loading"       — проверяем admin token + admin session.
 *   - "login"         — нет admin token / 401: рендерим AdminLoginForm.
 *   - "mfa"           — есть admin token, session не elevated: AdminMfaGate с autoStart="approval".
 *   - "elevated"      — есть admin token + elevated session: рендерим разделы.
 */
const IS_ADMIN_DEV_BYPASS =
  process.env.REACT_APP_ADMIN_DEV_BYPASS === "true" &&
  process.env.NODE_ENV !== "production";

export default function AdminAccessGate() {
  const [phase, setPhase] = useState(() => {
    if (IS_ADMIN_DEV_BYPASS) return "elevated";
    return getAdminAccessToken() ? "loading" : "login";
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const checkSession = useCallback(async () => {
    if (IS_ADMIN_DEV_BYPASS) return;
    if (!getAdminAccessToken()) {
      setPhase("login");
      return;
    }
    try {
      const res = await adminFetch(API_ENDPOINTS.adminSession);
      if (res.status === 401) {
        if (mountedRef.current) setPhase("login");
        return;
      }
      if (!res.ok) {
        if (mountedRef.current) setPhase("mfa");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      setPhase(data && data.is_elevated ? "elevated" : "mfa");
    } catch (_) {
      if (!mountedRef.current) return;
      setPhase("mfa");
    }
  }, []);

  useEffect(() => {
    if (phase === "loading") {
      checkSession();
    }
  }, [phase, checkSession]);

  useEffect(() => {
    if (IS_ADMIN_DEV_BYPASS) return undefined;
    return onAdminAuthExpired(() => {
      if (!mountedRef.current) return;
      setPhase("login");
    });
  }, []);

  const handleLoginSuccess = useCallback(({ access, refresh }) => {
    setAdminAccessToken(access);
    setAdminRefreshToken(refresh);
    setPhase("mfa");
  }, []);

  const handleElevated = useCallback(() => {
    if (!mountedRef.current) return;
    setPhase("elevated");
  }, []);

  if (phase === "loading") {
    return (
      <div className="admin-portal__phase admin-portal__phase--loading" role="status">
        Загрузка…
      </div>
    );
  }

  if (phase === "login") {
    return <AdminLoginForm onSuccess={handleLoginSuccess} />;
  }

  if (phase === "mfa") {
    return (
      <div className="admin-portal__phase admin-portal__phase--mfa">
        <AdminMfaGate autoStart="approval" onElevated={handleElevated}>
          {null}
        </AdminMfaGate>
      </div>
    );
  }

  return <AdminCabinetContent />;
}

export { ADMIN_SECTIONS };
