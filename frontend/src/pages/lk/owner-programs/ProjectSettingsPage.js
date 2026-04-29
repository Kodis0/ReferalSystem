import { useCallback, useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import { isUuidString } from "../../registration/postJoinNavigation";
import LkListboxSelect from "../components/LkListboxSelect";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "../settings/settings.css";
import "./CreateOwnerProjectPage.css";
import "./owner-programs.css";
import { emitSiteOwnerActivity } from "./siteOwnerActivityBus";
import {
  REFERRAL_LOCK_DAYS_MAX,
  REFERRAL_LOCK_DAYS_MIN,
  commissionPercentFromPayload,
  formatApiFieldErrors,
  normalizeCommissionPercentInput,
  normalizeReferralLockDaysInput,
  primaryOriginFromPayload,
  referralLockDaysAfterSaveFromResponse,
  referralLockDaysFromPayload,
  siteDescriptionFromPayload,
  siteNameFromPayload,
} from "./projectSettingsModel";

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function withSelectedSite(url, sitePublicId) {
  if (!sitePublicId) return url;
  const u = new URL(url, window.location.origin);
  u.searchParams.set("site_public_id", sitePublicId);
  return u.toString();
}

const PLATFORM_OPTIONS = [
  { value: "tilda", label: "Tilda" },
  { value: "generic", label: "Generic" },
];

export default function ProjectSettingsPage() {
  const outletContext = useOutletContext() || {};
  const { primarySitePublicId = "", reloadProjectHead } = outletContext;
  const { sitePublicId: routeSettingsSiteParam } = useParams();
  const routeSettingsSiteId =
    typeof routeSettingsSiteParam === "string" && isUuidString(routeSettingsSiteParam.trim())
      ? routeSettingsSiteParam.trim()
      : "";
  // Сайт из пути `/sites/:sitePublicId/settings` имеет приоритет; иначе — основной сайт (`/settings`).
  const id =
    routeSettingsSiteId ||
    (typeof primarySitePublicId === "string" ? primarySitePublicId.trim() : "");
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [origin, setOrigin] = useState("");
  const [platformPreset, setPlatformPreset] = useState("tilda");
  const [commissionPercent, setCommissionPercent] = useState("5");
  const [referralLockDays, setReferralLockDays] = useState("");

  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");

  const load = useCallback(async () => {
    if (!isUuidString(id)) return;
    setLoadState("loading");
    setLoadError("");
    try {
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, id), {
        method: "GET",
        headers: authHeaders(),
        credentials: "include",
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = payload?.code ?? payload?.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setLoadError(detailMsg || `Ошибка загрузки (${res.status})`);
        setLoadState("error");
        return;
      }
      setDisplayName(siteNameFromPayload(payload));
      setDescription(siteDescriptionFromPayload(payload));
      setOrigin(primaryOriginFromPayload(payload));
      setCommissionPercent(commissionPercentFromPayload(payload));
      setReferralLockDays(referralLockDaysFromPayload(payload));
      setPlatformPreset(
        payload.platform_preset === "generic" || payload.platform_preset === "tilda"
          ? payload.platform_preset
          : "tilda"
      );
      setLoadState("ready");
    } catch (e) {
      console.error(e);
      setLoadError("Сетевая ошибка");
      setLoadState("error");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onSave = async (e) => {
    e.preventDefault();
    if (!isUuidString(id)) return;
    setSaveState("saving");
    setSaveError("");
    try {
      const normalizedCommissionPercent = normalizeCommissionPercentInput(commissionPercent);
      const normalizedReferralLockDays = normalizeReferralLockDaysInput(referralLockDays);
      if (!normalizedReferralLockDays) {
        setSaveError("Укажите срок закрепления от 1 до 365 дней.");
        setSaveState("error");
        return;
      }
      const submittedReferralLockDays = Number(normalizedReferralLockDays);
      setCommissionPercent(normalizedCommissionPercent.toFixed(2));
      const patchPayload = {
        site_display_name: displayName.trim(),
        site_description: description.trim(),
        origin: origin.trim(),
        platform_preset: platformPreset,
        commission_percent: normalizedCommissionPercent.toFixed(2),
        referral_lock_days: submittedReferralLockDays,
      };
      const res = await fetch(withSelectedSite(API_ENDPOINTS.siteIntegration, id), {
        method: "PATCH",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify(patchPayload),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = payload?.code ?? payload?.detail;
        const detailMsg =
          typeof d === "string" ? d : Array.isArray(d) ? d.join("\n") : d != null ? String(d) : "";
        setSaveError(detailMsg || formatApiFieldErrors(payload) || `Не удалось сохранить (${res.status})`);
        setSaveState("error");
        return;
      }
      setDisplayName(siteNameFromPayload(payload));
      setDescription(siteDescriptionFromPayload(payload));
      setOrigin(primaryOriginFromPayload(payload));
      setCommissionPercent(commissionPercentFromPayload(payload));
      setReferralLockDays(referralLockDaysAfterSaveFromResponse(payload, patchPayload.referral_lock_days));
      setSaveState("success");
      emitSiteOwnerActivity(id);
      if (typeof reloadProjectHead === "function") {
        try {
          await reloadProjectHead();
        } catch {
          /* shell refresh best-effort */
        }
      }
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (err) {
      console.error(err);
      setSaveError("Сетевая ошибка");
      setSaveState("error");
    }
  };

  if (!isUuidString(id)) {
    return null;
  }

  return (
    <div id="create-owner-project" data-testid="project-settings-page">
      <div className="page">
        <div className="header">
          <div className="header__info noAvatar">
            <div className="headerTitleBlock">
              <h1 className="h1">Настройки сайта</h1>
            </div>
          </div>
        </div>

        {loadState === "loading" ? (
          <div
            className="owner-programs__connect-site-nested-create owner-programs__tab-page-skel_wide"
            role="status"
            aria-label="Загрузка настроек"
          >
            <div className="owner-programs__tab-page-skel owner-programs__tab-page-skel_wide">
              <span className="owner-programs__skel owner-programs__tab-page-skel_line-md" aria-hidden />
              <span className="owner-programs__skel owner-programs__tab-page-skel_line-sm" aria-hidden />
              <span className="owner-programs__skel owner-programs__tab-page-skel_input" aria-hidden />
              <span className="owner-programs__skel owner-programs__tab-page-skel_input" aria-hidden />
              <span className="owner-programs__skel owner-programs__tab-page-skel_textarea" aria-hidden />
              <span className="owner-programs__skel owner-programs__tab-page-skel_input" aria-hidden />
              <span className="owner-programs__skel owner-programs__tab-page-skel_btn" aria-hidden />
            </div>
          </div>
        ) : null}
        {loadState === "error" ? <div className="formError">{loadError}</div> : null}

        {loadState === "ready" ? (
            <div className="owner-programs__connect-site-nested-create">
              <form className="form" onSubmit={onSave} data-testid="project-settings-form">
              <label className="formControl" htmlFor="proj-settings-name">
                <div className="formControl__label">
                  <span className="text text_s text_bold text_grey text_align_left">Название сайта</span>
                </div>
                <div className="input">
                  <div className="inputWrapper">
                    <input
                      id="proj-settings-name"
                      className="inputField"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      maxLength={200}
                      autoComplete="off"
                    />
                  </div>
                </div>
              </label>

              <label className="formControl" htmlFor="proj-settings-description">
                <div className="formControl__label">
                  <span className="text text_s text_bold text_grey text_align_left">Описание сайта</span>
                </div>
                <div className="input">
                  <div className="inputWrapper">
                    <textarea
                      id="proj-settings-description"
                      className="inputField"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={2000}
                      rows={4}
                    />
                  </div>
                </div>
              </label>

              <label className="formControl" htmlFor="proj-settings-origin">
                <div className="formControl__label">
                  <span className="text text_s text_bold text_grey text_align_left">Домен или origin</span>
                </div>
                <div className="input">
                  <div className="inputWrapper">
                    <input
                      id="proj-settings-origin"
                      className="inputField"
                      value={origin}
                      onChange={(e) => setOrigin(e.target.value)}
                      placeholder="https://mysite.tilda.ws"
                      autoComplete="off"
                    />
                  </div>
                </div>
              </label>

              <div className="formControl">
                <div className="formControl__label" id="proj-settings-platform-label">
                  <span className="text text_s text_bold text_grey text_align_left">Платформа</span>
                </div>
                <div className="owner-programs__lk-listbox-select-scope">
                  <LkListboxSelect
                    value={platformPreset}
                    onChange={setPlatformPreset}
                    options={PLATFORM_OPTIONS}
                    labelledBy="proj-settings-platform-label"
                    disabled={saveState === "saving"}
                    listboxId="proj-settings-platform-listbox"
                    dataTestId="proj-settings-platform-select"
                  />
                </div>
              </div>

              <label className="formControl" htmlFor="proj-settings-commission-percent">
                <div className="formControl__label">
                  <span className="text text_s text_bold text_grey text_align_left">Процент выплаты рефералам</span>
                </div>
                <div className="input">
                  <div className="inputWrapper">
                    <input
                      id="proj-settings-commission-percent"
                      className="inputField"
                      type="text"
                      inputMode="decimal"
                      value={commissionPercent}
                      onChange={(e) => setCommissionPercent(e.target.value)}
                      onBlur={() => setCommissionPercent(String(normalizeCommissionPercentInput(commissionPercent)))}
                      disabled={saveState === "saving"}
                    />
                  </div>
                </div>
              </label>

              <label className="formControl" htmlFor="proj-settings-referral-lock-days">
                <div className="formControl__label">
                  <span className="text text_s text_bold text_grey text_align_left">
                    Срок закрепления пользователя за рефералом, дней
                  </span>
                </div>
                <div className="input">
                  <div className="inputWrapper">
                    <input
                      id="proj-settings-referral-lock-days"
                      className="inputField"
                      type="number"
                      name="referral_lock_days"
                      min={REFERRAL_LOCK_DAYS_MIN}
                      max={REFERRAL_LOCK_DAYS_MAX}
                      step="1"
                      inputMode="numeric"
                      value={referralLockDays}
                      onChange={(e) => setReferralLockDays(e.target.value)}
                      onBlur={(e) => setReferralLockDays(String(normalizeReferralLockDaysInput(e.target.value)))}
                      disabled={saveState === "saving"}
                    />
                  </div>
                </div>
              </label>

              {saveError ? <div className="formError">{saveError}</div> : null}
              {saveState === "success" ? (
                <p className="owner-programs__muted" data-testid="settings-save-success">
                  Сохранено
                </p>
              ) : null}

              <div className="owner-programs__connect-site-form-actions">
                <button
                  type="submit"
                  className="baseButton button button_size_medium baseButton__size_medium baseButton__color_primary"
                  disabled={saveState === "saving"}
                >
                  {saveState === "saving" ? "Сохранение…" : "Сохранить"}
                </button>
              </div>
              </form>
            </div>
        ) : null}
      </div>
    </div>
  );
}
