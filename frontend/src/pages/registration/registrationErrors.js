const INVALID_SITE_MSG =
  "Ссылка недействительна или срок её действия истёк. Проверьте адрес или получите новую ссылку у организатора.";
const SITE_NOT_JOINABLE_MSG =
  "Программа по этой площадке пока недоступна для регистрации.";

function isInvalidSitePublicIdPayload(data) {
  if (!data || typeof data !== "object") return false;
  const msgs = data.site_public_id;
  if (!Array.isArray(msgs) || !msgs.length) return false;
  return msgs.some(
    (m) =>
      typeof m === "string" &&
      /invalid\s+site_public_id/i.test(m)
  );
}

/** User-facing registration error text; avoids raw backend codes in the UI. */
export function formatRegistrationErrors(data) {
  if (data && data.detail === "site_not_joinable") {
    return SITE_NOT_JOINABLE_MSG;
  }
  if (isInvalidSitePublicIdPayload(data)) {
    return INVALID_SITE_MSG;
  }
  if (typeof data.detail === "string") {
    if (data.detail === "site_not_joinable") return SITE_NOT_JOINABLE_MSG;
    return data.detail;
  }
  if (Array.isArray(data.detail)) return data.detail.join("\n");
  if (typeof data === "object" && data !== null) {
    const entries = Object.entries(data).filter(([k]) => k !== "site_status");
    if (!entries.length) return "Ошибка регистрации";
    return entries
      .map(([field, messages]) =>
        Array.isArray(messages)
          ? `${field}: ${messages.join(" ")}`
          : `${field}: ${messages}`
      )
      .join("\n");
  }
  return "Ошибка регистрации";
}
