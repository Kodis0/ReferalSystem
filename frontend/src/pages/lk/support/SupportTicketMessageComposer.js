import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic, Paperclip, Send, Smile, Square, X } from "lucide-react";
import EmojiPicker, { Categories, EmojiStyle, Theme } from "emoji-picker-react";
import { isVoiceLikeFile, SupportTicketVoiceBubble } from "./supportTicketVoiceBubble";
import { chooseVoiceRecorderMimeType } from "./supportVoiceRecording";
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

const EMOJI_PANEL_WIDTH = 336;
const EMOJI_PANEL_HEIGHT = 380;

/**
 * @param {object} props
 * @param {boolean} props.disabled
 * @param {(payload: { messageText: string, files: File[] }) => Promise<{ ok: boolean, error?: string }>} props.onSend
 * @param {string} [props.submitLabel]
 * @param {string} [props.textareaId]
 * @param {string} [props.placeholder]
 */
/** Max textarea height (px) inside the fixed 66px telegram bar; scroll when exceeded */
const TG_TEXTAREA_MAX_PX = 58;
const TG_TEXTAREA_MIN_PX = 22;

export default function SupportTicketMessageComposer({
  disabled,
  onSend,
  submitLabel = "Отправить",
  textareaId = "lk-support-ticket-composer-message",
  placeholder = "Написать сообщение…",
}) {
  const formRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const emojiPanelRef = useRef(null);
  const emojiToggleRef = useRef(null);
  const emojiOpenRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordChunksRef = useRef([]);
  const discardRecordingRef = useRef(false);

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
  const [sendBusy, setSendBusy] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);

  const voiceWithIndices = useMemo(
    () =>
      files
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => isVoiceLikeFile(f)),
    [files],
  );
  const nonVoiceCount = useMemo(() => files.filter((f) => !isVoiceLikeFile(f)).length, [files]);
  const voiceOnlyMode = voiceWithIndices.length > 0 && nonVoiceCount === 0;

  useEffect(() => {
    if (voiceOnlyMode) {
      setMessage("");
      setEmojiOpen(false);
    }
  }, [voiceOnlyMode]);

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
    const btn = emojiToggleRef.current;
    const ta = textareaRef.current;
    const anchor = btn || ta;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const gap = 10;
    const margin = 10;
    let left = r.left;
    if (left + EMOJI_PANEL_WIDTH > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - EMOJI_PANEL_WIDTH);
    }
    let top = r.top - EMOJI_PANEL_HEIGHT - gap;
    if (top < margin) {
      top = r.bottom + gap;
    }
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
    const btn = emojiToggleRef.current;
    const rob = btn ? new ResizeObserver(() => updateEmojiPanelPosition()) : null;
    if (btn && rob) rob.observe(btn);
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
      ro?.disconnect();
      rob?.disconnect();
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

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, TG_TEXTAREA_MIN_PX), TG_TEXTAREA_MAX_PX)}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [message, adjustTextareaHeight]);

  const appendEmoji = useCallback(
    (ch) => {
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
    },
    [message],
  );

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
      if (!trimmed && files.length === 0) {
        setStatusLine("Введите текст или прикрепите вложение.");
        return;
      }
      setSendBusy(true);
      try {
        const result = await onSend({ messageText: trimmed, files });
        if (result.ok) {
          setMessage("");
          setFiles([]);
        } else {
          setStatusLine(result.error || "Не удалось отправить.");
        }
      } catch {
        setStatusLine("Не удалось отправить.");
      } finally {
        setSendBusy(false);
      }
    },
    [files, message, onSend],
  );

  const busy = disabled || sendBusy;

  const hasText = message.trim().length > 0;
  const showSend = (hasText || voiceOnlyMode) && !isRecording;

  const onTextareaKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!busy && message.trim()) {
          formRef.current?.requestSubmit?.();
        }
      }
    },
    [busy, message],
  );

  return (
    <form
      ref={formRef}
      className="lk-support-ticket__form lk-support-ticket-view__composer-form lk-support-ticket-view__composer-form_telegram"
      onSubmit={onSubmit}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="lk-support-ticket__telegram-file-input"
        multiple
        tabIndex={-1}
        onChange={onFiles}
        disabled={busy || voiceOnlyMode}
        aria-hidden
      />

      <div
        className={`lk-support-ticket__telegram-bar${voiceOnlyMode ? " lk-support-ticket__telegram-bar_voice-draft" : ""}`}
        onDragOver={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        }}
        onDrop={voiceOnlyMode ? undefined : onDrop}
      >
        {!voiceOnlyMode ? (
          <button
            type="button"
            className="lk-support-ticket__telegram-tool"
            title="Прикрепить файл"
            aria-label="Прикрепить файл"
            disabled={busy || isRecording}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={22} strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}

        <div
          className={`lk-support-ticket__telegram-input-wrap${voiceOnlyMode ? " lk-support-ticket__telegram-input-wrap_voice-draft" : ""}`}
        >
          {isRecording ? (
            <span className="lk-support-ticket__telegram-record-time" aria-live="polite">
              {Math.floor(recordingSec / 60)}:{String(recordingSec % 60).padStart(2, "0")}
            </span>
          ) : null}
          {voiceOnlyMode && !isRecording ? (
            voiceWithIndices.map(({ f, i }) => (
              <SupportTicketVoiceBubble key={`voice-bar-${i}-${f.name}-${f.size}`} file={f} fileIndex={i} onRemove={removeFileAt} compactBar />
            ))
          ) : (
            <textarea
              ref={textareaRef}
              id={textareaId}
              name="message"
              className="lk-support-ticket__textarea lk-support-ticket__textarea_telegram"
              rows={1}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={onTextareaKeyDown}
              placeholder={placeholder}
              readOnly={isRecording || busy}
              aria-busy={isRecording || busy}
              disabled={busy}
              aria-label={submitLabel}
            />
          )}
        </div>

        {!voiceOnlyMode ? (
          <button
            ref={emojiToggleRef}
            type="button"
            className="lk-support-ticket__telegram-tool"
            title="Смайлы"
            aria-expanded={emojiOpen}
            aria-label="Смайлы"
            disabled={isRecording || busy}
            onClick={() => setEmojiOpen((v) => !v)}
          >
            <Smile size={22} strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}

        {showSend ? (
          <button type="submit" className="lk-support-ticket__telegram-send" title={submitLabel} aria-label={submitLabel} disabled={busy}>
            <Send size={20} strokeWidth={2} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className={`lk-support-ticket__telegram-tool${isRecording ? " lk-support-ticket__telegram-tool_recording" : ""}`}
            title={
              isRecording
                ? `Остановить запись (${Math.floor(recordingSec / 60)}:${String(recordingSec % 60).padStart(2, "0")})`
                : "Голосовое сообщение"
            }
            aria-label={isRecording ? "Остановить запись" : "Голосовое сообщение"}
            aria-pressed={isRecording}
            disabled={busy}
            onClick={toggleVoiceRecording}
          >
            {isRecording ? <Square size={18} strokeWidth={2.25} fill="currentColor" aria-hidden /> : <Mic size={22} strokeWidth={1.75} aria-hidden />}
          </button>
        )}
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

      <div className="lk-support-ticket__attach-block lk-support-ticket__attach-block_telegram">
        {files.length > 0 && (!voiceOnlyMode || nonVoiceCount > 0) ? (
          <div className="lk-support-ticket__attachments">
            {files.map((f, idx) =>
              isVoiceLikeFile(f) ? (
                voiceOnlyMode ? null : (
                  <SupportTicketVoiceBubble
                    key={`voice-${idx}-${f.name}-${f.size}`}
                    file={f}
                    fileIndex={idx}
                    onRemove={removeFileAt}
                  />
                )
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
                        disabled={busy}
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
    </form>
  );
}
