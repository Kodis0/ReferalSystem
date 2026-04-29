import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import "./dashboard.css";

function formatJoinedAt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function programSiteLabel(program) {
  const originLabel = typeof program?.site_origin_label === "string" ? program.site_origin_label.trim() : "";
  if (originLabel) return originLabel;
  const displayLabel = typeof program?.site_display_label === "string" ? program.site_display_label.trim() : "";
  if (displayLabel) return displayLabel;
  return `Программа · ${program?.site_public_id || "—"}`;
}

export default function ProgramsCatalogPage() {
  const [programs, setPrograms] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("access_token");
    if (!token) {
      setPrograms([]);
      setError(false);
      return () => {
        cancelled = true;
      };
    }

    setPrograms(null);
    setError(false);
    fetch(API_ENDPOINTS.programsCatalog, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("programs_catalog_fetch_failed");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setPrograms(Array.isArray(data.programs) ? data.programs : []);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setPrograms([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="lk-dashboard">
      <section className="lk-dashboard__programs" aria-labelledby="programs-catalog-heading">
        <h1 id="programs-catalog-heading" className="lk-dashboard__programs-title">
          Список программ
        </h1>
        <p className="lk-dashboard__programs-lead">
          Все программы, подключенные к системе.
        </p>

        {programs === null && !error ? <p className="lk-dashboard__programs-muted">Загрузка…</p> : null}
        {error ? (
          <p className="lk-dashboard__programs-muted">
            Не удалось загрузить список программ. Обновите страницу или попробуйте позже.
          </p>
        ) : null}
        {programs !== null && !error && programs.length === 0 ? (
          <p className="lk-dashboard__programs-muted">Пока нет подключенных программ.</p>
        ) : null}

        {programs !== null && !error && programs.length > 0 ? (
          <ul className="lk-dashboard__programs-list">
            {programs.map((p) => {
              const joinedAt = formatJoinedAt(p.joined_at);
              return (
                <li key={p.site_public_id} className="lk-dashboard__programs-item">
                  <Link
                    to={
                      p.joined
                        ? `/lk/referral-program/${p.site_public_id}`
                        : `/registration?site_public_id=${encodeURIComponent(p.site_public_id)}`
                    }
                    className="lk-dashboard__programs-item-link"
                    data-testid="programs-catalog-list-link"
                  >
                    <div className="lk-dashboard__programs-item-main">
                      <span className="lk-dashboard__programs-label">{programSiteLabel(p)}</span>
                      <span className="lk-dashboard__programs-status">
                        {p.joined ? "Подключена" : p.site_status}
                      </span>
                    </div>
                    <div className="lk-dashboard__programs-joined">
                      {joinedAt ? `Дата подключения: ${joinedAt}` : "Нажмите, чтобы подключиться"}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
