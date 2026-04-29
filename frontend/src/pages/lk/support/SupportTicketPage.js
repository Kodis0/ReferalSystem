import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, NavLink, useNavigate, useParams } from "react-router-dom";
import { Code, Globe, Mic, Smile, Square, Users, X } from "lucide-react";
import EmojiPicker, { Categories, EmojiStyle, Theme } from "emoji-picker-react";
import { API_ENDPOINTS } from "../../../config/api";
import { fetchOwnerSitesList } from "../owner-programs/ownerSitesListApi";
import { formatSiteCardTitle } from "../owner-programs/siteDisplay";
import { SUPPORT_SERVICE_OPTIONS, SUPPORT_TICKET_SLUGS, SUPPORT_TICKET_TABS } from "./supportConstants";
import { createSupportTicket } from "./supportTicketsApi";
import { isVoiceLikeFile, SupportTicketVoiceBubble } from "./supportTicketVoiceBubble";
import { chooseVoiceRecorderMimeType } from "./supportVoiceRecording";
import LkListboxSelect from "../components/LkListboxSelect";
import "../settings/settings.css";
import "./support.css";

const SUPPORT_EMOJI_CATEGORIES = [
  { category: Categories.SUGGESTED, name: "Недавние" },
  { category: Categories.SMILEYS_PEOPLE, name: "Смайлы" },
  { category: Categories.ANIMALS_NATURE, name: "Животные и природа" },
  { category: Categories.FOOD_DRINK, name: "Еда и напитки" },
  { category: Categories.TRAVEL_PLACES, name: "Путешествия" },
  { category: Categories.ACTIVITIES, name: "Активности" },
  { category: Categories.OBJECTS, name: "Предметы" },
  { category: Categories.SYMBOLS, name: "Символы" },
  { category: Categories.FLAGS, name: "Флаги" },
];

const SUPPORT_TARGET_LOADING_VALUE = "__loading";

const EMOJI_PANEL_WIDTH = 336;
const EMOJI_PANEL_HEIGHT = 380;

function supportServiceIcon(iconType) {
  if (iconType === "site") {
    return <Globe size={18} strokeWidth={1.75} aria-hidden />;
  }
  if (iconType === "agent") {
    return <Users size={18} strokeWidth={1.75} aria-hidden />;
  }
  return undefined;
}

function ownerSiteListLabel(site) {
  const publicId = String(site?.public_id || "").trim();
  return formatSiteCardTitle(
    publicId,
    typeof site?.primary_origin === "string" ? site.primary_origin : "",
    typeof site?.display_name === "string" ? site.display_name : "",
  );
}

