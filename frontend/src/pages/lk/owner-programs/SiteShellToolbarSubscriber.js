import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import SiteShellWidgetActionsBar from "../widget-install/SiteShellWidgetActionsBar";
import { emitSiteOwnerActivity } from "./siteOwnerActivityBus";

const OPTIONAL_CAPTURE_FIELDS = [
  { key: "name", label: "Имя", recommended: true },
  { key: "email", label: "Email", recommended: true },
  { key: "phone", label: "Телефон", recommended: true },
  { key: "amount", label: "Сумма" },
  { key: "currency", label: "Валюта" },
  { key: "product_name", label: "Товар / тариф" },
];

function normalizeCaptureConfig(value) {
  const hasExplicitEnabledList =
    value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "enabled_optional_fields") &&
    Array.isArray(value.enabled_optional_fields);
  const raw = hasExplicitEnabledList ? value.enabled_optional_fields : OPTIONAL_CAPTURE_FIELDS.map((field) => field.key);
  const allowed = new Set(OPTIONAL_CAPTURE_FIELDS.map((field) => field.key));
  const next = [];
  raw.forEach((item) => {
    const key = String(item || "").trim();
    if (allowed.has(key) && !next.includes(key)) {
      next.push(key);
    }
  });
  return { enabled_optional_fields: next };
}

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function withSelectedSite(url, sitePublicId) {
  if (!sitePublicId) return url;
  const u = new URL(url, window.location.origin);
  u.searchParams.set("site_public_id", sitePublicId);
  return u.toString();
}

/** Query flag avoids CORS preflight issues with a custom header on GET diagnostics. */
function siteDiagnosticsFetchUrl(url, sitePublicId, activityRefresh) {
  const u = new URL(withSelectedSite(url, sitePublicId), window.location.origin);
  if (activityRefresh) u.searchParams.set("owner_activity_refresh", "1");
  return u.toString();
}

function apiErrorCode(payload) {
  return payload?.code ?? payload?.detail;
}

function apiErrorDisplayText(payload) {
  const raw = apiErrorCode(payload);
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.join("\n");
  if (raw != null) return String(raw);
  return "";
}

/**
 * Держит панель действий по сайту в шапке `SiteProjectLayout` на всех вкладках сайта
 * (дашборд, виджет, настройки, пользователи), не только на экране виджета.
 */
