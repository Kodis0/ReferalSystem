import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Link } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { SiteFaviconAvatar } from "../owner-programs/SiteFaviconAvatar";
import "./dashboard.css";

function programSiteLabel(program) {
  const originLabel = typeof program?.site_origin_label === "string" ? program.site_origin_label.trim() : "";
  if (originLabel) return originLabel;
  const displayLabel = typeof program?.site_display_label === "string" ? program.site_display_label.trim() : "";
  if (displayLabel) return displayLabel;
  return `Программа · ${program?.site_public_id || "—"}`;
}

function programAvatarLetter(label) {
  const value = typeof label === "string" ? label.trim() : "";
  return (value.slice(0, 1).toUpperCase() || "P");
}

function programSearchValue(program) {
  return [
    programSiteLabel(program),
    program?.site_display_label,
    program?.site_origin_label,
    program?.site_public_id,
    program?.site_status,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ")
    .toLowerCase();
}

export default function ProgramsCatalogPage() {
  const [programs, setPrograms] = useState(null);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredPrograms = Array.isArray(programs)
    ? programs.filter((program) => !normalizedSearchQuery || programSearchValue(program).includes(normalizedSearchQuery))
    : [];

  return (
    <div className="lk-dashboard">
      <section className="lk-dashboard__programs lk-dashboard__programs_catalog" aria-labelledby="programs-catalog-heading">
        <h1 id="programs-catalog-heading" className="lk-dashboard__programs-title">
          Каталог реферальных программ
        </h1>
        <p className="lk-dashboard__programs-lead">
          Выберите программу, вступите в неё и получите персональную ссылку для привлечения клиентов.
        </p>

        {programs !== null && !error && programs.length > 0 ? (
          <label className="lk-dashboard__programs-search" aria-label="Поиск программ">
            <span className="lk-dashboard__programs-search-icon" aria-hidden="true">
              <Search size={16} />
            </span>
            <input
              type="search"
              className="lk-dashboard__programs-search-input"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Поиск"
              autoComplete="off"
            />
          </label>
        ) : null}

        {programs === null && !error ? <p className="lk-dashboard__programs-muted">Загрузка…</p> : null}
        {error ? (
          <p className="lk-dashboard__programs-muted">
            Не удалось загрузить список программ. Обновите страницу или попробуйте позже.
          </p>
        ) : null}
        {programs !== null && !error && programs.length === 0 ? (
          <div className="lk-dashboard__programs-muted">
            <p>Пока нет доступных программ.</p>
            <p>Когда владельцы сайтов опубликуют реферальные программы, они появятся здесь.</p>
          </div>
        ) : null}
        {programs !== null && !error && programs.length > 0 && filteredPrograms.length === 0 ? (
          <p className="lk-dashboard__programs-muted">По вашему запросу программ не найдено.</p>
        ) : null}

        {programs !== null && !error && filteredPrograms.length > 0 ? (
          <ul className="lk-dashboard__programs-list">
            {filteredPrograms.map((p) => {
              const label = programSiteLabel(p);
              return (
                <li key={p.site_public_id} className="lk-dashboard__programs-item">
                  <div className="lk-dashboard__programs-item-link">
                    <Link
                      to={`/lk/referral-program/${p.site_public_id}`}
                      state={{ from: "/lk/programs" }}
                      className="lk-dashboard__programs-item-content"
                      data-testid="programs-catalog-list-link"
                    >
                      <div className="lk-dashboard__programs-item-top">
                        <div className="lk-dashboard__programs-avatar" aria-hidden="true">
                          <SiteFaviconAvatar
                            siteLike={p}
                            letter={programAvatarLetter(label)}
                            imgClassName="lk-dashboard__programs-avatar-img"
                          />
                        </div>
                      </div>
                      <div className="lk-dashboard__programs-item-main">
                        <span className="lk-dashboard__programs-status-dot" aria-hidden="true" />
                        <span className="lk-dashboard__programs-label">{label}</span>
                      </div>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
