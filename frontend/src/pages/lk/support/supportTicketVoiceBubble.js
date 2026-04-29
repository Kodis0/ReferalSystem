import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Pause, Play, X } from "lucide-react";

export const VOICE_WAVE_BARS = 52;

export function isVoiceLikeFile(file) {
  const t = String(file?.type || "").toLowerCase();
  if (t.startsWith("audio/")) return true;
  const n = String(file?.name || "").toLowerCase();
  return /\.(webm|ogg|opus|mp3|wav|m4a|aac|flac|mpeg)$/i.test(n);
}

function hashStringToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function fakeWaveformBars(seed, count) {
  const bars = [];
  let x = seed || 1;
  for (let i = 0; i < count; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    bars.push(0.12 + ((x % 78) / 100) * 0.88);
  }
  return bars;
}

async function decodeWaveformBars(file, barCount) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error("no AudioContext");
  const ctx = new AC();
  try {
    const buf = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(buf.slice(0));
    const data = audioBuffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / barCount));
    const bars = [];
    for (let i = 0; i < barCount; i += 1) {
      const start = i * step;
      const end = Math.min(start + step, data.length);
      let sum = 0;
      for (let j = start; j < end; j += 1) sum += Math.abs(data[j]);
      bars.push(sum / (end - start) || 0);
    }
    const max = Math.max(...bars, 1e-9);
    return bars.map((v) => Math.min(1, (v / max) * 0.92 + 0.08));
  } finally {
    await ctx.close?.();
  }
}

