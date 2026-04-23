import { useCallback, useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import LkListboxSelect from "../components/LkListboxSelect";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "../settings/settings.css";
import "./CreateOwnerProjectPage.css";
import "./owner-programs.css";

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

function formatApiFieldErrors(payload) {
  if (!payload || typeof payload !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(payload)) {
    if (k === "detail" || k === "code") continue;
    if (Array.isArray(v)) parts.push(`${k}: ${v.join(" ")}`);
    else if (typeof v === "string") parts.push(`${k}: ${v}`);
  }
  return parts.join("\n");
}

function primaryOriginFromPayload(payload) {
  const origins = Array.isArray(payload?.allowed_origins) ? payload.allowed_origins : [];
  const first = origins[0];
  return typeof first === "string" ? first : "";
}

function siteNameFromPayload(payload) {
  if (typeof payload?.site_display_name === "string" && payload.site_display_name.trim()) {
    return payload.site_display_name.trim();
  }
  return "";
}

function siteDescriptionFromPayload(payload) {
  if (typeof payload?.site_description === "string") {
    return payload.site_description;
  }
  return "";
}

const PLATFORM_OPTIONS = [
  { value: "tilda", label: "Tilda" },
  { value: "generic", label: "Generic" },
];

export default function ProjectSettingsPage() {
  const outletContext = useOutletContext() || {};
  const { primarySitePublicId = "", reloadProjectHead } = outletContext;
  const { sitePublicId: routeSettingsSiteParam } = useParams();
  const routeSettingsSiteId =
    typeof routeSettingsSiteParam === "string" && isUuidString(routeSettingsSiteParam.trim())
      ? routeSettingsSiteParam.trim()
      : "";
  // Сайт из пути `/sites/:sitePublicId/settings` имеет приоритет; иначе — основной сайт (`/settings`).
  const id =
    routeSettingsSiteId ||
    (typeof primarySitePublicId === "string" ? primarySitePublicId.trim() : "");
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [origin, setOrigin] = useState("");
  const [platformPreset, setPlatformPreset] = useState("tilda");

  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");

  const load = useCallback(async () => {
    if (!isUuidString(id)) return;
    setLoadState("loading");
    setLoadError("");
    try {
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, id), {
        method: "GET",
        headers: authHeaders(),
        credentials: "include",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = payload?.code ?? payload?.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setLoadError(detailMsg || `Ошибка загрузки (${res.status})`);
        setLoadState("error");
        return;
      }
      setDisplayName(siteNameFromPayload(payload));
      setDescription(siteDescriptionFromPayload(payload));
      setOrigin(primaryOriginFromPayload(payload));
      setPlatformPreset(
        payload.platform_preset === "generic" || payload.platform_preset === "tilda"
          ? payload.platform_preset
          : "tilda"
      );
      setLoadState("ready");
    } catch (e) {
      console.error(e);
      setLoadError("Сетевая ошибка");
      setLoadState("error");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onSave = async (e) => {
    e.preventDefault();
    if (!isUuidString(id)) return;
    setSaveState("saving");
    setSaveError("");
    try {
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, id), {
        method: "PATCH",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({
          site_display_name: displayName.trim(),
          site_description: description.trim(),
          origin: origin.trim(),
          platform_preset: platformPreset,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = payload?.code ?? payload?.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setSaveError(detailMsg || formatApiFieldErrors(payload) || `Не удалось сохранить (${res.status})`);
        setSaveState("error");
        return;
      }
      setDisplayName(siteNameFromPayload(payload));
      setDescription(siteDescriptionFromPayload(payload));
      setOrigin(primaryOriginFromPayload(payload));
      setSaveState("success");
      if (typeof reloadProjectHead === "function") {
        try {
          await reloadProjectHead();
        } catch {
          /* shell refresh best-effort */
        }
      }
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (err) {
      console.error(err);
      setSaveError("Сетевая ошибка");
      setSaveState("error");
    }
  };

  if (!isUuidString(id)) {
    return null;
  }

  return (
    <div id="create-owner-project" data-testid="project-settings-page">
      <div className="page">
        <div className="header">
          <div className="header__info noAvatar">
            <div className="headerTitleBlock">
              <h1 className="h1">Настройки сайта</h1>
            </div>
          </div>
        </div>

        {loadState === "loading" ? <p className="owner-programs__muted">Загрузка…</p> : null}
        {loadState === "error" ? <div className="formError">{loadError}</div> : null}

        {loadState === "ready" ? (
            <div className="owner-programs__connect-site-nested-create">
              <form className="form" onSubmit={onSave} data-testid="project-settings-form">
              <label className="formControl" htmlFor="proj-settings-name">
                <div className="formControl__label">
                  <span className="text text_s text_bold text_grey text_align_left">Название сайта в ЛК</span>
                </div>
                <div className="input">
                  <div className="inputWrapper">
                    <input
                      id="proj-settings-name"
                      className="inputField"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      maxLength={200}
                      autoComplete="off"
                    />
                  </div>
                </div>
              </label>

              <label className="formControl" htmlFor="proj-settings-description">
                <div className="formControl__label">
                  <span className="text text_s text_bold text_grey text_align_left">Описание сайта в ЛК</span>
                </div>
                <div className="input">
                  <div className="inputWrapper">
                    <textarea
                      id="proj-settings-description"
                      className="inputField"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={2000}
                      rows={4}
                    />
                  </div>
                </div>
              </label>

              <label className="formControl" htmlFor="proj-settings-origin">
                <div className="formControl__label">
                  <span className="text text_s text_bold text_grey text_align_left">Домен или origin</span>
                </div>
                <div className="input">
                  <div className="inputWrapper">
                    <input
                      id="proj-settings-origin"
                      className="inputField"
                      value={origin}
                      onChange={(e) => setOrigin(e.target.value)}
                      placeholder="https://mysite.tilda.ws"
                      autoComplete="off"
                    />
                  </div>
                </div>
              </label>

              <div className="formControl">
                <div className="formControl__label" id="proj-settings-platform-label">
                  <span className="text text_s text_bold text_grey text_align_left">Платформа</span>
                </div>
                <div className="owner-programs__lk-listbox-select-scope">
                  <LkListboxSelect
                    value={platformPreset}
                    onChange={setPlatformPreset}
                    options={PLATFORM_OPTIONS}
                    labelledBy="proj-settings-platform-label"
                    disabled={saveState === "saving"}
                    listboxId="proj-settings-platform-listbox"
                    dataTestId="proj-settings-platform-select"
                  />
                </div>
              </div>

              {saveError ? <div className="formError">{saveError}</div> : null}
              {saveState === "success" ? (
                <p className="owner-programs__muted" data-testid="settings-save-success">
                  Сохранено
                </p>
              ) : null}

              <div className="owner-programs__connect-site-form-actions">
                <button
                  type="submit"
                  className="baseButton button button_size_medium baseButton__size_medium baseButton__color_primary"
                  disabled={saveState === "saving"}
                >
                  {saveState === "saving" ? "Сохранение…" : "Сохранить"}
                </button>
              </div>
              </form>
            </div>
        ) : null}
      </div>
    </div>
  );
}
