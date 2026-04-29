import { useCallback, useEffect, useState } from "react";
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

function programSiteLabel(program) {
  const originLabel = typeof program?.site_origin_label === "string" ? program.site_origin_label.trim() : "";
  if (originLabel) return originLabel;
  const displayLabel = typeof program?.site_display_label === "string" ? program.site_display_label.trim() : "";
  if (displayLabel) return displayLabel;
  return `Программа · ${program?.site_public_id || "—"}`;
}

function programSiteName(program) {
  const displayLabel = typeof program?.site_display_label === "string" ? program.site_display_label.trim() : "";
  return displayLabel || programSiteLabel(program);
}

function programDescription(program) {
  const value = typeof program?.site_description === "string" ? program.site_description.trim() : "";
  return value || "Описание программы пока не добавлено.";
}

function formatCommissionPercent(value) {
  if (value === null || value === undefined || value === "") return "—";
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  return `${numberValue.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

function formatReferralLockDays(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return "—";
  return `${numberValue.toLocaleString("ru-RU")} дн.`;
}

function formatParticipantsCount(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return "—";
  return numberValue.toLocaleString("ru-RU");
}

function programStatusLabel(program) {
  return program?.program_active ? "Активна" : "Недоступна";
}

function programAvatarLetter(label) {
  const value = typeof label === "string" ? label.trim() : "";
  return value.slice(0, 1).toUpperCase() || "P";
}

async function fetchCatalogProgram(sitePublicId, token) {
  const res = await fetch(API_ENDPOINTS.programsCatalog, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("catalog_fetch_failed");
  const data = await res.json();
  const programs = Array.isArray(data?.programs) ? data.programs : [];
  return programs.find((item) => item?.site_public_id === sitePublicId) || null;
}

/**
 * Member-facing detail for one agent program (SiteMembership) by site public_id.
 */
export default function AgentProgramDetailPage() {
  const { sitePublicId } = useParams();
  const [program, setProgram] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [copyHint, setCopyHint] = useState("");

  const loadProgram = useCallback(
    async ({ cancelled } = {}) => {
      const token = localStorage.getItem("access_token");
      if (!token || !sitePublicId) {
        setProgram(null);
        setLoading(false);
        setErrorKind(!token ? "auth" : "not_found");
        return;
      }
      setLoading(true);
      setErrorKind(null);
      setProgram(null);
      setJoinError("");
      setCopyHint("");

      try {
        const res = await fetch(API_ENDPOINTS.programDetail(sitePublicId), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 404) {
          try {
            const catalogProgram = await fetchCatalogProgram(sitePublicId, token);
            if (cancelled?.()) return;
            if (catalogProgram) {
              setProgram(catalogProgram);
            } else {
              setErrorKind("not_found");
            }
          } catch {
            if (cancelled?.()) return;
            setErrorKind("not_found");
          }
          return;
        }
        if (!res.ok) throw new Error("fetch_failed");
        const data = await res.json();
        if (cancelled?.()) return;
        const p = data && data.program;
        if (!p || !p.site_public_id) {
          setErrorKind("not_found");
          return;
        }
        setProgram(p);
      } catch {
        if (!cancelled?.()) setErrorKind("network");
      } finally {
        if (!cancelled?.()) setLoading(false);
      }
    },
    [sitePublicId]
  );

  useEffect(() => {
    let isCancelled = false;
    loadProgram({ cancelled: () => isCancelled });
    return () => {
      isCancelled = true;
    };
  }, [loadProgram]);

  const onJoin = async () => {
    const token = localStorage.getItem("access_token");
    if (!token || !program?.site_public_id) return;
    setJoining(true);
    setJoinError("");
    try {
      const res = await fetch(API_ENDPOINTS.siteCtaJoin, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ site_public_id: program.site_public_id }),
      });
      if (!res.ok) throw new Error("join_failed");
      await loadProgram();
    } catch {
      setJoinError("Не удалось вступить в программу. Попробуйте позже.");
    } finally {
      setJoining(false);
    }
  };

  const onCopyReferralLink = async () => {
    const link = program?.referral_link;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopyHint("Скопировано");
      setTimeout(() => setCopyHint(""), 2000);
    } catch {
      setCopyHint("Не удалось скопировать");
    }
  };

  return (
    <div className="lk-dashboard lk-dashboard__program-detail" data-testid="agent-program-detail">
      <div className="page__returnButton lk-dashboard__program-detail-back">
        <Link to="/lk/programs" className="tw-link link_primary link_s">
          <svg xmlns="http://www.w3.org/2000/svg" width="7" height="13" fill="none" viewBox="0 0 7 13" aria-hidden="true">
            <path
              fill="currentColor"
              d="M1 6.99a1 1 0 0 1 .23-.64l4-5a1 1 0 0 1 1.54 1.29L3.29 6.99l3.32 4.35a1 1 0 0 1-.15 1.4A1 1 0 0 1 5 12.62l-3.83-5A1 1 0 0 1 1 7Z"
            />
          </svg>
          Назад
        </Link>
      </div>

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
          <section className="lk-dashboard__program-card" data-testid="agent-program-card">
            <div className="lk-dashboard__program-card-head">
              <div className="lk-dashboard__program-card-avatar" aria-hidden="true">
                {programAvatarLetter(programSiteLabel(program))}
              </div>
              <div className="lk-dashboard__program-card-copy">
                <p className="lk-dashboard__program-card-kicker">Название домена</p>
                <h1 className="lk-dashboard__program-card-title" data-testid="agent-program-title">
                  {programSiteLabel(program)}
                </h1>
                <p className="lk-dashboard__program-card-name">
                  <span>Название сайта</span>
                  {programSiteName(program)}
                </p>
              </div>
            </div>

            <div className="lk-dashboard__program-card-description">
              <span>Описание</span>
              <p>{programDescription(program)}</p>
            </div>

            <div className="lk-dashboard__program-metrics">
              <div className="lk-dashboard__program-metric">
                <span>Процент с продаж</span>
                <strong>{formatCommissionPercent(program.commission_percent)}</strong>
              </div>
              <div className="lk-dashboard__program-metric">
                <span>Срок закрепления клиента</span>
                <strong>{formatReferralLockDays(program.referral_lock_days)}</strong>
              </div>
              <div className="lk-dashboard__program-metric">
                <span>Статус программы</span>
                <strong>{programStatusLabel(program)}</strong>
              </div>
              <div className="lk-dashboard__program-metric">
                <span>Кол-во участников</span>
                <strong>{formatParticipantsCount(program.participants_count)}</strong>
              </div>
            </div>

            {program.joined ? (
              <div className="lk-dashboard__program-member" data-testid="agent-program-joined-state">
                <p className="lk-dashboard__program-card-joined">
                  Вы участвуете в программе
                  <br />
                  Дата подключения: {formatJoinedAt(program.joined_at)}
                </p>
                {program.ref_code ? (
                  <p className="lk-dashboard__program-card-joined">Реферальный код: {program.ref_code}</p>
                ) : null}
                {program.referral_link ? (
                  <div className="lk-dashboard__program-referral-link">
                    <input
                      className="lk-dashboard__program-referral-input"
                      readOnly
                      value={program.referral_link}
                      aria-label="Реферальная ссылка"
                    />
                    <button type="button" className="lk-dashboard__program-copy-btn" onClick={onCopyReferralLink}>
                      Скопировать ссылку
                    </button>
                  </div>
                ) : null}
                {copyHint ? <p className="lk-dashboard__program-card-joined">{copyHint}</p> : null}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="lk-dashboard__program-join-btn"
                  onClick={onJoin}
                  disabled={joining}
                  data-testid="agent-program-join-button"
                >
                  {joining ? "Вступаем…" : "Стать участником"}
                </button>
                {joinError ? <p className="lk-dashboard__program-card-joined">{joinError}</p> : null}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