function dedupeOwnerSitesByPublicId(sites) {
  const seen = new Set();
  const out = [];
  for (const s of sites || []) {
    const id = String(s?.public_id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(s);
  }
  return out;
}

function buildSupportTargetOptionRows(ownerSites, programs) {
  const rows = [];
  for (const site of dedupeOwnerSitesByPublicId(ownerSites)) {
    const sid = String(site?.public_id || "").trim();
    if (!sid) continue;
    const label = ownerSiteListLabel(site);
    rows.push({
      value: `owner-site:${sid}`,
      label,
      submissionLabel: `Сайт (кабинет владельца): ${label} (site_public_id: ${sid})`,
      iconType: "site",
    });
  }
  for (const pr of programs) {
    const sid = String(pr?.site_public_id || "").trim();
    if (!sid) continue;
    const label =
      typeof pr?.site_display_label === "string" && pr.site_display_label.trim()
        ? pr.site_display_label.trim()
        : `Программа · ${sid}`;
    rows.push({
      value: `agent-program:${sid}`,
      label,
      submissionLabel: `Реферальная программа (агент): ${label} (site_public_id: ${sid})`,
      iconType: "agent",
    });
  }
  if (rows.length === 0) {
    rows.push({
      value: "unlinked",
      label: "Без привязки к сайту или программе",
      submissionLabel: "Без привязки к конкретному сайту или реферальной программе",
      iconType: null,
    });
  }
  return rows;
}

function mergeSupportPlatformRows(apiServices) {
  const byId = Object.fromEntries((apiServices || []).map((s) => [s.id, s]));
  return SUPPORT_SERVICE_OPTIONS.map((opt) => {
    const s = byId[opt.value];
    const ok = s ? Boolean(s.ok) : true;
    const message = s && typeof s.message === "string" ? s.message.trim() : "";
    return { id: opt.value, label: opt.label, ok, message };
  });
}

function TabTimeIcon({ fast }) {
  if (fast) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 12 12" aria-hidden="true">
        <path fill="#F2C94C" d="M6.94 1.27H5.12c-.2 0-.38.12-.44.31L3.14 6.3c-.1.3.12.6.43.6h1.21l-1.05 3.23c-.16.48.47.83.8.43l4.25-5.32a.46.46 0 0 0-.35-.74H6.58l.8-2.64a.46.46 0 0 0-.44-.6Z" />
      </svg>
    );
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="15" fill="none" viewBox="0 0 14 15" aria-hidden="true">
      <path
        fill="#7F91A4"
        d="M7 1.67A5.85 5.85 0 0 0 1.17 7.5c0 3.2 2.62 5.83 5.83 5.83 3.2 0 5.83-2.62 5.83-5.83 0-3.2-2.62-5.83-5.83-5.83Zm2.04 7c-.17.29-.52.35-.82.23l-1.51-.88a.61.61 0 0 1-.3-.52V4.58c0-.35.24-.58.59-.58s.58.23.58.58v2.57l1.23.7c.29.17.35.52.23.82Z"
      />
    </svg>
  );
}

function BackChevron() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="7" height="13" fill="none" viewBox="0 0 7 13" aria-hidden="true">
      <path
        fill="currentColor"
        d="M1 6.99a1 1 0 0 1 .23-.64l4-5a1 1 0 0 1 1.54 1.29L3.29 6.99l3.32 4.35a1 1 0 0 1-.15 1.4A1 1 0 0 1 5 12.62l-3.83-5A1 1 0 0 1 1 7Z"
      />
    </svg>
  );
}

