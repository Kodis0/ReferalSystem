const INVALID_SITE_MSG =
  "Ссылка недействительна или срок её действия истёк. Проверьте адрес или получите новую ссылку у организатора.";
const SITE_NOT_JOINABLE_MSG =
  "Программа по этой площадке пока недоступна для регистрации.";

/** Тексты валидации DRF — показываем по-русски (как на странице входа). */
function translateRegistrationBackendMessage(text) {
  const raw = String(text ?? "").trim();
  const known = {
    "This field may not be blank.": "Это поле обязательно для заполнения.",
    "This field is required.": "Это поле обязательно для заполнения.",
    "Enter a valid email address.": "Введите корректный email.",
    "Ensure this field has no more than 254 characters.": "Не более 254 символов.",
    "Enter a valid phone number.": "Введите корректный номер телефона.",
  };
  if (known[raw]) return known[raw];
  if (/may not be blank/i.test(raw)) return "Это поле обязательно для заполнения.";
  if (/\bis required\b/i.test(raw)) return "Это поле обязательно для заполнения.";
  if (/valid email address/i.test(raw)) return "Введите корректный email.";
  if (/valid phone number/i.test(raw)) return "Введите корректный номер телефона.";
  return raw;
}

const FIELD_LABEL_RU = {
  email: "Email",
  password: "Пароль",
  fio: "ФИО",
  phone: "Телефон",
  username: "Имя пользователя",
};

function registrationFieldLabelRu(key) {
  return FIELD_LABEL_RU[key] || key;
}

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
    return translateRegistrationBackendMessage(data.detail);
  }
  if (Array.isArray(data.detail)) {
    return data.detail
      .map((x) => (typeof x === "string" ? translateRegistrationBackendMessage(x) : String(x)))
      .join("\n");
  }
  if (typeof data === "object" && data !== null) {
    const entries = Object.entries(data).filter(([k]) => k !== "site_status");
    if (!entries.length) return "Ошибка регистрации";
    return entries
      .map(([field, messages]) => {
        const label = registrationFieldLabelRu(field);
        if (Array.isArray(messages)) {
          const text = messages.map(translateRegistrationBackendMessage).join(" ");
          return `${label}: ${text}`;
        }
        return `${label}: ${translateRegistrationBackendMessage(messages)}`;
      })
      .join("\n");
  }
  return "Ошибка регистрации";
}
