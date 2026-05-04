import "./login.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../config/api";
import {
  authenticationCredentialToJSON,
  preparePublicKeyCredentialRequestOptions,
  webAuthnSupported,
} from "../../utils/webauthnBrowser";
import { LoginBrandLogo } from "./LoginBrandLogo";

/** Сообщения ответа DRF/JWT — отображаем по-русски */
function translateLoginApiMessage(text) {
  const raw = String(text ?? "").trim();
  const known = {
    "This field may not be blank.": "Это поле обязательно для заполнения.",
    "This field is required.": "Это поле обязательно для заполнения.",
    "Enter a valid email address.": "Введите корректный email.",
    "Ensure this field has no more than 254 characters.": "Не более 254 символов.",
    "No active account found with the given credentials.": "Неверный email или пароль.",
  };
  if (known[raw]) return known[raw];
  if (/may not be blank/i.test(raw)) return "Это поле обязательно для заполнения.";
  if (/\bis required\b/i.test(raw)) return "Это поле обязательно для заполнения.";
  return raw;
}

function loginFieldLabelRu(key) {
  if (key === "email") return "Логин или емейл";
  if (key === "password") return "Пароль";
  if (key === "non_field_errors") return "";
  return key;
}

function vkErrorMessageRu(code) {
  const byCode = {
    vk_oauth_not_configured: "Вход через VK не настроен на сервере.",
    vk_oauth_denied: "Вход через VK отменён.",
    vk_oauth_invalid_callback: "Некорректный ответ VK. Попробуйте войти снова.",
    vk_state_invalid: "Сессия входа VK устарела. Откройте вход снова с этой страницы.",
    vk_token_exchange_failed: "Не удалось завершить вход через VK. Попробуйте позже.",
    vk_missing_device_id: "Ответ VK неполный. Откройте вход снова с этой страницы.",
    vk_email_fetch_failed: "Не удалось получить профиль VK. Попробуйте позже.",
    vk_email_missing: "VK не передал email. Разрешите доступ к email в окне VK или привяжите email в настройках VK.",
    vk_email_not_registered:
      "Нет аккаунта с этим email. Зарегистрируйтесь или войдите по паролю.",
    account_disabled: "Аккаунт отключён.",
  };
  return byCode[code] || "";
}

function telegramErrorMessageRu(code) {
  const byCode = {
    tg_oauth_not_configured: "Вход через Telegram не настроен на сервере.",
    tg_auth_invalid: "Не удалось подтвердить вход Telegram. Откройте вход снова.",
    tg_widget_payload_missing: "Не получены данные Telegram. Обновите страницу и попробуйте снова.",
    tg_widget_payload_invalid: "Некорректный ответ Telegram. Попробуйте войти снова.",
    account_disabled: "Аккаунт отключён.",
  };
  return byCode[code] || "";
}

function formatLoginApiErrors(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.code === "string" && data.code.startsWith("passkey_")) {
    const byCode = {
      passkey_email_required: "Укажите email в поле выше.",
      passkey_challenge_required: "Сессия Passkey не начата. Обновите страницу.",
      passkey_credential_required: "Не получен ответ от устройства.",
      passkey_challenge_expired: "Время на вход истекло. Нажмите Passkey снова.",
      passkey_email_mismatch: "Email не совпадает с начатым входом.",
      passkey_email_not_registered: "Нет аккаунта с этим email.",
      passkey_not_registered: "Для этого аккаунта нет Passkey. Войдите по паролю и добавьте ключ в настройках.",
      passkey_origin_not_allowed: "Origin не разрешён для Passkey (проверьте WEBAUTHN_* на сервере).",
      passkey_origin_missing: "Запрос без Origin — откройте сайт в браузере.",
      passkey_unknown_credential: "Этот ключ не привязан к аккаунту.",
      passkey_verification_failed: "Не удалось подтвердить Passkey. Попробуйте снова.",
      passkey_credential_invalid: "Некорректный ответ устройства.",
    };
    if (byCode[data.code]) return byCode[data.code];
  }
  if (typeof data.code === "string" && data.code.startsWith("google_")) {
    const byCode = {
      google_oauth_not_configured: "Вход через Google не настроен на сервере.",
      google_credential_missing: "Не получен ответ от Google. Попробуйте снова.",
      google_token_invalid: "Не удалось проверить вход Google. Обновите страницу и попробуйте снова.",
      google_email_missing: "В аккаунте Google нет подходящего email.",
      google_email_not_verified: "Подтвердите email в Google и попробуйте снова.",
      google_email_not_registered:
        "Нет аккаунта с этим email. Зарегистрируйтесь или войдите по паролю.",
      account_disabled: "Аккаунт отключён.",
    };
    if (byCode[data.code]) return byCode[data.code];
  }
  if (data.detail != null && data.detail !== "") {
    if (typeof data.detail === "string") {
      return translateLoginApiMessage(data.detail);
    }
    if (Array.isArray(data.detail)) {
      return data.detail
        .map((x) => (typeof x === "string" ? translateLoginApiMessage(x) : String(x)))
        .join("\n")
        .trim();
    }
  }

  const lines = [];
  for (const key of Object.keys(data)) {
    if (key === "detail") continue;
    const val = data[key];
    const label = loginFieldLabelRu(key);
    if (Array.isArray(val)) {
      const text = val.map(translateLoginApiMessage).join(" ");
      if (label) lines.push(`${label}: ${text}`);
      else lines.push(text);
    } else if (typeof val === "string") {
      const msg = translateLoginApiMessage(val);
      if (label) lines.push(`${label}: ${msg}`);
      else lines.push(msg);
    }
  }
  return lines.join("\n").trim();
}

function LoginWelcomeAvatarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={60}
      height={60}
      fill="none"
      viewBox="0 0 24 24"
      className="login-page__avatar-svg"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2Zm0 5c1.7 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.3-3 3-3Zm0 13c-2.2 0-4.3-.9-5.8-2.5a6.94 6.94 0 0 1 11.5 0A7.56 7.56 0 0 1 12 20Z"
      />
    </svg>
  );
}

const LOGIN_RETURNING_KEY = "lumo_login_returning";
const LOGIN_DISPLAY_NAME_KEY = "lumo_login_display_name";
const RECOVER_CODE_LENGTH = 6;

function normalizeRecoverCode(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, RECOVER_CODE_LENGTH);
}

function loginGivenName(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const parts = text.split(/\s+/);
  return parts.length > 1 ? parts[1] : parts[0];
}

function readLoginWelcomeFromStorage() {
  try {
    if (localStorage.getItem(LOGIN_RETURNING_KEY) !== "1") {
      return { returning: false, name: null };
    }
    const name = loginGivenName(localStorage.getItem(LOGIN_DISPLAY_NAME_KEY));
    return { returning: true, name: name || null };
  } catch {
    return { returning: false, name: null };
  }
}

function pickLoginDisplayName(user) {
  if (!user || typeof user !== "object") return "";
  const first = (user.first_name || "").trim();
  if (first) return first;
  const fio = (user.fio || "").trim();
  if (fio) return loginGivenName(fio);
  const email = (user.email || "").trim();
  if (email) {
    const local = email.split("@")[0];
    return local || email;
  }
  return "";
}

/** Для VK/TG OAuth вне страницы Login — см. `OAuthVkTgFragmentHandler`. */
export function persistReturningUserWelcome(user) {
  if (!user || typeof user !== "object") return;
  const displayName = pickLoginDisplayName(user);
  try {
    localStorage.setItem(LOGIN_RETURNING_KEY, "1");
    if (displayName) {
      localStorage.setItem(LOGIN_DISPLAY_NAME_KEY, displayName);
    }
  } catch {
    /* ignore */
  }
}

function PasskeyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#454CEE"
        d="M8.08 10.43a3.84 3.84 0 1 0 0-7.68 3.84 3.84 0 0 0 0 7.68Zm10.23 0a2.99 2.99 0 1 0-4.26 2.68v4.57l1.28 1.28 2.13-2.14-1.28-1.28 1.28-1.27-1.06-1.06a2.98 2.98 0 0 0 1.91-2.78Zm-2.98 0a.85.85 0 1 1 0-1.7.85.85 0 0 1 0 1.7Zm-3.89 1.72a5.12 5.12 0 0 0-2.08-.44H6.8a5.12 5.12 0 0 0-5.11 5.11v1.7h11.08v-4.69a4.4 4.4 0 0 1-1.33-1.68Z"
      />
    </svg>
  );
}

/** Иконка ошибки входа по Passkey (человек + ключ + бейдж с крестиком). */
function PasskeyAuthErrorIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={49}
      height={45}
      fill="none"
      viewBox="0 0 49 45"
      className="login-page__passkey-error-icon-svg"
      aria-hidden
    >
      <path
        fill="#454CEE"
        d="M22.78 21.2a8.44 8.44 0 1 0 0-16.88 8.44 8.44 0 0 0 0 16.89Zm22.52 0a6.57 6.57 0 1 0-9.39 5.92v10.04l2.82 2.81 4.69-4.7-2.82-2.8 2.82-2.82-2.33-2.33a6.57 6.57 0 0 0 4.2-6.11Zm-6.57 0a1.88 1.88 0 1 1 0-3.75 1.88 1.88 0 0 1 0 3.76ZM30.17 25c-1.44-.64-3-.98-4.58-.98h-5.63A11.26 11.26 0 0 0 8.71 35.28v3.75H33.1V28.7a9.68 9.68 0 0 1-2.93-3.7Z"
      />
      <rect width="14.44" height="14.44" x="3" y="28" fill="#EA4335" rx="7.22" />
      <path
        fill="#fff"
        d="m10.74 35.22 2.35-2.34a.37.37 0 1 0-.53-.53l-2.34 2.34-2.34-2.34a.37.37 0 1 0-.53.53l2.34 2.34-2.34 2.34a.37.37 0 0 0 .12.61.37.37 0 0 0 .4-.08l2.35-2.35 2.34 2.35a.37.37 0 1 0 .53-.53l-2.35-2.34Z"
      />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#2AABEE"
        d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
      />
    </svg>
  );
}