export default function SupportTicketPage() {
  const navigate = useNavigate();
  const { ticketSlug } = useParams();
  const slug = String(ticketSlug || "").trim();
  const textareaRef = useRef(null);
  const emojiPanelRef = useRef(null);
  const emojiToggleRef = useRef(null);
  const emojiOpenRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordChunksRef = useRef([]);
  const discardRecordingRef = useRef(false);

  const [supportTargetRows, setSupportTargetRows] = useState([
    {
      value: SUPPORT_TARGET_LOADING_VALUE,
      label: "Загрузка…",
      submissionLabel: "",
      iconType: null,
    },
  ]);
  const [supportTargetKey, setSupportTargetKey] = useState(SUPPORT_TARGET_LOADING_VALUE);
  const [supportTargetsLoading, setSupportTargetsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiPanelPos, setEmojiPanelPos] = useState(null);
  const [emojiPickerTheme, setEmojiPickerTheme] = useState(() =>
    typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light"
      ? Theme.LIGHT
      : Theme.DARK,
  );
  const [statusLine, setStatusLine] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [platformRows, setPlatformRows] = useState(() => mergeSupportPlatformRows([]));
  const [platformLoading, setPlatformLoading] = useState(true);
  const [platformError, setPlatformError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPlatformLoading(true);
      setPlatformError("");
      try {
        const res = await fetch(API_ENDPOINTS.platformServiceStatus, { credentials: "omit" });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setPlatformError("Не удалось загрузить статус сервисов.");
          return;
        }
        if (!Array.isArray(body.services)) {
          setPlatformError("Некорректный ответ сервера.");
          return;
        }
        setPlatformRows(mergeSupportPlatformRows(body.services));
      } catch {
        if (!cancelled) {
          setPlatformError("Не удалось загрузить статус сервисов.");
        }
      } finally {
        if (!cancelled) {
          setPlatformLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSupportTargetsLoading(true);
      try {
        const ownerRes = await fetchOwnerSitesList();
        const token = localStorage.getItem("access_token");
        let programs = [];
        if (token) {
          const rp = await fetch(API_ENDPOINTS.myPrograms, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (rp.ok) {
            const data = await rp.json().catch(() => ({}));
            programs = Array.isArray(data.programs) ? data.programs : [];
          }
        }
        if (cancelled) return;
        const ownerSites = ownerRes.ok ? ownerRes.sites || [] : [];
        const rows = buildSupportTargetOptionRows(ownerSites, programs);
        setSupportTargetRows(rows);
        setSupportTargetKey((prev) => (rows.some((r) => r.value === prev) ? prev : rows[0].value));
      } catch {
        if (!cancelled) {
          const rows = buildSupportTargetOptionRows([], []);
          setSupportTargetRows(rows);
          setSupportTargetKey(rows[0].value);
        }
      } finally {
        if (!cancelled) {
          setSupportTargetsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => {
      setEmojiPickerTheme(root.getAttribute("data-theme") === "light" ? Theme.LIGHT : Theme.DARK);
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  emojiOpenRef.current = emojiOpen;

  const updateEmojiPanelPosition = useCallback(() => {
    if (!emojiOpenRef.current) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const r = ta.getBoundingClientRect();
    const gap = 10;
    const margin = 10;
    let left = r.right + gap;
    if (left + EMOJI_PANEL_WIDTH > window.innerWidth - margin) {
      left = Math.max(margin, r.left - EMOJI_PANEL_WIDTH - gap);
    }
    let top = r.top;
    if (top + EMOJI_PANEL_HEIGHT > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - EMOJI_PANEL_HEIGHT - margin);
    }
    setEmojiPanelPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!emojiOpen) {
      setEmojiPanelPos(null);
      return undefined;
    }
    updateEmojiPanelPosition();
    const onWin = () => updateEmojiPanelPosition();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    const ta = textareaRef.current;
    const ro = ta ? new ResizeObserver(() => updateEmojiPanelPosition()) : null;
    if (ta && ro) ro.observe(ta);
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
      ro?.disconnect();
    };
  }, [emojiOpen, updateEmojiPanelPosition]);

  useEffect(() => {
    if (!emojiOpen) return undefined;
    const onPointerDown = (e) => {
      const t = e.target;
      if (emojiPanelRef.current?.contains(t) || emojiToggleRef.current?.contains(t)) return;
      setEmojiOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [emojiOpen]);

  useEffect(() => {
    if (!isRecording) return undefined;
    const id = window.setInterval(() => setRecordingSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [isRecording]);

  useEffect(() => {
    return () => {
      discardRecordingRef.current = true;
      const mr = mediaRecorderRef.current;
      const stream = mediaStreamRef.current;
      if (mr && mr.state !== "inactive") {
        mr.stop();
      }
      stream?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
    };
  }, []);

  const toggleVoiceRecording = useCallback(async () => {
    setStatusLine("");
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === "recording") {
      mr.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      discardRecordingRef.current = false;
      mediaStreamRef.current = stream;
      recordChunksRef.current = [];
      const mimeType = chooseVoiceRecorderMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordChunksRef.current.push(ev.data);
        }
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);
        setRecordingSec(0);
        const shouldDiscard = discardRecordingRef.current;
        discardRecordingRef.current = false;
        if (shouldDiscard) {
          recordChunksRef.current = [];
          return;
        }
        const blob = new Blob(recordChunksRef.current, { type: rec.mimeType || mimeType || "audio/webm" });
        recordChunksRef.current = [];
        if (blob.size === 0) return;
        const type = blob.type || "";
        const ext = type.includes("webm") ? "webm" : type.includes("mp4") || type.includes("m4a") ? "m4a" : "webm";
        const name = `voice-${Date.now()}.${ext}`;
        const file = new File([blob], name, { type: blob.type || type || "audio/webm" });
        setFiles((prev) => [...prev, file]);
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setRecordingSec(0);
      setIsRecording(true);
    } catch {
      setStatusLine("Не удалось получить доступ к микрофону. Разрешите запись в настройках браузера.");
    }
  }, []);

  const targetSelectOptions = useMemo(
    () =>
      supportTargetRows.map((row) => ({
        value: row.value,
        label: row.label,
        icon: supportServiceIcon(row.iconType),
      })),
    [supportTargetRows],
  );

  const appendEmoji = useCallback((ch) => {
    const el = textareaRef.current;
    if (!el) {
      setMessage((m) => m + ch);
      return;
    }
    const start = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? message.length;
    const next = message.slice(0, start) + ch + message.slice(end);
    setMessage(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + ch.length;
      el.setSelectionRange(pos, pos);
    });
  }, [message]);

  const insertCodeFence = useCallback(() => {
    const el = textareaRef.current;
    const open = "<code>";
    const close = "</code>";
    const emptyBlock = `${open}\n\n${close}`;
    if (!el) {
      setMessage((m) => m + emptyBlock);
      return;
    }
    const start = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? message.length;
    const selected = message.slice(start, end);
    if (selected.trim().length > 0) {
      const block = `${open}\n${selected}\n${close}`;
      const next = message.slice(0, start) + block + message.slice(end);
      setMessage(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + block.length, start + block.length);
      });
    } else {
      const next = message.slice(0, start) + emptyBlock + message.slice(end);
      setMessage(next);
      requestAnimationFrame(() => {
        el.focus();
        const caret = start + open.length + 1;
        el.setSelectionRange(caret, caret);
      });
    }
  }, [message]);

  const onFiles = useCallback((e) => {
    const list = e.target?.files;
    if (!list || list.length === 0) {
      setFiles([]);
      return;
    }
    setFiles(Array.from(list));
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.files?.length) {
      setFiles(Array.from(e.dataTransfer.files));
    }
  }, []);

  const removeFileAt = useCallback((index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const onSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setStatusLine("");
      const trimmed = message.trim();
      if (!trimmed) {
        setStatusLine("Введите текст сообщения.");
        return;
      }
      const tab = SUPPORT_TICKET_TABS.find((t) => t.slug === slug) || SUPPORT_TICKET_TABS[0];
      const targetRow = supportTargetRows.find((r) => r.value === supportTargetKey);
      const targetLine =
        targetRow?.submissionLabel ||
        targetRow?.label ||
        (supportTargetKey === SUPPORT_TARGET_LOADING_VALUE ? "" : String(supportTargetKey));
      if (!targetLine.trim()) {
        setStatusLine("Подождите, пока загрузится список сайтов и программ.");
        return;
      }
      const names = files.map((f) => f.name).join(", ");
      const body = [
        `Тип: ${tab.title}`,
        `Сайт / программа: ${targetLine}`,
        "",
        trimmed,
        names ? `\n\nВложения (имена файлов): ${names}` : "",
      ].join("\n");

      const save = await createSupportTicket({
        type_slug: slug,
        target_key:
          supportTargetKey === SUPPORT_TARGET_LOADING_VALUE ? "" : String(supportTargetKey),
        target_label: targetLine.trim(),
        body,
        attachment_names: names,
        ...(files.length > 0 ? { files } : {}),
      });

      if (!save.ok) {
        const detail = save.ticket && typeof save.ticket.detail === "string" ? save.ticket.detail : "";
        if (save.status === 401) {
          setStatusLine("Сессия истекла — войдите снова и повторите отправку.");
        } else {
          setStatusLine(detail || "Не удалось сохранить обращение.");
        }
        return;
      }

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(body);
        }
      } catch {
        /* ignore */
      }

      setStatusLine("Обращение сохранено.");
      const newId = save.ticket && save.ticket.id ? save.ticket.id : null;
      if (newId) {
        navigate("/lk/support", { state: { focusTicketId: newId }, replace: false });
      }
    },
    [files, message, navigate, slug, supportTargetKey, supportTargetRows],
  );

  if (!SUPPORT_TICKET_SLUGS.includes(slug)) {
    return <Navigate to="/lk/support/help-question" replace />;
  }

  return (
    <div className="lk-support-ticket" id="lk-support-ticket">
      <div className="lk-support-ticket__return">
        <Link className="tw-link link_primary link_s" to="/lk/support">
          <BackChevron />
          <span className="lk-support-ticket__return-label">Назад</span>
        </Link>
      </div>

      <div className="lk-support-ticket__header">
        <h1 className="lk-support-ticket__h1">Создать тикет</h1>
      </div>

      <div className="lk-support-ticket__layout">
        <div className="lk-support-ticket__main">
          <div className="lk-support-ticket__tabs-aside-grid">
            <div className="lk-support-ticket__tabs" role="tablist" aria-label="Тип обращения">
              {SUPPORT_TICKET_TABS.map((tab) => (
                <NavLink
                  key={tab.slug}
                  to={`/lk/support/${tab.slug}`}
                  className={({ isActive }) =>
                    `lk-support-ticket__tab${isActive ? " lk-support-ticket__tab_active" : ""}`
                  }
                  role="tab"
                  aria-selected={tab.slug === slug}
                >
                  <p className="lk-support-ticket__tab-title">{tab.title}</p>
                  <p className={`lk-support-ticket__tab-time${tab.fast ? " lk-support-ticket__tab-time_fast" : ""}`}>
                    <TabTimeIcon fast={tab.fast} />
                    <span>{tab.time}</span>
                  </p>
                </NavLink>
              ))}
            </div>

            <aside className="lk-support-ticket__aside" aria-label="Статус сервисов">
              <section className="lk-support-ticket__aside-section">
                <p className="lk-support-ticket__aside-title">Статус сервисов</p>
                {platformLoading ? (
                  <p className="lk-support-ticket__aside-desc lk-support-ticket__aside-desc_muted">Загрузка…</p>
                ) : platformError ? (
                  <p className="lk-support-ticket__aside-desc lk-support-ticket__aside-desc_muted">{platformError}</p>
                ) : platformRows.length > 0 && platformRows.every((row) => row.ok) ? (
                  <p className="lk-support-ticket__aside-desc">
                    <span className="lk-support-ticket__status-dot" aria-hidden="true" />
                    Все сервисы доступны
                  </p>
                ) : (
                  <ul className="lk-support-ticket__aside-services">
                    {platformRows.map((row) => (
                      <li key={row.id} className="lk-support-ticket__aside-service">
                        <div className="lk-support-ticket__aside-service-line">
                          <span
                            className={
                              row.ok
                                ? "lk-support-ticket__status-dot"
                                : "lk-support-ticket__status-dot lk-support-ticket__status-dot_bad"
                            }
                            aria-hidden="true"
                          />
                          <span className="lk-support-ticket__aside-service-name">{row.label}</span>
                        </div>
                        {!row.ok ? (
                          <p className="lk-support-ticket__aside-service-msg">
                            {row.message || "Сервис временно недоступен."}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </aside>
          </div>

          <form className="lk-support-ticket__form" onSubmit={onSubmit}>
            <div className="lk-support-ticket__field">
              <div className="lk-support-ticket__label" id="lk-support-target-label">
                Сайт или реферальная программа
              </div>
              <div className="lk-support-ticket__listbox-scope">
                <LkListboxSelect
                  value={supportTargetKey}
                  onChange={setSupportTargetKey}
                  options={targetSelectOptions}
                  labelledBy="lk-support-target-label"
                  listboxId="lk-support-target-listbox"
                  dataTestId="lk-support-target-select"
                  disabled={supportTargetsLoading}
                />
              </div>
            </div>

            <div className="lk-support-ticket__field">
              <label className="lk-support-ticket__label" htmlFor="lk-support-message">
                Сообщение
              </label>
              <div className="lk-support-ticket__textarea-wrap">
                <textarea
                  ref={textareaRef}
                  id="lk-support-message"
                  name="message"
                  className="lk-support-ticket__textarea"
                  rows={6}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Напишите ваш вопрос. Скриншоты, выводы из консоли и другие подробности ускорят наш ответ"
                  readOnly={isRecording}
                  aria-busy={isRecording}
                />
                {isRecording ? (
                  <span className="lk-support-ticket__record-time" aria-live="polite">
                    {Math.floor(recordingSec / 60)}:{String(recordingSec % 60).padStart(2, "0")}
                  </span>
                ) : null}
                <div className="lk-support-ticket__msg-tools">
                  <button
                    ref={emojiToggleRef}
                    type="button"
                    className="lk-support-ticket__icon-btn"
                    title="Смайлы"
                    aria-expanded={emojiOpen}
                    aria-disabled={isRecording}
                    disabled={isRecording}
                    onClick={() => setEmojiOpen((v) => !v)}
                  >
                    <Smile size={20} strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className="lk-support-ticket__icon-btn"
                    title="Вставить код"
                    aria-disabled={isRecording}
                    disabled={isRecording}
                    onClick={insertCodeFence}
                  >
                    <Code size={20} strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className={`lk-support-ticket__icon-btn${isRecording ? " lk-support-ticket__icon-btn_recording" : ""}`}
                    title={
                      isRecording
                        ? `Остановить запись (${Math.floor(recordingSec / 60)}:${String(recordingSec % 60).padStart(2, "0")})`
                        : "Голосовое сообщение"
                    }
                    aria-pressed={isRecording}
                    onClick={toggleVoiceRecording}
                  >
                    {isRecording ? <Square size={18} strokeWidth={2.25} fill="currentColor" /> : <Mic size={20} strokeWidth={1.75} />}
                  </button>
                </div>
              </div>
              {emojiOpen && emojiPanelPos
                ? createPortal(
                    <div
                      ref={emojiPanelRef}
                      className="lk-support-ticket__emoji-panel lk-support-ticket__emoji-panel_portal"
                      style={{ top: emojiPanelPos.top, left: emojiPanelPos.left }}
                    >
                      <EmojiPicker
                        theme={emojiPickerTheme}
                        emojiStyle={EmojiStyle.NATIVE}
                        lazyLoadEmojis
                        searchDisabled
                        autoFocusSearch={false}
                        height={EMOJI_PANEL_HEIGHT}
                        width={EMOJI_PANEL_WIDTH}
                        categories={SUPPORT_EMOJI_CATEGORIES}
                        onEmojiClick={(emojiData) => appendEmoji(emojiData.emoji)}
                        previewConfig={{ showPreview: false }}
                      />
                    </div>,
                    document.body,
                  )
                : null}
            </div>

            <div className="lk-support-ticket__attach-block">
              <label
                className="lk-support-ticket__dropzone"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={onDrop}
              >
                <input type="file" className="lk-support-ticket__file-input" multiple onChange={onFiles} />
                <span className="lk-support-ticket__dropzone-title">
                  <span className="lk-support-ticket__dropzone-accent">Выберите файл </span>
                  <span>или перетащите его сюда</span>
                </span>
                <span className="lk-support-ticket__dropzone-note">Не более 50 МБ</span>
              </label>

              {files.length > 0 ? (
                <div className="lk-support-ticket__attachments">
                  {files.map((f, idx) =>
                    isVoiceLikeFile(f) ? (
                      <SupportTicketVoiceBubble
                        key={`voice-${idx}-${f.name}-${f.size}`}
                        file={f}
                        fileIndex={idx}
                        onRemove={removeFileAt}
                      />
                    ) : null,
                  )}
                  {files.some((item) => !isVoiceLikeFile(item)) ? (
                    <div className="lk-support-ticket__file-list-other">
                      {files.map((f, idx) =>
                        !isVoiceLikeFile(f) ? (
                          <div key={`file-${idx}-${f.name}`} className="lk-support-ticket__file-chip">
                            <span className="lk-support-ticket__file-chip-name">{f.name}</span>
                            <button
                              type="button"
                              className="lk-support-ticket__file-chip-remove"
                              aria-label={`Удалить вложение ${f.name}`}
                              title="Удалить"
                              onClick={() => removeFileAt(idx)}
                            >
                              <X size={15} strokeWidth={2.25} aria-hidden />
                            </button>
                          </div>
                        ) : null,
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {statusLine ? (
              <p className="lk-support-ticket__status" role="status">
                {statusLine}
              </p>
            ) : null}

            <button type="submit" className="lk-support-ticket__submit">
              Отправить
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
