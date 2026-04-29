import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MoreVertical } from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
import { SUPPORT_HUB_TICKETS_REFRESH_EVENT } from "./supportConstants";
import { deleteSupportTicketAttachment, fetchSupportTicketById, patchSupportTicket } from "./supportTicketsApi";
import { isVoiceLikeFile, SupportTicketVoiceBubble } from "./supportTicketVoiceBubble";
import SupportTicketMessageComposer from "./SupportTicketMessageComposer";
import LkScrollerScrollbar from "../components/LkScrollerScrollbar";
import "./support.css";

function formatCommentFooterDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTicketNo(idStr) {
  const s = String(idStr || "").replace(/-/g, "");
  if (s.length < 4) return s || "—";
  return s.slice(0, 8).toUpperCase();
}

/** Убирает ведущий «Тип:» из превью (часто первая строка тела совпадает с полем «Тип» ниже). */
function headerTitleFromPreview(preview) {
  const raw = String(preview || "").trim();
  if (!raw) return "";
  const stripped = raw.replace(/^тип\s*:\s*/iu, "").trim();
  if (stripped) return stripped;
  return /^тип\s*:?\s*$/iu.test(raw) ? "" : raw;
}

/** Разделитель: ответы поддержки, вставляемые в `body` с бэкенда, идут после этой метки. */
const SUPPORT_THREAD_SEP = "\n\n[SUPPORT]\n\n";
/** Префикс для patch append_body после ответа поддержки (перед текстом нового сообщения пользователя). Бэкенд добавляет `\n\n` между старым телом и append_body. */
const SUPPORT_APPEND_PREFIX = "[SUPPORT]\n\n";
/** Внутри одного «хода» пользователя до ответа поддержки — отдельные сообщения. */
const USER_THREAD_SEP = "\n\n[USER]\n\n";

/** После ответа поддержки следующий юзер-текст в `body` идёт после нового SUPPORT-маркера; чётное число частей при split → последняя часть — ответ поддержки. */
function endsWithSupportMessage(body) {
  const s = normalizeThreadNewlines(body).trim();
  if (!s || !s.includes(SUPPORT_THREAD_SEP)) return false;
  const parts = s.split(SUPPORT_THREAD_SEP);
  return parts.length % 2 === 0;
}

function splitUserRound(text) {
  const raw = String(text ?? "").trimEnd();
  if (!raw) return [];
  return raw
    .split(USER_THREAD_SEP)
    .map((t) => String(t).trimEnd())
    .filter((t) => t.length > 0)
    .map((t) => ({ role: "user", text: t }));
}

/** Одна строка переносов в БД/клиенте; иначе split по USER/SUPPORT-разделителям не срабатывает. */
function normalizeThreadNewlines(s) {
  return String(s ?? "").replace(/\r\n/g, "\n");
}

function ticketBodyToThreadSegments(body) {
  const s = normalizeThreadNewlines(body);
  if (!s.includes(SUPPORT_THREAD_SEP)) {
    return splitUserRound(s);
  }
  const parts = s.split(SUPPORT_THREAD_SEP);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const piece = String(parts[i]).trimEnd();
    if (!piece) continue;
    if (i % 2 === 0) {
      out.push(...splitUserRound(piece));
    } else {
      out.push({ role: "support", text: piece });
    }
  }
  return out;
}

/**
 * Текст пузыря: без дубля строки вложений, без служебных маркеров [USER]/[SUPPORT], если они попали в сегмент.
 */
