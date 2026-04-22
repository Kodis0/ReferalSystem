import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import "./dashboard.css";

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
 * Member-facing detail for one agent program (SiteMembership) by site public_id.
 */
export default function AgentProgramDetailPage() {
  const { sitePublicId } = useParams();
  const [program, setProgram] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("access_token");
    if (!token || !sitePublicId) {
      setProgram(null);
      setLoading(false);
      setErrorKind(!token ? "auth" : "not_found");
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setErrorKind(null);
    setProgram(null);

    fetch(API_ENDPOINTS.myProgramDetail(sitePublicId), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 404) {
          return { notFound: true };
        }
        if (!res.ok) throw new Error("fetch_failed");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data && data.notFound) {
          setErrorKind("not_found");
          return;
        }
        const p = data && data.program;
        if (!p || !p.site_public_id) {
          setErrorKind("not_found");
          return;
        }
        setProgram(p);
      })
      .catch(() => {
        if (!cancelled) setErrorKind("network");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sitePublicId]);

  return (
    <div className="lk-dashboard lk-dashboard__program-detail" data-testid="agent-program-detail">
      <Link to="/lk/dashboard#my-programs" className="lk-dashboard__program-detail-back">
        ← К агентским программам
      </Link>

      {loading && <p className="lk-dashboard__programs-muted">Загрузка…</p>}

      {!loading && errorKind === "auth" && (
        <p className="lk-dashboard__programs-muted">Войдите, чтобы открыть карточку программы.</p>
      )}

      {!loading && errorKind === "not_found" && (
        <p className="lk-dashboard__programs-muted" data-testid="agent-program-not-found">
          Программа не найдена или у вас нет к ней доступа.
        </p>
      )}

      {!loading && errorKind === "network" && (
        <p className="lk-dashboard__programs-muted" data-testid="agent-program-error">
          Не удалось загрузить данные программы. Обновите страницу или попробуйте позже.
        </p>
      )}

      {!loading && program && (
        <>
          <h1 className="lk-dashboard__title" data-testid="agent-program-title">
            {program.site_display_label || `Программа · ${program.site_public_id}`}
          </h1>
          <p className="lk-dashboard__subtitle">
            Вы участвуете в агентской программе. Подробности и акции смотрите на сайте организатора.
          </p>

          <div className="lk-dashboard__program-detail-meta">
            <p className="lk-dashboard__programs-muted" style={{ marginBottom: "8px" }}>
              <span className="lk-dashboard__programs-label" style={{ display: "inline", marginRight: "8px" }}>
                Дата подключения:
              </span>
              {formatJoinedAt(program.joined_at)}
            </p>
            {program.site_status ? (
              <p className="lk-dashboard__programs-muted" style={{ margin: 0 }}>
                Статус:{" "}
                <span className="lk-dashboard__programs-status">{program.site_status}</span>
              </p>
            ) : null}
          </div>

          <section className="lk-dashboard__program-next" aria-labelledby="agent-program-next-heading">
            <h2 id="agent-program-next-heading" className="lk-dashboard__programs-title">
              Что дальше
            </h2>
            <p className="lk-dashboard__programs-muted">
              Учёт участия идёт автоматически. Новости и материалы публикует организатор на своём сайте;
              если он подключит материалы через LUMO, они появятся здесь.
            </p>
            <div className="lk-dashboard__program-next-actions">
              <Link to="/lk/dashboard#my-programs" className="lk-dashboard__program-next-cta">
                К агентским программам
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
