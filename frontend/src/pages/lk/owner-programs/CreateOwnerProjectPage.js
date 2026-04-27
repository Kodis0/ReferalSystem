import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../../config/api";
import "./CreateOwnerProjectPage.css";
import { PROJECT_OWNER_DESCRIPTION_MAX_CHARS } from "./projectOwnerFormLimits";

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function formatApiFieldErrors(payload) {
  if (!payload || typeof payload !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(payload)) {
    if (k === "detail" || k === "code") continue;
    if (Array.isArray(v)) parts.push(`${k}: ${v.join(" ")}`);
    else if (typeof v === "string") parts.push(`${k}: ${v}`);
  }
  return parts.join("\n");
}

function createRandomToken(length = 24) {
  const alphabet = "abcdef0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function svgToDataUrl(svg) {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function generateProjectAvatarDataUrl() {
  const palettes = [
    ["#0F172A", "#1D4ED8", "#1E3A8A", "#1D4ED8"],
    ["#172554", "#1D4ED8", "#1E40AF", "#2563EB"],
    ["#1E1B4B", "#1E40AF", "#1E3A8A", "#3B82F6"],
    ["#082F49", "#1D4ED8", "#0F3D91", "#2563EB"],
  ];
  const [bgStart, bgEnd, shapeA, shapeB] = palettes[Math.floor(Math.random() * palettes.length)];
  const seed = createRandomToken();

  const orb1x = 16 + Math.floor(Math.random() * 20);
  const orb1y = 16 + Math.floor(Math.random() * 20);
  const orb1r = 12 + Math.floor(Math.random() * 8);
  const orb2x = 40 + Math.floor(Math.random() * 18);
  const orb2y = 38 + Math.floor(Math.random() * 18);
  const orb2r = 11 + Math.floor(Math.random() * 9);
  const diamondCx = 24 + Math.floor(Math.random() * 24);
  const diamondCy = 24 + Math.floor(Math.random() * 24);
  const diamondR = 10 + Math.floor(Math.random() * 9);
  const rectX = 10 + Math.floor(Math.random() * 18);
  const rectY = 30 + Math.floor(Math.random() * 16);
  const rectW = 28 + Math.floor(Math.random() * 18);
  const rectH = 12 + Math.floor(Math.random() * 10);
  const rectRot = -24 + Math.floor(Math.random() * 49);
  const triangleX1 = 8 + Math.floor(Math.random() * 18);
  const triangleY1 = 40 + Math.floor(Math.random() * 16);
  const triangleX2 = 28 + Math.floor(Math.random() * 18);
  const triangleY2 = 12 + Math.floor(Math.random() * 18);
  const triangleX3 = 50 + Math.floor(Math.random() * 14);
  const triangleY3 = 44 + Math.floor(Math.random() * 16);
  const highlightX = 34 + Math.floor(Math.random() * 18);
  const highlightY = 8 + Math.floor(Math.random() * 16);
  const highlightR = 8 + Math.floor(Math.random() * 7);
  const rectRadius = Math.max(6, Math.floor(rectH / 2));

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" fill="none">
  <defs>
    <linearGradient id="bg-${seed}" x1="10" y1="6" x2="62" y2="66" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${bgStart}"/>
      <stop offset="1" stop-color="${bgEnd}"/>
    </linearGradient>
    <clipPath id="clip-${seed}">
      <circle cx="36" cy="36" r="36"/>
    </clipPath>
  </defs>
  <g clip-path="url(#clip-${seed})">
    <circle cx="36" cy="36" r="36" fill="url(#bg-${seed})"/>
    <circle cx="${orb1x}" cy="${orb1y}" r="${orb1r}" fill="${shapeA}" opacity="0.85"/>
    <circle cx="${orb2x}" cy="${orb2y}" r="${orb2r}" fill="${shapeB}" opacity="0.72"/>
    <rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" rx="${rectRadius}" fill="#FFFFFF" opacity="0.18" transform="rotate(${rectRot} 36 36)"/>
    <path d="M${diamondCx} ${diamondCy - diamondR} L${diamondCx + diamondR} ${diamondCy} L${diamondCx} ${diamondCy + diamondR} L${diamondCx - diamondR} ${diamondCy} Z" fill="#FFFFFF" opacity="0.28"/>
    <path d="M${triangleX1} ${triangleY1} L${triangleX2} ${triangleY2} L${triangleX3} ${triangleY3} Z" fill="${shapeB}" opacity="0.34"/>
    <circle cx="${highlightX}" cy="${highlightY}" r="${highlightR}" fill="#FFFFFF" opacity="0.12"/>
  </g>
</svg>`.trim();

  return svgToDataUrl(svg);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_decode_failed"));
    img.src = source;
  });
}

async function fileToAvatarDataUrl(file) {
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;

  const srcWidth = image.naturalWidth || image.width || size;
  const srcHeight = image.naturalHeight || image.height || size;
  const scale = Math.max(size / srcWidth, size / srcHeight);
  const drawWidth = srcWidth * scale;
  const drawHeight = srcHeight * scale;
  const dx = (size - drawWidth) / 2;
  const dy = (size - drawHeight) / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
  return canvas.toDataURL("image/jpeg", 0.84);
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

export default function CreateOwnerProjectPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarPreview, setAvatarPreview] = useState(() => generateProjectAvatarDataUrl());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const onAvatarChange = async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    try {
      const nextAvatar = await fileToAvatarDataUrl(f);
      if (nextAvatar) setAvatarPreview(nextAvatar);
    } catch (err) {
      console.error(err);
      setError("Не удалось обработать изображение");
    }
  };

  const clearAvatar = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    setAvatarPreview(generateProjectAvatarDataUrl());
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setFieldErrors({});
    try {
      const body = {
        display_name: displayName.trim(),
        avatar_data_url: avatarPreview.trim(),
      };
      const d = description.trim().slice(0, PROJECT_OWNER_DESCRIPTION_MAX_CHARS);
      if (d) body.description = d;

      const res = await fetch(API_ENDPOINTS.projectCreate, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 400 && payload && typeof payload === "object") {
          const fe = {};
          for (const [k, v] of Object.entries(payload)) {
            if (Array.isArray(v) && v.length) fe[k] = v.join(" ");
            else if (typeof v === "string") fe[k] = v;
          }
          setFieldErrors(fe);
        }
        const dtl = payload?.code ?? payload?.detail;
        const detailMsg =
          typeof dtl === "string" ? dtl : Array.isArray(dtl) ? dtl.join("\n") : dtl != null ? String(dtl) : "";
        const flat = formatApiFieldErrors(payload);
        setError(detailMsg || flat || `Не удалось создать проект (${res.status})`);
        return;
      }
      if (typeof payload?.id === "number") {
        navigate(`/lk/partner/project/${payload.id}/sites`, { replace: true });
        return;
      }
      navigate("/lk/partner", { replace: true });
      return;
    } catch (err) {
      console.error(err);
      setError("Сетевая ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="create-owner-project">
      <div className="page">
        <div className="page__returnButton">
          <Link className="tw-link link_primary link_s" to="/lk/partner">
            <svg xmlns="http://www.w3.org/2000/svg" width="7" height="13" fill="none" viewBox="0 0 7 13" aria-hidden>
              <path
                fill="currentColor"
                d="M1 6.99a1 1 0 0 1 .23-.64l4-5a1 1 0 0 1 1.54 1.29L3.29 6.99l3.32 4.35a1 1 0 0 1-.15 1.4A1 1 0 0 1 5 12.62l-3.83-5A1 1 0 0 1 1 7Z"
              />
            </svg>
            Назад
          </Link>
        </div>

        <div className="header">
          <div className="header__info noAvatar">
            <div className="headerTitleBlock">
              <h1 className="h1">Создать проект</h1>
            </div>
          </div>
        </div>

        <form className="form" onSubmit={onSubmit}>
          <label className="wrapper">
            <input
              ref={fileInputRef}
              type="file"
              name="avatar"
              accept="image/gif, image/jpeg, image/png, image/webp"
              className="input"
              onChange={onAvatarChange}
            />
            <div className="avatarWrapper">
              <div className="statusAvatarWrapper">
                <div className="avatar">
                  <img className="src" src={avatarPreview} alt="project-avatar" style={{ filter: "opacity(1)" }} />
                </div>
              </div>
            </div>
            <button type="button" className="closeButton" onClick={clearAvatar} aria-label="Сгенерировать новый аватар">
              <ProjectAvatarRemoveIcon />
            </button>
          </label>

          <label className="formControl">
            <div className="formControl__label">
              <span className="text text_s text_bold text_grey text_align_left">Название проекта</span>
            </div>
            <div className="input">
              <div className="inputWrapper">
                <input
                  className="inputField"
                  name="name"
                  value={displayName}
                  onChange={(ev) => setDisplayName(ev.target.value)}
                  autoComplete="off"
                  maxLength={200}
                  required
                />
              </div>
            </div>
            {fieldErrors.display_name ? <div className="fieldError">{fieldErrors.display_name}</div> : null}
          </label>

          <label className="formControl">
            <div className="formControl__label">
              <span className="text text_s text_bold text_grey text_align_left">Описание проекта</span>
            </div>
            <div className="input">
              <div className="inputWrapper">
                <input
                  className="inputField"
                  name="description"
                  value={description}
                  onChange={(ev) =>
                    setDescription(ev.target.value.slice(0, PROJECT_OWNER_DESCRIPTION_MAX_CHARS))
                  }
                  autoComplete="off"
                  maxLength={PROJECT_OWNER_DESCRIPTION_MAX_CHARS}
                />
              </div>
            </div>
            {fieldErrors.description ? <div className="fieldError">{fieldErrors.description}</div> : null}
          </label>

          {fieldErrors.platform_preset ? <div className="fieldError">{fieldErrors.platform_preset}</div> : null}
          {error ? <div className="formError">{error}</div> : null}

          <button
            type="submit"
            className="baseButton button button_size_medium baseButton__size_medium baseButton__color_primary"
            data-testid="submit-form-btn"
            data-test-id="submit-form-btn"
            disabled={loading}
          >
            Создать
          </button>
        </form>
      </div>
    </div>
  );
}