function stripEmbeddedAttachmentLines(text) {
  let t = normalizeThreadNewlines(text);
  t = t.replace(/\n\nВложения \(имена файлов\):[^\n]*/g, "");
  t = t.replace(/^\[USER\]$/gim, "");
  t = t.replace(/^\[SUPPORT\]$/gim, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/** Убирает служебные пометки цели обращения из текста в ленте (не трогаем хранимое тело на сервере). */
function sanitizeSupportTicketThreadDisplay(text) {
  let t = normalizeThreadNewlines(String(text || ""));
  t = t.replace(/\s*\(project_id:\s*\d+\)/gi, "");
  t = t.replace(
    /\s*\(site_public_id:\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)/gi,
    "",
  );
  t = t.replace(/Проект\s*\(\s*кабинет\s+владельца\s*\)\s*:\s*/gi, "");
  t = t.replace(/Сайт\s*\(\s*кабинет\s+владельца\s*\)\s*:\s*/gi, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

function parseTicketAttachmentNames(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function mimeFromFileName(name) {
  const n = String(name).toLowerCase();
  if (n.endsWith(".webm")) return "audio/webm";
  if (n.endsWith(".ogg")) return "audio/ogg";
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".wav")) return "audio/wav";
  if (n.endsWith(".m4a") || n.endsWith(".mp4")) return "audio/mp4";
  return "audio/webm";
}

function placeholderVoiceFile(name) {
  return new File([], name, { type: mimeFromFileName(name) });
}

export default function SupportTicketDetailPage() {
  const { ticketId } = useParams();
  const id = String(ticketId || "").trim();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [deletingAttachmentName, setDeletingAttachmentName] = useState(null);
  const actionsMenuRef = useRef(null);
  const threadScrollRef = useRef(null);
  const [lkScrollbarTheme, setLkScrollbarTheme] = useState(() =>
    document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark",
  );

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () =>
      setLkScrollbarTheme(root.getAttribute("data-theme") === "light" ? "light" : "dark");
    syncTheme();
    const mo = new MutationObserver(syncTheme);
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  const handleAppendMessage = useCallback(
    async ({ messageText, files }) => {
      if (!id || !ticket) {
        return { ok: false, error: "Нет данных обращения." };
      }
      const names = files.map((f) => f.name).join(", ");
      let append = messageText.trim();
      if (names) {
        append += `\n\nВложения (имена файлов): ${names}`;
      }
      const tb = (ticket.body || "").trim();
      if (tb.length > 0) {
        if (endsWithSupportMessage(tb)) {
          append = `${SUPPORT_APPEND_PREFIX}${append}`;
        } else {
          append = `[USER]\n\n${append}`;
        }
      }
      const prev = (ticket.attachment_names || "").trim();
      const merged = [prev, names].filter(Boolean).join(", ");
      const res = await patchSupportTicket(id, {
        append_body: append,
        attachment_names: merged,
        ...(files.length > 0 ? { files } : {}),
      });
      if (!res.ok) {
        const d = res.ticket && typeof res.ticket.detail === "string" ? res.ticket.detail : "";
        if (res.status === 401) {
          return { ok: false, error: "Сессия истекла — войдите снова." };
        }
        return { ok: false, error: d || "Не удалось отправить сообщение." };
      }
      setTicket(res.ticket);
      window.dispatchEvent(new CustomEvent(SUPPORT_HUB_TICKETS_REFRESH_EVENT, { detail: {} }));
      return { ok: true };
    },
    [id, ticket],
  );

  const onCloseTicket = useCallback(async () => {
    if (!id || !ticket) return;
    setActionError("");
    setActionBusy(true);
    try {
      const res = await patchSupportTicket(id, { is_closed: true });
      if (!res.ok) {
        const d = res.ticket && typeof res.ticket.detail === "string" ? res.ticket.detail : "";
        setActionError(d || "Не удалось закрыть обращение.");
        return;
      }
      setTicket(res.ticket);
      window.dispatchEvent(
        new CustomEvent(SUPPORT_HUB_TICKETS_REFRESH_EVENT, { detail: { closedTicketId: id } }),
      );
    } finally {
      setActionBusy(false);
    }
  }, [id, ticket]);

  const handleDeleteAttachment = useCallback(
    async (name) => {
      if (!id) return;
      if (
        !window.confirm(
          "Удалить это голосовое вложение? Файл будет удалён с сервера без возможности восстановления.",
        )
      ) {
        return;
      }
      setActionError("");
      setDeletingAttachmentName(name);
      try {
        const res = await deleteSupportTicketAttachment(id, name);
        if (!res.ok) {
          if (res.status === 401) {
            setActionError("Сессия истекла — войдите снова.");
          } else {
            const d = res.ticket && typeof res.ticket.detail === "string" ? res.ticket.detail : "";
            setActionError(d || "Не удалось удалить вложение.");
          }
          return;
        }
        setTicket(res.ticket);
        window.dispatchEvent(new CustomEvent(SUPPORT_HUB_TICKETS_REFRESH_EVENT, { detail: {} }));
      } finally {
        setDeletingAttachmentName(null);
      }
    },
    [id],
  );

  const onReopenTicket = useCallback(async () => {
    if (!id) return;
    setActionError("");
    setActionBusy(true);
    try {
      const res = await patchSupportTicket(id, { is_closed: false });
      if (!res.ok) {
        const d = res.ticket && typeof res.ticket.detail === "string" ? res.ticket.detail : "";
        setActionError(d || "Не удалось открыть обращение.");
        return;
      }
      setTicket(res.ticket);
      window.dispatchEvent(new CustomEvent(SUPPORT_HUB_TICKETS_REFRESH_EVENT, { detail: {} }));
    } finally {
      setActionBusy(false);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) {
        setError("Обращение не найдено.");
        return;
      }
      setError("");
      setTicket(null);
      const res = await fetchSupportTicketById(id);
      if (cancelled) return;
      if (!res.ok) {
        if (res.status === 404) {
          setError("Обращение не найдено.");
        } else {
          setError("Не удалось загрузить обращение.");
        }
        return;
      }
      setTicket(res.ticket);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!actionsMenuOpen) return undefined;
    const onDown = (e) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target)) {
        setActionsMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setActionsMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [actionsMenuOpen]);

  useEffect(() => {
    setActionsMenuOpen(false);
  }, [id]);

  const ticketNoShort = ticket ? formatTicketNo(ticket.id) : "";

  const attachmentNameList = ticket ? parseTicketAttachmentNames(ticket.attachment_names) : [];

  const onCopyTicketNo = useCallback(() => {
    if (!ticketNoShort || ticketNoShort === "—") return;
    void navigator.clipboard.writeText(ticketNoShort).catch(() => {});
  }, [ticketNoShort]);

  return (
    <div className="lk-support-ticket-view" id="lk-support-ticket-view">
      {error ? (
        <p className="lk-support-ticket-view__error" role="alert">
          {error}
        </p>
      ) : null}

      {!error && !ticket ? (
        <p className="lk-support-ticket-view__loading" aria-live="polite">
          Загрузка…
        </p>
      ) : null}

      {ticket ? (
        <div className="lk-support-ticket-view__thread">
          <header className="lk-support-ticket-view__top-bar">
            <h1 className="lk-support-ticket-view__title">
              {headerTitleFromPreview(ticket.preview) || "Обращение в поддержку"}
            </h1>
            <div className="lk-support-ticket-view__top-bar-aside" ref={actionsMenuRef}>
              <button
                type="button"
                className="lk-support-ticket-view__ticket-no"
                title="Скопировать номер в буфер обмена"
                aria-label={`Скопировать номер обращения ${ticketNoShort}`}
                onClick={onCopyTicketNo}
              >
                №{ticketNoShort}
              </button>
              <span
                className={
                  ticket.is_closed === true
                    ? "lk-support-ticket-view__status lk-support-ticket-view__status_closed"
                    : "lk-support-ticket-view__status lk-support-ticket-view__status_open"
                }
              >
                <span className="lk-support-ticket-view__status-dot" aria-hidden />
                {ticket.is_closed === true ? "Закрыт" : "Открыт"}
              </span>
              <div className="lk-support-ticket-view__actions">
                <button
                  type="button"
                  className="lk-support-ticket-view__actions-trigger"
                  aria-label="Действия с обращением"
                  aria-haspopup="menu"
                  aria-expanded={actionsMenuOpen}
                  disabled={actionBusy}
                  onClick={() => setActionsMenuOpen((o) => !o)}
                >
                  <MoreVertical size={20} strokeWidth={2} aria-hidden />
                </button>
                {actionsMenuOpen ? (
                  <div className="lk-support-ticket-view__actions-menu" role="menu">
                    {ticket.is_closed !== true ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="lk-support-ticket-view__actions-item"
                        disabled={actionBusy}
                        onClick={() => {
                          setActionsMenuOpen(false);
                          onCloseTicket();
                        }}
                      >
                        {actionBusy ? "Сохранение…" : "Закрыть обращение"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        className="lk-support-ticket-view__actions-item"
                        disabled={actionBusy}
                        onClick={() => {
                          setActionsMenuOpen(false);
                          onReopenTicket();
                        }}
                      >
                        {actionBusy ? "Сохранение…" : "Открыть снова"}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <div className="lk-support-ticket-view__thread-scroll-wrap">
            <div ref={threadScrollRef} className="lk-support-ticket-view__thread-scroll">
            {ticket.is_closed !== true ? (
              <div className="lk-support-ticket-view__thread-divider lk-support-ticket-view__thread-divider_open">
                <div className="lk-support-ticket-view__thread-divider-line" aria-hidden />
                <p className="lk-support-ticket-view__thread-divider-text">
                  Тикет открыт {formatCommentFooterDate(ticket.created_at)}
                </p>
                <div className="lk-support-ticket-view__thread-divider-line" aria-hidden />
              </div>
            ) : null}

            {ticketBodyToThreadSegments(ticket.body)
              .map((seg, idx) => {
                const segmentText = sanitizeSupportTicketThreadDisplay(stripEmbeddedAttachmentLines(seg.text));
                return { seg, idx, segmentText };
              })
              .filter((x) => x.segmentText.trim())
              .map(({ seg, idx, segmentText }) => {
                const isUser = seg.role === "user";
                return (
                  <div
                    key={idx}
                    className={
                      isUser
                        ? "lk-support-ticket-view__comment lk-support-ticket-view__comment_user"
                        : "lk-support-ticket-view__comment lk-support-ticket-view__comment_support"
                    }
                  >
                    <div className="lk-support-ticket-view__comment-inner">
                      <div className="lk-support-ticket-view__message-wrap">
                        <p className="lk-support-ticket-view__message">{segmentText}</p>
                        {isUser ? (
                          <p className="lk-support-ticket-view__message-stamp">
                            {formatCommentFooterDate(ticket.created_at)}
                          </p>
                        ) : null}
                      </div>
                      {!isUser ? (
                        <div className="lk-support-ticket-view__comment-footer">
                          <p className="lk-support-ticket-view__comment-byline">
                            {`Поддержка, ${formatCommentFooterDate(ticket.created_at)}`}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}

            {attachmentNameList.length > 0 ? (
              <div
                className="lk-support-ticket-view__thread-voice-attachments"
                aria-label="Вложения"
              >
                {attachmentNameList.map((name, attIdx) =>
                  isVoiceLikeFile({ name }) ? (
                    <div
                      key={`att-voice-${attIdx}-${name}`}
                      className="lk-support-ticket-view__comment lk-support-ticket-view__comment_user lk-support-ticket-view__comment_attach-row"
                    >
                      <div className="lk-support-ticket-view__comment-inner">
                        <SupportTicketVoiceBubble
                          file={placeholderVoiceFile(name)}
                          fileIndex={attIdx}
                          audioAuthUrl={API_ENDPOINTS.supportTicketAttachment(String(ticket.id), name)}
                          threadUserStyle
                          threadFooterStamp={formatCommentFooterDate(ticket.created_at)}
                          onRemove={
                            deletingAttachmentName === name
                              ? undefined
                              : () => {
                                  void handleDeleteAttachment(name);
                                }
                          }
                        />
                      </div>
                    </div>
                  ) : (
                    <div
                      key={`att-file-${attIdx}-${name}`}
                      className="lk-support-ticket-view__comment lk-support-ticket-view__comment_user lk-support-ticket-view__comment_attach-row"
                    >
                      <div className="lk-support-ticket-view__comment-inner">
                        <div className="lk-support-ticket-view__thread-file-chip-wrap">
                          <span className="lk-support-ticket-view__thread-file-chip">{name}</span>
                        </div>
                      </div>
                    </div>
                  ),
                )}
              </div>
            ) : null}

            {ticket.is_closed === true ? (
              <div className="lk-support-ticket-view__thread-divider lk-support-ticket-view__thread-divider_closed">
                <div className="lk-support-ticket-view__thread-divider-line" aria-hidden />
                <p className="lk-support-ticket-view__thread-divider-text">
                  {ticket.closed_at
                    ? `Тикет закрыт ${formatCommentFooterDate(ticket.closed_at)}`
                    : "Тикет закрыт"}
                </p>
                <div className="lk-support-ticket-view__thread-divider-line" aria-hidden />
              </div>
            ) : null}
            </div>
            <LkScrollerScrollbar scrollerRef={threadScrollRef} theme={lkScrollbarTheme} />
          </div>

          {ticket.is_closed !== true ? (
            <div className="lk-support-ticket-view__reply">
              <SupportTicketMessageComposer
                disabled={actionBusy}
                onSend={handleAppendMessage}
                submitLabel="Отправить"
                textareaId="lk-support-ticket-reply-message"
                placeholder="Сообщение…"
              />
            </div>
          ) : null}

          {actionError ? (
            <div className="lk-support-ticket-view__thread-foot lk-support-ticket-view__thread-foot_error-only">
              <p className="lk-support-ticket-view__action-error" role="alert">
                {actionError}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
