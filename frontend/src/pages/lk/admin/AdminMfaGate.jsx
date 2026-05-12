import { useCallback, useEffect, useState } from "react";
import { API_ENDPOINTS } from "../../../config/api";
import { toast } from "../../../components/toast/toastBus";

/**
 * Step-up MFA gate для админ-кабинета.
 *
 * Поток:
 *   1) GET /users/admin/session/ — если уже elevated, отдаём children.
 *   2) Иначе экран «idle»: основная кнопка «Отправить код в Telegram»
 *      (POST /users/admin/mfa/telegram/challenge/) и dev-кнопка «Подтвердить для разработки»
 *      (POST /users/admin/session/dev-confirm/, доступна только при DEBUG=True).
 *   3) После успеха challenge → экран «code»: ввод 6 цифр и POST /users/admin/mfa/telegram/verify/.
 *      На успех verify сразу выдаёт `is_elevated: true` — раскрываем children.
 *   4) Если challenge вернул `TELEGRAM_MFA_DEVICE_NOT_CONFIGURED` — на «idle» появляется кнопка
 *      «Привязать Telegram», которая через POST /users/admin/mfa/telegram/bind/start/ выдаёт
 *      ссылку `t.me/<bot>?start=<token>` (фаза «bind»).
 */
const DEVICE_NOT_CONFIGURED_HINT =
  "Telegram MFA не настроен. Привяжите Telegram device через Django admin или следующий шаг настройки.";
const BOOTSTRAP_REQUIRED_HINT =
  "Первичную привязку Telegram должен выполнить суперадминистратор. Обратитесь к нему.";
const BIND_REBIND_NEED_MFA_HINT =
  "Для перепривязки Telegram нужно сначала войти в админку с актуальным MFA. Подтвердите код Telegram или используйте dev-fallback.";
const BIND_NOT_CONFIGURED_HINT = "Telegram бот не настроен на сервере.";
const BIND_GENERIC_ERROR = "Не удалось начать привязку.";

