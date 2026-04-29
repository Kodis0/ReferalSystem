import { useCallback, useState } from "react";
import { API_ENDPOINTS } from "../../../config/api";
import { dispatchLkProgramListsRefetch } from "../lkProgramListsSync";
import fileToAvatarDataUrl from "./fileToAvatarDataUrl";
import "../owner-programs/owner-programs.css";

function SettingsIdentityAvatarIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" viewBox="0 0 28 28" aria-hidden="true">
      <path
        fill="currentColor"
        d="M22.17 6.42h-1.56l-.39-1.22A3.66 3.66 0 0 0 16.75 2.5h-5.5a3.66 3.66 0 0 0-3.47 2.7l-.4 1.22H5.83A3.66 3.66 0 0 0 2.17 10.08v9.09a3.66 3.66 0 0 0 3.66 3.66h16.34a3.66 3.66 0 0 0 3.66-3.66v-9.09a3.66 3.66 0 0 0-3.66-3.66Zm1.22 12.75c0 .67-.55 1.22-1.22 1.22H5.83c-.67 0-1.22-.55-1.22-1.22v-9.09c0-.67.55-1.22 1.22-1.22H8.5c.53 0 1-.34 1.16-.84l.65-1.95c.17-.5.63-.84 1.15-.84h5.08c.52 0 .98.34 1.15.84l.65 1.95c.17.5.63.84 1.15.84h2.68c.67 0 1.22.55 1.22 1.22v9.09Z"
      />
      <path
        fill="currentColor"
        d="M14 9.33a4.67 4.67 0 1 0 0 9.34 4.67 4.67 0 0 0 0-9.34Zm0 6.9a2.23 2.23 0 1 1 0-4.46 2.23 2.23 0 0 1 0 4.46Z"
      />
    </svg>
  );
}

function ProjectAvatarRemoveIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 8 8" aria-hidden="true">
      <path
        fill="currentColor"
        d="m5.41 4 1.3-1.29a1 1 0 0 0-1.42-1.42L4 2.59l-1.29-1.3a1 1 0 1 0-1.42 1.42L2.59 4l-1.3 1.29a1 1 0 0 0 0 1.42 1 1 0 0 0 1.42 0L4 5.41l1.29 1.3a1 1 0 0 0 1.42 0 1 1 0 0 0 0-1.42L5.41 4Z"
      />
    </svg>
  );
}

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Аватар аккаунта: выбор файла и удаление — те же классы, что у shell в `SiteProjectLayout`.
 */
export default function AccountSettingsAvatar({ user, fetchUser, setUser, disabled }) {
  /** Локальный превью URL на время запроса; после успеха сбрасываем — источник правды `user` из родителя. */
  const [pendingAvatar, setPendingAvatar] = useState(null);
  const [saveState, setSaveState] = useState("idle");
  const [error, setError] = useState("");

  const serverAvatar =
    user && typeof user.avatar_data_url === "string" ? user.avatar_data_url.trim() : "";
  const avatarDataUrl = pendingAvatar ?? serverAvatar;

  const patchAvatar = useCallback(
    async (nextUrl) => {
      const res = await fetch(API_ENDPOINTS.currentUser, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ avatar_data_url: nextUrl }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = payload?.detail ?? payload?.code;
        const detailMsg =
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail.join("\n")
              : detail != null
                ? String(detail)
                : "";
        throw new Error(detailMsg || `Не удалось сохранить фото (${res.status})`);
      }
      if (payload && typeof payload === "object" && "id" in payload && typeof setUser === "function") {
        setUser(payload);
      }
      await fetchUser();
      window.dispatchEvent(new CustomEvent("lk-account-avatar-updated"));
      dispatchLkProgramListsRefetch();
    },
    [fetchUser, setUser],
  );

  const handleAvatarChange = useCallback(
    async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      if (!file || disabled || !user) return;
      if (!file.type.startsWith("image/")) {
        setError("Нужен файл изображения");
        return;
      }
      setSaveState("saving");
      setError("");
      try {
        const next = await fileToAvatarDataUrl(file);
        setPendingAvatar(next);
        try {
          await patchAvatar(next);
        } finally {
          setPendingAvatar(null);
        }
        setSaveState("idle");
      } catch (err) {
        console.error(err);
        setPendingAvatar(null);
        setSaveState("error");
        setError(err instanceof Error && err.message ? err.message : "Не удалось сохранить фото");
      }
    },
    [disabled, user, patchAvatar],
  );

  const handleAvatarRemove = useCallback(
    async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled || !user || !avatarDataUrl || saveState === "saving") return;
      setSaveState("saving");
      setError("");
      try {
        await patchAvatar("");
        setSaveState("idle");
      } catch (err) {
        console.error(err);
        setSaveState("error");
        setError(err instanceof Error && err.message ? err.message : "Не удалось удалить фото");
      }
    },
    [disabled, user, avatarDataUrl, saveState, patchAvatar],
  );

  if (disabled || !user) {
    return (
      <div className="lk-settings__avatar lk-settings__avatar_static" aria-hidden="true">
        <span className="lk-settings__avatar-placeholder">
          <SettingsIdentityAvatarIcon />
        </span>
      </div>
    );
  }

  return (
    <div className="lk-settings__avatar-shell-wrap">
      <label
        className={`owner-programs__shell-avatar owner-programs__shell-avatar_action${
          avatarDataUrl ? " owner-programs__shell-avatar_has-media" : ""
        }${saveState === "saving" ? " owner-programs__shell-avatar_loading" : ""}`}
        aria-label="Фото профиля, нажмите чтобы заменить"
      >
        <input
          type="file"
          accept="image/gif, image/jpeg, image/png, image/webp"
          className="owner-programs__shell-avatar-input"
          onChange={handleAvatarChange}
          disabled={saveState === "saving"}
        />
        {avatarDataUrl ? (
          <>
            <img className="owner-programs__shell-avatar-image" src={avatarDataUrl} alt="Фото профиля" />
            <button
              type="button"
              className="owner-programs__shell-avatar-remove"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={handleAvatarRemove}
              disabled={saveState === "saving"}
              aria-label="Удалить фото профиля"
            >
              <ProjectAvatarRemoveIcon />
            </button>
          </>
        ) : (
          <span className="owner-programs__shell-avatar-placeholder" aria-hidden="true">
            <SettingsIdentityAvatarIcon />
          </span>
        )}
      </label>
      {error ? <p className="owner-programs__shell-avatar-note">{error}</p> : null}
    </div>
  );
}
