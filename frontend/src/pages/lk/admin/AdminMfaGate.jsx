import { useCallback, useEffect, useRef, useState } from "react";
import { API_ENDPOINTS } from "../../../config/api";
import { adminFetch } from "../../../components/adminAuth";
import { toast } from "../../../components/toast/toastBus";

/**
 * Step-up MFA gate для админ-кабинета.
 *
 * Поток:
 *   1) GET /users/admin/session/ — если уже elevated, отдаём children.
 *   2) Иначе экран «idle»: primary кнопка «Подтвердить вход в Telegram»
 *      (POST /users/admin/mfa/telegram/approval/challenge/), secondary «Ввести код» (старый flow),
 *      dev-кнопка «Подтвердить для разработки».
 *   3) approval_pending → polling GET /users/admin/mfa/telegram/approval/challenge/<id>/ каждые 2с.
 *      approved → AdminSession создаётся бэком, отдаём children. denied/expired → ошибочный экран.
 *   4) Фаза «code» — fallback на старый flow: POST /challenge/ → input → /verify/.
 *   5) Bind flow без изменений: device-not-configured → POST /bind/start/ → t.me/<bot>?start=... → done.
 */
const DEVICE_NOT_CONFIGURED_HINT =
  "Telegram MFA не настроен. Привяжите Telegram device через Django admin или следующий шаг настройки.";
const BOOTSTRAP_REQUIRED_HINT =
  "Первичную привязку Telegram должен выполнить суперадминистратор. Обратитесь к нему.";
const BIND_REBIND_NEED_MFA_HINT =
  "Для перепривязки Telegram нужно сначала войти в админку с актуальным MFA. Подтвердите код Telegram или используйте dev-fallback.";
const BIND_NOT_CONFIGURED_HINT = "Telegram бот не настроен на сервере.";
const BIND_GENERIC_ERROR = "Не удалось начать привязку.";
const APPROVAL_RATE_LIMIT_HINT = "Слишком часто, попробуйте через минуту.";
const APPROVAL_NOT_CONFIGURED_HINT = "Telegram MFA не настроен на сервере.";
const APPROVAL_DENIED_HINT =
  "Вход отклонён в Telegram. Если это были не вы — смените пароль и переплавите MFA устройство.";
const APPROVAL_EXPIRED_HINT = "Запрос истёк.";
const APPROVAL_POLL_INTERVAL_MS = 2000;