export default function AdminMfaGate({ children }) {
  const [sessionLoading, setSessionLoading] = useState(true);
  const [elevated, setElevated] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [devSending, setDevSending] = useState(false);
  const [bindStarting, setBindStarting] = useState(false);
  const [bindOffered, setBindOffered] = useState(false);
  const [bindLink, setBindLink] = useState("");
  const [error, setError] = useState(null);

  const authHeader = () => {
    const token =
      typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(API_ENDPOINTS.adminSession, { headers: authHeader() });
      if (!res.ok) throw new Error("session_fetch_failed");
      const data = await res.json();
      setElevated(!!data.is_elevated);
    } catch (_) {
      setElevated(false);
      setError("Не удалось проверить сессию администратора");
    } finally {
      setSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const handleChallenge = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(API_ENDPOINTS.adminTelegramMfaChallenge, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
      });
      let body = null;
      try {
        body = await res.json();
      } catch (_) {
        // ignore parse error
      }
      if (!res.ok) {
        if (body && body.code === "TELEGRAM_MFA_DEVICE_NOT_CONFIGURED") {
          setError(DEVICE_NOT_CONFIGURED_HINT);
          setBindOffered(true);
        } else {
          setError((body && body.detail) || "Не удалось отправить код");
        }
        return;
      }
      setCode("");
      setBindOffered(false);
      setPhase("code");
    } catch (_) {
      toast.error("Сеть недоступна. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    const trimmed = (code || "").trim();
    if (!trimmed) {
      setError("Введите код из Telegram");
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(API_ENDPOINTS.adminTelegramMfaVerify, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ code: trimmed }),
      });
      let body = null;
      try {
        body = await res.json();
      } catch (_) {
        // ignore parse error
      }
      if (!res.ok) {
        setError((body && body.detail) || "Не удалось подтвердить код");
        return;
      }
      if (body && body.is_elevated) {
        setElevated(true);
      } else {
        await fetchSession();
      }
    } catch (_) {
      toast.error("Сеть недоступна. Попробуйте ещё раз.");
    } finally {
      setVerifying(false);
    }
  };

  const handleBack = () => {
    setPhase("idle");
    setCode("");
    setError(null);
  };

  const handleDevConfirm = async () => {
    setDevSending(true);
    setError(null);
    try {
      const res = await fetch(API_ENDPOINTS.adminSessionDevConfirm, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
      });
      if (!res.ok) {
        let body = null;
        try {
          body = await res.json();
        } catch (_) {
          // ignore parse error
        }
        setError((body && body.detail) || "Подтверждение недоступно");
        return;
      }
      await fetchSession();
    } catch (_) {
      toast.error("Не удалось подтвердить сессию");
    } finally {
      setDevSending(false);
    }
  };

  const handleBindStart = async () => {
    setBindStarting(true);
    setError(null);
    try {
      const res = await fetch(API_ENDPOINTS.adminTelegramBindStart, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
      });
      let body = null;
      try {
        body = await res.json();
      } catch (_) {
        // ignore parse error
      }
      if (!res.ok) {
        const codeStr = body && body.code;
        if (codeStr === "TELEGRAM_MFA_BOOTSTRAP_REQUIRED") {
          setError(BOOTSTRAP_REQUIRED_HINT);
        } else if (codeStr === "ADMIN_MFA_REQUIRED") {
          setError(BIND_REBIND_NEED_MFA_HINT);
          setBindOffered(false);
          setPhase("idle");
        } else if (codeStr === "TELEGRAM_MFA_NOT_CONFIGURED") {
          setError(BIND_NOT_CONFIGURED_HINT);
        } else {
          setError((body && body.detail) || BIND_GENERIC_ERROR);
        }
        return;
      }
      const link = body && body.bot_link;
      if (!link) {
        setError(BIND_GENERIC_ERROR);
        return;
      }
      setBindLink(link);
      setPhase("bind");
    } catch (_) {
      toast.error("Сеть недоступна. Попробуйте ещё раз.");
    } finally {
      setBindStarting(false);
    }
  };

  const handleBindDone = async () => {
    setBindLink("");
    setBindOffered(false);
    setPhase("idle");
    await handleChallenge();
  };

  const handleBindCancel = () => {
    setBindLink("");
    setPhase("idle");
    setError(null);
  };

  if (sessionLoading) {
    return <div className="lk-admin-mfa lk-admin-mfa--loading">Загрузка…</div>;
  }
  if (elevated) return children;

  return (
    <section className="lk-admin-mfa" aria-labelledby="lk-admin-mfa-title">
      <h2 id="lk-admin-mfa-title" className="lk-admin-mfa__title">
        Подтверждение администратора
      </h2>
      {phase === "idle" ? (
        <>
          <p className="lk-admin-mfa__text">
            Для доступа к админке нужно дополнительное подтверждение.
          </p>
          {error ? (
            <p className="lk-admin-mfa__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="lk-admin-mfa__row">
            <button
              type="button"
              className="lk-admin-mfa__btn"
              onClick={handleChallenge}
              disabled={sending}
            >
              {sending ? "Отправляем…" : "Отправить код в Telegram"}
            </button>
            <button
              type="button"
              className="lk-admin-mfa__btn lk-admin-mfa__btn--secondary"
              onClick={handleDevConfirm}
              disabled={devSending}
            >
              {devSending ? "Подтверждаем…" : "Подтвердить для разработки"}
            </button>
          </div>
          {bindOffered ? (
            <div className="lk-admin-mfa__row">
              <button
                type="button"
                className="lk-admin-mfa__btn"
                onClick={handleBindStart}
                disabled={bindStarting}
              >
                {bindStarting ? "Готовим ссылку…" : "Привязать Telegram"}
              </button>
            </div>
          ) : null}
        </>
      ) : phase === "bind" ? (
        <>
          <h3 className="lk-admin-mfa__title">Привяжите Telegram</h3>
          <ol className="lk-admin-mfa__instructions">
            <li>Откройте бота по ссылке ниже.</li>
            <li>Нажмите Start (или отправьте сообщение, которое предложит Telegram).</li>
            <li>Вернитесь сюда и нажмите «Я привязал Telegram».</li>
          </ol>
          <a
            className="lk-admin-mfa__bot-link"
            href={bindLink}
            target="_blank"
            rel="noreferrer"
          >
            Открыть Telegram
          </a>
          {error ? (
            <p className="lk-admin-mfa__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="lk-admin-mfa__row">
            <button
              type="button"
              className="lk-admin-mfa__btn"
              onClick={handleBindDone}
              disabled={sending}
            >
              {sending ? "Проверяем…" : "Я привязал Telegram"}
            </button>
            <button
              type="button"
              className="lk-admin-mfa__btn lk-admin-mfa__btn--secondary"
              onClick={handleBindCancel}
              disabled={sending}
            >
              Отмена
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="lk-admin-mfa__text">
            Код отправлен в Telegram. Введите 6 цифр.
          </p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            className="lk-admin-mfa__input"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            aria-label="Код из Telegram"
          />
          {error ? (
            <p className="lk-admin-mfa__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="lk-admin-mfa__row">
            <button
              type="button"
              className="lk-admin-mfa__btn"
              onClick={handleVerify}
              disabled={verifying}
            >
              {verifying ? "Подтверждаем…" : "Подтвердить"}
            </button>
            <button
              type="button"
              className="lk-admin-mfa__btn lk-admin-mfa__btn--secondary"
              onClick={handleBack}
              disabled={verifying}
            >
              Назад
            </button>
          </div>
        </>
      )}
    </section>
  );
}
