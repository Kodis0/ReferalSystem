import { cloneElement, forwardRef, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, isValid as isValidDate, parse } from "date-fns";
import { ru } from "date-fns/locale";
import DatePicker, { registerLocale } from "react-datepicker";
import { API_ENDPOINTS } from "../../../config/api";
import LkListboxSelect from "../components/LkListboxSelect";
import "react-datepicker/dist/react-datepicker.css";
import "./settings.css";

registerLocale("ru", ru);

const ACCOUNT_TYPES = [
  { value: "individual", label: "Физическое лицо" },
  { value: "sole_proprietor", label: "Индивидуальный предприниматель" },
  { value: "legal_entity", label: "Юридическое лицо" },
];

function dateFromApiToInput(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value.slice(0, 10);
  return "";
}

function parseYmdLocal(ymd) {
  if (!ymd || typeof ymd !== "string" || ymd.length < 10) return null;
  const [ys, ms, ds] = ymd.slice(0, 10).split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatYmdLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function capitalizeMonthLabel(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Подсказка месяца календаря при неполном вводе (например «15.04» без года). */
function tryPeekMonthFromPartialInput(raw, defaultYear) {
  const v = String(raw || "").trim();
  if (!v) return null;
  const y = Number.isFinite(defaultYear) ? defaultYear : new Date().getFullYear();
  const dm = v.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(y, month - 1, day, 12, 0, 0, 0);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

function countDigitsBeforeIndex(str, index) {
  const i = Math.max(0, Math.min(index ?? 0, str.length));
  let n = 0;
  for (let c = 0; c < i; c++) {
    if (/\d/.test(str[c])) n += 1;
  }
  return n;
}

function caretIndexAfterDigitCount(str, digitCount) {
  if (digitCount <= 0) return 0;
  let n = 0;
  for (let idx = 0; idx < str.length; idx++) {
    if (/\d/.test(str[idx])) {
      n += 1;
      if (n >= digitCount) return idx + 1;
    }
  }
  return str.length;
}

/** Ручной ввод: цифры → дд.мм.гггг (точки после 2-й и 4-й цифры). Строка с «-» не трогаем (ISO). */
function formatDotsDdMmYyyy(raw) {
  const s = String(raw ?? "");
  if (/-/.test(s)) return s;
  const digits = s.replace(/\D/g, "").slice(0, 8);
  if (!digits) return "";
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += "." + digits.slice(2, 4);
  if (digits.length > 4) out += "." + digits.slice(4, 8);
  return out;
}

const PersonalDateInput = forwardRef(function PersonalDateInput(props, ref) {
  const {
    value,
    onClick,
    onChange,
    onBlur,
    onFocus,
    disabled,
    id,
    name,
    placeholder,
    className,
    ...rest
  } = props;

  const handleChange = useCallback(
    (e) => {
      const el = e.target;
      if (disabled) {
        onChange?.(e);
        return;
      }
      const before = el.value;
      const selStart = typeof el.selectionStart === "number" ? el.selectionStart : before.length;
      const digitsBefore = countDigitsBeforeIndex(before, selStart);
      const formatted = formatDotsDdMmYyyy(before);
      if (formatted !== before) {
        const proto = typeof window !== "undefined" ? window.HTMLInputElement?.prototype : null;
        const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, formatted);
        else el.value = formatted;
        const nextCaret = Math.min(caretIndexAfterDigitCount(formatted, digitsBefore), formatted.length);
        requestAnimationFrame(() => {
          try {
            if (document.activeElement === el) el.setSelectionRange(nextCaret, nextCaret);
          } catch (_) {
            /* ignore */
          }
        });
      }
      onChange?.(e);
    },
    [disabled, onChange],
  );

  const inputClassName = ["lk-settings-personal-page__date-input-field", className].filter(Boolean).join(" ");
  return (
    <div className="lk-settings-personal-page__date-input">
      <div className="lk-settings-personal-page__date-input-inner">
        <input
          ref={ref}
          {...rest}
          type="text"
          id={id}
          name={name}
          value={value ?? ""}
          placeholder={placeholder}
          onClick={onClick}
          onChange={handleChange}
          onBlur={onBlur}
          onFocus={onFocus}
          disabled={disabled}
          className={inputClassName}
          autoComplete="off"
          spellCheck={false}
        />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          className="lk-settings-personal-page__date-input-icon"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M17 2h-2V1a1 1 0 0 0-2 0v1H7V1a1 1 0 0 0-2 0v1H3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3Zm1 15a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7h16v7Zm0-9H2V5a1 1 0 0 1 1-1h2v1a1 1 0 0 0 2 0V4h6v1a1 1 0 0 0 2 0V4h2a1 1 0 0 1 1 1v3Z"
          />
        </svg>
      </div>
    </div>
  );
});

function PersonalDateHeader({
  monthDate,
  decreaseMonth,
  increaseMonth,
  prevMonthButtonDisabled,
  nextMonthButtonDisabled,
}) {
  const monthLabel = capitalizeMonthLabel(format(monthDate, "LLLL", { locale: ru }));
  const yearLabel = format(monthDate, "yyyy", { locale: ru });
  return (
    <div className="lk-settings-personal-page__dp-header">
      <button
        type="button"
        className="lk-settings-personal-page__dp-nav"
        onClick={decreaseMonth}
        disabled={prevMonthButtonDisabled}
        aria-label="Предыдущий месяц"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="6" height="13" fill="none" viewBox="0 0 6 13" aria-hidden="true">
          <path
            fill="currentColor"
            d="M0 6.32a1 1 0 0 1 .23-.64l4-4.99a1 1 0 0 1 1.54 1.28L2.3 6.32l3.32 4.35a1 1 0 0 1-.15 1.41A1 1 0 0 1 4 11.94L.17 6.95A1 1 0 0 1 0 6.32Z"
          />
        </svg>
      </button>
      <p className="lk-settings-personal-page__dp-caption">
        <span className="lk-settings-personal-page__dp-month">{monthLabel}</span>
        <span className="lk-settings-personal-page__dp-year">{yearLabel}</span>
      </p>
      <button
        type="button"
        className="lk-settings-personal-page__dp-nav"
        onClick={increaseMonth}
        disabled={nextMonthButtonDisabled}
        aria-label="Следующий месяц"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="6" height="13" fill="none" viewBox="0 0 6 13" aria-hidden="true">
          <path
            fill="currentColor"
            d="M6 6.32a1 1 0 0 0-.23-.64L1.77.7A1 1 0 0 0 .23 1.97L3.7 6.32.39 10.67a1 1 0 0 0 .15 1.41A1 1 0 0 0 2 11.94l3.83-4.99A1 1 0 0 0 6 6.32Z"
          />
        </svg>
      </button>
    </div>
  );
}

const PERSONAL_DATE_DISPLAY_FORMATS = ["dd.MM.yyyy", "d.M.yyyy", "dd.MM.yy", "d.M.yy", "yyyy-MM-dd", "dd/MM/yyyy", "d/M/yyyy"];

export function PersonalDatePicker({
  id,
  name,
  value,
  onChange,
  disabled,
  minDate,
  maxDate,
  placeholderText = "дд.мм.гггг",
  ariaLabelledBy,
  portalId,
  customInput,
  isClearable = false,
}) {
  const defaultPeekYear = maxDate instanceof Date && !Number.isNaN(maxDate.getTime()) ? maxDate.getFullYear() : new Date().getFullYear();
  const [peekOpenToDate, setPeekOpenToDate] = useState(() => parseYmdLocal(value) || null);
  const [pickerCalendarOpen, setPickerCalendarOpen] = useState(false);

  useEffect(() => {
    setPeekOpenToDate(parseYmdLocal(value) || null);
  }, [value]);

  const handleChangeRaw = useCallback(
    (e) => {
      const raw = e?.target?.value;
      if (typeof raw !== "string") return;
      const refDate = new Date(defaultPeekYear, 0, 1, 12, 0, 0, 0);
      let found = null;
      for (const fmt of PERSONAL_DATE_DISPLAY_FORMATS) {
        const d = parse(raw.trim(), fmt, refDate, { locale: ru });
        if (isValidDate(d)) {
          found = d;
          break;
        }
      }
      if (found) {
        setPeekOpenToDate(found);
        return;
      }
      const partial = tryPeekMonthFromPartialInput(raw, defaultPeekYear);
      if (partial) setPeekOpenToDate(partial);
    },
    [defaultPeekYear],
  );

  const openToDate = useMemo(() => {
    const fromValue = parseYmdLocal(value);
    if (fromValue) return fromValue;
    if (peekOpenToDate) return peekOpenToDate;
    if (maxDate instanceof Date && !Number.isNaN(maxDate.getTime())) return maxDate;
    return new Date();
  }, [value, peekOpenToDate, maxDate]);

  const resolvedCustomInput = customInput
    ? cloneElement(
        customInput,
        typeof customInput.type === "string" ? {} : { id, name, calendarOpen: pickerCalendarOpen },
      )
    : null;

  return (
    <DatePicker
      selected={parseYmdLocal(value)}
      onChange={(d) => onChange(d ? formatYmdLocal(d) : "")}
      onCalendarOpen={() => setPickerCalendarOpen(true)}
      onCalendarClose={() => setPickerCalendarOpen(false)}
      locale="ru"
      dateFormat={PERSONAL_DATE_DISPLAY_FORMATS}
      placeholderText={placeholderText}
      minDate={minDate}
      maxDate={maxDate}
      disabled={disabled}
      ariaLabelledBy={customInput ? undefined : ariaLabelledBy}
      customInput={resolvedCustomInput ?? <PersonalDateInput id={id} name={name} placeholder={placeholderText} />}
      {...(customInput ? {} : { onChangeRaw: handleChangeRaw })}
      isClearable={isClearable}
      openToDate={openToDate}
      renderCustomHeader={(p) => (
        <PersonalDateHeader
          monthDate={p.monthDate}
          decreaseMonth={p.decreaseMonth}
          increaseMonth={p.increaseMonth}
          prevMonthButtonDisabled={p.prevMonthButtonDisabled}
          nextMonthButtonDisabled={p.nextMonthButtonDisabled}
        />
      )}
      wrapperClassName="lk-settings-personal-page__datepicker-wrapper"
      popperClassName="lk-settings-personal-page__datepicker-popper"
      calendarClassName="lk-settings-personal-page__datepicker-calendar"
      showPopperArrow={false}
      popperPlacement="bottom-start"
      {...(portalId ? { portalId } : {})}
    />
  );
}

function fioFromUser(user) {
  if (!user) return "";
  const raw = typeof user.fio === "string" ? user.fio.trim() : "";
  if (raw) return raw;
  const patronymic = typeof user.patronymic === "string" ? user.patronymic.trim() : "";
  const parts = [user.last_name, user.first_name, patronymic].filter((p) => typeof p === "string" && p.trim());
  return parts.join(" ").trim();
}

export default function AccountPersonalDataPage({ user, fetchUser, setUser }) {
  const [accountType, setAccountType] = useState("individual");
  const [fio, setFio] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [passportSeries, setPassportSeries] = useState("");
  const [passportNumber, setPassportNumber] = useState("");
  const [passportIssuedBy, setPassportIssuedBy] = useState("");
  const [passportIssueDate, setPassportIssueDate] = useState("");
  const [passportRegistrationAddress, setPassportRegistrationAddress] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const loadingProfile = typeof window !== "undefined" && !!localStorage.getItem("access_token") && user === null;

  useEffect(() => {
    if (!user) return;
    const at = typeof user.account_type === "string" ? user.account_type.trim() : "";
    setAccountType(ACCOUNT_TYPES.some((o) => o.value === at) ? at : "individual");
    setFio(fioFromUser(user));
    setBirthDate(dateFromApiToInput(user.birth_date));
    setPassportSeries(typeof user.passport_series === "string" ? user.passport_series : "");
    setPassportNumber(typeof user.passport_number === "string" ? user.passport_number : "");
    setPassportIssuedBy(typeof user.passport_issued_by === "string" ? user.passport_issued_by : "");
    setPassportIssueDate(dateFromApiToInput(user.passport_issue_date));
    setPassportRegistrationAddress(
      typeof user.passport_registration_address === "string" ? user.passport_registration_address : "",
    );
    setEmail(typeof user.email === "string" ? user.email : "");
    setError("");
    setSaved(false);
  }, [user]);

  const canSubmit = useMemo(() => !!user && !loadingProfile, [user, loadingProfile]);

  const onSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");
      setSaved(false);
      const token = localStorage.getItem("access_token");
      if (!token || !user) {
        setError("Нет сессии. Войдите в аккаунт снова.");
        return;
      }
      setSaving(true);
      try {
        const body = {
          account_type: accountType,
          fio: fio.trim(),
          birth_date: birthDate.trim() ? birthDate.trim().slice(0, 10) : null,
          passport_series: passportSeries.trim(),
          passport_number: passportNumber.trim(),
          passport_issued_by: passportIssuedBy.trim(),
          passport_issue_date: passportIssueDate.trim() ? passportIssueDate.trim().slice(0, 10) : null,
          passport_registration_address: passportRegistrationAddress.trim(),
          email: email.trim(),
        };
        const response = await fetch(API_ENDPOINTS.currentUser, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const payload = response.headers.get("content-type")?.includes("application/json")
          ? await response.json()
          : null;
        if (!response.ok) {
          let msg = `Не удалось сохранить (${response.status})`;
          if (payload && typeof payload === "object") {
            if (typeof payload.detail === "string") msg = payload.detail;
            else if (Array.isArray(payload.detail)) msg = payload.detail.join("\n");
            else {
              const parts = [];
              for (const v of Object.values(payload)) {
                if (Array.isArray(v)) parts.push(...v.map(String));
                else if (typeof v === "string") parts.push(v);
              }
              if (parts.length) msg = parts.join("\n");
            }
          }
          setError(msg);
          return;
        }
        if (payload && typeof payload === "object" && "id" in payload && typeof setUser === "function") {
          setUser(payload);
        }
        await fetchUser();
        setSaved(true);
      } catch (err) {
        console.error(err);
        setError("Сетевая ошибка, попробуйте позже");
      } finally {
        setSaving(false);
      }
    },
    [
      user,
      accountType,
      fio,
      birthDate,
      passportSeries,
      passportNumber,
      passportIssuedBy,
      passportIssueDate,
      passportRegistrationAddress,
      email,
      fetchUser,
      setUser,
    ],
  );

  return (
    <div id="lk-settings-personal-page" className="lk-settings-personal-page" data-testid="lk-account-personal-page">
      <div className="page">
        <div className="page__returnButton">
          <Link className="tw-link link_primary link_s" to="/lk/settings">
            <svg xmlns="http://www.w3.org/2000/svg" width="7" height="13" fill="none" viewBox="0 0 7 13" aria-hidden="true">
              <path
                fill="currentColor"
                d="M1 6.99a1 1 0 0 1 .23-.64l4-5a1 1 0 0 1 1.54 1.29L3.29 6.99l3.32 4.35a1 1 0 0 1-.15 1.4A1 1 0 0 1 5 12.62l-3.83-5A1 1 0 0 1 1 7Z"
              />
            </svg>
            Назад
          </Link>
        </div>

        <div className="lk-settings-personal-page__header">
          <h1 className="lk-settings-personal-page__title">Личные данные</h1>
        </div>

        {loadingProfile ? <p className="lk-settings-personal-page__muted">Загрузка профиля…</p> : null}
        {!loadingProfile && !user ? (
          <p className="lk-settings-personal-page__muted">Профиль недоступен. Вернитесь в настройки и попробуйте снова.</p>
        ) : null}

        {user ? (
          <form className="lk-settings-personal-page__form" lang="ru" onSubmit={onSubmit}>
            <label className="lk-settings-personal-page__field">
              <span className="lk-settings-personal-page__field-label" id="lk-settings-account-type-label">
                Тип аккаунта
              </span>
              <LkListboxSelect
                value={accountType}
                onChange={setAccountType}
                options={ACCOUNT_TYPES}
                labelledBy="lk-settings-account-type-label"
                disabled={saving || !canSubmit}
                listboxId="lk-settings-account-type-listbox"
                dataTestId="lk-settings-account-type-select"
              />
            </label>

            <label className="lk-settings-personal-page__field">
              <span className="lk-settings-personal-page__field-label">Фамилия Имя Отчество</span>
              <input
                className="lk-settings-personal-page__control lk-settings-personal-page__control_fio"
                name="fio"
                value={fio}
                onChange={(ev) => setFio(ev.target.value)}
                autoComplete="name"
                maxLength={400}
              />
            </label>

            <label className="lk-settings-personal-page__field">
              <span className="lk-settings-personal-page__field-label" id="lk-settings-birth-date-label">
                Дата рождения
              </span>
              <div className="lk-settings-personal-page__date-wrap">
                <PersonalDatePicker
                  id="lk-settings-birth-date"
                  name="birth_date"
                  value={birthDate}
                  onChange={setBirthDate}
                  disabled={saving || !canSubmit}
                  maxDate={new Date()}
                  placeholderText="дд.мм.гггг"
                  ariaLabelledBy="lk-settings-birth-date-label"
                  portalId="lk-settings-personal-page"
                />
              </div>
            </label>

            <h2 className="lk-settings-personal-page__block-title lk-settings-personal-page__block-title_passport">Паспорт</h2>

            <div className="lk-settings-personal-page__inline-pair">
              <label className="lk-settings-personal-page__field">
                <span className="lk-settings-personal-page__field-label">Серия</span>
                <input
                  className="lk-settings-personal-page__control"
                  name="passport_series"
                  value={passportSeries}
                  onChange={(ev) => setPassportSeries(ev.target.value)}
                  maxLength={16}
                  inputMode="numeric"
                />
              </label>
              <label className="lk-settings-personal-page__field">
                <span className="lk-settings-personal-page__field-label">Номер</span>
                <input
                  className="lk-settings-personal-page__control"
                  name="passport_number"
                  value={passportNumber}
                  onChange={(ev) => setPassportNumber(ev.target.value)}
                  maxLength={32}
                  inputMode="numeric"
                />
              </label>
            </div>

            <label className="lk-settings-personal-page__field">
              <span className="lk-settings-personal-page__field-label">Выдан</span>
              <textarea
                className="lk-settings-personal-page__control lk-settings-personal-page__control_textarea"
                name="passport_issued_by"
                value={passportIssuedBy}
                onChange={(ev) => setPassportIssuedBy(ev.target.value)}
                rows={4}
              />
            </label>

            <label className="lk-settings-personal-page__field">
              <span className="lk-settings-personal-page__field-label" id="lk-settings-passport-issue-label">
                Дата выдачи
              </span>
              <div className="lk-settings-personal-page__date-wrap">
                <PersonalDatePicker
                  id="lk-settings-passport-issue-date"
                  name="passport_issue_date"
                  value={passportIssueDate}
                  onChange={setPassportIssueDate}
                  disabled={saving || !canSubmit}
                  minDate={new Date(1900, 0, 1)}
                  maxDate={new Date()}
                  placeholderText="дд.мм.гггг"
                  ariaLabelledBy="lk-settings-passport-issue-label"
                  portalId="lk-settings-personal-page"
                />
              </div>
            </label>

            <label className="lk-settings-personal-page__field">
              <span className="lk-settings-personal-page__field-label">Адрес регистрации</span>
              <textarea
                className="lk-settings-personal-page__control lk-settings-personal-page__control_textarea"
                name="passport_registration_address"
                value={passportRegistrationAddress}
                onChange={(ev) => setPassportRegistrationAddress(ev.target.value)}
                rows={3}
              />
            </label>

            <label className="lk-settings-personal-page__field">
              <span className="lk-settings-personal-page__field-label">Почта</span>
              <input
                className="lk-settings-personal-page__control"
                name="email"
                type="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                autoComplete="email"
              />
            </label>

            {error ? <div className="lk-settings-personal-error">{error}</div> : null}
            {saved && !error ? <div className="lk-settings-personal-page__saved">Изменения сохранены</div> : null}

            <div className="lk-settings-personal-page__actions">
              <button
                type="submit"
                className="baseButton button button_size_medium baseButton__size_medium baseButton__color_primary"
                disabled={saving || !canSubmit}
              >
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
