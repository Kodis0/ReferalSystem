/** Pure catalog list logic (search string, filters, sort). No React / IO. */

export function programSiteLabel(program) {
  const originLabel = typeof program?.site_origin_label === "string" ? program.site_origin_label.trim() : "";
  if (originLabel) return originLabel;
  const displayLabel = typeof program?.site_display_label === "string" ? program.site_display_label.trim() : "";
  if (displayLabel) return displayLabel;
  return `Программа · ${program?.site_public_id || "—"}`;
}

/** Название сайта для строки каталога (имя, не домен; домен — запасной вариант). */
export function programCatalogDisplayName(program) {
  const display = typeof program?.site_display_label === "string" ? program.site_display_label.trim() : "";
  if (display) return display;
  const origin = typeof program?.site_origin_label === "string" ? program.site_origin_label.trim() : "";
  if (origin) return origin;
  return `Программа · ${program?.site_public_id || "—"}`;
}

export function formatCatalogCommissionPercent(program) {
  const raw = program?.commission_percent;
  if (raw === null || raw === undefined || raw === "") return "—";
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
  if (!Number.isFinite(n)) return String(raw);
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

/** Домен из API (origin label) для подсказки в строке каталога. */
export function programCatalogSiteOriginLabel(program) {
  const v = typeof program?.site_origin_label === "string" ? program.site_origin_label.trim() : "";
  return v;
}

/** HTTPS URL для открытия сайта в новой вкладке; пусто если origin не распознан как URL. */
export function programCatalogExternalSiteHref(program) {
  const label = programCatalogSiteOriginLabel(program);
  if (!label) return "";
  try {
    const url = new URL(label.includes("://") ? label : `https://${label}`);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return "";
  }
  return "";
}

export function programLifecycleStatus(program) {
  if (program?.widget_enabled === false) {
    return {
      tone: "muted",
      label: "Виджет выключен",
      description: "Программа временно остановлена.",
    };
  }
  const status = typeof program?.site_status === "string" ? program.site_status.trim().toLowerCase() : "";
  if (program?.program_active === true || (program?.program_active !== false && status === "active")) {
    return {
      tone: "success",
      label: "Активна",
      description: "Программа принимает участников и лиды.",
    };
  }

  if (status === "verified") {
    return {
      tone: "warning",
      label: "Готова к активации",
      description: "Сайт проверен, но программа ещё не активирована.",
    };
  }
  if (status === "draft") {
    return {
      tone: "muted",
      label: "Черновик",
      description: "Программа ещё не активна.",
    };
  }
  if (status === "paused" || status === "disabled" || status === "inactive") {
    return {
      tone: "danger",
      label: "Остановлена",
      description: "Программа временно недоступна.",
    };
  }
  return {
    tone: "muted",
    label: "Не активна",
    description: "Программа временно недоступна.",
  };
}

function programSearchValue(program) {
  return [
    programSiteLabel(program),
    program?.site_display_label,
    program?.site_origin_label,
    program?.site_public_id,
    program?.site_status,
    programLifecycleStatus(program).label,
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

/**
 * @param {unknown} programs
 * @param {string} normalizedSearchQuery — уже trim + toLowerCase (как в компоненте)
 * @param {string} commissionFilter
 * @param {string} participantsFilter
 */
export function getCatalogFilteredSortedPrograms(programs, normalizedSearchQuery, commissionFilter, participantsFilter) {
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

  return { filteredPrograms, sortedFilteredPrograms };
}
