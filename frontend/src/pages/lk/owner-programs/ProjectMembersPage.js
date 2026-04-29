import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
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

function formatJoinedAt(iso) {
  if (!iso || typeof iso !== "string") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ProjectMembersPage() {
  const { sitePublicId: routeMembersSiteParam } = useParams();
  const routeMembersSiteId =
    typeof routeMembersSiteParam === "string" && isUuidString(routeMembersSiteParam.trim())
      ? routeMembersSiteParam.trim()
      : "";
  /** Только `/project/:id/sites/:sitePublicId/members` — участники реферальной программы сайта. */
  const isSiteReferralMembersView = Boolean(routeMembersSiteId);

  const [loading, setLoading] = useState(() => isSiteReferralMembersView);
  const [error, setError] = useState("");
  const [count, setCount] = useState(null);
  const [members, setMembers] = useState([]);

  const pageTitle = useMemo(() => (isSiteReferralMembersView ? "Участники" : "Участники проекта"), [isSiteReferralMembersView]);

  const load = useCallback(async () => {
    if (!isSiteReferralMembersView) {
      setCount(0);
      setMembers([]);
      setError("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegrationMembers, routeMembersSiteId), {
        method: "GET",
        headers: authHeaders(),
        credentials: "include",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = payload?.code ?? payload?.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setCount(null);
        setMembers([]);
        setError(detailMsg || `Ошибка (${res.status})`);
        return;
      }
      setCount(typeof payload.count === "number" ? payload.count : 0);
      setMembers(Array.isArray(payload.members) ? payload.members : []);
    } catch (e) {
      console.error(e);
      setCount(null);
      setMembers([]);
      setError("Сетевая ошибка");
    } finally {
      setLoading(false);
    }
  }, [isSiteReferralMembersView, routeMembersSiteId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="owner-programs__page" data-testid="project-members-page">
      <header className="owner-programs__members-head">
        <h2 className="owner-programs__overview-title">{pageTitle}</h2>
      </header>

      {!isSiteReferralMembersView ? (
        <div
          className="owner-programs__members-empty owner-programs__project-access-members-empty"
          data-testid="project-access-members-empty"
        >
          <p className="owner-programs__project-access-lead">
            Здесь будут пользователи с доступом к просмотру и управлению проектом.
          </p>
          <div className="owner-programs__actions">
            <button
              type="button"
              className="baseButton button button_size_medium baseButton__size_medium baseButton__color_primary"
              data-testid="project-access-add-member"
            >
              Добавить
            </button>
          </div>
        </div>
      ) : null}

      {isSiteReferralMembersView && loading ? (
        <div className="owner-programs__tab-page-skel owner-programs__tab-page-skel_wide" role="status" aria-label="Загрузка">
          <span className="owner-programs__skel owner-programs__tab-page-skel_line-md" aria-hidden />
          {[0, 1, 2].map((i) => (
            <span key={i} className="owner-programs__skel owner-programs__tab-page-skel_members-row" aria-hidden />
          ))}
        </div>
      ) : null}
      {isSiteReferralMembersView && !loading && error ? <div className="owner-programs__error">{error}</div> : null}

      {isSiteReferralMembersView && !loading && !error ? (
        <>
          {count > 0 ? (
            <p className="owner-programs__members-count" aria-live="polite">
              Участников: <strong>{count ?? 0}</strong>
            </p>
          ) : null}

          {count > 0 && count > members.length ? (
            <p className="owner-programs__muted" style={{ margin: "0 0 12px" }}>
              Показаны последние {members.length} из {count}.
            </p>
          ) : null}

          {count === 0 ? (
            <div className="owner-programs__members-empty" data-testid="members-empty">
              <p className="owner-programs__muted" style={{ margin: 0, color: "#ffffff", opacity: 1 }}>
                Пока никто не присоединился к реферальной программе.
              </p>
            </div>
          ) : (
            <ul className="owner-programs__members-list" data-testid="members-list">
              {members.map((row, idx) => (
                <li key={`${row.joined_at || ""}-${idx}`} className="owner-programs__members-row">
                  <div className="owner-programs__members-row-main">
                    <span className="owner-programs__members-identity" data-testid="member-identity">
                      {row.identity_masked || "—"}
                    </span>
                    <span className="owner-programs__members-date">{formatJoinedAt(row.joined_at)}</span>
                  </div>
                  {row.ref_code ? (
                    <div className="owner-programs__members-row-meta">
                      <span>
                        Код: <code className="owner-programs__members-code">{row.ref_code}</code>
                      </span>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
