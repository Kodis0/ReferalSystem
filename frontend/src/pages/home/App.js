import { BrowserRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";
import Home from './Home';
import Registration from '../registration/registration';
import Login from '../login/login';
import LK from '../lk/lk';
import LegalPage from "../legal/LegalPage";
import SiteConnectPage from "../site-connect/SiteConnectPage";
import ToolsDiagramsPage from "../tools-diagrams/ToolsDiagramsPage";
import ProtectedRoute from "../../components/protectedroute";
import AdminProtectedRoute from "../../components/AdminProtectedRoute";
import AdminCabinet from "../lk/admin/AdminCabinet";
import ReferralCaptureOnMount from "../../components/ReferralCaptureOnMount";
import OAuthVkTgFragmentHandler from "../../components/OAuthVkTgFragmentHandler";
import ToastStack from "../../components/toast/ToastStack";

/**
 * Сохраняет под-путь при миграции старых `/lk/admin/...` URL на отдельный admin portal.
 * Например, `/lk/admin/users/42` → `/admin-console/users/42`.
 */
function LkAdminLegacyRedirect() {
  const { pathname, search, hash } = useLocation();
  const rest = pathname.replace(/^\/lk\/admin/, "");
  return <Navigate to={`/admin-console${rest}${search || ""}${hash || ""}`} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <ToastStack />
      <OAuthVkTgFragmentHandler />
      <ReferralCaptureOnMount />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/registration" element={<Registration />} /> 
        <Route path="/login" element={<Login />} />
        <Route path="/legal/:legalSlug" element={<LegalPage />} />
        <Route path="/tools-diagrams" element={<ToolsDiagramsPage />} />

        <Route path="/site-connect" element={<ProtectedRoute><SiteConnectPage /></ProtectedRoute>} />
        <Route
          path="/admin-console/*"
          element={
            <ProtectedRoute>
              <AdminProtectedRoute>
                <AdminCabinet />
              </AdminProtectedRoute>
            </ProtectedRoute>
          }
        />
        <Route path="/lk/admin/*" element={<LkAdminLegacyRedirect />} />
        <Route path="/lk/*" element={<ProtectedRoute><LK /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
