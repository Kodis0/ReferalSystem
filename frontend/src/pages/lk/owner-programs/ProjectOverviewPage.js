import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./CreateOwnerProjectPage.css";
import "./owner-programs.css";
import { formatDomainLine, siteLifecycleLabelRu } from "./siteDisplay";

function ServicesGridIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 3H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Zm0 8H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1Zm8-8h-4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Zm0 8h-4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1Z"
      />
    </svg>
  );
}

function ServicesListIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20" aria-hidden="true">
      <path fill="currentColor" d="M4 5h12a1 1 0 1 0 0-2H4a1 1 0 1 0 0 2Zm12 4H4a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2Zm0 6H4a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2Z" />
    </svg>
  );
}

function serviceSearchValue(site) {
  const title = serviceTitle(site);
  const domain = formatDomainLine(site.primary_origin, [site.primary_origin]);
  return `${title} ${domain} ${site.public_id} ${site.platform_preset || ""}`.toLowerCase();
}

function serviceTitle(site) {
  const displayName = typeof site?.display_name === "string" ? site.display_name.trim() : "";
  if (displayName) {
    return displayName;
  }
  const domain = formatDomainLine(site?.primary_origin, [site?.primary_origin]);
  if (domain && domain !== "Домен не задан") {
    return domain;
  }
  const publicId = typeof site?.public_id === "string" ? site.public_id.trim() : "";
  if (!publicId) {
    return "Сайт";
  }
  const compact = publicId.replace(/-/g, "");
  return `Сайт · ${compact.slice(0, 8)}…`;
}

function domainHostFromValue(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const raw = value.trim();
  try {
    if (raw.includes("://")) {
      return new URL(raw).hostname.toLowerCase();
    }
  } catch {
    /* ignore */
  }
  return raw.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
}

function countryCodeFromDomain(value) {
  const host = domainHostFromValue(value);
  if (!host) return "";
  const labels = host.split(".").filter(Boolean);
  if (labels.length === 0) return "";
  const tld = labels[labels.length - 1];
  if (/^[a-z]{2}$/i.test(tld)) {
    const upper = tld.toUpperCase();
    if (upper === "UK") return "GB";
    return upper;
  }
  if (tld === "xn--p1ai" || tld === "su") return "RU";
  return "";
}

function emojiFlagFromCountryCode(countryCode) {
  if (!/^[A-Z]{2}$/.test(countryCode)) return "";
  const base = 127397;
  return String.fromCodePoint(...countryCode.split("").map((letter) => base + letter.charCodeAt(0)));
}

function ServiceCountryFlag({ domain }) {
  const countryCode = countryCodeFromDomain(domain);
  const flag = emojiFlagFromCountryCode(countryCode);
  if (!flag) return null;
  return (
    <span className="owner-programs__service-card-flag" role="img" aria-label={`Флаг страны ${countryCode}`}>
      {flag}
    </span>
  );
}

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function ServiceActionsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="currentColor" d="M9 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm-5.25 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm10.5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
    </svg>
  );
}

function serviceStatusTone(status) {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!value) return "success";
  if (value.includes("draft") || value.includes("чернов")) return "warning";
  if (value.includes("error") || value.includes("fail") || value.includes("disabled")) return "danger";
  return "success";
}

const CONNECT_SITE_PLATFORMS = [
  { value: "tilda", label: "Tilda" },
  { value: "generic", label: "Generic" },
];

