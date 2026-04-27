import "../login/login.css";
import "intl-tel-input/styles";
import "./registrationIntlTel.css";
import intlTelInput from "intl-tel-input/intlTelInputWithUtils";
import ruI18n from "intl-tel-input/i18n/ru";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../config/api";
import { LoginBrandLogo } from "../login/LoginBrandLogo";
import {
  buildSiteCtaJoinRequestBody,
  ctaContextFromURLSearchParams,
} from "./ctaQuery";
import { buildPostJoinDashboardPath } from "./postJoinNavigation";
import { formatRegistrationErrors } from "./registrationErrors";

/**
 * CTA / Tilda block → app registration query contract (MVP):
 *   ?site=<uuid> or ?site_public_id=<uuid>  — target Site.public_id
 *   ?ref=<code> or ?ref_code=<code>        — optional partner ref (same as signup body)
 * Widget builders can deep-link the SPA registration route with these params.
 */

const REGISTER_URL = API_ENDPOINTS.register;
/** Если бэкенд не прислал redirect_url — открываем вкладку «Панель» (после выдачи JWT при регистрации). */
const DEFAULT_REDIRECT = "/lk/dashboard";

/** PDF в `public/legal/` — открываются в новой вкладке. */
const LEGAL_DOC_BASE = `${process.env.PUBLIC_URL || ""}/legal`;
const REG_DOC_POLICY = `${LEGAL_DOC_BASE}/01-politika-obrabotki-personalnyh-dannyh-lumo.pdf`;
const REG_DOC_PD_CONSENT = `${LEGAL_DOC_BASE}/02-soglasie-na-obrabotku-personalnyh-dannyh-lumo.pdf`;
const REG_DOC_OFFER = `${LEGAL_DOC_BASE}/03-publichnaya-oferta-lumo.pdf`;
const REG_DOC_MAILING = `${LEGAL_DOC_BASE}/04-soglasie-na-rassylki-vsemi-vidami-lumo.pdf`;

const PHONE_COUNTRY_ORDER = [
  "ru",
  "by",
  "kz",
  "ua",
  "am",
  "az",
  "ge",
  "kg",
  "md",
  "tj",
  "tm",
  "uz",
];

function EyeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M21.92 11.6C19.9 6.91 16.1 4 12 4s-7.9 2.91-9.92 7.6a1 1 0 0 0 0 .8C4.1 17.09 7.9 20 12 20s7.9-2.91 9.92-7.6a1 1 0 0 0 0-.8ZM12 18c-3.17 0-6.17-2.29-7.9-6C5.83 8.29 8.83 6 12 6s6.17 2.29 7.9 6c-1.73 3.71-4.73 6-7.9 6Zm0-10a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.79-2.81 3.77-4.53-1.87-3.21-5.39-5.22-9.33-5.22-1.36 0-2.66.26-3.85.74l2.24 2.24c.57-.23 1.18-.37 1.85-.37zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
      />
    </svg>
  );
}