export default function AdminMfaGate({ children, autoStart, onElevated, skipSessionFetch }) {
  const [sessionLoading, setSessionLoading] = useState(!skipSessionFetch);
  const [elevated, setElevated] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [devSending, setDevSending] = useState(false);
  const [bindStarting, setBindStarting] = useState(false);
  const [bindOffered, setBindOffered] = useState(false);
  const [bindLink, setBindLink] = useState("");
  const [approvalStarting, setApprovalStarting] = useState(false);
  const [approvalChallengeId, setApprovalChallengeId] = useState(null);
  const [error, setError] = useState(null);
  const pollTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const autoStartedRef = useRef(false);

  const fetchSession = useCallback(async () => {
    try {
      const res = await adminFetch(API_ENDPOINTS.adminSession);
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
    if (skipSessionFetch) {
      setSessionLoading(false);
      return;
    }
    fetchSession();
  }, [fetchSession, skipSessionFetch]);

  useEffect(() => {
    if (elevated && typeof onElevated === "function") {
      onElevated();
    }
  }, [elevated, onElevated]);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPollTimer();
    };
  }, [clearPollTimer]);

  const pollApprovalStatus = useCallback(
    async (cid) => {
      if (!cid || !mountedRef.current) return;
      try {
        const res = await adminFetch(
          API_ENDPOINTS.adminTelegramApprovalChallengeStatus(cid),
        );
        let body = null;
        try {
          body = await res.json();
        } catch (_) {
          // ignore parse error
        }
        if (!mountedRef.current) return;
        if (!res.ok) {
          setError("Не удалось получить статус подтверждения");
          setPhase("idle");
          return;
        }
        const st = body && body.status;
        if (st === "approved") {
          setElevated(true);
          setApprovalChallengeId(null);
          return;
        }
        if (st === "denied") {
          setApprovalChallengeId(null);
          setPhase("denied");
          return;
        }
        if (st === "expired") {
          setApprovalChallengeId(null);
          setPhase("expired");
          return;
        }
        pollTimerRef.current = setTimeout(
          () => pollApprovalStatus(cid),
          APPROVAL_POLL_INTERVAL_MS,
        );
      } catch (_) {
        if (!mountedRef.current) return;
        pollTimerRef.current = setTimeout(
          () => pollApprovalStatus(cid),
          APPROVAL_POLL_INTERVAL_MS,
        );
      }
    },
    [],
  );

  const handleApprovalChallenge = async () => {
    setApprovalStarting(true);
    setError(null);
    try {
      const res = await adminFetch(API_ENDPOINTS.adminTelegramApprovalChallenge, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      let body = null;
      try {
        body = await res.json();
      } catch (_) {
        // ignore parse error
      }
      if (!res.ok) {
        const codeStr = body && body.code;
        if (codeStr === "TELEGRAM_MFA_DEVICE_NOT_CONFIGURED") {
          setError(DEVICE_NOT_CONFIGURED_HINT);
          setBindOffered(true);
        } else if (codeStr === "TELEGRAM_MFA_RATE_LIMITED") {
          setError(APPROVAL_RATE_LIMIT_HINT);
        } else if (codeStr === "TELEGRAM_MFA_NOT_CONFIGURED") {
          setError(APPROVAL_NOT_CONFIGURED_HINT);
        } else {
          setError((body && body.detail) || "Не удалось отправить запрос в Telegram");
        }
        return;
      }
      const cid = body && body.challenge_id;
      if (cid == null) {
        setError("Не удалось отправить запрос в Telegram");
        return;
      }
      setBindOffered(false);
      setApprovalChallengeId(cid);
      setPhase("approval_pending");
      clearPollTimer();
      pollTimerRef.current = setTimeout(
        () => pollApprovalStatus(cid),
        APPROVAL_POLL_INTERVAL_MS,
      );
    } catch (_) {
      toast.error("Сеть недоступна. Попробуйте ещё раз.");
    } finally {
      setApprovalStarting(false);
    }
  };

  const handleApprovalCancel = () => {
    clearPollTimer();
    setApprovalChallengeId(null);
    setPhase("idle");
    setError(null);
  };

  useEffect(() => {
    if (autoStartedRef.current) return;
    if (sessionLoading) return;
    if (elevated) return;
    if (autoStart === "approval" && phase === "idle" && !approvalStarting) {
      autoStartedRef.current = true;
      handleApprovalChallenge();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, sessionLoading, elevated, phase]);


  const handleChallenge = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await adminFetch(API_ENDPOINTS.adminTelegramMfaChallenge, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  const handleSwitchToCode = () => {
    setError(null);
    handleChallenge();
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
      const res = await adminFetch(API_ENDPOINTS.adminTelegramMfaVerify, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  const handleRetryFromDenied = () => {
    setPhase("idle");
    setError(null);
  };

  const handleRetryFromExpired = () => {
    setPhase("idle");
    setError(null);
    handleApprovalChallenge();
  };

  const handleDevConfirm = async () => {
    setDevSending(true);
    setError(null);
    try {
      const res = await adminFetch(API_ENDPOINTS.adminSessionDevConfirm, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const res = await adminFetch(API_ENDPOINTS.adminTelegramBindStart, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    await handleApprovalChallenge();
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
              onClick={handleApprovalChallenge}
              disabled={approvalStarting}
            >
              {approvalStarting ? "Отправляем…" : "Подтвердить вход в Telegram"}
            </button>
            <button
              type="button"
              className="lk-admin-mfa__btn lk-admin-mfa__btn--secondary"
              onClick={handleSwitchToCode}
              disabled={sending}
            >
              {sending ? "Отправляем…" : "Ввести код"}
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
      ) : phase === "approval_pending" ? (
        <>
          <p className="lk-admin-mfa__text">
            Мы отправили запрос в Telegram. Нажмите «Подтвердить» или «Отклонить».
          </p>
          <div
            className="lk-admin-mfa__pending"
            role="status"
            aria-live="polite"
          >
            <span className="lk-admin-mfa__spinner" aria-hidden="true" />
            <span>Ожидаем подтверждения…</span>
          </div>
          {error ? (
            <p className="lk-admin-mfa__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="lk-admin-mfa__row">
            <button
              type="button"
              className="lk-admin-mfa__btn lk-admin-mfa__btn--secondary"
              onClick={handleApprovalCancel}
            >
              Отмена
            </button>
          </div>
        </>
      ) : phase === "denied" ? (
        <>
          <p className="lk-admin-mfa__error" role="alert">
            {APPROVAL_DENIED_HINT}
          </p>
          <div className="lk-admin-mfa__row">
            <button
              type="button"
              className="lk-admin-mfa__btn lk-admin-mfa__btn--secondary"
              onClick={handleRetryFromDenied}
            >
              Назад
            </button>
          </div>
        </>
      ) : phase === "expired" ? (
        <>
          <p className="lk-admin-mfa__error" role="alert">
            {APPROVAL_EXPIRED_HINT}
          </p>
          <div className="lk-admin-mfa__row">
            <button
              type="button"
              className="lk-admin-mfa__btn"
              onClick={handleRetryFromExpired}
              disabled={approvalStarting}
            >
              {approvalStarting ? "Отправляем…" : "Повторить"}
            </button>
            <button
              type="button"
              className="lk-admin-mfa__btn lk-admin-mfa__btn--secondary"
              onClick={handleRetryFromDenied}
            >
              Назад
            </button>
          </div>
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
              disabled={approvalStarting}
            >
              {approvalStarting ? "Проверяем…" : "Я привязал Telegram"}
            </button>
            <button
              type="button"
              className="lk-admin-mfa__btn lk-admin-mfa__btn--secondary"
              onClick={handleBindCancel}
              disabled={approvalStarting}
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
