import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ListFilter, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { SiteFaviconAvatar } from "../owner-programs/SiteFaviconAvatar";
import "../lk.css";
import "../owner-programs/owner-programs.css";
import "./dashboard.css";

const COMMISSION_FILTER_OPTIONS = [
  { value: "", label: "Все" },
  { value: "lt5", label: "до 5%" },
  { value: "5-10", label: "5–10%" },
  { value: "10-20", label: "10–20%" },
  { value: "gte20", label: "20% и выше" },
];

const PARTICIPANTS_FILTER_OPTIONS = [
  { value: "", label: "Все" },
  { value: "lt10", label: "до 10" },
  { value: "10-50", label: "10–50" },
  { value: "50-200", label: "50–200" },
  { value: "gte200", label: "200 и выше" },
];

function CatalogFilterListbox({
  fieldKey,
  labelText,
  labelId,
  triggerId,
  listboxId,
  value,
  onChange,
  options,
  openField,
  setOpenField,
}) {
  const isOpen = openField === fieldKey;
  const currentLabel = options.find((o) => o.value === value)?.label ?? options[0].label;
  return (
    <div className="lk-dashboard__programs-filter" data-programs-catalog-filter-menu>
      <span className="lk-dashboard__programs-filter-label" id={labelId}>
        {labelText}
      </span>
      <div className="lk-dashboard__programs-filter-menu-wrap">
        <button
          type="button"
          id={triggerId}
          className="lk-dashboard__programs-filter-menu-trigger"
          aria-labelledby={labelId}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          data-testid={`programs-catalog-filter-${fieldKey}-trigger`}
          onClick={() => setOpenField(isOpen ? null : fieldKey)}
        >
          <span className="lk-dashboard__programs-filter-menu-trigger-label">{currentLabel}</span>
          <ChevronDown
            size={18}
            aria-hidden
            className={
              isOpen
                ? "lk-dashboard__programs-filter-menu-chevron lk-dashboard__programs-filter-menu-chevron_open"
                : "lk-dashboard__programs-filter-menu-chevron"
            }
          />
        </button>
        {isOpen ? (
          <div
            className="lk-header__menu lk-dashboard__programs-filter-lk-menu"
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
          >
            {options.map((opt) => (
              <button
                key={opt.value === "" ? "__all" : opt.value}
                type="button"
                role="option"
                aria-selected={value === opt.value}
                className="lk-header__menu-item"
                onClick={() => {
                  onChange(opt.value);
                  setOpenField(null);
                }}
              >
                <span className="lk-header__menu-item-text">{opt.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ServiceActionsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="currentColor" d="M9 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm-5.25 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm10.5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
    </svg>
  );
}

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

function parseCommissionPercent(program) {
  const raw = program?.commission_percent;
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseParticipantsCount(program) {
  const raw = program?.participants_count;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw === null || raw === undefined) return null;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

function matchesCommissionFilter(key, percent) {
  if (!key) return true;
  if (percent === null) return false;
  if (key === "lt5") return percent < 5;
  if (key === "5-10") return percent >= 5 && percent < 10;
  if (key === "10-20") return percent >= 10 && percent < 20;
  if (key === "gte20") return percent >= 20;
  return true;
}

function matchesParticipantsFilter(key, count) {
  if (!key) return true;
  if (count === null) return false;
  if (key === "lt10") return count < 10;
  if (key === "10-50") return count >= 10 && count < 50;
  if (key === "50-200") return count >= 50 && count < 200;
  if (key === "gte200") return count >= 200;
  return true;
}

function compareProgramsForSort(a, b, sortBy, sortDir) {
  const av = sortBy === "commission" ? parseCommissionPercent(a) : parseParticipantsCount(a);
  const bv = sortBy === "commission" ? parseCommissionPercent(b) : parseParticipantsCount(b);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  const cmp = av - bv;
  return sortDir === "desc" ? -cmp : cmp;
}

/** Пока UI сортировки отключён — порядок списка фиксирован */
const CATALOG_LIST_SORT_BY = "commission";
const CATALOG_LIST_SORT_DIR = "desc";

export default function ProgramsCatalogPage() {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState(null);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [commissionFilter, setCommissionFilter] = useState("");
  const [participantsFilter, setParticipantsFilter] = useState("");
  const [filtersPanelOpen, setFiltersPanelOpen] = useState(false);
  const [filterListboxOpen, setFilterListboxOpen] = useState(null);
  const filtersWrapRef = useRef(null);
  const [activeMenuSiteId, setActiveMenuSiteId] = useState("");
  const [joiningSiteId, setJoiningSiteId] = useState("");
  const [leavingSiteId, setLeavingSiteId] = useState("");

  useEffect(() => {
    if (!filtersPanelOpen) return undefined;
    function onPointerDown(event) {
      if (filtersWrapRef.current && !filtersWrapRef.current.contains(event.target)) {
        setFiltersPanelOpen(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setFiltersPanelOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filtersPanelOpen]);

  useEffect(() => {
    if (!filtersPanelOpen) setFilterListboxOpen(null);
  }, [filtersPanelOpen]);

  useEffect(() => {
    if (!filterListboxOpen) return undefined;
    function onPointerDown(event) {
      const t = event.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-programs-catalog-filter-menu]")) return;
      setFilterListboxOpen(null);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setFilterListboxOpen(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filterListboxOpen]);

  useEffect(() => {
    if (!activeMenuSiteId) return undefined;
    function onPointerDown(event) {
      const t = event.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-catalog-program-menu]")) return;
      setActiveMenuSiteId("");
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setActiveMenuSiteId("");
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeMenuSiteId]);

  const refetchPrograms = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const res = await fetch(API_ENDPOINTS.programsCatalog, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setPrograms(Array.isArray(data.programs) ? data.programs : []);
    } catch {
      /* ignore */
    }
  }, []);

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
    ? programs.filter((program) => {
        if (normalizedSearchQuery && !programSearchValue(program).includes(normalizedSearchQuery)) return false;
        if (!matchesCommissionFilter(commissionFilter, parseCommissionPercent(program))) return false;
        if (!matchesParticipantsFilter(participantsFilter, parseParticipantsCount(program))) return false;
        return true;
      })
    : [];

  const sortedFilteredPrograms = [...filteredPrograms].sort((a, b) =>
    compareProgramsForSort(a, b, CATALOG_LIST_SORT_BY, CATALOG_LIST_SORT_DIR),
  );

  const openProgramCard = (sitePublicId) => {
    if (!sitePublicId) return;
    navigate(`/lk/referral-program/${sitePublicId}`, { state: { from: "/lk/programs" } });
  };

  const handleJoinProgram = async (event, sitePublicId) => {
    event.stopPropagation();
    const token = localStorage.getItem("access_token");
    if (!token || !sitePublicId || joiningSiteId) return;
    setJoiningSiteId(sitePublicId);
    setActiveMenuSiteId("");
    try {
      const res = await fetch(API_ENDPOINTS.siteCtaJoin, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ site_public_id: sitePublicId }),
      });
      if (!res.ok) throw new Error("join_failed");
      await refetchPrograms();
    } catch {
      /* UI: silent; user can retry from card */
    } finally {
      setJoiningSiteId("");
    }
  };

  const handleLeaveProgram = async (event, sitePublicId) => {
    event.stopPropagation();
    const token = localStorage.getItem("access_token");
    if (!token || !sitePublicId || leavingSiteId) return;
    setLeavingSiteId(sitePublicId);
    setActiveMenuSiteId("");
    try {
      const leaveRes = await fetch(API_ENDPOINTS.siteCtaLeave, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ site_public_id: sitePublicId }),
      });
      if (!leaveRes.ok) {
        const fallbackRes = await fetch(API_ENDPOINTS.myProgramDetail(sitePublicId), {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!fallbackRes.ok && fallbackRes.status !== 404) throw new Error("leave_failed");
      }
      await refetchPrograms();
    } catch {
      /* ignore */
    } finally {
      setLeavingSiteId("");
    }
  };

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
          <>
            <div className="lk-dashboard__programs-toolbar">
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
              <div className="lk-dashboard__programs-filters-wrap" ref={filtersWrapRef}>
                <button
                  type="button"
                  className="lk-dashboard__programs-filters-btn"
                  aria-expanded={filtersPanelOpen}
                  aria-controls="programs-catalog-filters-panel"
                  aria-haspopup="true"
                  onClick={() => {
                    setFiltersPanelOpen((open) => !open);
                    setFilterListboxOpen(null);
                  }}
                  data-testid="programs-catalog-filters-toggle"
                >
                  <ListFilter size={18} strokeWidth={2} aria-hidden={true} />
                  <span>Фильтры</span>
                  {commissionFilter || participantsFilter ? (
                    <span className="lk-dashboard__programs-filters-btn-dot" aria-hidden={true} />
                  ) : null}
                </button>
                {filtersPanelOpen ? (
                  <div
                    id="programs-catalog-filters-panel"
                    className="lk-dashboard__programs-filters-panel"
                    role="group"
                    aria-label="Фильтры каталога"
                  >
                    <CatalogFilterListbox
                      fieldKey="commission"
                      labelText="Начисление, %"
                      labelId="programs-catalog-filter-commission-label"
                      triggerId="programs-catalog-filter-commission"
                      listboxId="programs-catalog-filter-commission-listbox"
                      value={commissionFilter}
                      onChange={setCommissionFilter}
                      options={COMMISSION_FILTER_OPTIONS}
                      openField={filterListboxOpen}
                      setOpenField={setFilterListboxOpen}
                    />
                    <CatalogFilterListbox
                      fieldKey="participants"
                      labelText="Участники"
                      labelId="programs-catalog-filter-participants-label"
                      triggerId="programs-catalog-filter-participants"
                      listboxId="programs-catalog-filter-participants-listbox"
                      value={participantsFilter}
                      onChange={setParticipantsFilter}
                      options={PARTICIPANTS_FILTER_OPTIONS}
                      openField={filterListboxOpen}
                      setOpenField={setFilterListboxOpen}
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="lk-dashboard__programs-catalog-section-title" data-testid="programs-catalog-section-title">
              <h2 className="lk-dashboard__programs-catalog-section-heading">
                Программы <span className="lk-dashboard__programs-catalog-section-count">{programs.length}</span>
              </h2>
            </div>
          </>
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
            {sortedFilteredPrograms.map((p) => {
              const label = programSiteLabel(p);
              const menuOpen = activeMenuSiteId === p.site_public_id;
              const joined = Boolean(p.joined);
              const busyJoin = joiningSiteId === p.site_public_id;
              const busyLeave = leavingSiteId === p.site_public_id;
              return (
                <li key={p.site_public_id} className="lk-dashboard__programs-item">
                  <div
                    className={`lk-dashboard__programs-catalog-row${menuOpen ? " lk-dashboard__programs-catalog-row_menu-open" : ""}`}
                    data-testid="programs-catalog-list-link"
                    data-nav-target={`/lk/referral-program/${p.site_public_id}`}
                    role="link"
                    tabIndex={0}
                    onClick={() => openProgramCard(p.site_public_id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openProgramCard(p.site_public_id);
                      }
                    }}
                  >
                    <div className="lk-dashboard__programs-item-top">
                      <div className="lk-dashboard__programs-avatar" aria-hidden="true">
                        <SiteFaviconAvatar
                          manualUrl={typeof p.avatar_data_url === "string" ? p.avatar_data_url.trim() : ""}
                          siteLike={p}
                          letter={programAvatarLetter(label)}
                          imgClassName="lk-dashboard__programs-avatar-img"
                        />
                      </div>
                    </div>
                    <div className="lk-dashboard__programs-catalog-row-middle">
                      <span className="lk-dashboard__programs-status-dot" aria-hidden="true" />
                      <span className="lk-dashboard__programs-label">{label}</span>
                    </div>
                    <div
                      className="lk-dashboard__programs-catalog-row-actions"
                      data-catalog-program-menu="true"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <div className="owner-programs__service-card-menu owner-programs__services-list-menu">
                        <button
                          type="button"
                          className="owner-programs__service-card-menu-trigger owner-programs__services-list-menu-trigger"
                          aria-haspopup="menu"
                          aria-expanded={menuOpen}
                          aria-label="Действия по программе"
                          data-testid={`programs-catalog-menu-trigger-${p.site_public_id}`}
                          disabled={busyJoin || busyLeave}
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveMenuSiteId((cur) => (cur === p.site_public_id ? "" : p.site_public_id));
                          }}
                        >
                          <ServiceActionsIcon />
                        </button>
                        {menuOpen ? (
                          <div className="owner-programs__service-card-menu-dropdown" role="menu">
                            {joined ? (
                              <button
                                type="button"
                                className="owner-programs__service-card-menu-item owner-programs__service-card-menu-item_danger"
                                role="menuitem"
                                disabled={busyLeave}
                                onClick={(event) => handleLeaveProgram(event, p.site_public_id)}
                              >
                                {busyLeave ? "Выходим…" : "Выйти"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="owner-programs__service-card-menu-item"
                                role="menuitem"
                                disabled={busyJoin}
                                onClick={(event) => handleJoinProgram(event, p.site_public_id)}
                              >
                                {busyJoin ? "Вступаем…" : "Вступить"}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
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
