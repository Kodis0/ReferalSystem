import { useCallback, useEffect, useRef, useState } from "react";
import { ListFilter, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { LK_PROGRAM_LISTS_REFETCH_EVENT } from "../lkProgramListsSync";
import { SiteFaviconAvatar } from "../owner-programs/SiteFaviconAvatar";
import "../lk.css";
import "../owner-programs/owner-programs.css";
import "./dashboard.css";
import {
  CatalogFilterListbox,
  COMMISSION_FILTER_OPTIONS,
  PARTICIPANTS_FILTER_OPTIONS,
} from "./ProgramsCatalogFilters";
import {
  formatCatalogCommissionPercent,
  getCatalogFilteredSortedPrograms,
  programCatalogDisplayName,
  programCatalogExternalSiteHref,
  programCatalogSiteOriginLabel,
} from "./programsCatalogModel";

function ServiceActionsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="currentColor" d="M9 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm-5.25 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm10.5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
    </svg>
  );
}

function programAvatarLetter(label) {
  const value = typeof label === "string" ? label.trim() : "";
  return (value.slice(0, 1).toUpperCase() || "P");
}

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

  const catalogListFetchInit = useCallback((token) => {
    return {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    };
  }, []);

  const refetchPrograms = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const res = await fetch(API_ENDPOINTS.programsCatalog, catalogListFetchInit(token));
      if (!res.ok) return;
      const data = await res.json();
      setPrograms(Array.isArray(data.programs) ? data.programs : []);
    } catch {
      /* ignore */
    }
  }, [catalogListFetchInit]);

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
    fetch(API_ENDPOINTS.programsCatalog, catalogListFetchInit(token))
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
  }, [catalogListFetchInit]);

  useEffect(() => {
    function onProgramsAvatarSourcesUpdated() {
      refetchPrograms();
    }
    window.addEventListener(LK_PROGRAM_LISTS_REFETCH_EVENT, onProgramsAvatarSourcesUpdated);
    window.addEventListener("lk-account-avatar-updated", onProgramsAvatarSourcesUpdated);
    window.addEventListener("lk-site-avatar-updated", onProgramsAvatarSourcesUpdated);
    return () => {
      window.removeEventListener(LK_PROGRAM_LISTS_REFETCH_EVENT, onProgramsAvatarSourcesUpdated);
      window.removeEventListener("lk-account-avatar-updated", onProgramsAvatarSourcesUpdated);
      window.removeEventListener("lk-site-avatar-updated", onProgramsAvatarSourcesUpdated);
    };
  }, [refetchPrograms]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      refetchPrograms();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refetchPrograms]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const { filteredPrograms, sortedFilteredPrograms } = getCatalogFilteredSortedPrograms(
    programs,
    normalizedSearchQuery,
    commissionFilter,
    participantsFilter,
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
              const rowTitle = programCatalogDisplayName(p);
              const commissionLabel = formatCatalogCommissionPercent(p);
              const catalogOriginLabel = programCatalogSiteOriginLabel(p);
              const catalogSiteHref = programCatalogExternalSiteHref(p);
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
                          key={`cat-${p.site_public_id}-${String(p.avatar_data_url || "").slice(0, 48)}-${String(p.avatar_updated_at || "")}`}
                          manualUrl={typeof p.avatar_data_url === "string" ? p.avatar_data_url.trim() : ""}
                          siteLike={p}
                          letter={programAvatarLetter(rowTitle)}
                          imgClassName="lk-dashboard__programs-avatar-img"
                          useExternalFavicon={false}
                        />
                      </div>
                    </div>
                    <div className="lk-dashboard__programs-catalog-row-middle">
                      <span className="lk-dashboard__programs-status-dot" aria-hidden="true" />
                      <div className="lk-dashboard__programs-catalog-row-text">
                        <span className="lk-dashboard__programs-catalog-title">{rowTitle}</span>
                        {catalogSiteHref ? (
                          <a
                            className="lk-dashboard__programs-catalog-domain"
                            href={catalogSiteHref}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Открыть сайт ${catalogOriginLabel}`}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            {catalogOriginLabel}
                          </a>
                        ) : null}
                        <span className="lk-dashboard__programs-catalog-commission">{commissionLabel}</span>
                      </div>
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