function formatMmSs(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function formatMessageClock(file) {
  const t = file?.lastModified ? new Date(file.lastModified) : new Date();
  return `${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}`;
}

export function SupportTicketVoiceBubble({
  file,
  fileIndex,
  onRemove,
  compactBar = false,
  /** Нет локального файла / URL — только отображение в тикете (имена на сервере без аудио). */
  playbackUnavailable = false,
  /** Полный URL загрузки вложения с API (JWT в заголовке fetch → blob для audio). */
  audioAuthUrl,
  /** Фон пузыря как у исходящего текста пользователя (#7177f8) в ленте тикета. */
  threadUserStyle = false,
  /** Дата/время под блоком управления (лента тикета), как у текстовых пузырей. */
  threadFooterStamp = "",
}) {
  const audioRef = useRef(null);
  const containerRef = useRef(null);
  const waveTrackRef = useRef(null);
  const [bars, setBars] = useState(() => fakeWaveformBars(hashStringToSeed(`${file.name}-${file.size}`), VOICE_WAVE_BARS));
  const [waveTrackPx, setWaveTrackPx] = useState(0);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [authLoading, setAuthLoading] = useState(() => Boolean(audioAuthUrl));
  const [authError, setAuthError] = useState(false);
  const [playError, setPlayError] = useState(false);
  /** Blob URL после авторизованного fetch — привязка к audio в отдельном layout-effect (после async ref уже есть). */
  const [attachmentBlobUrl, setAttachmentBlobUrl] = useState(null);

  useEffect(() => {
    if (!audioAuthUrl) {
      setAttachmentBlobUrl(null);
      setAuthLoading(false);
      setAuthError(false);
      return undefined;
    }
    let cancelled = false;
    setAuthLoading(true);
    setAuthError(false);
    setAttachmentBlobUrl(null);
    setPlayError(false);

    (async () => {
      try {
        const token = typeof localStorage !== "undefined" ? localStorage.getItem("access_token") : null;
        const res = await fetch(audioAuthUrl, {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`fetch_${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        if (!blob || blob.size === 0) throw new Error("empty_blob");

        const decFile = new File([blob], file.name, { type: blob.type || file.type });
        try {
          const next = await decodeWaveformBars(decFile, VOICE_WAVE_BARS);
          if (!cancelled) setBars(next);
        } catch {
          if (!cancelled) {
            setBars(fakeWaveformBars(hashStringToSeed(`${file.name}-${blob.size}`), VOICE_WAVE_BARS));
          }
        }

        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setAttachmentBlobUrl(url);
      } catch {
        if (!cancelled) {
          setAuthError(true);
          setBars(fakeWaveformBars(hashStringToSeed(file.name), VOICE_WAVE_BARS));
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      setAttachmentBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [audioAuthUrl, file.name, file.type]);

  useLayoutEffect(() => {
    if (!attachmentBlobUrl) return undefined;
    const audio = audioRef.current;
    if (!audio) return undefined;
    audio.src = attachmentBlobUrl;
    audio.preload = "metadata";
    audio.load();
    setPlayError(false);
    return () => {
      audio.removeAttribute("src");
      audio.load();
    };
  }, [attachmentBlobUrl]);

  useEffect(() => {
    if (audioAuthUrl) {
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        if (playbackUnavailable || file.size === 0) throw new Error("skip decode");
        const next = await decodeWaveformBars(file, VOICE_WAVE_BARS);
        if (!cancelled) setBars(next);
      } catch {
        if (!cancelled) {
          setBars(fakeWaveformBars(hashStringToSeed(`${file.name}-${file.size}`), VOICE_WAVE_BARS));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, playbackUnavailable, audioAuthUrl]);

  useEffect(() => {
    if (audioAuthUrl) {
      return undefined;
    }
    if (playbackUnavailable || file.size === 0) {
      const audio = audioRef.current;
      if (audio) {
        audio.removeAttribute("src");
        audio.load();
      }
      return undefined;
    }
    const url = URL.createObjectURL(file);
    const audio = audioRef.current;
    if (audio) {
      audio.src = url;
      audio.preload = "metadata";
      audio.load();
      setPlayError(false);
    }
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file, playbackUnavailable, audioAuthUrl]);

  const playDisabled =
    playbackUnavailable ||
    (audioAuthUrl ? authLoading || authError || !attachmentBlobUrl : file.size === 0);

  useLayoutEffect(() => {
    const el = waveTrackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      setWaveTrackPx(el.clientWidth);
    });
    ro.observe(el);
    setWaveTrackPx(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return undefined;
    let rafId = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const a = audioRef.current;
      if (a && !a.paused && Number.isFinite(a.duration)) {
        setCurrent(a.currentTime);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [playing]);

  const onTimeUpdate = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    setCurrent(a.currentTime);
  }, []);

  const onLoadedMeta = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    const d = a.duration;
    if (Number.isFinite(d)) setDuration(d);
  }, []);

  const onEnded = useCallback(() => {
    setPlaying(false);
    setCurrent(0);
    const a = audioRef.current;
    if (a) a.currentTime = 0;
  }, []);

  const pauseOthersInAttachments = useCallback(() => {
    const root = containerRef.current?.closest(
      ".lk-support-ticket__attachments, .lk-support-ticket-view__thread-voice-attachments",
    );
    if (!root) return;
    root.querySelectorAll(".lk-support-ticket__voice-audio-el").forEach((el) => {
      if (el !== audioRef.current) el.pause();
    });
  }, []);

  const togglePlay = useCallback(() => {
    if (playDisabled) return;
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      pauseOthersInAttachments();
      setPlayError(false);
      a.play()
        .then(() => setPlaying(true))
        .catch(() => {
          setPlaying(false);
          setPlayError(true);
        });
    } else {
      a.pause();
      setPlaying(false);
    }
  }, [pauseOthersInAttachments, playDisabled]);

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const clock = useMemo(() => formatMessageClock(file), [file]);
  const leftTime = playing || current > 0 ? current : duration;

  const seekToClientX = useCallback(
    (clientX) => {
      if (playDisabled) return;
      const track = waveTrackRef.current;
      const a = audioRef.current;
      if (!track || !a) return;
      const d = Number.isFinite(duration) && duration > 0 ? duration : a.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      const rect = track.getBoundingClientRect();
      const x = clientX - rect.left;
      const ratio = Math.min(1, Math.max(0, x / rect.width));
      const t = ratio * d;
      a.currentTime = t;
      setCurrent(t);
    },
    [duration, playDisabled],
  );

  const onWavePointerDown = useCallback(
    (e) => {
      if (playDisabled) return;
      if (e.button !== 0) return;
      const track = waveTrackRef.current;
      if (!track) return;
      seekToClientX(e.clientX);
      try {
        if (e.pointerId != null) track.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      const onMove = (ev) => {
        seekToClientX(ev.clientX);
      };
      const onUp = (ev) => {
        try {
          if (ev.pointerId != null) track.releasePointerCapture(ev.pointerId);
        } catch {
          /* noop */
        }
        track.removeEventListener("pointermove", onMove);
        track.removeEventListener("pointerup", onUp);
        track.removeEventListener("pointercancel", onUp);
      };
      track.addEventListener("pointermove", onMove);
      track.addEventListener("pointerup", onUp);
      track.addEventListener("pointercancel", onUp);
    },
    [playDisabled, seekToClientX],
  );

  const onRemoveClick = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const a = audioRef.current;
      if (a) {
        a.pause();
      }
      onRemove?.(fileIndex);
    },
    [fileIndex, onRemove],
  );

  return (
    <div
      ref={containerRef}
      className={`lk-support-ticket__voice${compactBar ? " lk-support-ticket__voice_compact-bar" : ""}${
        playing ? " lk-support-ticket__voice_playing" : ""
      }${threadUserStyle ? " lk-support-ticket__voice_thread-user" : ""}`}
      data-voice-id={String(fileIndex)}
    >
      <audio
        ref={audioRef}
        className="lk-support-ticket__voice-audio-el"
        preload="metadata"
        playsInline
        aria-label={`Голосовое вложение ${file.name}`}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMeta}
        onEnded={onEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div
        className={`lk-support-ticket__voice-bubble${
          threadFooterStamp ? " lk-support-ticket__voice-bubble_thread-stamp" : ""
        }`}
      >
        <div className="lk-support-ticket__voice-row">
          <button
            type="button"
            className="lk-support-ticket__voice-play"
            aria-label={playing ? "Пауза" : "Воспроизвести"}
            aria-disabled={playDisabled}
            disabled={playDisabled}
            title={
              authError
                ? "Не удалось загрузить аудио"
                : authLoading
                  ? "Загрузка…"
                  : playError
                    ? "Не удалось воспроизвести: браузер часто не играет webm (Safari/iOS). Запишите сообщение снова — на Apple-устройствах теперь используется m4a."
                    : playDisabled
                      ? "Воспроизведение недоступно"
                      : undefined
            }
            onClick={togglePlay}
          >
            {playing ? (
              <Pause size={20} strokeWidth={2} fill="currentColor" aria-hidden />
            ) : (
              <Play size={22} strokeWidth={0} fill="currentColor" className="lk-support-ticket__voice-play-icon" aria-hidden />
            )}
          </button>
          <div className="lk-support-ticket__voice-middle">
            <div
              ref={waveTrackRef}
              className="lk-support-ticket__voice-wave-track"
              role="slider"
              tabIndex={playDisabled ? -1 : 0}
              aria-label="Прогресс и перемотка"
              aria-valuemin={0}
              aria-valuemax={Math.round(Number.isFinite(duration) ? duration : 0)}
              aria-valuenow={Math.round(current)}
              aria-valuetext={`${formatMmSs(current)} из ${formatMmSs(duration)}`}
              onPointerDown={onWavePointerDown}
              onKeyDown={(e) => {
                if (playDisabled) return;
                const a = audioRef.current;
                if (!a || !Number.isFinite(duration) || duration <= 0) return;
                const step = Math.min(5, duration / 20);
                if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                  e.preventDefault();
                  a.currentTime = Math.max(0, a.currentTime - step);
                  setCurrent(a.currentTime);
                } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                  e.preventDefault();
                  a.currentTime = Math.min(duration, a.currentTime + step);
                  setCurrent(a.currentTime);
                } else if (e.key === "Home") {
                  e.preventDefault();
                  a.currentTime = 0;
                  setCurrent(0);
                } else if (e.key === "End") {
                  e.preventDefault();
                  a.currentTime = duration;
                  setCurrent(duration);
                }
              }}
            >
              <div className="lk-support-ticket__voice-wave-dim">
                {bars.map((h, i) => (
                  <span
                    key={`d-${i}`}
                    className="lk-support-ticket__voice-bar"
                    style={{ height: `${Math.max(4, Math.round(5 + h * 26))}px` }}
                  />
                ))}
              </div>
              {waveTrackPx > 0 ? (
                <div className="lk-support-ticket__voice-wave-hi" style={{ width: `${progress * 100}%` }}>
                  <div className="lk-support-ticket__voice-wave-dup" style={{ width: `${waveTrackPx}px` }}>
                    {bars.map((h, i) => (
                      <span
                        key={`u-${i}`}
                        className="lk-support-ticket__voice-bar lk-support-ticket__voice-bar_active"
                        style={{ height: `${Math.max(4, Math.round(5 + h * 26))}px` }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="lk-support-ticket__voice-meta-row">
              <span className="lk-support-ticket__voice-time-left">
                {formatMmSs(leftTime)}
                <span className="lk-support-ticket__voice-dot" aria-hidden />
              </span>
              <span className="lk-support-ticket__voice-time-right">
                <span>{clock}</span>
                <Check className="lk-support-ticket__voice-check" size={16} strokeWidth={2.5} aria-hidden />
              </span>
            </div>
          </div>
          {onRemove ? (
            <button
              type="button"
              className="lk-support-ticket__voice-remove"
              aria-label="Удалить голосовое сообщение"
              title="Удалить"
              onClick={onRemoveClick}
            >
              <X size={18} strokeWidth={2} aria-hidden />
            </button>
          ) : null}
        </div>
        {threadFooterStamp ? (
          <p className="lk-support-ticket-view__message-stamp">{threadFooterStamp}</p>
        ) : null}
      </div>
    </div>
  );
}
