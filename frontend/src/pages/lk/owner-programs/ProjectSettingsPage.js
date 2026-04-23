import { useCallback, useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./owner-programs.css";

const DELETE_CONFIRM_PHRASE = "УДАЛИТЬ";

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
    if (k === "detail") continue;
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

function projectMetaFromPayload(payload) {
  const project = payload?.project && typeof payload.project === "object" ? payload.project : {};
  return {
    name: typeof project.name === "string" ? project.name : "",
    description: typeof project.description === "string" ? project.description : "",
  };
}

export default function ProjectSettingsPage() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const {
    primarySitePublicId = "",
    projectId = null,
    buildProjectPath,
  } = outletContext;
  // Project-level page: scoped to the project's primary site only.
  const id = (primarySitePublicId || "").trim();
  const overviewPath =
    typeof buildProjectPath === "function"
      ? buildProjectPath("sites")
      : typeof projectId === "number"
        ? `/lk/partner/project/${projectId}/sites`
        : "/lk/partner";

  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [origin, setOrigin] = useState("");
  const [platformPreset, setPlatformPreset] = useState("tilda");

  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");

  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleteState, setDeleteState] = useState("idle");
  const [deleteError, setDeleteError] = useState("");

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
        const d = payload.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setLoadError(detailMsg || `Ошибка загрузки (${res.status})`);
        setLoadState("error");
        return;
      }
      const project = projectMetaFromPayload(payload);
      setDisplayName(project.name);
      setDescription(project.description);
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
          display_name: displayName.trim(),
          description: description.trim(),
          origin: origin.trim(),
          platform_preset: platformPreset,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = payload.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setSaveError(detailMsg || formatApiFieldErrors(payload) || `Не удалось сохранить (${res.status})`);
        setSaveState("error");
        return;
      }
      const project = projectMetaFromPayload(payload);
      setDisplayName(project.name);
      setDescription(project.description);
      setOrigin(primaryOriginFromPayload(payload));
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (err) {
      console.error(err);
      setSaveError("Сетевая ошибка");
      setSaveState("error");
    }
  };

  const onDelete = async () => {
    if (!isUuidString(id)) return;
    if (deletePhrase.trim() !== DELETE_CONFIRM_PHRASE) return;
    setDeleteState("deleting");
    setDeleteError("");
    try {
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, id), {
        method: "DELETE",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ site_public_id: id }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = payload.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setDeleteError(detailMsg || `Не удалось удалить (${res.status})`);
        setDeleteState("error");
        return;
      }
      navigate(
        typeof buildProjectPath === "function"
          ? buildProjectPath("sites", "")
          : typeof projectId === "number"
            ? `/lk/partner/project/${projectId}/sites`
            : "/lk/partner",
        { replace: true },
      );
    } catch (err) {
      console.error(err);
      setDeleteError("Сетевая ошибка");
      setDeleteState("error");
    }
  };

  if (!isUuidString(id)) {
    return null;
  }

  return (
    <div className="owner-programs__page" data-testid="project-settings-page">
      <h2 className="owner-programs__overview-title">Настройки</h2>
      <div className="page__returnButton" style={{ marginBottom: 12 }}>
        <button type="button" className="tw-link link_primary link_s" onClick={() => navigate(overviewPath)}>
          Назад к сервисам
        </button>
      </div>
      <p className="owner-programs__muted" style={{ margin: "6px 0 20px", maxWidth: 560 }}>
        Название и описание относятся к проекту, а домен и платформа управляют интеграцией текущего сайта.
      </p>

      {loadState === "loading" && <p className="lk-partner__muted">Загрузка…</p>}
      {loadState === "error" && <div className="owner-programs__error">{loadError}</div>}

      {loadState === "ready" && (
        <form className="owner-programs__form" onSubmit={onSave} data-testid="project-settings-form">
          <div className="owner-programs__field">
            <label className="owner-programs__label" htmlFor="proj-settings-name">
              Название проекта
            </label>
            <input
              id="proj-settings-name"
              className="owner-programs__input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={200}
              autoComplete="off"
            />
          </div>
          <div className="owner-programs__field">
            <label className="owner-programs__label" htmlFor="proj-settings-description">
              Описание проекта
            </label>
            <textarea
              id="proj-settings-description"
              className="owner-programs__input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={4}
            />
          </div>
          <div className="owner-programs__field">
            <label className="owner-programs__label" htmlFor="proj-settings-origin">
              Домен или origin
            </label>
            <input
              id="proj-settings-origin"
              className="owner-programs__input"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="https://mysite.tilda.ws"
              autoComplete="off"
            />
            <p className="owner-programs__field-hint">
              Основной URL — первый в списке разрешённых адресов для виджета.
            </p>
          </div>
          <div className="owner-programs__field">
            <label className="owner-programs__label" htmlFor="proj-settings-platform">
              Платформа
            </label>
            <select
              id="proj-settings-platform"
              className="owner-programs__input"
              value={platformPreset}
              onChange={(e) => setPlatformPreset(e.target.value)}
            >
              <option value="tilda">Tilda</option>
              <option value="generic">Generic</option>
            </select>
          </div>

          {saveError && <div className="owner-programs__error">{saveError}</div>}
          {saveState === "success" && (
            <p className="owner-programs__muted" data-testid="settings-save-success">
              Сохранено
            </p>
          )}

          <div className="owner-programs__actions" style={{ marginTop: 8 }}>
            <button type="submit" className="owner-programs__btn" disabled={saveState === "saving"}>
              {saveState === "saving" ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </form>
      )}

      {loadState === "ready" && (
        <section className="owner-programs__danger-zone" aria-labelledby="proj-danger-heading">
          <h3 id="proj-danger-heading" className="owner-programs__danger-title">
            Опасная зона
          </h3>
          <p className="owner-programs__muted" style={{ marginBottom: 12, maxWidth: 560 }}>
            Удаление необратимо: будут удалены участники, лиды и связанные данные только текущего сайта.
          </p>
          <label className="owner-programs__label" htmlFor="proj-delete-confirm">
            Введите «{DELETE_CONFIRM_PHRASE}», чтобы включить кнопку удаления
          </label>
          <input
            id="proj-delete-confirm"
            className="owner-programs__input"
            style={{ maxWidth: 280 }}
            value={deletePhrase}
            onChange={(e) => setDeletePhrase(e.target.value)}
            autoComplete="off"
            data-testid="delete-confirm-input"
          />
          {deleteError && <div className="owner-programs__error">{deleteError}</div>}
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="owner-programs__btn_danger"
              disabled={deletePhrase.trim() !== DELETE_CONFIRM_PHRASE || deleteState === "deleting"}
              onClick={onDelete}
              data-testid="delete-project-button"
            >
              {deleteState === "deleting" ? "Удаление…" : "Удалить текущий сайт"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
