import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import "./CreateOwnerProjectPage.css";
import { emitSiteOwnerActivity } from "./siteOwnerActivityBus";

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

function projectMetaFromPayload(payload) {
  const project = payload?.project && typeof payload.project === "object" ? payload.project : {};
  return {
    name: typeof project.name === "string" ? project.name : "",
    description: typeof project.description === "string" ? project.description : "",
  };
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

export default function ProjectInfoPage() {
  const { sitePublicId, projectId } = useParams();
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const { reloadProjectHead } = outletContext;
  const siteId = (sitePublicId || "").trim();
  const numericProjectId = Number(projectId);
  const hasProjectId = Number.isInteger(numericProjectId) && numericProjectId > 0;
  const hasSiteId = isUuidString(siteId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const overviewPath = hasProjectId ? `/lk/partner/project/${numericProjectId}/sites` : `/lk/partner/${siteId}/overview`;

  const load = useCallback(async () => {
    if (!hasSiteId && !hasProjectId) return;
    setLoading(true);
    setError("");
    try {
      const url = hasProjectId ? API_ENDPOINTS.projectDetail(numericProjectId) : withSelectedSite(API_ENDPOINTS.siteIntegration, siteId);
      const res = await fetch(url, {
        method: "GET",
        headers: authHeaders(),
        credentials: "include",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = payload?.code ?? payload?.detail;
        const detailMsg =
          typeof detail === "string" ? detail : Array.isArray(detail) ? detail.join("\n") : detail != null ? String(detail) : "";
        setError(detailMsg || `Не удалось загрузить проект (${res.status})`);
        return;
      }
      const meta = projectMetaFromPayload(payload);
      setName(meta.name);
      setDescription(meta.description);
    } catch (err) {
      console.error(err);
      setError("Сетевая ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  }, [hasProjectId, hasSiteId, numericProjectId, siteId]);

  useEffect(() => {
    load();
  }, [load]);

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!hasSiteId && !hasProjectId) return;
    setSaving(true);
    setError("");
    try {
      const url = hasProjectId ? API_ENDPOINTS.projectDetail(numericProjectId) : withSelectedSite(API_ENDPOINTS.siteIntegration, siteId);
      const body = hasProjectId
        ? {
            display_name: name.trim(),
            description: description.trim(),
          }
        : {
            display_name: name.trim(),
            description: description.trim(),
          };
      const res = await fetch(url, {
        method: "PATCH",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = payload?.code ?? payload?.detail;
        const detailMsg =
          typeof detail === "string" ? detail : Array.isArray(detail) ? detail.join("\n") : detail != null ? String(detail) : "";
        setError(detailMsg || formatApiFieldErrors(payload) || `Не удалось сохранить (${res.status})`);
        return;
      }
      const meta = projectMetaFromPayload(payload);
      setName(meta.name);
      setDescription(meta.description);
      if (hasSiteId) {
        emitSiteOwnerActivity(siteId);
      }
      if (typeof reloadProjectHead === "function") {
        await reloadProjectHead();
      }
      navigate(overviewPath);
    } catch (err) {
      console.error(err);
      setError("Сетевая ошибка, попробуйте позже");
    } finally {
      setSaving(false);
    }
  };

  if (!hasSiteId && !hasProjectId) {
    return null;
  }

  return (
    <div id="create-owner-project" data-testid="project-info-page">
      <div className="page">
        <div className="page__returnButton">
          <Link
            className="tw-link link_primary link_s"
            to={hasProjectId ? "/lk/partner" : `/lk/partner/${siteId}/overview`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="7" height="13" fill="none" viewBox="0 0 7 13" aria-hidden>
              <path
                fill="currentColor"
                d="M1 6.99a1 1 0 0 1 .23-.64l4-5a1 1 0 0 1 1.54 1.29L3.29 6.99l3.32 4.35a1 1 0 0 1-.15 1.4A1 1 0 0 1 5 12.62l-3.83-5A1 1 0 0 1 1 7Z"
              />
            </svg>
            Назад
          </Link>
        </div>

        <div className="header">
          <div className="header__info noAvatar">
            <div className="headerTitleBlock">
              <h1 className="h1">Информация о проекте</h1>
            </div>
          </div>
        </div>

        {loading ? <p className="owner-programs__muted">Загрузка…</p> : null}

        {!loading ? (
          <form className="form" onSubmit={onSubmit}>
            <label className="formControl">
              <div className="formControl__label">
                <span className="text text_s text_bold text_grey text_align_left">Название</span>
              </div>
              <div className="input">
                <div className="inputWrapper">
                  <input
                    className="inputField"
                    name="name"
                    value={name}
                    onChange={(ev) => setName(ev.target.value)}
                    autoComplete="off"
                    maxLength={200}
                  />
                </div>
              </div>
            </label>

            <label className="formControl">
              <div className="formControl__label">
                <span className="text text_s text_bold text_grey text_align_left">Комментарий</span>
              </div>
              <div className="input">
                <div className="inputWrapper">
                  <input
                    className="inputField"
                    name="description"
                    value={description}
                    onChange={(ev) => setDescription(ev.target.value)}
                    autoComplete="off"
                    maxLength={2000}
                  />
                </div>
              </div>
            </label>

            {error ? <div className="formError">{error}</div> : null}

            <button
              type="submit"
              className="baseButton button button_size_medium baseButton__size_medium baseButton__color_primary"
              data-testid="submit-form-btn"
              disabled={saving}
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
