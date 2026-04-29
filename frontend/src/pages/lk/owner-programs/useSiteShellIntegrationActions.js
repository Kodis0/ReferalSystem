import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
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

function siteDiagnosticsFetchUrl(url, sitePublicId, activityRefresh) {
  const u = new URL(withSelectedSite(url, sitePublicId), window.location.origin);
  if (activityRefresh) u.searchParams.set("owner_activity_refresh", "1");
  return u.toString();
}

function apiErrorDisplayText(payload) {
  const raw = payload?.code ?? payload?.detail;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.join("\n");
  if (raw != null) return String(raw);
  return "";
}

/** Human message for POST activate failure (409 embed readiness etc.). */
export function formatActivateConflictMessage(payload, integrationData) {
  const code = payload?.code;
  const er = payload?.embed_readiness;
  const seen = Boolean(integrationData?.last_widget_seen_at);
  if (code === "site_not_ready_for_activate" && er && er.widget_enabled === false && seen) {
    return "Виджет найден на сайте, но выключен в настройках. Включите виджет.";
  }
  const fallback = apiErrorDisplayText(payload);
  return fallback || "Не удалось активировать сайт.";
}

/**
 * Загрузка интеграции сайта и действия как в `SiteShellWidgetActionsBar` (шапка сайта / меню карточки).
 *
 * @param {object} options
 * @param {string} options.sitePublicId
 * @param {number} [options.projectIdProp]
 * @param {object} [options.projectEntry]
 * @param {function} [options.reloadProjectEntry]
 * @param {function} [options.buildProjectPath]
 * @param {'shell'|'overview'} [options.deleteContext]
 * @param {string} [options.overviewRouteSitePublicId] — query `site_public_id` на экране обзора
 * @param {function} [options.onAfterDeleteSuccess]
 * @param {function} [options.onSiteDeletePending] — `(sitePublicId) => void` до запроса DELETE (оптимистичное скрытие в списке).
 * @param {function} [options.onSiteDeleteSettled] — после завершения DELETE (успех или ошибка).
 */
export function useSiteShellIntegrationActions({
  sitePublicId,
  projectIdProp,
  projectEntry,
  reloadProjectEntry,
  buildProjectPath,
  deleteContext = "shell",
  overviewRouteSitePublicId = "",
  onAfterDeleteSuccess,
  onSiteDeletePending,
  onSiteDeleteSettled,
} = {}) {
  const navigate = useNavigate();
  const loadGen = useRef(0);
  const actionsRef = useRef({});

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [diag, setDiag] = useState(null);
  const [widgetEnabled, setWidgetEnabled] = useState(true);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [deleteSiteBusy, setDeleteSiteBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activateLoading, setActivateLoading] = useState(false);
  const [activateError, setActivateError] = useState("");

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
        setActivateError("");
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
    if (!siteId) {
      loadGen.current += 1;
      setLoading(false);
      setData(null);
      setDiag(null);
      setError("");
      setWidgetEnabled(true);
      setVerifyLoading(false);
      setRefreshBusy(false);
      setDeleteSiteBusy(false);
      setSaving(false);
      setActivateLoading(false);
      setActivateError("");
      return undefined;
    }
    void load();
    return undefined;
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
        setActivateError("");
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
    setActivateError("");
    try {
      let integrationSnapshot = data;
      if (
        integrationSnapshot &&
        integrationSnapshot.widget_enabled === false &&
        integrationSnapshot.last_widget_seen_at
      ) {
        const resPatch = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, siteId), {
          method: "PATCH",
          headers: authHeaders(),
          credentials: "include",
          body: JSON.stringify({ widget_enabled: true }),
        });
        const patchPayload = await resPatch.json().catch(() => ({}));
        if (resPatch.ok) {
          setData(patchPayload);
          if (typeof patchPayload?.widget_enabled === "boolean") {
            setWidgetEnabled(Boolean(patchPayload.widget_enabled));
          }
          integrationSnapshot = patchPayload;
          emitSiteOwnerActivity(siteId);
        }
      }
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
        return;
      }
      setActivateError(formatActivateConflictMessage(payload, integrationSnapshot));
    } catch (e) {
      console.error(e);
      setActivateError("Сетевая ошибка");
    } finally {
      setActivateLoading(false);
    }
  }, [data, load, siteId]);

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

  const handleDeleteSite = useCallback(
    async (confirmTitleOverride) => {
      const fromData =
        (typeof data?.site_display_name === "string" && data.site_display_name.trim()) ||
        (typeof data?.config_json?.site_display_name === "string" && data.config_json.site_display_name.trim()) ||
        "";
      const title =
        typeof confirmTitleOverride === "string" && confirmTitleOverride.trim() ? confirmTitleOverride.trim() : fromData || "Сайт";
      if (!window.confirm(`Удалить сайт "${title}"?`)) return;
      const pid =
        typeof projectEntry?.id === "number"
          ? projectEntry.id
          : typeof projectIdProp === "number" && projectIdProp > 0
            ? projectIdProp
            : data?.project?.id;
      if (typeof pid !== "number" || !siteId) return;
      onSiteDeletePending?.(siteId);
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
          await reloadProjectEntry(pid, { silent: true });
        }
        if (deleteContext === "overview") {
          if (siteId === (overviewRouteSitePublicId || "").trim() && typeof buildProjectPath === "function") {
            navigate(buildProjectPath("sites"), { replace: true });
          }
          if (typeof onAfterDeleteSuccess === "function") {
            onAfterDeleteSuccess();
          }
          return;
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
        onSiteDeleteSettled?.();
      }
    },
    [
      buildProjectPath,
      data,
      deleteContext,
      navigate,
      onAfterDeleteSuccess,
      onSiteDeletePending,
      onSiteDeleteSettled,
      overviewRouteSitePublicId,
      projectEntry?.id,
      projectIdProp,
      reloadProjectEntry,
      siteId,
    ],
  );

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
    onDeleteSite: handleDeleteSite,
    onUnifiedToggle: onUnifiedShellToggle,
  };

  return {
    siteId,
    loading,
    error,
    data,
    diag,
    widgetEnabled,
    verifyLoading,
    refreshBusy,
    deleteSiteBusy,
    saving,
    activateLoading,
    activateError,
    actionsRef,
    load,
  };
}
