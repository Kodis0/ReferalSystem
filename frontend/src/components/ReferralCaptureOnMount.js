import { useEffect } from "react";
import { API_ENDPOINTS } from "../config/api";

const STORAGE_PREFIX = "referral_capture_v1_";

/**
 * POST /referrals/capture/ once per session per ref, with credentials.
 * sessionStorage + synchronous "pending" avoids duplicate posts under StrictMode.
 * Terminal "fail" is only for HTTP 400 (invalid ref / bad payload). Network and
 * other HTTP errors clear the key so a refresh or later visit can retry.
 */
function ReferralCaptureOnMount() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("ref");
    const ref = raw != null ? String(raw).trim() : "";
    if (!ref) return;

    const key = `${STORAGE_PREFIX}${ref}`;
    const existing = sessionStorage.getItem(key);
    if (existing === "ok" || existing === "pending") return;

    sessionStorage.setItem(key, "pending");

    const body = JSON.stringify({
      ref,
      landing_url: window.location.href,
    });

    fetch(API_ENDPOINTS.referralCapture, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body,
    })
      .then((res) => {
        if (res.ok) {
          sessionStorage.setItem(key, "ok");
          return;
        }
        if (res.status === 400) {
          sessionStorage.setItem(key, "fail");
          return;
        }
        sessionStorage.removeItem(key);
      })
      .catch(() => {
        sessionStorage.removeItem(key);
      });
  }, []);

  return null;
}

export default ReferralCaptureOnMount;