export default function SiteShellToolbarSubscriber({
  sitePublicId,
  projectId: projectIdProp,
  setSiteShellToolbar,
  reloadProjectEntry,
  buildProjectPath,
  projectEntry,
}) {
  const navigate = useNavigate();
  const loadGen = useRef(0);
  const actionsRef = useRef({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [diag, setDiag] = useState(null);
  const [widgetEnabled, setWidgetEnabled] = useState(true);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [deleteSiteBusy, setDeleteSiteBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activateLoading, setActivateLoading] = useState(false);

  const siteId = isUuidString(sitePublicId) ? sitePublicId.trim() : "";

  const load = useCallback(
    async (options = {}) => {
      const { quiet = false, activityRefresh = false } = options;
      const gen = ++loadGen.current;
      if (!siteId) return;
      if (!quiet) {
        setLoading(true);
        setError("");
      }
      try {
        const resInt = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, siteId), {
          method: "GET",
          headers: authHeaders(),
          credentials: "include",
        });
        const intPayload = await resInt.json().catch(() => ({}));
        if (gen !== loadGen.current) return;
        if (!resInt.ok) {
          const message = apiErrorDisplayText(intPayload) || `Ошибка загрузки (${resInt.status})`;
          if (quiet) {
            setError(message);
            return;
          }
          setData(null);
          setDiag(null);
          setError(message);
          return;
        }
        setError("");
        setData(intPayload);
        setWidgetEnabled(Boolean(intPayload.widget_enabled));
        const resDiag = await fetch(
          siteDiagnosticsFetchUrl(API_ENDPOINTS.siteIntegrationDiagnostics, intPayload.public_id || siteId, activityRefresh),
          {
            method: "GET",
            headers: authHeaders(),
            credentials: "include",
          },
        );
        if (gen !== loadGen.current) return;
        if (resDiag.ok) {
          setDiag(await resDiag.json().catch(() => null));
        } else {
          setDiag(null);
        }
      } catch (e) {
        console.error(e);
        if (gen !== loadGen.current) return;
        if (quiet) {
          setError("network");
          return;
        }
        setData(null);
        setDiag(null);
        setError("network");
      } finally {
        if (gen === loadGen.current && !quiet) setLoading(false);
      }
    },
    [siteId],
  );

  useEffect(() => {
    void load();
  }, [load, siteId]);

  const onSaveWidgetEnabled = useCallback(
    async (nextEnabled) => {
      if (!data || !siteId) return;
      setSaving(true);
      try {
        const allowed_origins = Array.isArray(data.allowed_origins) ? data.allowed_origins : [];
        const config_json =
          typeof data.config_json === "object" && data.config_json != null && !Array.isArray(data.config_json)
            ? data.config_json
            : {};
        const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, siteId), {
          method: "PATCH",
          headers: authHeaders(),
          credentials: "include",
          body: JSON.stringify({
            site_public_id: siteId,
            allowed_origins,
            config_json,
            capture_config: normalizeCaptureConfig(data.capture_config || config_json.capture_config),
            platform_preset: data.platform_preset || "tilda",
            widget_enabled: nextEnabled,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) return;
        setData(payload);
        if (typeof payload?.widget_enabled === "boolean") {
          setWidgetEnabled(Boolean(payload.widget_enabled));
        }
        emitSiteOwnerActivity(siteId);
        const resDiag = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegrationDiagnostics, siteId), {
          method: "GET",
          headers: authHeaders(),
          credentials: "include",
        });
        if (resDiag.ok) {
          setDiag(await resDiag.json().catch(() => null));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setSaving(false);
      }
    },
    [data, siteId],
  );

  const onActivate = useCallback(async () => {
    if (!siteId) return;
    setActivateLoading(true);
    try {
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegrationActivate, siteId), {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ site_public_id: siteId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        setData(payload);
        emitSiteOwnerActivity(siteId);
        await load();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setActivateLoading(false);
    }
  }, [load, siteId]);

  const onVerify = useCallback(async () => {
    if (!siteId) return;
    setVerifyLoading(true);
    try {
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegrationVerify, siteId), {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ site_public_id: siteId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        setData(payload);
        emitSiteOwnerActivity(siteId);
        const resDiag = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegrationDiagnostics, siteId), {
          method: "GET",
          headers: authHeaders(),
          credentials: "include",
        });
        if (resDiag.ok) {
          setDiag(await resDiag.json().catch(() => null));
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setVerifyLoading(false);
    }
  }, [siteId]);

  const onRefreshStatus = useCallback(async () => {
    setRefreshBusy(true);
    try {
      await load({ quiet: true, activityRefresh: true });
      emitSiteOwnerActivity(siteId);
    } finally {
      setRefreshBusy(false);
    }
  }, [load, siteId]);

  const handleDeleteSiteFromShell = useCallback(async () => {
    const title =
      (typeof data?.site_display_name === "string" && data.site_display_name.trim()) ||
      (typeof data?.config_json?.site_display_name === "string" && data.config_json.site_display_name.trim()) ||
      "Сайт";
    if (!window.confirm(`Удалить сайт "${title}"?`)) return;
    const pid =
      typeof projectEntry?.id === "number"
        ? projectEntry.id
        : typeof projectIdProp === "number" && projectIdProp > 0
          ? projectIdProp
          : data?.project?.id;
    if (typeof pid !== "number" || !siteId) return;
    setDeleteSiteBusy(true);
    try {
      const res = await fetch(API_ENDPOINTS.projectSiteDelete(pid), {
        method: "DELETE",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ site_public_id: siteId }),
      });
      if (!res.ok) {
        await res.json().catch(() => ({}));
        return;
      }
      if (typeof reloadProjectEntry === "function") {
        await reloadProjectEntry(pid);
      }
      if (typeof buildProjectPath === "function") {
        navigate(buildProjectPath("sites"), { replace: true });
      } else {
        navigate("/lk/partner", { replace: true });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDeleteSiteBusy(false);
    }
  }, [buildProjectPath, data, navigate, projectEntry?.id, projectIdProp, reloadProjectEntry, siteId]);

  const onUnifiedShellToggle = useCallback(() => {
    const ls = diag?.site_status || data?.status;
    if (ls !== "active") {
      void onActivate();
      return;
    }
    void onSaveWidgetEnabled(!widgetEnabled);
  }, [data?.status, diag?.site_status, onActivate, onSaveWidgetEnabled, widgetEnabled]);

  actionsRef.current = {
    onVerify,
    onRefreshStatus,
    onDeleteSite: handleDeleteSiteFromShell,
    onUnifiedToggle: onUnifiedShellToggle,
  };

  useEffect(() => {
    if (typeof setSiteShellToolbar !== "function") {
      return undefined;
    }
    // Не учитываем `error` отдельно: после успешной загрузки сбрасываем error, а при тихом
    // обновлении не очищаем data — иначе плашка пропадала бы при кратковременном сбое API.
    if (loading || !data) {
      setSiteShellToolbar(null);
      return undefined;
    }
    const lifecycleForToolbar = diag?.site_status || data?.status;
    setSiteShellToolbar(
      <SiteShellWidgetActionsBar
        actionsRef={actionsRef}
        deleteSiteBusy={deleteSiteBusy}
        verifyLoading={verifyLoading}
        refreshBusy={refreshBusy}
        lifecycleStatus={lifecycleForToolbar}
        widgetEnabled={widgetEnabled}
        toggleBusy={saving || activateLoading}
      />,
    );
    return () => setSiteShellToolbar(null);
  }, [
    activateLoading,
    data,
    deleteSiteBusy,
    diag?.site_status,
    loading,
    refreshBusy,
    saving,
    setSiteShellToolbar,
    verifyLoading,
    widgetEnabled,
  ]);

  return null;
}