function VkIcon() {
  /* Синяя «плитка» и белый знак из исходного монолитного path; кнопка как у остальных социконок. */
  const vkTileBlue =
    "M15.684 0H8.316C1.592 0 0 1.592 0 8.316v7.368C0 22.408 1.592 24 8.316 24h7.368C22.408 24 24 22.408 24 15.684V8.316C24 1.592 22.391 0 15.684 0z";
  /* После внешнего контура `z` в оригинале был `m3.692 17.123` от (15.684,0) → (19.376,17.123). */
  const vkMarkWhite =
    "M19.376 17.123h-1.744c-.66 0-.862-.523-2.049-1.714-1.033-1-1.49-1.135-1.745-1.135-.356 0-.458.102-.458.593v1.575c0 .422-.135.678-1.253.678-1.846 0-3.896-1.117-5.339-3.179C4.832 10.984 4.351 9.227 4.351 8.863c0-.254.102-.491.593-.491h1.744c.44 0 .61.203.78.678.863 2.462 2.303 4.623 2.896 4.623.135 0 .203-.068.203-.44V9.773c-.068-1.186-.695-1.287-.695-1.71 0-.203.17-.407.44-.407h2.744c.373 0 .508.203.508.643v2.896c0 .372.17.508.271.508.135 0 .254-.102.508-.407 1.253-1.71 2.15-4.35 2.15-4.35.169-.305.44-.458.847-.458h1.744c.525 0 .644.27.525.847-.203.966-2.128 3.81-2.128 3.81-.356.593-.458.695 0 1.287 0 0 1.744 2.314 2.049 3.81.102.525-.102.78-.593.78z";
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path fill="#0077ff" d={vkTileBlue} />
      <path fill="#ffffff" d={vkMarkWhite} />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

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

function loadGoogleIdentityScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("no_window"));
      return;
    }
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const existing = document.querySelector("script[data-lumo-gis='1']");
    if (existing) {
      const done = () => {
        if (window.google?.accounts?.id) resolve();
        else reject(new Error("gis_unavailable"));
      };
      if (window.google?.accounts?.id) {
        resolve();
      } else {
        existing.addEventListener("load", done, { once: true });
        existing.addEventListener("error", () => reject(new Error("gis_load_failed")), { once: true });
      }
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.dataset.lumoGis = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("gis_load_failed"));
    document.head.appendChild(s);
  });
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passkeyErrorScreen, setPasskeyErrorScreen] = useState(false);
  const [showRecoverAccess, setShowRecoverAccess] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState("");
  const [captchaKey, setCaptchaKey] = useState("");
  const [captchaImageSrc, setCaptchaImageSrc] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [captchaLoading, setCaptchaLoading] = useState(false);
  /** Восстановление: шаг 1 (email+капча) → шаг 2 (код+пароли) → success */
  const [recoverPhase, setRecoverPhase] = useState("step1");
  const [recoverConfirmError, setRecoverConfirmError] = useState("");
  const [recoverCode, setRecoverCode] = useState("");
  const [recoverCodeVerified, setRecoverCodeVerified] = useState(false);
  const [recoverNewPassword, setRecoverNewPassword] = useState("");
  const [recoverNewPassword2, setRecoverNewPassword2] = useState("");
  const [showRecoverNewPassword, setShowRecoverNewPassword] = useState(false);
  const [showRecoverNewPassword2, setShowRecoverNewPassword2] = useState(false);
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const [recoverResendExpanded, setRecoverResendExpanded] = useState(false);
  const [{ returning: isReturningUser, name: storedWelcomeName }] = useState(() => readLoginWelcomeFromStorage());
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const googleCredentialHandlerRef = useRef(() => {});
  const recoverCodeInputRefs = useRef([]);

  googleCredentialHandlerRef.current = async (credentialResponse) => {
    const cred = credentialResponse?.credential;
    if (!cred) {
      setLoading(false);
      return;
    }
    setMessage("");
    try {
      const response = await fetch(API_ENDPOINTS.tokenGoogle, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: cred }),
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) {
        const errorMsg = formatLoginApiErrors(data);
        setMessage(errorMsg || "Не удалось войти через Google.");
        setLoading(false);
        return;
      }

      localStorage.setItem("access_token", data.access);
      localStorage.setItem("refresh_token", data.refresh);
      if (data.user) {
        localStorage.setItem("user", JSON.stringify(data.user));
      }
      persistReturningUserWelcome(data.user);

      setMessage("✅ Вход выполнен!");
      navigate("/lk/partner");
    } catch (err) {
      console.error("Google login:", err);
      setMessage("Произошла ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  };

  /** Системный диалог Passkey (Windows Hello и др.) после «Отмена» может вернуть фокус с задержкой; flushSync гарантирует показ экрана ошибки сразу. */
  const showPasskeyFailureScreen = () => {
    flushSync(() => {
      setMessage("");
      setPasskeyErrorScreen(true);
      setLoading(false);
    });
    window.scrollTo(0, 0);
  };

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const res = await fetch(API_ENDPOINTS.passwordResetCaptcha, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error("captcha_fetch");
      }
      setCaptchaKey(typeof data.captcha_key === "string" ? data.captcha_key : "");
      setCaptchaImageSrc(typeof data.image_base64 === "string" ? data.image_base64 : "");
      setCaptchaCode("");
    } catch {
      setMessage("Не удалось загрузить капчу. Обновите страницу.");
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  const resetRecoverWizard = useCallback(() => {
    setRecoverPhase("step1");
    setRecoverConfirmError("");
    setRecoverCode("");
    setRecoverCodeVerified(false);
    setRecoverNewPassword("");
    setRecoverNewPassword2("");
    setShowRecoverNewPassword(false);
    setShowRecoverNewPassword2(false);
    setResendCooldownSec(0);
    setRecoverResendExpanded(false);
    setCaptchaCode("");
    setMessage("");
  }, []);

  useEffect(() => {
    if (resendCooldownSec <= 0) return undefined;
    const t = setTimeout(() => {
      setResendCooldownSec((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearTimeout(t);
  }, [resendCooldownSec]);

  useEffect(() => {
    if (!showRecoverAccess) return undefined;
    loadCaptcha();
    return undefined;
  }, [showRecoverAccess, loadCaptcha]);

  useEffect(() => {
    const vkErr = searchParams.get("vk_error");
    const tgErr = searchParams.get("tg_error");
    const code = vkErr || tgErr;
    if (!code) return undefined;
    const text = vkErr ? vkErrorMessageRu(code) || code : telegramErrorMessageRu(code) || code;
    setMessage(text);
    const next = new URLSearchParams(searchParams);
    next.delete("vk_error");
    next.delete("tg_error");
    setSearchParams(next, { replace: true });
    return undefined;
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!clientId) return undefined;

    let cancelled = false;
    (async () => {
      try {
        await loadGoogleIdentityScript();
        if (cancelled || typeof window === "undefined" || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp) => googleCredentialHandlerRef.current(resp),
        });
      } catch {
        /* script optional until user clicks; retry on click if needed */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleGoogleClick = async () => {
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setMessage(
        "Вход через Google не настроен: задайте REACT_APP_GOOGLE_CLIENT_ID (тот же Web client ID, что и GOOGLE_OAUTH_CLIENT_ID на сервере).",
      );
      return;
    }
    setMessage("");
    try {
      if (typeof window === "undefined" || !window.google?.accounts?.id) {
        await loadGoogleIdentityScript();
      }
      if (typeof window === "undefined" || !window.google?.accounts?.id) {
        setMessage("Не удалось загрузить вход Google. Проверьте сеть и обновите страницу.");
        return;
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => googleCredentialHandlerRef.current(resp),
      });
    } catch {
      setMessage("Не удалось загрузить скрипт Google. Попробуйте позже.");
      return;
    }

    setLoading(true);
    window.google.accounts.id.prompt((notification) => {
      if (notification.isDismissedMoment?.() || notification.isSkippedMoment?.()) {
        setLoading(false);
      }
      if (notification.isNotDisplayed?.()) {
        setLoading(false);
        const reason = notification.getNotDisplayedReason?.();
        const hints = {
          unregistered_domain:
            "Этот сайт не указан в «Authorized JavaScript origins» в Google Cloud Console.",
          invalid_client: "Неверный Google Client ID (REACT_APP_GOOGLE_CLIENT_ID).",
          missing_client_id: "Не задан Google Client ID.",
        };
        if (reason && hints[reason]) {
          setMessage(hints[reason]);
        }
      }
    });
  };

  const handleVkClick = () => {
    setMessage("");
    window.location.assign(API_ENDPOINTS.tokenVkStart);
  };

  const handleTelegramClick = () => {
    setMessage("");
    window.location.assign(API_ENDPOINTS.tokenTelegramStart);
  };

  const handlePasskeyClick = async () => {
    setPasskeyErrorScreen(false);
    const emailRaw = email.trim();
    /** С email — только passkeys этого аккаунта (старые ключи без discoverable). Без email — выбор ключа в системе (Windows / телефон и т.д.). */
    const useLegacyEmailFlow = Boolean(emailRaw);
    if (!webAuthnSupported()) {
      showPasskeyFailureScreen();
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const ro = await fetch(API_ENDPOINTS.tokenPasskeyLoginOptions, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(useLegacyEmailFlow ? { email: emailRaw } : {}),
        credentials: "include",
      });
      const roData = await ro.json().catch(() => ({}));
      if (!ro.ok) {
        showPasskeyFailureScreen();
        return;
      }
      const publicKey = preparePublicKeyCredentialRequestOptions(roData.options);
      if (!publicKey) {
        showPasskeyFailureScreen();
        return;
      }
      let assertion;
      try {
        assertion = await navigator.credentials.get({ publicKey });
      } catch {
        showPasskeyFailureScreen();
        return;
      }
      if (!assertion || assertion.type !== "public-key") {
        showPasskeyFailureScreen();
        return;
      }
      const credentialPayload = authenticationCredentialToJSON(assertion);
      if (!credentialPayload) {
        showPasskeyFailureScreen();
        return;
      }
      const verifyBody = {
        challenge_key: roData.challenge_key,
        credential: credentialPayload,
      };
      if (useLegacyEmailFlow) {
        verifyBody.email = emailRaw;
      }
      const vr = await fetch(API_ENDPOINTS.tokenPasskeyLoginVerify, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(verifyBody),
        credentials: "include",
      });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok) {
        showPasskeyFailureScreen();
        return;
      }
      localStorage.setItem("access_token", vd.access);
      localStorage.setItem("refresh_token", vd.refresh);
      if (vd.user) {
        localStorage.setItem("user", JSON.stringify(vd.user));
      }
      persistReturningUserWelcome(vd.user);
      setMessage("✅ Вход выполнен!");
      navigate("/lk/partner");
    } catch (err) {
      console.error("Passkey login:", err);
      showPasskeyFailureScreen();
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(API_ENDPOINTS.passwordResetCodeRequest, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: recoverEmail.trim(),
          captcha_key: captchaKey,
          captcha: captchaCode.trim(),
        }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errText =
          formatLoginApiErrors(data) ||
          (typeof data.detail === "string" ? data.detail : "") ||
          "Не удалось отправить запрос.";
        setMessage(errText);
        if (data.code === "captcha_invalid" || data.code === "captcha_expired") {
          await loadCaptcha();
        }
        setLoading(false);
        return;
      }
      setMessage("");
      setRecoverPhase("step2");
      setResendCooldownSec(60);
      setRecoverResendExpanded(false);
      setRecoverConfirmError("");
      setRecoverCodeVerified(false);
    } catch (err) {
      console.error("Recover password:", err);
      setMessage("Произошла ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  };

  const focusRecoverCodeInput = (index) => {
    recoverCodeInputRefs.current[index]?.focus();
  };

  const resetRecoverCodeVerification = () => {
    setRecoverCodeVerified(false);
    setRecoverNewPassword("");
    setRecoverNewPassword2("");
    setShowRecoverNewPassword(false);
    setShowRecoverNewPassword2(false);
  };

  const updateRecoverCodeAt = (index, value) => {
    resetRecoverCodeVerification();
    const incoming = normalizeRecoverCode(value);
    const chars = recoverCode.padEnd(RECOVER_CODE_LENGTH, " ").slice(0, RECOVER_CODE_LENGTH).split("");
    if (!incoming) {
      chars[index] = " ";
      setRecoverCode(chars.join("").replace(/\s/g, ""));
      return;
    }
    incoming.split("").forEach((char, offset) => {
      const targetIndex = index + offset;
      if (targetIndex < RECOVER_CODE_LENGTH) {
        chars[targetIndex] = char;
      }
    });
    setRecoverCode(chars.join("").replace(/\s/g, ""));
    focusRecoverCodeInput(Math.min(index + incoming.length, RECOVER_CODE_LENGTH - 1));
  };

  const handleRecoverCodePaste = (index, e) => {
    const pasted = normalizeRecoverCode(e.clipboardData.getData("text"));
    if (!pasted) return;
    e.preventDefault();
    resetRecoverCodeVerification();
    if (pasted.length >= RECOVER_CODE_LENGTH) {
      setRecoverCode(pasted);
      focusRecoverCodeInput(RECOVER_CODE_LENGTH - 1);
      return;
    }
    updateRecoverCodeAt(index, pasted);
  };

  const handleRecoverCodeKeyDown = (index, e) => {
    if (e.key !== "Backspace" || recoverCode[index] || index <= 0) return;
    e.preventDefault();
    resetRecoverCodeVerification();
    const chars = recoverCode.padEnd(RECOVER_CODE_LENGTH, " ").slice(0, RECOVER_CODE_LENGTH).split("");
    chars[index - 1] = " ";
    setRecoverCode(chars.join("").replace(/\s/g, ""));
    focusRecoverCodeInput(index - 1);
  };

  const handleRecoverConfirmSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setRecoverConfirmError("");
    try {
      if (!recoverCodeVerified) {
        const res = await fetch(API_ENDPOINTS.passwordResetCodeVerify, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: recoverEmail.trim(),
            code: recoverCode.trim(),
          }),
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errText =
            formatLoginApiErrors(data) ||
            (typeof data.detail === "string" ? data.detail : "") ||
            "Не удалось проверить код.";
          setRecoverConfirmError(errText);
          setLoading(false);
          return;
        }
        setRecoverCodeVerified(true);
        setLoading(false);
        return;
      }

      const res = await fetch(API_ENDPOINTS.passwordResetCodeConfirm, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: recoverEmail.trim(),
          code: recoverCode.trim(),
          new_password: recoverNewPassword,
          new_password_confirm: recoverNewPassword2,
        }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errText =
          formatLoginApiErrors(data) ||
          (typeof data.detail === "string" ? data.detail : "") ||
          "Не удалось сменить пароль.";
        setRecoverConfirmError(errText);
        setLoading(false);
        return;
      }
      setRecoverPhase("success");
    } catch (err) {
      console.error("Recover confirm:", err);
      setRecoverConfirmError("Произошла ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverResendSubmit = async (e) => {
    e.preventDefault();
    if (!recoverResendExpanded) return;
    setLoading(true);
    setRecoverConfirmError("");
    try {
      const res = await fetch(API_ENDPOINTS.passwordResetCodeRequest, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: recoverEmail.trim(),
          captcha_key: captchaKey,
          captcha: captchaCode.trim(),
        }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errText =
          formatLoginApiErrors(data) ||
          (typeof data.detail === "string" ? data.detail : "") ||
          "Не удалось отправить код.";
        setRecoverConfirmError(errText);
        if (data.code === "captcha_invalid" || data.code === "captcha_expired") {
          await loadCaptcha();
        }
        setLoading(false);
        return;
      }
      setResendCooldownSec(60);
      setRecoverResendExpanded(false);
      setRecoverCode("");
      resetRecoverCodeVerification();
      setCaptchaCode("");
    } catch (err) {
      console.error("Recover resend:", err);
      setRecoverConfirmError("Произошла ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(API_ENDPOINTS.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = formatLoginApiErrors(data);
        setMessage(errorMsg || "Не удалось войти. Проверьте данные и попробуйте снова.");
        setLoading(false);
        return;
      }

      localStorage.setItem("access_token", data.access);
      localStorage.setItem("refresh_token", data.refresh);
      if (data.user) {
        localStorage.setItem("user", JSON.stringify(data.user));
      }
      persistReturningUserWelcome(data.user);

      setMessage("✅ Вход выполнен!");
      setEmail("");
      setPassword("");

      navigate("/lk/partner");
    } catch (error) {
      console.error("Ошибка при логине:", error);
      setMessage("Произошла ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  };

  const messageIsSuccess = message.startsWith("✅");

  return (
    <div className="login-page">
      <div className="login-page__cloud" id="login-cloud">
        <Link to="/" className="login-page__brand" aria-label="На главную">
          <LoginBrandLogo />
        </Link>
        {passkeyErrorScreen ? (
          <div
            className="login-page__passkey-error"
            role="alert"
            aria-live="assertive"
          >
            <div className="login-page__passkey-error-inner">
              <PasskeyAuthErrorIcon />
              <h1 className="login-page__passkey-error-title">Ошибка авторизации</h1>
              <p className="login-page__passkey-error-text">
                Проверьте, было ли добавлено устройство в личном кабинете, и убедитесь, что функция распознавания на
                нем работает. Если ничего не помогло, войдите другим способом
              </p>
              <button
                type="button"
                className="login-page__base-button login-page__base-button_size_large login-page__base-button_color_primary login-page__passkey-error-primary"
                onClick={() => setPasskeyErrorScreen(false)}
              >
                Войти другим способом
              </button>
              <button type="button" className="login-page__passkey-error-retry" onClick={() => void handlePasskeyClick()}>
                Попробовать повторно
              </button>
            </div>
          </div>
        ) : (
        <div className="login-page__wrapper">
          <div className="login-page__container">
            {showRecoverAccess ? (
              <>
                {recoverPhase === "success" ? (
                  <>
                    <div className="login-page__welcome login-page__welcome--recover">
                      <h1 className="login-page__title">Восстановление доступа</h1>
                    </div>
                    <div className="login-page__alert login-page__alert--success" role="status">
                      Пароль успешно изменён.
                    </div>
                    <button
                      type="button"
                      className="login-page__base-button login-page__base-button_size_large login-page__base-button_color_primary login-page__login-btn"
                      onClick={() => {
                        setShowRecoverAccess(false);
                        resetRecoverWizard();
                      }}
                    >
                      Вернуться к авторизации
                    </button>
                  </>
                ) : recoverPhase === "step2" ? (
                  <>
                    <div className="login-page__welcome login-page__welcome--recover">
                      <h1 className="login-page__title">Восстановление доступа</h1>
                    </div>
                    <p className="login-page__recover-step2-intro">
                      Если аккаунт существует, мы отправили код восстановления на почту
                      {recoverEmail.trim() ? (
                        <>
                          {" "}
                          <span className="login-page__recover-email-hint">{recoverEmail.trim()}</span>
                        </>
                      ) : null}
                      .
                    </p>

                    <form className="login-page__form" onSubmit={handleRecoverConfirmSubmit} noValidate>
                      <div className="login-page__form-block">
                        <p className="login-page__form-block-title">Код из письма</p>
                        <div className="login-page__form-block-inner">
                          <div className="login-page__recover-code" role="group" aria-label="Код из письма">
                            {Array.from({ length: RECOVER_CODE_LENGTH }).map((_, index) => (
                              <input
                                key={index}
                                ref={(node) => {
                                  recoverCodeInputRefs.current[index] = node;
                                }}
                                className="login-page__recover-code-input"
                                type="text"
                                id={index === 0 ? "recover-mail-code" : undefined}
                                name={index === 0 ? "recover-mail-code" : undefined}
                                autoComplete={index === 0 ? "one-time-code" : "off"}
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={RECOVER_CODE_LENGTH}
                                value={recoverCode[index] || ""}
                                onChange={(e) => updateRecoverCodeAt(index, e.target.value)}
                                onPaste={(e) => handleRecoverCodePaste(index, e)}
                                onKeyDown={(e) => handleRecoverCodeKeyDown(index, e)}
                                aria-label={`Символ ${index + 1} из ${RECOVER_CODE_LENGTH}`}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                      {recoverCodeVerified ? (
                        <>
                          <div className="login-page__form-block">
                            <p className="login-page__form-block-title">Новый пароль</p>
                            <div className="login-page__form-block-inner">
                              <div className="login-page__input login-page__input--password">
                                <div className="login-page__input-wrapper">
                                  <input
                                    className="login-page__input-field"
                                    type={showRecoverNewPassword ? "text" : "password"}
                                    id="recover-new-password"
                                    name="recover-new-password"
                                    autoComplete="new-password"
                                    value={recoverNewPassword}
                                    onChange={(e) => setRecoverNewPassword(e.target.value)}
                                  />
                                  <button
                                    type="button"
                                    className="login-page__icon-btn"
                                    onClick={() => setShowRecoverNewPassword((v) => !v)}
                                    aria-label={showRecoverNewPassword ? "Скрыть новый пароль" : "Показать новый пароль"}
                                  >
                                    {showRecoverNewPassword ? <EyeOffIcon /> : <EyeIcon />}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="login-page__form-block">
                            <p className="login-page__form-block-title">Повторите пароль</p>
                            <div className="login-page__form-block-inner">
                              <div className="login-page__input login-page__input--password">
                                <div className="login-page__input-wrapper">
                                  <input
                                    className="login-page__input-field"
                                    type={showRecoverNewPassword2 ? "text" : "password"}
                                    id="recover-new-password2"
                                    name="recover-new-password2"
                                    autoComplete="new-password"
                                    value={recoverNewPassword2}
                                    onChange={(e) => setRecoverNewPassword2(e.target.value)}
                                  />
                                  <button
                                    type="button"
                                    className="login-page__icon-btn"
                                    onClick={() => setShowRecoverNewPassword2((v) => !v)}
                                    aria-label={showRecoverNewPassword2 ? "Скрыть повтор пароля" : "Показать повтор пароля"}
                                  >
                                    {showRecoverNewPassword2 ? <EyeOffIcon /> : <EyeIcon />}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : null}

                      {recoverConfirmError ? (
                        <div
                          className="login-page__alert login-page__alert--error login-page__recover-confirm-error"
                          role="alert"
                        >
                          {recoverConfirmError}
                        </div>
                      ) : null}

                      <button
                        type="submit"
                        className="login-page__base-button login-page__base-button_size_large login-page__base-button_color_primary login-page__login-btn"
                        disabled={loading}
                      >
                        {loading ? (recoverCodeVerified ? "Сохранение..." : "Проверка...") : recoverCodeVerified ? "Сменить пароль" : "Проверить код"}
                      </button>
                    </form>

                    <div className="login-page__recover-resend">
                      {resendCooldownSec > 0 ? (
                        <p className="login-page__recover-resend-muted">
                          Повторная отправка через {resendCooldownSec} сек.
                        </p>
                      ) : !recoverResendExpanded ? (
                        <button
                          type="button"
                          className="login-page__recover-footer-link login-page__recover-resend-trigger"
                          onClick={() => {
                            setRecoverConfirmError("");
                            setRecoverResendExpanded(true);
                            setRecoverCode("");
                            resetRecoverCodeVerification();
                            void loadCaptcha();
                            setCaptchaCode("");
                          }}
                          disabled={loading || captchaLoading}
                        >
                          Отправить код повторно
                        </button>
                      ) : (
                        <form className="login-page__form login-page__recover-resend-form" onSubmit={handleRecoverResendSubmit} noValidate>
                          <p className="login-page__form-block-title">Введите код с картинки</p>
                          <div className="login-page__form-block-inner login-page__form-block-inner--captcha">
                            <div className="login-page__captcha-visual">
                              <div className="login-page__captcha-frame">
                                {captchaImageSrc ? (
                                  <img
                                    src={captchaImageSrc}
                                    alt=""
                                    className="login-page__captcha-img"
                                  />
                                ) : (
                                  <div className="login-page__captcha-skel" aria-hidden />
                                )}
                                <button
                                  type="button"
                                  className="login-page__captcha-refresh"
                                  onClick={() => void loadCaptcha()}
                                  disabled={captchaLoading || loading}
                                  aria-label="Обновить капчу"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20" aria-hidden>
                                    <path
                                      fill="#454CEE"
                                      fillRule="evenodd"
                                      d="M4 2a1 1 0 0 1 1 1v2.1a7 7 0 0 1 11.6 2.57 1 1 0 1 1-1.88.66A5 5 0 0 0 6 7h3a1 1 0 0 1 0 2H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm0 9.06a1 1 0 0 1 1.28.6A5 5 0 0 0 14 13h-3a1 1 0 0 1 0-2h5a1 1 0 0 1 1 1v5a1 1 0 0 1-2 0v-2.1a7 7 0 0 1-11.6-2.57 1 1 0 0 1 .6-1.27Z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </div>
                            <div className="login-page__input">
                              <div className="login-page__input-wrapper">
                                <input
                                  className="login-page__input-field"
                                  type="text"
                                  id="recover-resend-captcha"
                                  name="recover_resend_captcha"
                                  autoComplete="off"
                                  autoCapitalize="none"
                                  value={captchaCode}
                                  onChange={(e) => setCaptchaCode(e.target.value)}
                                  placeholder="Код с картинки"
                                />
                              </div>
                            </div>
                          </div>
                          <button
                            type="submit"
                            className="login-page__base-button login-page__base-button_size_large login-page__base-button_color_primary login-page__login-btn"
                            disabled={loading || captchaLoading}
                          >
                            {loading ? "Отправка..." : "Отправить код повторно"}
                          </button>
                        </form>
                      )}
                    </div>

                    <p className="login-page__recover-footer-text">
                      Есть аккаунт?{" "}
                      <button
                        type="button"
                        className="login-page__recover-footer-link"
                        onClick={() => {
                          setShowRecoverAccess(false);
                          resetRecoverWizard();
                        }}
                      >
                        Вернуться к авторизации
                      </button>
                    </p>
                  </>
                ) : (
                  <>
                    <div className="login-page__welcome login-page__welcome--recover">
                      <h1 className="login-page__title">Восстановление доступа</h1>
                    </div>

                    {message ? (
                      <div
                        className={`login-page__alert ${messageIsSuccess ? "login-page__alert--success" : "login-page__alert--error"}`}
                        role="alert"
                      >
                        {message}
                      </div>
                    ) : null}

                    <form className="login-page__form" onSubmit={handleRecoverSubmit} noValidate>
                      <div className="login-page__form-block">
                        <p className="login-page__form-block-title">Email</p>
                        <div className="login-page__form-block-inner">
                          <div className="login-page__input">
                            <div className="login-page__input-wrapper">
                              <input
                                className="login-page__input-field"
                                type="email"
                                id="recover-email"
                                name="recover-email"
                                autoComplete="email"
                                autoCapitalize="none"
                                inputMode="email"
                                value={recoverEmail}
                                onChange={(e) => setRecoverEmail(e.target.value)}
                                required
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="login-page__form-block">
                        <p className="login-page__form-block-title">Введите код с картинки</p>
                        <div className="login-page__form-block-inner login-page__form-block-inner--captcha">
                          <div className="login-page__captcha-visual">
                            <div className="login-page__captcha-frame">
                              {captchaImageSrc ? (
                                <img
                                  src={captchaImageSrc}
                                  alt=""
                                  className="login-page__captcha-img"
                                />
                              ) : (
                                <div className="login-page__captcha-skel" aria-hidden />
                              )}
                              <button
                                type="button"
                                className="login-page__captcha-refresh"
                                onClick={() => void loadCaptcha()}
                                disabled={captchaLoading || loading}
                                aria-label="Обновить капчу"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 20 20" aria-hidden>
                                  <path
                                    fill="#454CEE"
                                    fillRule="evenodd"
                                    d="M4 2a1 1 0 0 1 1 1v2.1a7 7 0 0 1 11.6 2.57 1 1 0 1 1-1.88.66A5 5 0 0 0 6 7h3a1 1 0 0 1 0 2H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm0 9.06a1 1 0 0 1 1.28.6A5 5 0 0 0 14 13h-3a1 1 0 0 1 0-2h5a1 1 0 0 1 1 1v5a1 1 0 0 1-2 0v-2.1a7 7 0 0 1-11.6-2.57 1 1 0 0 1 .6-1.27Z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <div className="login-page__input">
                            <div className="login-page__input-wrapper">
                              <input
                                className="login-page__input-field"
                                type="text"
                                id="recover-captcha"
                                name="captcha_code"
                                autoComplete="off"
                                autoCapitalize="none"
                                value={captchaCode}
                                onChange={(e) => setCaptchaCode(e.target.value)}
                                placeholder="Код с картинки"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="login-page__base-button login-page__base-button_size_large login-page__base-button_color_primary login-page__login-btn"
                        disabled={loading || captchaLoading}
                      >
                        {loading ? "Отправка..." : "Отправить"}
                      </button>
                    </form>

                    <p className="login-page__recover-footer-text">
                      Есть аккаунт?{" "}
                      <button
                        type="button"
                        className="login-page__recover-footer-link"
                        onClick={() => {
                          setShowRecoverAccess(false);
                          resetRecoverWizard();
                        }}
                      >
                        Вернуться к авторизации
                      </button>
                    </p>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="login-page__welcome">
                  <div className="login-page__avatar-wrap">
                    <div className="login-page__avatar">
                      <LoginWelcomeAvatarIcon />
                    </div>
                  </div>
                  <h1 className="login-page__title">
                    {isReturningUser && storedWelcomeName
                      ? `С возвращением, ${storedWelcomeName}`
                      : isReturningUser
                        ? "С возвращением"
                        : "Вход"}
                  </h1>
                </div>

                {message ? (
                  <div
                    className={`login-page__alert ${messageIsSuccess ? "login-page__alert--success" : "login-page__alert--error"}`}
                    role="alert"
                  >
                    {message}
                  </div>
                ) : null}

                <form className="login-page__form" onSubmit={handleSubmit} noValidate>
              <div className="login-page__form-block">
                <p className="login-page__form-block-title">Логин или емейл</p>
                <div className="login-page__form-block-inner">
                  <div className="login-page__input">
                    <div className="login-page__input-wrapper">
                      <input
                        className="login-page__input-field"
                        type="text"
                        id="email"
                        name="email"
                        autoComplete="username"
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
                <div className="login-page__form-block-title-row">
                  <p className="login-page__form-block-title">Пароль</p>
                  <button
                    type="button"
                    className="login-page__recover-link"
                    onClick={() => {
                      resetRecoverWizard();
                      setRecoverEmail(email.trim());
                      setShowRecoverAccess(true);
                    }}
                  >
                    Восстановить
                  </button>
                </div>
                <div className="login-page__form-block-inner">
                  <div className="login-page__input login-page__input--password">
                    <div className="login-page__input-wrapper">
                      <input
                        className="login-page__input-field"
                        type={showPassword ? "text" : "password"}
                        id="password"
                        name="password"
                        autoComplete="current-password"
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

              <button
                type="submit"
                className="login-page__base-button login-page__base-button_size_large login-page__base-button_color_primary login-page__login-btn"
                data-testid="submit-form-btn"
                data-test-id="submit-form-btn"
                disabled={loading}
              >
                {loading ? "Вход..." : "Войти"}
              </button>
            </form>

            <div className="login-page__social" aria-label="Другие способы входа">
              <div className="login-page__divider">
                <span>или</span>
              </div>
              <div className="login-page__social-grid">
                <button
                  type="button"
                  className="login-page__social-btn login-page__social-btn--passkey"
                  aria-label="Войти с помощью Passkey"
                  disabled={loading}
                  onClick={handlePasskeyClick}
                >
                  <PasskeyIcon />
                  <span>Passkey</span>
                </button>
                <button
                  type="button"
                  className="login-page__social-btn"
                  aria-label="Войти через VK"
                  disabled={loading}
                  onClick={handleVkClick}
                >
                  <VkIcon />
                </button>
                <button
                  type="button"
                  className="login-page__social-btn"
                  aria-label="Войти через Telegram"
                  disabled={loading}
                  onClick={handleTelegramClick}
                >
                  <TelegramIcon />
                </button>
                <button
                  type="button"
                  className="login-page__social-btn"
                  aria-label="Войти через Google"
                  disabled={loading}
                  onClick={handleGoogleClick}
                >
                  <GoogleIcon />
                </button>
              </div>
            </div>

            <p className="login-page__footer">
              Нет аккаунта?{" "}
              <Link to="/registration" className="login-page__footer-link">
                Зарегистрируйтесь
              </Link>
            </p>
              </>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

export default Login;