function Registration() {
  const [searchParams] = useSearchParams();
  const ctaContext = useMemo(
    () => ctaContextFromURLSearchParams(searchParams),
    [searchParams]
  );

  const [fio, setFio] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const phoneInputRef = useRef(null);
  const phoneItiRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  /** Logged-in user + CTA site: automatic join instead of signup form. */
  const [ctaJoinPhase, setCtaJoinPhase] = useState("idle");

  useEffect(() => {
    const body = buildSiteCtaJoinRequestBody(ctaContext);
    if (!body) return;
    const token = (localStorage.getItem("access_token") || "").trim();
    if (!token) return;

    let cancelled = false;
    (async () => {
      setCtaJoinPhase("loading");
      try {
        const res = await fetch(API_ENDPOINTS.siteCtaJoin, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          credentials: "include",
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 401) {
          setCtaJoinPhase("idle");
          return;
        }
        if (res.ok) {
          setCtaJoinPhase("done");
          const siteId = data.site_public_id;
          const outcome =
            data.status === "already_joined" ? "already_joined" : "joined";
          const path = buildPostJoinDashboardPath(siteId, outcome, data.site_display_label);
          window.location.href = `${window.location.origin}${path}`;
          return;
        }
        setCtaJoinPhase("error");
        setMessage(formatRegistrationErrors(data));
      } catch (err) {
        if (!cancelled) {
          console.error("Site CTA join error:", err);
          setCtaJoinPhase("error");
          setMessage("Ошибка сети или сервера. Попробуйте позже.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctaContext.site_public_id, ctaContext.ref]);

  useEffect(() => {
    const el = phoneInputRef.current;
    if (!el) return undefined;

    const syncPhoneDropdownWidth = () => {
      const wrap = el.closest(".login-page__input-wrapper");
      const root = el.closest(".iti");
      const dropdown = root?.querySelector(".iti__dropdown-content");
      if (!wrap || !dropdown) return;
      dropdown.style.width = `${wrap.offsetWidth}px`;
    };

    const iti = intlTelInput(el, {
      initialCountry: "ru",
      countryOrder: PHONE_COUNTRY_ORDER,
      separateDialCode: true,
      formatOnDisplay: true,
      formatAsYouType: true,
      countrySearch: true,
      /** Ограничение длины национальной части по правилам выбранной страны (libphonenumber). */
      strictMode: true,
      /** Иначе ширина = только поле номера, а не вся полоса как у `.login-page__input-wrapper`. */
      fixDropdownWidth: false,
      i18n: ruI18n,
      placeholderNumberType: "MOBILE",
      autoPlaceholder: "polite",
    });
    phoneItiRef.current = iti;

    el.addEventListener("open:countrydropdown", syncPhoneDropdownWidth);

    return () => {
      el.removeEventListener("open:countrydropdown", syncPhoneDropdownWidth);
      iti.destroy();
      phoneItiRef.current = null;
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const payload = { email, password };
    if (fio.trim()) payload.fio = fio.trim();

    const phoneEl = phoneInputRef.current;
    const iti = phoneItiRef.current;
    if (phoneEl && iti) {
      const nationalDigits = phoneEl.value.replace(/\D/g, "");
      if (nationalDigits.length > 0) {
        const e164Format = intlTelInput.utils?.numberFormat?.E164 ?? 0;
        let phoneOut = iti.getNumber(e164Format) || iti.getNumber() || "";
        if (phoneOut.length > 32) phoneOut = phoneOut.slice(0, 32);
        if (phoneOut) payload.phone = phoneOut;
      }
    }
    if (ctaContext.site_public_id) payload.site_public_id = ctaContext.site_public_id;
    if (ctaContext.ref) {
      payload.ref = ctaContext.ref;
      payload.ref_code = ctaContext.ref;
    }

    try {
      const res = await fetch(REGISTER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        if (data.access && data.refresh) {
          localStorage.setItem("access_token", data.access);
          localStorage.setItem("refresh_token", data.refresh);
          if (data.user) {
            localStorage.setItem("user", JSON.stringify(data.user));
          }
        }
        let redirectUrl = data.redirect_url || DEFAULT_REDIRECT;
        const cj = data.cta_join;
        const siteFromResponse = cj && cj.site_public_id;
        const siteForJoin = siteFromResponse || ctaContext.site_public_id;
        if (siteForJoin) {
          const outcome =
            cj && cj.status === "already_joined"
              ? "already_joined"
              : "joined";
          const path = buildPostJoinDashboardPath(
            siteForJoin,
            outcome,
            cj && cj.site_display_label
          );
          redirectUrl = path;
        }
        const target = redirectUrl.startsWith("http")
          ? redirectUrl
          : `${window.location.origin}${redirectUrl.startsWith("/") ? redirectUrl : "/" + redirectUrl}`;
        window.location.href = target;
        return;
      }

      if (res.status === 400 || res.status === 403) {
        setMessage(formatRegistrationErrors(data));
        setLoading(false);
        return;
      }

      const fallback = formatRegistrationErrors(data);
      setMessage(
        fallback !== "Ошибка регистрации"
          ? fallback
          : "Не удалось зарегистрироваться"
      );
    } catch (err) {
      console.error("Registration error:", err);
      setMessage("Ошибка сети или сервера. Попробуйте позже.");
    } finally {
      setLoading(false);
    }
  };

  const messageIsSuccess = message.startsWith("✅");
  const ctaBusy = ctaJoinPhase === "loading" || ctaJoinPhase === "done";
  const showForm = !ctaBusy;

  return (
    <div className="login-page registration-page">
      <div className="login-page__cloud" id="registration-cloud">
        <Link to="/" className="login-page__brand" aria-label="На главную">
          <LoginBrandLogo />
        </Link>
        <div className="login-page__wrapper">
          <div className="login-page__container">
            <div className="login-page__welcome login-page__welcome--no-avatar">
              <h1 className="login-page__title">Регистрация в LUMO</h1>
              {ctaJoinPhase === "loading" ? (
                <p className="login-page__subtitle login-page__subtitle--cta-hint">
                  Проверяем вход и подключаем к площадке…
                </p>
              ) : null}
            </div>

            {message ? (
              <div
                className={`login-page__alert ${messageIsSuccess ? "login-page__alert--success" : "login-page__alert--error"}`}
                role="alert"
              >
                {message}
              </div>
            ) : null}

            <form
              className="login-page__form"
              onSubmit={handleSubmit}
              noValidate
              style={{ display: showForm ? undefined : "none" }}
            >
              <div className="login-page__form-block">
                <p className="login-page__form-block-title">ФИО</p>
                <div className="login-page__form-block-inner">
                  <div className="login-page__input">
                    <div className="login-page__input-wrapper">
                      <input
                        className="login-page__input-field"
                        type="text"
                        id="fio"
                        name="fio"
                        autoComplete="name"
                        autoCapitalize="words"
                        value={fio}
                        onChange={(e) => setFio(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="login-page__form-block">
                <p className="login-page__form-block-title">Email</p>
                <div className="login-page__form-block-inner">
                  <div className="login-page__input">
                    <div className="login-page__input-wrapper">
                      <input
                        className="login-page__input-field"
                        type="email"
                        id="email"
                        name="email"
                        autoComplete="email"
                        autoCapitalize="none"
                        inputMode="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="login-page__form-block">
                <p className="login-page__form-block-title">Пароль</p>
                <div className="login-page__form-block-inner">
                  <div className="login-page__input login-page__input--password">
                    <div className="login-page__input-wrapper">
                      <input
                        className="login-page__input-field"
                        type={showPassword ? "text" : "password"}
                        id="password"
                        name="password"
                        autoComplete="new-password"
                        autoCapitalize="none"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className="login-page__icon-btn"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="login-page__form-block">
                <p className="login-page__form-block-title">Телефон</p>
                <div className="login-page__form-block-inner">
                  <div className="login-page__input login-page__input--phone">
                    <div className="login-page__input-wrapper">
                      <input
                        ref={phoneInputRef}
                        className="login-page__input-field"
                        type="tel"
                        id="phone"
                        name="phone"
                        autoComplete="tel"
                        inputMode="tel"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="login-page__base-button login-page__base-button_size_large login-page__base-button_color_primary login-page__login-btn"
                disabled={loading}
              >
                {loading ? "Регистрация..." : "Зарегистрироваться"}
              </button>

              <div className="login-page__consents" role="group" aria-label="Согласия">
                <label className="login-page__consent-row">
                  <input
                    type="checkbox"
                    className="login-page__consent-checkbox"
                    name="accept_personal_data"
                    required
                    defaultChecked
                  />
                  <span className="login-page__consent-label">
                    Я ознакомлен(а) с{" "}
                    <a
                      href={REG_DOC_POLICY}
                      className="login-page__consent-link"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Политика обработки персональных данных (PDF)"
                    >
                      политикой
                    </a>
                    ,{" "}
                    <a
                      href={REG_DOC_OFFER}
                      className="login-page__consent-link"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Публичная оферта (PDF)"
                    >
                      офертой
                    </a>{" "}
                    и даю{" "}
                    <a
                      href={REG_DOC_PD_CONSENT}
                      className="login-page__consent-link"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Согласие на обработку персональных данных (PDF)"
                    >
                      согласие
                    </a>{" "}
                    на обработку персональных данных
                  </span>
                </label>
                <label className="login-page__consent-row">
                  <input
                    type="checkbox"
                    className="login-page__consent-checkbox"
                    name="accept_mailing"
                    defaultChecked
                  />
                  <span className="login-page__consent-label">
                    Я даю{" "}
                    <a
                      href={REG_DOC_MAILING}
                      className="login-page__consent-link"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Согласие на получение рассылок (PDF)"
                    >
                      согласие
                    </a>{" "}
                    на получение информационных рассылок
                  </span>
                </label>
              </div>
            </form>

            <p className="login-page__footer">
              Уже есть аккаунт?{" "}
              <Link to="/login" className="login-page__footer-link">
                Войти
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Registration;