function ConnectSitePlatformSelect({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const currentLabel = CONNECT_SITE_PLATFORMS.find((o) => o.value === value)?.label || value;

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!rootRef.current || rootRef.current.contains(event.target)) return;
      setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="input" ref={rootRef}>
      <div className="inputWrapper owner-programs__menu-select-wrap">
        <button
          type="button"
          id="project-add-site-platform-trigger"
          className="owner-programs__menu-select-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls="project-add-site-platform-listbox"
          aria-labelledby="project-add-site-platform-label"
          disabled={disabled}
          data-testid="project-add-site-platform"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="owner-programs__menu-select-value">{currentLabel}</span>
          <ChevronDown
            size={18}
            className={
              open ? "owner-programs__menu-select-chevron owner-programs__menu-select-chevron_open" : "owner-programs__menu-select-chevron"
            }
            aria-hidden="true"
          />
        </button>
        {open ? (
          <div
            id="project-add-site-platform-listbox"
            className="owner-programs__menu-select-dropdown"
            role="listbox"
            aria-labelledby="project-add-site-platform-label"
          >
            {CONNECT_SITE_PLATFORMS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={value === opt.value}
                className={`owner-programs__menu-select-option${value === opt.value ? " owner-programs__menu-select-option_active" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ProjectOverviewPage() {
  const navigate = useNavigate();
  const {
    sitePublicId,
    hasSiteId,
    projectId,
    buildProjectPath,
    projectEntry,
    reloadProjectEntry,
    projectEntryLoading,
    projectEntryError,
    addSiteOpen,
    addSiteDisplayName,
    addSiteOrigin,
    addSitePlatform,
    addSiteState,
    addSiteError,
    setAddSiteDisplayName,
    setAddSiteOrigin,
    setAddSitePlatform,
    toggleAddSiteForm,
    handleAddSite,
  } = useOutletContext();
  const [searchValue, setSearchValue] = useState("");
  const [layoutMode, setLayoutMode] = useState("cards");
  const [activeMenuSiteId, setActiveMenuSiteId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingSiteId, setDeletingSiteId] = useState("");
  const menuRef = useRef(null);

  const currentProjectSites = Array.isArray(projectEntry?.sites) ? projectEntry.sites : [];
  const visibleProjectSites = useMemo(
    () => currentProjectSites.filter((site) => site.public_id !== deletingSiteId),
    [currentProjectSites, deletingSiteId],
  );
  const showAddSiteForm = addSiteOpen;
  const filteredSites = useMemo(() => {
    const needle = searchValue.trim().toLowerCase();
    if (!needle) return visibleProjectSites;
    return visibleProjectSites.filter((site) => serviceSearchValue(site).includes(needle));
  }, [visibleProjectSites, searchValue]);

  const openSiteCard = useCallback(
    (sitePublicId) => {
      if (!sitePublicId || typeof buildProjectPath !== "function") return;
      navigate(buildProjectPath("overview", sitePublicId));
    },
    [buildProjectPath, navigate],
  );

  useEffect(() => {
    function handlePointerDown(event) {
      if (!menuRef.current || menuRef.current.contains(event.target)) return;
      setActiveMenuSiteId("");
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setActiveMenuSiteId("");
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleDeleteSite = useCallback(
    async (site) => {
      const title = serviceTitle(site);
      const confirmed = window.confirm(`Удалить сайт "${title}"?`);
      if (!confirmed) return;
      if (typeof projectEntry?.id !== "number") {
        setDeleteError("Не удалось определить проект для удаления сайта");
        return;
      }

      setActiveMenuSiteId("");
      setDeleteError("");
      setDeletingSiteId(site.public_id);

      try {
        const res = await fetch(API_ENDPOINTS.projectSiteDelete(projectEntry.id), {
          method: "DELETE",
          headers: authHeaders(),
          credentials: "include",
          body: JSON.stringify({ site_public_id: site.public_id }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = payload?.detail;
          const detailMsg =
            typeof detail === "string" ? detail : Array.isArray(detail) ? detail.join("\n") : detail != null ? String(detail) : "";
          throw new Error(detailMsg || `Не удалось удалить сайт (${res.status})`);
        }

        const updatedProject =
          typeof projectEntry?.id === "number" ? await reloadProjectEntry(projectEntry.id) : null;

        if (site.public_id === sitePublicId) {
          const fallbackSiteId =
            updatedProject && Array.isArray(updatedProject.sites) ? updatedProject.sites[0]?.public_id || "" : "";
          if (fallbackSiteId) {
            navigate(
              typeof buildProjectPath === "function"
                ? buildProjectPath("overview", fallbackSiteId)
                : `/lk/partner/project/${projectEntry?.id}/overview?site_public_id=${fallbackSiteId}`,
              { replace: true },
            );
          } else {
            navigate(
              typeof buildProjectPath === "function"
                ? buildProjectPath("overview", "")
                : projectId
                  ? `/lk/partner/project/${projectId}/overview`
                  : "/lk/partner",
              { replace: true },
            );
          }
          return;
        }
      } catch (err) {
        console.error(err);
        setDeleteError(err instanceof Error && err.message ? err.message : "Не удалось удалить сайт");
      } finally {
        setDeletingSiteId("");
      }
    },
    [buildProjectPath, navigate, projectEntry?.id, projectId, reloadProjectEntry, sitePublicId],
  );

  return (
    <div className="owner-programs__page" data-testid="project-services-page">
      {!projectEntryLoading && !projectEntryError && showAddSiteForm ? (
        <section className="owner-programs__connect-site-panel">
          <div className="page__returnButton">
            <Link className="tw-link link_primary link_s" to="/lk/partner" data-testid="project-connect-site-back">
              <svg xmlns="http://www.w3.org/2000/svg" width="7" height="13" fill="none" viewBox="0 0 7 13" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M1 6.99a1 1 0 0 1 .23-.64l4-5a1 1 0 0 1 1.54 1.29L3.29 6.99l3.32 4.35a1 1 0 0 1-.15 1.4A1 1 0 0 1 5 12.62l-3.83-5A1 1 0 0 1 1 7Z"
                />
              </svg>
              Назад
            </Link>
          </div>
          <h2 className="owner-programs__overview-title">
            {currentProjectSites.length === 0 ? "Подключение сайта" : "Добавить сайт"}
          </h2>
          <p className="owner-programs__muted owner-programs__connect-site-lead">
            {currentProjectSites.length === 0
              ? "Сначала добавьте сайт в проект, после этого откроются сервисы, настройки интеграции и пользователи."
              : "Добавьте ещё один сайт в текущий проект."}
          </p>
          <div id="create-owner-project" className="owner-programs__connect-site-nested-create">
            <form className="form" onSubmit={handleAddSite}>
              <label className="formControl" htmlFor="project-add-site-name">
                <div className="formControl__label">
                  <span className="text text_s text_bold text_grey text_align_left">Название сайта</span>
                </div>
                <div className="input">
                  <div className="inputWrapper">
                    <input
                      id="project-add-site-name"
                      className="inputField"
                      value={addSiteDisplayName}
                      onChange={(event) => setAddSiteDisplayName(event.target.value)}
                      placeholder="Основной лендинг"
                      autoComplete="off"
                      required
                      maxLength={200}
                      data-testid="project-add-site-name"
                    />
                  </div>
                </div>
              </label>

              <label className="formControl" htmlFor="project-add-site-origin">
                <div className="formControl__label">
                  <span className="text text_s text_bold text_grey text_align_left">Домен или origin</span>
                </div>
                <div className="input">
                  <div className="inputWrapper">
                    <input
                      id="project-add-site-origin"
                      className="inputField"
                      value={addSiteOrigin}
                      onChange={(event) => setAddSiteOrigin(event.target.value)}
                      placeholder="https://mysite.tilda.ws"
                      autoComplete="off"
                      required
                      data-testid="project-add-site-origin"
                    />
                  </div>
                </div>
              </label>

              <div className="formControl">
                <div className="formControl__label" id="project-add-site-platform-label">
                  <span className="text text_s text_bold text_grey text_align_left">Платформа</span>
                </div>
                <ConnectSitePlatformSelect value={addSitePlatform} onChange={setAddSitePlatform} disabled={addSiteState === "saving"} />
              </div>

              {addSiteError ? <div className="formError">{addSiteError}</div> : null}

              <div className="owner-programs__connect-site-form-actions">
                <button
                  type="submit"
                  className="baseButton button button_size_medium baseButton__size_medium baseButton__color_primary"
                  disabled={addSiteState === "saving"}
                  data-testid="project-add-site-submit"
                >
                  {addSiteState === "saving" ? "Создание…" : "Создать и настроить"}
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      {!showAddSiteForm ? (
        <>
          <div className="owner-programs__services-toolbar">
            <label className="owner-programs__services-search">
              <span className="owner-programs__services-search-icon">
                <Search size={16} />
              </span>
              <input
                className="owner-programs__input owner-programs__services-search-input"
                type="search"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Поиск"
                data-testid="project-services-search"
              />
            </label>
            <div className="owner-programs__services-layout-switch" role="group" aria-label="Вид списка сайтов">
              <button
                type="button"
                className={`owner-programs__services-layout-btn${layoutMode === "cards" ? " owner-programs__services-layout-btn_active" : ""}`}
                onClick={() => setLayoutMode("cards")}
                aria-pressed={layoutMode === "cards"}
                data-testid="project-services-layout-cards"
              >
                <ServicesGridIcon />
              </button>
              <button
                type="button"
                className={`owner-programs__services-layout-btn${layoutMode === "list" ? " owner-programs__services-layout-btn_active" : ""}`}
                onClick={() => setLayoutMode("list")}
                aria-pressed={layoutMode === "list"}
                data-testid="project-services-layout-list"
              >
                <ServicesListIcon />
              </button>
            </div>
            <div className="owner-programs__services-count">
              {projectEntryLoading ? "Загрузка…" : `Сервисов: ${visibleProjectSites.length}`}
            </div>
          </div>

          {projectEntryLoading ? <p className="lk-partner__muted">Загрузка сайтов проекта…</p> : null}
          {!projectEntryLoading && projectEntryError ? <div className="owner-programs__error">{projectEntryError}</div> : null}
          {!projectEntryLoading && !projectEntryError && deleteError ? <div className="owner-programs__error">{deleteError}</div> : null}
          {!projectEntryLoading && !projectEntryError && filteredSites.length === 0 && visibleProjectSites.length === 0 ? (
            <p className="owner-programs__muted" data-testid="project-services-empty">
              У проекта пока нет сервисов.
            </p>
          ) : null}
          {!projectEntryLoading && !projectEntryError && filteredSites.length === 0 && visibleProjectSites.length > 0 ? (
            <p className="owner-programs__muted">По вашему запросу сайты не найдены.</p>
          ) : null}

          {!projectEntryLoading && !projectEntryError && filteredSites.length > 0 ? (
            layoutMode === "cards" ? (
              <div className="owner-programs__services-grid" data-testid="project-child-sites-list">
                {filteredSites.map((site) => {
                  const isCurrent = site.public_id === sitePublicId;
                  const title = serviceTitle(site);
                  const domain = formatDomainLine(site.primary_origin, [site.primary_origin]);
                  const statusTone = serviceStatusTone(site.status);
                  return (
                    <div
                      key={site.public_id}
                      className="owner-programs__service-card"
                      data-testid={`project-child-site-${site.public_id}`}
                      role="link"
                      tabIndex={0}
                      onClick={() => openSiteCard(site.public_id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openSiteCard(site.public_id);
                        }
                      }}
                    >
                      <div className="owner-programs__service-card-top-right" ref={activeMenuSiteId === site.public_id ? menuRef : null}>
                        <ServiceCountryFlag domain={site.primary_origin} />
                        <div className="owner-programs__service-card-menu" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            className="owner-programs__service-card-menu-trigger"
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveMenuSiteId((value) => (value === site.public_id ? "" : site.public_id));
                            }}
                            aria-haspopup="menu"
                            aria-expanded={activeMenuSiteId === site.public_id}
                            data-testid={`project-child-site-menu-trigger-${site.public_id}`}
                            disabled={deletingSiteId === site.public_id}
                          >
                            <ServiceActionsIcon />
                          </button>
                          {activeMenuSiteId === site.public_id ? (
                            <div className="owner-programs__service-card-menu-dropdown" role="menu">
                              <button
                                type="button"
                                className="owner-programs__service-card-menu-item owner-programs__service-card-menu-item_danger"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteSite(site);
                                }}
                                role="menuitem"
                                data-testid={`project-child-site-delete-${site.public_id}`}
                                disabled={deletingSiteId === site.public_id}
                              >
                                {deletingSiteId === site.public_id ? "Удаление…" : "Удалить"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="owner-programs__service-card-top">
                        <div className="owner-programs__service-card-avatar">
                          <span>{title.slice(0, 1).toUpperCase() || "S"}</span>
                        </div>
                        <div className="owner-programs__service-card-copy">
                          <p className="owner-programs__service-card-title">{title}</p>
                          <p className="owner-programs__service-card-domain">{domain}</p>
                        </div>
                      </div>
                      <div className="owner-programs__service-card-meta">
                        <span className="owner-programs__service-card-status">
                          <span
                            className={`owner-programs__service-card-status-dot owner-programs__service-card-status-dot_${statusTone}`}
                            aria-hidden="true"
                          />
                          <span>{siteLifecycleLabelRu(site.status)}{hasSiteId && isCurrent ? " · текущий" : ""}</span>
                        </span>
                        <span>{site.platform_preset || "—"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="owner-programs__members-list owner-programs__services-list" data-testid="project-child-sites-list">
                {filteredSites.map((site) => {
                  const isCurrent = site.public_id === sitePublicId;
                  const title = serviceTitle(site);
                  const domain = formatDomainLine(site.primary_origin, [site.primary_origin]);
                  const statusLabel = `${siteLifecycleLabelRu(site.status)}${hasSiteId && isCurrent ? " · текущий" : ""}`;
                  const statusTone = serviceStatusTone(site.status);
                  return (
                    <div
                      key={site.public_id}
                      className="owner-programs__services-list-row"
                      data-testid={`project-child-site-${site.public_id}`}
                      role="link"
                      tabIndex={0}
                      onClick={() => openSiteCard(site.public_id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openSiteCard(site.public_id);
                        }
                      }}
                    >
                      <div className="owner-programs__services-list-top">
                        <div className="owner-programs__service-card-avatar owner-programs__services-list-avatar">
                          <span>{title.slice(0, 1).toUpperCase() || "S"}</span>
                        </div>
                      </div>
                      <div className="owner-programs__services-list-middle">
                        <div className={`owner-programs__services-list-status owner-programs__services-list-status_${statusTone}`} />
                        <div className="owner-programs__services-list-copy">
                          <p className="owner-programs__services-list-title">{title}</p>
                          <p className="owner-programs__services-list-domain">{domain}</p>
                        </div>
                      </div>
                      <div className="owner-programs__services-list-bottom">
                        <div className="owner-programs__services-list-end">
                          <div className="owner-programs__services-list-flag-wrap">
                            <ServiceCountryFlag domain={site.primary_origin} />
                          </div>
                          <div
                            className="owner-programs__service-card-menu owner-programs__services-list-menu"
                            ref={activeMenuSiteId === site.public_id ? menuRef : null}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="owner-programs__service-card-menu-trigger owner-programs__services-list-menu-trigger"
                              onClick={(event) => {
                                event.stopPropagation();
                                setActiveMenuSiteId((value) => (value === site.public_id ? "" : site.public_id));
                              }}
                              aria-haspopup="menu"
                              aria-expanded={activeMenuSiteId === site.public_id}
                              data-testid={`project-child-site-menu-trigger-${site.public_id}`}
                              disabled={deletingSiteId === site.public_id}
                            >
                              <ServiceActionsIcon />
                            </button>
                            {activeMenuSiteId === site.public_id ? (
                              <div className="owner-programs__service-card-menu-dropdown" role="menu">
                                <button
                                  type="button"
                                  className="owner-programs__service-card-menu-item owner-programs__service-card-menu-item_danger"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDeleteSite(site);
                                  }}
                                  role="menuitem"
                                  data-testid={`project-child-site-delete-${site.public_id}`}
                                  disabled={deletingSiteId === site.public_id}
                                >
                                  {deletingSiteId === site.public_id ? "Удаление…" : "Удалить"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
}
