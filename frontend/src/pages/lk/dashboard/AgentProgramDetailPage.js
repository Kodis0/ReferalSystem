import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { LUMOREF_SITE_STATUS_CHANGED_EVENT } from "../lkProgramListsSync";
import { SiteFaviconAvatar } from "../owner-programs/SiteFaviconAvatar";
import { programLifecycleStatus } from "./programsCatalogModel";
import "../owner-programs/owner-programs.css";
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

function programSiteHref(program) {
  const label = programSiteLabel(program);
  if (!label || label.startsWith("Программа ·")) return "";
  try {
    const url = new URL(label.includes("://") ? label : `https://${label}`);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return "";
  }
  return "";
}

/** Ссылка для распространения: тот же origin, что у сайта в шапке карточки, + ?ref= */
function memberReferralShareUrl(program) {
  const ref = typeof program?.ref_code === "string" ? program.ref_code.trim() : "";
  if (!ref) {
    return typeof program?.referral_link === "string" ? program.referral_link.trim() : "";
  }
  const cardHref = programSiteHref(program);
  if (cardHref) {
    try {
      const u = new URL(cardHref);
      return `${u.origin}/?ref=${encodeURIComponent(ref)}`;
    } catch {
      /* fall through */
    }
  }
  return typeof program?.referral_link === "string" ? program.referral_link.trim() : "";
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

/** API may send decimal as string or number. */
function formatReferrerMoneyRub(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return String(value);
  return `${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

function programAvatarLetter(label) {
  const value = typeof label === "string" ? label.trim() : "";
  return value.slice(0, 1).toUpperCase() || "P";
}

/**
 * Member-facing detail for one agent program (SiteMembership) by site public_id.
 */
export default function AgentProgramDetailPage() {
  const { sitePublicId } = useParams();
  const location = useLocation();
  const [program, setProgram] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState(null);
  const [copyHint, setCopyHint] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  const loadProgram = useCallback(
    async ({ cancelled, softRefresh } = {}) => {
      const token = localStorage.getItem("access_token");
      if (!token || !sitePublicId) {
        setProgram(null);
        setLoading(false);
        setErrorKind(!token ? "auth" : "not_found");
        return;
      }
      const soft = Boolean(softRefresh);
      if (!soft) {
        setLoading(true);
        setErrorKind(null);
        setProgram(null);
        setCopyHint("");
        setJoinError("");
      }

      try {
        const res = await fetch(API_ENDPOINTS.programDetail(sitePublicId), {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (res.status === 404) {
          if (cancelled?.()) return;
          setErrorKind("not_found");
          setProgram(null);
          return;
        }
        if (!res.ok) throw new Error("fetch_failed");
        const data = await res.json();
        if (cancelled?.()) return;
        const p = data && data.program;
        if (!p || !p.site_public_id) {
          setErrorKind("not_found");
          setProgram(null);
          return;
        }
        setProgram(p);
        if (soft) setErrorKind(null);
      } catch {
        if (!cancelled?.() && !soft) setErrorKind("network");
      } finally {
        if (!cancelled?.()) setLoading(false);
      }
    },
    [sitePublicId]
  );

  useEffect(() => {
    let isCancelled = false;
    loadProgram({ cancelled: () => isCancelled, softRefresh: false });
    return () => {
      isCancelled = true;
    };
  }, [loadProgram]);

  /** Подтягиваем program_active после действий владельца (виджет вкл/выкл / activate). */
  useEffect(() => {
    if (errorKind === "not_found") return undefined;
    let isCancelled = false;
    const tick = () => {
      void loadProgram({ cancelled: () => isCancelled, softRefresh: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    const onSiteStatusChanged = (event) => {
      const changedSiteId = event?.detail?.site_public_id || "";
      if (!changedSiteId || changedSiteId === sitePublicId) tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", tick);
    window.addEventListener(LUMOREF_SITE_STATUS_CHANGED_EVENT, onSiteStatusChanged);
    return () => {
      isCancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", tick);
      window.removeEventListener(LUMOREF_SITE_STATUS_CHANGED_EVENT, onSiteStatusChanged);
    };
  }, [loadProgram, sitePublicId, errorKind]);

  const referralShareUrl = program ? memberReferralShareUrl(program) : "";

  const onCopyReferralLink = async () => {
    if (!referralShareUrl) return;
    try {
      await navigator.clipboard.writeText(referralShareUrl);
      setCopyHint("Скопировано");
      setTimeout(() => setCopyHint(""), 2000);
    } catch {
      setCopyHint("Не удалось скопировать");
    }
  };

  const onJoinProgram = async () => {
    const token = localStorage.getItem("access_token");
    if (!token || !sitePublicId || joining) return;
    setJoining(true);
    setJoinError("");
    try {
      const res = await fetch(API_ENDPOINTS.siteCtaJoin, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ site_public_id: sitePublicId }),
      });
      if (!res.ok) throw new Error("program_join_failed");
      await loadProgram({ softRefresh: true });
    } catch {
      setJoinError("Не удалось присоединиться к программе. Попробуйте позже.");
    } finally {
      setJoining(false);
    }
  };

  const backTo = location.state?.from === "/lk/my-programs" ? "/lk/my-programs" : "/lk/programs";
  const lifecycle = programLifecycleStatus(program);
  const canJoinProgram = lifecycle.tone === "success";
  const joined = Boolean(program?.joined);

  return (
    <div
      className={`lk-dashboard lk-dashboard__program-detail${joined ? " lk-dashboard__program-detail_joined lk-partner" : ""}`}
      data-testid="agent-program-detail"
    >
      <div className="page__returnButton lk-dashboard__program-detail-back">
        <Link to={backTo} className="tw-link link_primary link_s">
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
                <SiteFaviconAvatar
                  manualUrl={typeof program.avatar_data_url === "string" ? program.avatar_data_url.trim() : ""}
                  siteLike={program}
                  letter={programAvatarLetter(programSiteLabel(program))}
                  imgClassName="lk-dashboard__program-card-avatar-img"
                  useExternalFavicon={false}
                />
              </div>
              <div className="lk-dashboard__program-card-copy">
                <h1 className="lk-dashboard__program-card-title" data-testid="agent-program-title">
                  {programSiteName(program)}
                </h1>
                {programSiteHref(program) ? (
                  <a
                    className="lk-dashboard__program-card-name"
                    href={programSiteHref(program)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {programSiteLabel(program)}
                  </a>
                ) : (
                  <p className="lk-dashboard__program-card-name">{programSiteLabel(program)}</p>
                )}
              </div>
            </div>

            <div className="lk-dashboard__program-card-description">
              <span>Описание</span>
              <p>{programDescription(program)}</p>
            </div>

            {program.joined ? (
              <nav
                className="owner-programs__tabs lk-dashboard__program-detail-shell-tabs"
                aria-label="Дашборд программы"
                role="tablist"
                data-testid="agent-program-shell-tabs"
              >
                <span className="owner-programs__tab owner-programs__tab_active" role="tab" aria-selected="true">
                  Дашборд
                </span>
              </nav>
            ) : null}

            {program.joined ? (
              <div className="lk-dashboard__program-earnings" data-testid="agent-program-referrer-money">
                <span className="lk-dashboard__program-earnings-label">Доход по вашей ссылке</span>
                <div className="lk-dashboard__program-earnings-row">
                  <strong className="lk-dashboard__program-earnings-commission">
                    {formatReferrerMoneyRub(program.referrer_commission_total)}
                  </strong>
                  <span className="lk-dashboard__program-earnings-sales" title="Сумма оплаченных заказов клиентов по вашей ссылке">
                    <span className="lk-dashboard__program-earnings-sales-prefix">Продажи </span>
                    {formatReferrerMoneyRub(program.referrer_sales_total)}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="lk-dashboard__program-metrics">
              <div className="lk-dashboard__program-metric">
                <span>Вознаграждение</span>
                <strong>{formatCommissionPercent(program.commission_percent)}</strong>
              </div>
              <div className="lk-dashboard__program-metric">
                <span>Срок закрепления</span>
                <strong>{formatReferralLockDays(program.referral_lock_days)}</strong>
              </div>
              <div className="lk-dashboard__program-metric">
                <span>Количество участников</span>
                <strong>{formatParticipantsCount(program.participants_count)}</strong>
              </div>
              <div className="lk-dashboard__program-metric">
                <span>Статус программы</span>
                <strong>{lifecycle.label}</strong>
              </div>
            </div>

            {lifecycle.tone !== "success" ? (
              <p className="lk-dashboard__program-card-joined" role="status">
                {lifecycle.description}
              </p>
            ) : null}

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
                {referralShareUrl ? (
                  <div className="lk-dashboard__program-referral-link">
                    <input
                      className="lk-dashboard__program-referral-input"
                      readOnly
                      value={referralShareUrl}
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
              <div className="lk-dashboard__program-member" data-testid="agent-program-unjoined-state">
                <button
                  type="button"
                  className="owner-programs__projects-create-btn"
                  onClick={onJoinProgram}
                  disabled={joining || !canJoinProgram}
                  data-testid="agent-program-join-btn"
                >
                  {joining ? "Вступаем…" : canJoinProgram ? "Вступить в программу" : "Программа временно недоступна"}
                </button>
                {joinError ? <p className="lk-dashboard__program-card-joined">{joinError}</p> : null}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
