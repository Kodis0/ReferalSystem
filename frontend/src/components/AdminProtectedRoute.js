import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import useCurrentUser from "../hooks/useCurrentUser";
import { toast } from "./toast/toastBus";

/**
 * Гард для админ-разделов ЛК. Пускает только пользователей с `is_staff === true`.
 * `useCurrentUser()` ещё не отдаёт явный `loading`-флаг, поэтому при наличии
 * access-токена «пустой» user трактуем как «ещё грузится», иначе — как отказ.
 */
const AdminProtectedRoute = ({ children }) => {
  const { user, loading } = useCurrentUser();
  const hasAccessToken =
    typeof window !== "undefined" && Boolean(window.localStorage?.getItem("access_token"));
  const isLoading = loading === true || (user == null && hasAccessToken);
  const isAdmin = user?.is_staff === true;
  const denied = !isLoading && !isAdmin;

  useEffect(() => {
    if (denied) {
      toast.error("Доступ только для администраторов");
    }
  }, [denied]);

  if (isLoading) {
    return (
      <div className="lk-admin-protected-route__loading" role="status" aria-live="polite">
        <p className="lk-partner__muted">Загрузка…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/lk/dashboard" replace />;
  }

  return children;
};

export default AdminProtectedRoute;
