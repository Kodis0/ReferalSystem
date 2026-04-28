/**
 * Выбор MIME для MediaRecorder: на Safari/iOS WebM в audio часто не воспроизводится,
 * поэтому там сначала пробуем audio/mp4.
 */
export function chooseVoiceRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const webkitMobile = /iPhone|iPad|iPod/i.test(ua);
  const safariDesktop = /Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua);
  const preferMp4 = webkitMobile || safariDesktop;

  if (preferMp4 && MediaRecorder.isTypeSupported("audio/mp4")) {
    return "audio/mp4";
  }
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) {
    return "audio/webm";
  }
  if (MediaRecorder.isTypeSupported("audio/mp4")) {
    return "audio/mp4";
  }
  return "";
}
