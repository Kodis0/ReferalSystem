import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";

function formatJoinedAt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Member-facing list of referral programs (SiteMembership) for the logged-in user.
 */
export function MyProgramsSection() {
  const [programs, setPrograms] = useState(null);
  const [programsError, setProgramsError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("access_token");
    if (!token) {
      setPrograms([]);
      return () => {
        cancelled = true;
      };
    }
    setPrograms(null);
    setProgramsError(null);

    fetch(API_ENDPOINTS.myPrograms, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("programs_fetch_failed");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setPrograms(Array.isArray(data.programs) ? data.programs : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProgramsError(true);
          setPrograms([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      id="my-programs"
      className="lk-dashboard__programs"
      aria-labelledby="lk-dashboard-programs-heading"
    >
      <h2 id="lk-dashboard-programs-heading" className="lk-dashboard__programs-title">
        Агентские программы
      </h2>
      <p className="lk-dashboard__programs-lead">
        Программы, в которых вы участвуете как агент после приглашения от организатора.
      </p>
      {programs === null && !programsError && (
        <p className="lk-dashboard__programs-muted">Загрузка…</p>
      )}
      {programsError && (
        <p className="lk-dashboard__programs-muted">
          Не удалось загрузить список программ. Обновите страницу или попробуйте позже.
        </p>
      )}
      {programs !== null && !programsError && programs.length === 0 && (
        <p className="lk-dashboard__programs-muted">
          Пока нет подключённых программ. Когда вы примете приглашение, программа появится в этом
          списке.
        </p>
      )}
      {programs !== null && !programsError && programs.length > 0 && (
        <ul className="lk-dashboard__programs-list">
          {programs.map((p) => (
            <li key={p.site_public_id} className="lk-dashboard__programs-item">
              <Link
                to={`/lk/referral-program/${p.site_public_id}`}
                className="lk-dashboard__programs-item-link"
                data-testid="agent-program-list-link"
              >
                <div className="lk-dashboard__programs-item-main">
                  <span className="lk-dashboard__programs-label">
                    {p.site_display_label || `Программа · ${p.site_public_id}`}
                  </span>
                  {p.site_status ? (
                    <span className="lk-dashboard__programs-status">{p.site_status}</span>
                  ) : null}
                </div>
                <div className="lk-dashboard__programs-joined">
                  Дата подключения: {formatJoinedAt(p.joined_at)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
