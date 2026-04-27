import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { deferResizeObserverCallback } from "../../../resizeObserverDefer";
import { flushSync } from "react-dom";
import { Hand, Move, Type, X } from "lucide-react";
import { useParams } from "react-router-dom";
import { applyNodeChanges, Background, Panel, ReactFlow, useReactFlow, useStore } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { API_ENDPOINTS } from "../../../config/api";
import { ownerSitesAuthHeaders } from "./ownerSitesListApi";
import { withSitePublicIdQuery } from "./siteReachability";
import EditableReferralBlockPreview, { createDefaultBuilderBlockConfig } from "./EditableReferralBlockPreview";
import {
  buildSiteStyleProfileFromScreenshotBlock,
  screenshotBlockForInsertionSlot,
  themeForSiteStyleProfile,
} from "./siteStyleProfile";

const PREVIEW_CHIPS = ["до 15%", "личная ссылка", "выплаты ежемесячно"];
const SCAN_ERROR_MESSAGE = "Не удалось просканировать страницу. Проверьте URL или попробуйте другую страницу.";
const SCAN_LOADER_STATUS_MESSAGES = [
  "Подключаемся к странице и проверяем доступность…",
  "Загружаем макет и разбираем структуру…",
  "Выделяем логические секции по визуальным границам…",
  "Снимаем области и готовим слоты для вставок…",
  "Собираем данные для рабочей области…",
  "Почти готово — финализируем импорт…",
];
const DEFAULT_SCAN_META = {
  visualImportAvailable: null,
  visualMode: "",
  detail: "",
  platform: "generic",
  visualVideoCount: 0,
};

const REFERRAL_BUILDER_WORKSPACE_VERSION = 1;

function buildReferralBuilderWorkspaceSnapshot({
  scanUrl,
  scannedBlocks,
  scanMeta,
  builderBlocks,
  selectedInsertionSlotId,
  displayNodes,
}) {
  const flowNodePositions = {};
  for (const n of displayNodes) {
    if (n && n.id && n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y)) {
      flowNodePositions[n.id] = { x: n.position.x, y: n.position.y };
    }
  }
  return {
    v: REFERRAL_BUILDER_WORKSPACE_VERSION,
    scanUrl: typeof scanUrl === "string" ? scanUrl : "",
    scannedBlocks: Array.isArray(scannedBlocks) ? scannedBlocks : [],
    scanMeta: scanMeta && typeof scanMeta === "object" ? { ...DEFAULT_SCAN_META, ...scanMeta } : { ...DEFAULT_SCAN_META },
    builderBlocks: Array.isArray(builderBlocks) ? builderBlocks : [],
    selectedInsertionSlotId: typeof selectedInsertionSlotId === "string" ? selectedInsertionSlotId : "",
    flowNodePositions,
  };
}

function parseReferralBuilderWorkspace(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (raw.v != null && raw.v !== REFERRAL_BUILDER_WORKSPACE_VERSION) {
    return null;
  }
  const sm = raw.scanMeta && typeof raw.scanMeta === "object" ? raw.scanMeta : {};
  return {
    scanUrl: typeof raw.scanUrl === "string" ? raw.scanUrl : "",
    scannedBlocks: Array.isArray(raw.scannedBlocks) ? raw.scannedBlocks : [],
    scanMeta: {
      visualImportAvailable: sm.visualImportAvailable ?? DEFAULT_SCAN_META.visualImportAvailable,
      visualMode: typeof sm.visualMode === "string" ? sm.visualMode : "",
      detail: typeof sm.detail === "string" ? sm.detail : "",
      platform: sm.platform === "tilda" ? "tilda" : "generic",
      visualVideoCount:
        typeof sm.visualVideoCount === "number" && Number.isFinite(sm.visualVideoCount) ? sm.visualVideoCount : 0,
    },
    builderBlocks: Array.isArray(raw.builderBlocks) ? raw.builderBlocks : [],
    flowNodePositions:
      raw.flowNodePositions && typeof raw.flowNodePositions === "object" && !Array.isArray(raw.flowNodePositions)
        ? raw.flowNodePositions
        : {},
    selectedInsertionSlotId: typeof raw.selectedInsertionSlotId === "string" ? raw.selectedInsertionSlotId : "",
  };
}
const PAGE_COLUMN_X = -620;
const IMPORTED_PAGE_STACK_X = -520;
const REFERRAL_COLUMN_X = 160;
const REFERRAL_DEFAULT_Y = 160;
/** Зум канваса сразу после успешного визуального импорта (стек скриншотов). */
const POST_IMPORT_SCREENSHOT_ZOOM = 1.2;

const DEBUG_VISUAL_IMPORT_LAYERS = process.env.REACT_APP_DEBUG_VISUAL_IMPORT_LAYERS === "true";
/** В Chrome Document View Transition + большой канвас часто даёт просадку FPS; по умолчанию выкл. Включить: REACT_APP_REFERRAL_BUILDER_DOCUMENT_VIEW_TRANSITION=true */
const REFERRAL_BUILDER_DOCUMENT_VIEW_TRANSITION =
  process.env.REACT_APP_REFERRAL_BUILDER_DOCUMENT_VIEW_TRANSITION === "true";

function newBuilderBlockId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `bb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function blockGroupId(block) {
  const g = block?.groupId ?? block?.group_id;
  if (typeof g === "string" && g.trim()) {
    return g.trim();
  }
  return typeof block?.id === "string" && block.id.trim() ? block.id.trim() : "";
}

function blockIsContinuation(block) {
  if (block && typeof block.isContinuation === "boolean") {
    return block.isContinuation;
  }
  if (block && typeof block.is_continuation === "boolean") {
    return block.is_continuation;
  }
  return false;
}

function blockAllowInsertBefore(block) {
  const v = block?.allowInsertBefore ?? block?.allow_insert_before;
  if (v === true) {
    return true;
  }
  if (v === false) {
    return false;
  }
  return null;
}

function blockAllowInsertAfter(block) {
  const v = block?.allowInsertAfter ?? block?.allow_insert_after;
  if (v === true) {
    return true;
  }
  if (v === false) {
    return false;
  }
  return null;
}

function insertionSlotIdBefore(block) {
  return `before-${blockGroupId(block)}`;
}

function insertionSlotIdAfter(block) {
  return `after-${blockGroupId(block)}`;
}

function shouldShowSlotAfter(block, nextBlock) {
  if (!block) {
    return false;
  }
  const explicit = blockAllowInsertAfter(block);
  if (explicit === false) {
    return false;
  }
  if (nextBlock && blockIsContinuation(nextBlock)) {
    return false;
  }
  if (explicit === true) {
    return true;
  }
  if (nextBlock) {
    const g1 = blockGroupId(block);
    const g2 = blockGroupId(nextBlock);
    if (g1 && g2 && g1 === g2) {
      return false;
    }
  }
  return true;
}

function shouldShowSlotBefore(block, prevBlock, firstIsHeader, blockIndex) {
  if (!block || blockIsContinuation(block)) {
    return false;
  }
  if (firstIsHeader && blockIndex === 1 && prevBlock?.kind === "header") {
    return false;
  }
  const explicit = blockAllowInsertBefore(block);
  if (explicit === false) {
    return false;
  }
  if (explicit === true) {
    return true;
  }
  if (prevBlock) {
    const g1 = blockGroupId(prevBlock);
    const g2 = blockGroupId(block);
    if (g1 && g2 && g1 === g2) {
      return false;
    }
  }
  return true;
}

/** Порядок слотов совпадает с порядком отрисовки (для legacy insertionIndex). */
function collectInsertionSlotIdsInOrder(blocks) {
  const out = [];
  const firstIsHeader = blocks[0]?.kind === "header";
  if (!firstIsHeader && blocks.length > 0 && shouldShowSlotBefore(blocks[0], null, firstIsHeader, 0)) {
    out.push(insertionSlotIdBefore(blocks[0]));
  }
  blocks.forEach((block, index) => {
    if (firstIsHeader && index === 0) {
      if (shouldShowSlotAfter(block, blocks[index + 1] ?? null)) {
        out.push(insertionSlotIdAfter(block));
      }
      return;
    }
    const next = blocks[index + 1];
    if (shouldShowSlotAfter(block, next ?? null)) {
      out.push(insertionSlotIdAfter(block));
    }
  });
  return out;
}

function builderBlockMatchesInsertionSlot(block, slotId, orderedSlotIds) {
  if (!slotId || !block) {
    return false;
  }
  if (typeof block.insertionSlotId === "string" && block.insertionSlotId) {
    return block.insertionSlotId === slotId;
  }
  if (Number.isInteger(block.insertionIndex) && orderedSlotIds.length > 0) {
    const mapped = orderedSlotIds[block.insertionIndex];
    return mapped === slotId;
  }
  return false;
}

function firstVisibleInsertionSlotId(blocks) {
  const ordered = collectInsertionSlotIdsInOrder(blocks);
  return ordered[0] ?? "";
}

function remapBuilderBlocksAfterScreenshotRemove(builderBlocks, remainingScreenshotBlocks) {
  const slotIds = collectInsertionSlotIdsInOrder(remainingScreenshotBlocks);
  const valid = new Set(slotIds);
  const fallback = slotIds[0] || "";
  return builderBlocks.map((b) => {
    if (typeof b.insertionSlotId === "string" && b.insertionSlotId && valid.has(b.insertionSlotId)) {
      return b;
    }
    if (!fallback) {
      return b;
    }
    return { ...b, insertionSlotId: fallback };
  });
}

/** @internal exported for unit tests */
export {
  shouldShowSlotAfter,
  shouldShowSlotBefore,
  collectInsertionSlotIdsInOrder,
  blockGroupId,
  blockIsContinuation,
};

/** Временно `true` — логи onNodeDrag* в консоль (проверка цепочки drag). */
const DEBUG_REFERRAL_BUILDER_DRAG = false;

function numericOr(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function isTypingIntoField(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target.isContentEditable;
}

function mergeFlowNodePositions(prev, fresh) {
  if (!fresh.length) {
    return fresh;
  }
  const prevById = new Map(prev.map((node) => [node.id, node]));
  return fresh.map((freshNode) => {
    const prevNode = prevById.get(freshNode.id);
    if (!prevNode) {
      return freshNode;
    }
    return {
      ...freshNode,
      position: prevNode.position,
      selected: prevNode.selected,
      dragging: prevNode.dragging,
    };
  });
}

function WorkspaceChromeMenuIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm14 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
      />
    </svg>
  );
}

function WorkspaceChromeAddIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M19 11h-6V5a1 1 0 0 0-2 0v6H5a1 1 0 0 0 0 2h6v6a1 1 0 0 0 2 0v-6h6a1 1 0 0 0 0-2Z" />
    </svg>
  );
}

function FullscreenIcon({ active = false }) {
  if (active) {
    return (
      <svg
        viewBox="0 0 16 16"
        className="owner-programs__referral-builder-control-icon"
        aria-hidden="true"
      >
        <path d="M6 2H2v4" />
        <path d="M10 2h4v4" />
        <path d="M2 10v4h4" />
        <path d="M14 10v4h-4" />
        <path d="M6 6 2 2" />
        <path d="M10 6 14 2" />
        <path d="M6 10 2 14" />
        <path d="M10 10 14 14" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 16 16"
      className="owner-programs__referral-builder-control-icon"
      aria-hidden="true"
    >
      <path d="M6 2H2v4" />
      <path d="M10 2h4v4" />
      <path d="M2 10v4h4" />
      <path d="M14 10v4h-4" />
      <path d="M6 2 2 6" />
      <path d="M10 2 14 6" />
      <path d="M2 10 6 14" />
      <path d="M14 10 10 14" />
    </svg>
  );
}

function ReferralBuilderZoomMinusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="19" height="18" fill="none" viewBox="0 0 19 18" aria-hidden="true">
      <path fill="currentColor" d="M4.47 8.25h10.5a.75.75 0 1 1 0 1.5H4.47a.75.75 0 0 1 0-1.5Z" />
    </svg>
  );
}

function ReferralBuilderZoomPlusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="19" height="18" fill="none" viewBox="0 0 19 18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14.97 8.25h-4.5v-4.5a.75.75 0 1 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 1 0 1.5 0v-4.5h4.5a.75.75 0 1 0 0-1.5Z"
      />
    </svg>
  );
}

function ReferralBuilderExpandedToolDock({ tool, onToolChange }) {
  return (
    <Panel position="bottom-center" className="owner-programs__referral-builder-expanded-dock">
      <div className="owner-programs__referral-builder-expanded-dock__tools" role="toolbar" aria-label="Инструменты холста">
        <button
          type="button"
          className={`owner-programs__referral-builder-expanded-dock__btn${tool === "move" ? " is-active" : ""}`}
          onClick={() => onToolChange("move")}
          aria-pressed={tool === "move"}
          aria-label="Move — перемещение и выбор, клавиша V"
          title="Move (V)"
        >
          <Move className="owner-programs__referral-builder-expanded-dock__icon" size={18} strokeWidth={2} aria-hidden />
          <span className="owner-programs__referral-builder-expanded-dock__label">Move</span>
          <kbd className="owner-programs__referral-builder-expanded-dock__kbd">V</kbd>
        </button>
        <button
          type="button"
          className={`owner-programs__referral-builder-expanded-dock__btn${tool === "text" ? " is-active" : ""}`}
          onClick={() => onToolChange("text")}
          aria-pressed={tool === "text"}
          aria-label="Text — редактирование текста в блоках, клавиша T"
          title="Text (T)"
        >
          <Type className="owner-programs__referral-builder-expanded-dock__icon" size={18} strokeWidth={2} aria-hidden />
          <span className="owner-programs__referral-builder-expanded-dock__label">Text</span>
          <kbd className="owner-programs__referral-builder-expanded-dock__kbd">T</kbd>
        </button>
        <button
          type="button"
          className={`owner-programs__referral-builder-expanded-dock__btn${tool === "hand" ? " is-active" : ""}`}
          onClick={() => onToolChange("hand")}
          aria-pressed={tool === "hand"}
          aria-label="Hand — панорама холста, клавиша H"
          title="Hand (H)"
        >
          <Hand className="owner-programs__referral-builder-expanded-dock__icon" size={18} strokeWidth={2} aria-hidden />
          <span className="owner-programs__referral-builder-expanded-dock__label">Hand</span>
          <kbd className="owner-programs__referral-builder-expanded-dock__kbd">H</kbd>
        </button>
      </div>
    </Panel>
  );
}

function ReferralBuilderFlowToolbar({ onToggleFullscreen, fullscreenTitle, isExpanded }) {
  const { zoomIn, zoomOut } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const minZoom = useStore((s) => s.minZoom);
  const maxZoom = useStore((s) => s.maxZoom);
  const minReached = zoom <= minZoom;
  const maxReached = zoom >= maxZoom;
  const zoomPercentLabel = `${Math.round(zoom * 100)}%`;

  return (
    <Panel position="bottom-left" className="owner-programs__referral-builder-flow-toolbar">
      <div className="owner-programs__referral-builder-zoom-container">
        <button
          type="button"
          className="owner-programs__referral-builder-zoom-btn"
          onClick={() => zoomOut()}
          disabled={minReached}
          aria-label="Уменьшить масштаб"
          title="Уменьшить"
        >
          <ReferralBuilderZoomMinusIcon />
        </button>
        <p className="owner-programs__referral-builder-zoom-label">{zoomPercentLabel}</p>
        <button
          type="button"
          className="owner-programs__referral-builder-zoom-btn"
          onClick={() => zoomIn()}
          disabled={maxReached}
          aria-label="Увеличить масштаб"
          title="Увеличить"
        >
          <ReferralBuilderZoomPlusIcon />
        </button>
      </div>
      <span className="owner-programs__referral-builder-flow-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="owner-programs__referral-builder-zoom-btn owner-programs__referral-builder-flow-toolbar-fs"
        onClick={onToggleFullscreen}
        aria-label={fullscreenTitle}
        title={fullscreenTitle}
      >
        <FullscreenIcon active={isExpanded} />
      </button>
    </Panel>
  );
}

function percentOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Пиксельный rect overlay: из API или из процентов относительно размера скриншота-блока. */
function overlayRectPixels(item, blockW, blockH) {
  const rawX = item.x ?? item.doc_x ?? item.docX;
  if (rawX !== undefined && rawX !== null && Number.isFinite(Number(rawX))) {
    return {
      x: Math.round(Number(item.x ?? item.doc_x ?? item.docX)),
      y: Math.round(Number(item.y ?? item.doc_y ?? item.docY ?? 0)),
      width: Math.max(0, Math.round(Number(item.width ?? item.doc_w ?? item.docW ?? 0))),
      height: Math.max(0, Math.round(Number(item.height ?? item.doc_h ?? item.docH ?? 0))),
    };
  }
  const bw = Math.max(1, numericOr(blockW, 1));
  const bh = Math.max(1, numericOr(blockH, 1));
  return {
    x: Math.round((percentOrZero(item.x_percent ?? item.xPercent) / 100) * bw),
    y: Math.round((percentOrZero(item.y_percent ?? item.yPercent) / 100) * bh),
    width: Math.max(0, Math.round((percentOrZero(item.width_percent ?? item.widthPercent) / 100) * bw)),
    height: Math.max(0, Math.round((percentOrZero(item.height_percent ?? item.heightPercent) / 100) * bh)),
  };
}

function videoCoveragePx(video, sectionW, sectionH) {
  const area = Math.max(1, numericOr(sectionW, 1) * numericOr(sectionH, 1));
  return ((video.width || 0) * (video.height || 0)) / area;
}

function overlayIntersectsPx(a, b) {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

function filterVisibleForegroundOverlays(foregroundOverlays, videoOverlays, sectionW, sectionH) {
  if (!videoOverlays.length) {
    return [];
  }
  const sw = numericOr(sectionW, 1);
  const sh = numericOr(sectionH, 1);
  const hasBackgroundVideo = videoOverlays.some((v) => videoCoveragePx(v, sw, sh) >= 0.55);
  return foregroundOverlays.filter((fg) => {
    if (hasBackgroundVideo) {
      return true;
    }
    return videoOverlays.some((video) => overlayIntersectsPx(fg, video));
  });
}

function normalizeMediaOverlays(block) {
  const raw = block?.media_overlays ?? block?.mediaOverlays;
  if (!Array.isArray(raw)) {
    return [];
  }
  const bw = numericOr(block?.width, 1200);
  const bh = numericOr(block?.height, 640);
  return raw
    .map((item, overlayIndex) => {
      if (!item || typeof item !== "object" || item.type !== "video") {
        return null;
      }
      const src = typeof item.src === "string" ? item.src.trim() : "";
      if (!src) {
        return null;
      }
      const poster = typeof item.poster === "string" ? item.poster.trim() : "";
      const { x, y, width, height } = overlayRectPixels(item, bw, bh);
      return {
        type: "video",
        src,
        poster,
        x,
        y,
        width,
        height,
        muted: true,
        autoplay: item.autoplay !== false,
        loop: item.loop !== false,
        playsInline: item.plays_inline !== false && item.playsInline !== false,
        overlayIndex,
      };
    })
    .filter(Boolean);
}

function normalizeForegroundStyle(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const pick = (snake, camel) => {
    const v = raw[snake] ?? raw[camel];
    if (v === undefined || v === null) {
      return "";
    }
    return String(v);
  };
  return {
    color: pick("color", "color"),
    fontFamily: pick("font_family", "fontFamily"),
    fontSize: pick("font_size", "fontSize"),
    fontWeight: pick("font_weight", "fontWeight"),
    lineHeight: pick("line_height", "lineHeight"),
    textAlign: pick("text_align", "textAlign"),
    letterSpacing: pick("letter_spacing", "letterSpacing"),
    textTransform: pick("text_transform", "textTransform"),
    backgroundColor: pick("background_color", "backgroundColor"),
    borderRadius: pick("border_radius", "borderRadius"),
    padding: pick("padding", "padding"),
    border: pick("border", "border"),
    minHeight: pick("min_height", "minHeight"),
    height: pick("height", "height"),
  };
}

function normalizeForegroundOverlays(block) {
  const raw = block?.foreground_overlays ?? block?.foregroundOverlays;
  if (!Array.isArray(raw)) {
    return [];
  }
  const bw = numericOr(block?.width, 1200);
  const bh = numericOr(block?.height, 640);
  return raw
    .map((item, overlayIndex) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const t = String(item.type || "text").toLowerCase();
      const type = t === "button" ? "button" : "text";
      const text = typeof item.text === "string" ? item.text.trim() : "";
      if (!text) {
        return null;
      }
      const href = typeof item.href === "string" ? item.href.trim() : "";
      const { x, y, width, height } = overlayRectPixels(item, bw, bh);
      return {
        type,
        text,
        href,
        x,
        y,
        width,
        height,
        style: normalizeForegroundStyle(item.style || {}),
        overlayIndex,
      };
    })
    .filter(Boolean);
}

function normalizeScannedBlocks(payload) {
  const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
  const platform = payload?.platform === "tilda" ? "tilda" : "generic";
  return blocks
    .map((block, index) => {
      if (!block || typeof block !== "object") {
        return null;
      }
      const title = typeof block.title === "string" ? block.title.trim() : "";
      const selector = typeof block.selector === "string" ? block.selector.trim() : "";
      return {
        id: typeof block.id === "string" && block.id.trim() ? block.id.trim() : `site-block-${index + 1}`,
        selector,
        title: title || `Блок ${index + 1}`,
        previewText: typeof block.preview_text === "string" ? block.preview_text.trim() : "",
        snapshotHtml: typeof block.snapshot_html === "string" ? block.snapshot_html : "",
        screenshotDataUrl: (() => {
          const snake = typeof block.screenshot_data_url === "string" ? block.screenshot_data_url.trim() : "";
          const camel = typeof block.screenshotDataUrl === "string" ? block.screenshotDataUrl.trim() : "";
          return snake || camel;
        })(),
        screenshotUrl: typeof block.screenshot_url === "string" ? block.screenshot_url.trim() : "",
        kind: typeof block.kind === "string" && block.kind.trim() ? block.kind.trim() : "generic",
        position: typeof block.position === "number" ? block.position : index + 1,
        width: numericOr(block.width, 1200),
        height: numericOr(block.height, 640),
        platform:
          typeof block.platform === "string" && block.platform.trim() ? block.platform.trim() : platform,
        mediaOverlays: normalizeMediaOverlays(block),
        foregroundOverlays: normalizeForegroundOverlays(block),
        groupId: (() => {
          const g = block.group_id ?? block.groupId;
          return typeof g === "string" && g.trim() ? g.trim() : "";
        })(),
        isContinuation: Boolean(block.is_continuation ?? block.isContinuation),
        allowInsertBefore: (() => {
          const v = block.allow_insert_before ?? block.allowInsertBefore;
          if (v === true || v === false) return v;
          return null;
        })(),
        allowInsertAfter: (() => {
          const v = block.allow_insert_after ?? block.allowInsertAfter;
          if (v === true || v === false) return v;
          return null;
        })(),
        debug_clip: block.debug_clip && typeof block.debug_clip === "object" ? block.debug_clip : null,
        debugClip: block.debugClip && typeof block.debugClip === "object" ? block.debugClip : null,
      };
    })
    .filter(Boolean);
}

function normalizeScanMeta(payload) {
  const blocks = normalizeScannedBlocks(payload);
  const rawCount = payload?.visual_video_count;
  const visualVideoCount = typeof rawCount === "number" && Number.isFinite(rawCount) ? rawCount : 0;
  return {
    blocks,
    visualImportAvailable:
      payload?.visual_import_available === false
        ? false
        : blocks.some((block) => Boolean(block.screenshotDataUrl || block.screenshotUrl || block.snapshotHtml)),
    visualMode: typeof payload?.visual_mode === "string" ? payload.visual_mode.trim() : "",
    detail: typeof payload?.detail === "string" ? payload.detail.trim() : "",
    platform: payload?.platform === "tilda" ? "tilda" : "generic",
    visualVideoCount,
  };
}

function ReferralPreviewCard({ inline = false, testId = null }) {
  return (
    <div
      className={`owner-programs__referral-preview-card${inline ? " owner-programs__referral-preview-card--inline" : ""}`}
      data-testid={testId || undefined}
    >
      <div className="owner-programs__referral-preview-browser">
        <span className="owner-programs__referral-preview-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="owner-programs__referral-preview-domain">your-site.ru</span>
      </div>

      <div className="owner-programs__referral-preview-hero">
        <span className="owner-programs__referral-preview-badge">Партнерская программа</span>
        <h3 className="owner-programs__referral-preview-title">Станьте рефералом магазина</h3>
        <p className="owner-programs__referral-preview-description">
          Получайте вознаграждение за клиентов, которые приходят по вашей ссылке.
        </p>

        <div className="owner-programs__referral-preview-chips" aria-label="Преимущества блока">
          {PREVIEW_CHIPS.map((chip) => (
            <span key={chip} className="owner-programs__referral-preview-chip">
              {chip}
            </span>
          ))}
        </div>

        <button type="button" className="owner-programs__referral-preview-button nodrag nopan">
          Стать рефералом
        </button>
      </div>
    </div>
  );
}

function ReferralPreviewNode() {
  return <ReferralPreviewCard testId="referral-builder-preview-node" />;
}

function SiteImportedBlockNode({ data }) {
  const selectorLabel = data.selector || (data.id ? `#${data.id}` : "selector unavailable");
  const isSelected = Boolean(data?.isSelected);
  const handleClick = useCallback(() => {
    if (typeof data?.onSelectBlock === "function" && data?.blockId) {
      data.onSelectBlock(data.blockId);
    }
  }, [data]);
  const handleKeyDown = useCallback(
    (event) => {
      if ((event.key === "Enter" || event.key === " ") && typeof data?.onSelectBlock === "function" && data?.blockId) {
        event.preventDefault();
        data.onSelectBlock(data.blockId);
      }
    },
    [data],
  );

  return (
    <div
      className={`owner-programs__imported-site-block-node${isSelected ? " is-selected" : ""}`}
      data-testid="imported-site-block-node"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected ? "true" : "false"}
    >
      <div className="owner-programs__imported-site-block-node-bar">
        <span className="owner-programs__imported-site-block-node-position">#{data.position}</span>
        <span className="owner-programs__imported-site-block-node-selector">{selectorLabel}</span>
      </div>
      <iframe
        className="owner-programs__imported-site-block-node-frame"
        data-testid="imported-site-block-iframe"
        title="Imported site block preview"
        sandbox=""
        srcDoc={data.snapshotHtml || ""}
      />
    </div>
  );
}

/** Pixels from base screenshot over video — same coords as overlay layer (scaled with parent). */
function ForegroundScreenshotCrop({ screenshotSrc, sourceWidth, sourceHeight, layer }) {
  const cropPadding = layer.type === "button" ? 4 : 0;
  const x0 = Math.max(0, layer.x - cropPadding);
  const y0 = Math.max(0, layer.y - cropPadding);
  const w0 = Math.min(Math.max(0, sourceWidth - x0), layer.width + cropPadding * 2);
  const h0 = Math.min(Math.max(0, sourceHeight - y0), layer.height + cropPadding * 2);
  if (!screenshotSrc || w0 <= 0 || h0 <= 0) {
    return null;
  }
  return (
    <div
      className={`owner-programs__imported-section-foreground-crop owner-programs__imported-section-foreground-crop--${layer.type}`}
      style={{
        left: `${x0}px`,
        top: `${y0}px`,
        width: `${w0}px`,
        height: `${h0}px`,
      }}
      data-testid="imported-section-foreground-crop"
      data-foreground-type={layer.type}
      aria-hidden="true"
    >
      <img
        src={screenshotSrc}
        alt=""
        draggable={false}
        className="owner-programs__imported-section-foreground-crop-image"
        data-testid="imported-section-foreground-crop-image"
        style={{
          width: `${sourceWidth}px`,
          height: `${sourceHeight}px`,
          transform: `translate(${-x0}px, ${-y0}px)`,
        }}
      />
    </div>
  );
}

function InsertSlot({ slotId, active, onSelectInsertionSlot, afterBuilderBlockId = null }) {
  return (
    <div
      className={`imported-page-insert-slot${active ? " is-active" : ""}`}
      data-testid="imported-page-insert-slot"
      data-slot-id={slotId}
      data-insert-after-builder-block-id={afterBuilderBlockId || undefined}
    >
      <button
        type="button"
        className="imported-page-insert-slot__button nodrag nopan"
        onClick={() => {
          if (typeof onSelectInsertionSlot === "function") {
            onSelectInsertionSlot(slotId, afterBuilderBlockId ?? null);
          }
        }}
        aria-pressed={active ? "true" : "false"}
        aria-label="Вставить реферальный блок здесь"
        title="Вставить реферальный блок здесь"
      >
        <span className="imported-page-insert-slot__plus" aria-hidden="true">
          +
        </span>
      </button>
    </div>
  );
}

function ImportedScreenshotSection({ block, position, selected = false, onSelectBlock, overlayPointerEventsNone = true }) {
  const sectionRef = useRef(null);
  const [renderWidth, setRenderWidth] = useState(0);

  useEffect(() => {
    if (!sectionRef.current) {
      return undefined;
    }
    const el = sectionRef.current;
    let deferId = 0;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(deferId);
      deferId = deferResizeObserverCallback(() => {
        deferId = 0;
        setRenderWidth(entry.contentRect.width);
      });
    });
    observer.observe(el);
    return () => {
      clearTimeout(deferId);
      observer.disconnect();
    };
  }, []);

  const handleClick = useCallback(() => {
    if (typeof onSelectBlock === "function") {
      onSelectBlock(block.id);
    }
  }, [block.id, onSelectBlock]);
  const handleKeyDown = useCallback(
    (event) => {
      if ((event.key === "Enter" || event.key === " ") && typeof onSelectBlock === "function") {
        event.preventDefault();
        onSelectBlock(block.id);
      }
    },
    [block.id, onSelectBlock],
  );

  const sourceWidth = numericOr(block.width, 1440);
  const sourceHeight = numericOr(block.height, 900);
  const layerScale = renderWidth && sourceWidth ? renderWidth / sourceWidth : 1;
  const videoOverlays = useMemo(() => {
    const mediaOverlays = Array.isArray(block.mediaOverlays) ? block.mediaOverlays : [];
    return mediaOverlays.filter((overlay) => overlay && overlay.type === "video");
  }, [block.mediaOverlays]);
  const visibleForegroundOverlays = useMemo(() => {
    const foregroundOverlays = Array.isArray(block.foregroundOverlays) ? block.foregroundOverlays : [];
    return filterVisibleForegroundOverlays(foregroundOverlays, videoOverlays, sourceWidth, sourceHeight);
  }, [block.foregroundOverlays, videoOverlays, sourceWidth, sourceHeight]);
  const layerPointerEvents = overlayPointerEventsNone ? "none" : "auto";
  const screenshotSrc = block.screenshotDataUrl || block.screenshot_data_url || block.screenshotUrl || "";

  const videoElements = videoOverlays.map((overlay) => (
    <video
      key={`${block.id}-video-overlay-${overlay.overlayIndex}`}
      className="owner-programs__imported-section-video-overlay"
      data-testid="imported-section-video-overlay"
      src={overlay.src}
      poster={overlay.poster || undefined}
      autoPlay={overlay.autoplay !== false}
      muted
      loop={overlay.loop !== false}
      playsInline={overlay.playsInline !== false}
      controls={false}
      draggable={false}
      style={{
        left: `${overlay.x}px`,
        top: `${overlay.y}px`,
        width: `${overlay.width}px`,
        height: `${overlay.height}px`,
        zIndex: 1,
        pointerEvents: layerPointerEvents,
      }}
    />
  ));

  const foregroundCropElements = visibleForegroundOverlays.map((layer) => (
    <ForegroundScreenshotCrop
      key={`${block.id}-foreground-crop-${layer.overlayIndex}`}
      screenshotSrc={screenshotSrc}
      sourceWidth={sourceWidth}
      sourceHeight={sourceHeight}
      layer={layer}
    />
  ));

  const sectionKind = typeof block.kind === "string" ? block.kind : "";

  return (
    <div
      className={`imported-page-section${selected ? " is-selected" : ""}${
        sectionKind === "header" || sectionKind === "first_screen" ? " imported-page-section--header" : ""
      }${sectionKind === "footer" ? " imported-page-section--footer" : ""}`}
      data-testid="imported-page-section"
      data-position={position}
      data-section-kind={sectionKind || undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={selected ? "true" : "false"}
    >
      <div
        ref={sectionRef}
        className={`owner-programs__imported-screenshot-section${
          DEBUG_VISUAL_IMPORT_LAYERS ? " owner-programs__imported-screenshot-section--debug-layers" : ""
        }`}
      >
        {DEBUG_VISUAL_IMPORT_LAYERS ? (
          <div className="owner-programs__imported-screenshot-section__debug-scale" aria-hidden="true">
            scale {layerScale.toFixed(2)}
            <br />
            source width {sourceWidth}
            <br />
            source height {sourceHeight}
            <br />
            render width {Math.round(renderWidth)}
            <br />
            group {String(block.groupId ?? block.group_id ?? "—")}
            <br />
            continuation {String(blockIsContinuation(block))}
            <br />
            clip {String(block.debug_clip?.source ?? block.debugClip?.source ?? "—")}
          </div>
        ) : null}
        <img
          className="owner-programs__imported-section-screenshot"
          src={screenshotSrc}
          alt=""
          draggable={false}
          data-testid="imported-page-section-image"
        />
        <div
          className="owner-programs__imported-screenshot-section__layer"
          data-testid="imported-screenshot-overlay-layer"
          style={{
            width: `${sourceWidth}px`,
            height: `${sourceHeight}px`,
            transform: `scale(${layerScale})`,
          }}
        >
          {videoElements}
          {foregroundCropElements}
        </div>
      </div>
    </div>
  );
}

function ImportedPageStackNode({ data }) {
  const blocks = useMemo(() => (Array.isArray(data?.blocks) ? data.blocks : []), [data?.blocks]);
  const orderedSlotIds = useMemo(() => collectInsertionSlotIdsInOrder(blocks), [blocks]);
  const selectedInsertionSlotId =
    typeof data?.selectedInsertionSlotId === "string" && data.selectedInsertionSlotId
      ? data.selectedInsertionSlotId
      : null;
  const onSelectInsertionSlot =
    typeof data?.onSelectInsertionSlot === "function" ? data.onSelectInsertionSlot : () => {};
  const selectedBlockId = typeof data?.selectedBlockId === "string" ? data.selectedBlockId : "";
  const onSelectBlock = typeof data?.onSelectBlock === "function" ? data.onSelectBlock : () => {};
  const builderBlocks = Array.isArray(data?.builderBlocks) ? data.builderBlocks : [];
  const selectedBuilderBlockId = typeof data?.selectedBuilderBlockId === "string" ? data.selectedBuilderBlockId : "";
  const onSelectBuilderBlock =
    typeof data?.onSelectBuilderBlock === "function" ? data.onSelectBuilderBlock : () => {};
  const onInlineEditBuilderBlockField =
    typeof data?.onInlineEditBuilderBlockField === "function" ? data.onInlineEditBuilderBlockField : () => {};
  const textEditEnabled = data?.textEditEnabled === true;
  const overlayPointerEventsNone = data?.overlayPointerEventsNone !== false;
  const insertAfterBuilderBlockId =
    typeof data?.insertAfterBuilderBlockId === "string" && data.insertAfterBuilderBlockId.trim()
      ? data.insertAfterBuilderBlockId.trim()
      : null;
  const blocksAtSlot = (slotId) =>
    builderBlocks.filter((b) => {
      if (typeof b.insertionSlotId === "string" && b.insertionSlotId) {
        return b.insertionSlotId === slotId;
      }
      if (Number.isInteger(b.insertionIndex) && orderedSlotIds.length > 0) {
        const mapped = orderedSlotIds[b.insertionIndex];
        return mapped === slotId;
      }
      return false;
    });
  const renderSlotWithBlocks = (slotId) => {
    const slotBlocks = blocksAtSlot(slotId);
    const hasBuilderBlocks = slotBlocks.length > 0;
    const lastSlotBlockId = hasBuilderBlocks ? slotBlocks[slotBlocks.length - 1].id : null;
    return (
      <Fragment key={`slot-wrap-${slotId}`}>
        <InsertSlot
          slotId={slotId}
          active={selectedInsertionSlotId === slotId && !insertAfterBuilderBlockId}
          onSelectInsertionSlot={onSelectInsertionSlot}
        />
        {slotBlocks.flatMap((bBlock, index) => {
          const nodes = [];
          if (index > 0) {
            const prevId = slotBlocks[index - 1].id;
            nodes.push(
              <InsertSlot
                key={`insert-between-${slotId}-${prevId}`}
                slotId={slotId}
                afterBuilderBlockId={prevId}
                active={selectedInsertionSlotId === slotId && insertAfterBuilderBlockId === prevId}
                onSelectInsertionSlot={onSelectInsertionSlot}
              />,
            );
          }
          nodes.push(
            <EditableReferralBlockPreview
              key={bBlock.id}
              block={bBlock}
              selected={selectedBuilderBlockId === bBlock.id}
              onSelect={onSelectBuilderBlock}
              textEditEnabled={textEditEnabled}
              onInlineEditField={onInlineEditBuilderBlockField}
            />,
          );
          return nodes;
        })}
        {hasBuilderBlocks && lastSlotBlockId ? (
          <InsertSlot
            key={`insert-after-all-${slotId}`}
            slotId={slotId}
            afterBuilderBlockId={lastSlotBlockId}
            active={selectedInsertionSlotId === slotId && insertAfterBuilderBlockId === lastSlotBlockId}
            onSelectInsertionSlot={onSelectInsertionSlot}
          />
        ) : null}
      </Fragment>
    );
  };
  const firstIsHeader = blocks[0]?.kind === "header";

  const bodyChildren = [];
  if (!firstIsHeader && blocks.length > 0 && shouldShowSlotBefore(blocks[0], null, firstIsHeader, 0)) {
    const sid = insertionSlotIdBefore(blocks[0]);
    bodyChildren.push(renderSlotWithBlocks(sid));
  }

  blocks.forEach((block, index) => {
    bodyChildren.push(
      <Fragment key={block.id}>
        <ImportedScreenshotSection
          block={block}
          position={index + 1}
          selected={selectedBlockId === block.id}
          onSelectBlock={onSelectBlock}
          overlayPointerEventsNone={overlayPointerEventsNone}
        />
      </Fragment>,
    );
    if (firstIsHeader && index === 0) {
      if (shouldShowSlotAfter(block, blocks[index + 1] ?? null)) {
        const sid = insertionSlotIdAfter(block);
        bodyChildren.push(renderSlotWithBlocks(sid));
      }
      return;
    }
    const next = blocks[index + 1];
    if (shouldShowSlotAfter(block, next ?? null)) {
      const sid = insertionSlotIdAfter(block);
      bodyChildren.push(renderSlotWithBlocks(sid));
    }
  });

  return (
    <div className="imported-page-stack-node" data-testid="imported-page-stack-node">
      <div className="imported-page-stack-node__body">{bodyChildren}</div>
    </div>
  );
}

function SiteBlockNode({ data }) {
  const isSelected = Boolean(data?.isSelected);
  const handleClick = useCallback(() => {
    if (typeof data?.onSelectBlock === "function" && data?.blockId) {
      data.onSelectBlock(data.blockId);
    }
  }, [data]);
  const handleKeyDown = useCallback(
    (event) => {
      if ((event.key === "Enter" || event.key === " ") && typeof data?.onSelectBlock === "function" && data?.blockId) {
        event.preventDefault();
        data.onSelectBlock(data.blockId);
      }
    },
    [data],
  );

  return (
    <div
      className={`owner-programs__site-scan-node${isSelected ? " is-selected" : ""}`}
      data-testid="site-scan-block-node"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected ? "true" : "false"}
    >
      <div className="owner-programs__site-scan-node-top">
        <span className="owner-programs__site-scan-node-position">#{data.position}</span>
        <div className="owner-programs__site-scan-node-badges">
          <span className="owner-programs__site-scan-node-badge">{data.kind}</span>
          <span className="owner-programs__site-scan-node-badge owner-programs__site-scan-node-badge_platform">
            {data.platform}
          </span>
        </div>
      </div>
      <h3 className="owner-programs__site-scan-node-title">{data.title}</h3>
      <p className="owner-programs__site-scan-node-text">{data.previewText || "Текст блока не найден."}</p>
      <div className="owner-programs__site-scan-node-selector">{data.selector || "selector unavailable"}</div>
    </div>
  );
}

function ReferralBuilderBlocksDock({ visible, onPickType }) {
  if (!visible) {
    return null;
  }
  const libraryItems = [
    {
      testId: "builder-library-hero",
      type: "referralHero",
      title: "Hero",
      description: "Крупный блок с заголовком, CTA и описанием программы.",
    },
    {
      testId: "builder-library-banner",
      type: "referralBanner",
      title: "Баннер",
      description: "Горизонтальный акцентный баннер для быстрого оффера.",
    },
    {
      testId: "builder-library-card",
      type: "referralCard",
      title: "Карточка",
      description: "Компактный формат с текстом и кнопкой действия.",
    },
    {
      testId: "builder-library-split",
      type: "referralSplit",
      title: "Две колонки",
      description: "Сравнение выгод или два сценария в одном блоке.",
    },
    {
      testId: "builder-library-minimal",
      type: "referralMinimal",
      title: "Минималистичный",
      description: "Лаконичный блок с заголовком, коротким текстом и одной кнопкой.",
    },
    {
      testId: "builder-library-promo",
      type: "referralPromo",
      title: "Промо",
      description: "Акцентный промо-блок с бейджем и усиленным оффером.",
    },
  ];

  const handleOverlayMouseDown = (event) => {
    if (event.target === event.currentTarget) {
      onPickType(null);
    }
  };

  return (
    <div
      className="owner-programs__referral-builder-blocks-dock"
      data-testid="referral-builder-blocks-dock"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        className="owner-programs__referral-builder-blocks-dock__panel nodrag nopan"
        role="dialog"
        aria-modal="true"
        aria-label="Выбор блока"
      >
        <div className="owner-programs__referral-builder-blocks-dock__head">
          <div>
            <p className="owner-programs__referral-builder-blocks-dock__title">Выберите блок</p>
            <p className="owner-programs__referral-builder-blocks-dock__subtitle">
              Добавьте преднастроенный шаблон в выбранный слот.
            </p>
          </div>
          <button
            type="button"
            className="owner-programs__referral-builder-blocks-dock__close"
            onClick={() => onPickType(null)}
            aria-label="Закрыть окно выбора блока"
          >
            <X size={18} />
          </button>
        </div>
        <div className="owner-programs__referral-builder-blocks-dock__grid">
          {libraryItems.map((item) => (
            <button
              key={item.type}
              type="button"
              className="owner-programs__referral-builder-blocks-dock__btn nodrag nopan"
              data-testid={item.testId}
              data-preview-kind={item.type}
              onClick={() => onPickType(item.type)}
            >
              <span className="owner-programs__referral-builder-blocks-dock__btn-preview" aria-hidden="true">
                <span className="owner-programs__referral-builder-blocks-dock__btn-preview-top" />
                <span className="owner-programs__referral-builder-blocks-dock__btn-preview-body">
                  <span className="owner-programs__referral-builder-blocks-dock__btn-preview-chip" />
                  <span className="owner-programs__referral-builder-blocks-dock__btn-preview-line owner-programs__referral-builder-blocks-dock__btn-preview-line--lg" />
                  <span className="owner-programs__referral-builder-blocks-dock__btn-preview-line owner-programs__referral-builder-blocks-dock__btn-preview-line--sm" />
                  <span className="owner-programs__referral-builder-blocks-dock__btn-preview-cta" />
                </span>
              </span>
              <span className="owner-programs__referral-builder-blocks-dock__btn-title">{item.title}</span>
              <span className="owner-programs__referral-builder-blocks-dock__btn-text">{item.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const REFERRAL_BUILDER_BLOCK_TYPE_LABELS = {
  referralHero: "Hero",
  referralBanner: "Баннер",
  referralCard: "Карточка",
  referralSplit: "Две колонки",
  referralMinimal: "Минималистичный",
  referralPromo: "Промо",
};

function ReferralBuilderInspectorSection({ sectionTitleId, title, children }) {
  return (
    <section className="owner-programs__referral-builder-inspector__section" aria-labelledby={sectionTitleId}>
      <div id={sectionTitleId} className="owner-programs__referral-builder-inspector__section-title">
        {title}
      </div>
      {children}
    </section>
  );
}

function ReferralBuilderBlockInspector({ visible, selectedBlock, onChangeConfig, onDuplicate, onDelete }) {
  if (!visible || !selectedBlock) {
    return null;
  }

  const cfg = selectedBlock.config ?? createDefaultBuilderBlockConfig();

  const patch = (partial) => {
    onChangeConfig(selectedBlock.id, { ...cfg, ...partial });
  };

  const blockTypeKey = typeof selectedBlock.type === "string" ? selectedBlock.type : "";
  const blockTypeLabel =
    REFERRAL_BUILDER_BLOCK_TYPE_LABELS[blockTypeKey] || (blockTypeKey ? blockTypeKey : "Блок");
  const accentHex = cfg.accentColor?.startsWith("#") ? cfg.accentColor : "#6366f1";

  return (
    <aside className="owner-programs__referral-builder-inspector" data-testid="referral-builder-inspector">
      <div className="owner-programs__referral-builder-inspector__header">
        <div className="owner-programs__referral-builder-inspector__title" role="heading" aria-level={2}>
          {blockTypeLabel}
        </div>
        <div className="owner-programs__referral-builder-inspector__subtitle">Реферальный блок</div>
      </div>

      <ReferralBuilderInspectorSection sectionTitleId="builder-inspector-section-text" title="Текст">
        <div className="owner-programs__referral-builder-inspector__field">
          <label className="owner-programs__referral-builder-inspector__label" htmlFor="builder-inspector-title">
            Заголовок
          </label>
          <input
            id="builder-inspector-title"
            className="owner-programs__referral-builder-inspector__input"
            data-testid="builder-inspector-title"
            value={cfg.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </div>
        <div className="owner-programs__referral-builder-inspector__field">
          <label className="owner-programs__referral-builder-inspector__label" htmlFor="builder-inspector-description">
            Описание
          </label>
          <textarea
            id="builder-inspector-description"
            className="owner-programs__referral-builder-inspector__textarea"
            data-testid="builder-inspector-description"
            rows={2}
            value={cfg.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </div>
        <div className="owner-programs__referral-builder-inspector__field">
          <label className="owner-programs__referral-builder-inspector__label" htmlFor="builder-inspector-button">
            Текст кнопки
          </label>
          <input
            id="builder-inspector-button"
            className="owner-programs__referral-builder-inspector__input"
            data-testid="builder-inspector-button-text"
            value={cfg.buttonText}
            onChange={(e) => patch({ buttonText: e.target.value })}
          />
        </div>
        <div className="owner-programs__referral-builder-inspector__field">
          <label className="owner-programs__referral-builder-inspector__label" htmlFor="builder-inspector-terms">
            Условия
          </label>
          <textarea
            id="builder-inspector-terms"
            className="owner-programs__referral-builder-inspector__textarea"
            data-testid="builder-inspector-terms"
            rows={2}
            value={cfg.terms}
            onChange={(e) => patch({ terms: e.target.value })}
          />
        </div>
      </ReferralBuilderInspectorSection>

      <ReferralBuilderInspectorSection sectionTitleId="builder-inspector-section-appearance" title="Оформление">
        <div className="owner-programs__referral-builder-inspector__field">
          <label className="owner-programs__referral-builder-inspector__label" htmlFor="builder-inspector-theme">
            Тема
          </label>
          <select
            id="builder-inspector-theme"
            className="owner-programs__referral-builder-inspector__select"
            data-testid="builder-inspector-theme"
            value={cfg.theme === "dark" ? "dark" : "light"}
            onChange={(e) => patch({ theme: e.target.value })}
          >
            <option value="light">Светлая</option>
            <option value="dark">Тёмная</option>
          </select>
        </div>
        <div className="owner-programs__referral-builder-inspector__field">
          <label className="owner-programs__referral-builder-inspector__label" htmlFor="builder-inspector-accent">
            Акцент
          </label>
          <div className="owner-programs__referral-builder-inspector__accent-row">
            <input
              id="builder-inspector-accent"
              type="color"
              className="owner-programs__referral-builder-inspector__color-swatch"
              data-testid="builder-inspector-accent"
              value={accentHex}
              onChange={(e) => patch({ accentColor: e.target.value })}
              aria-label="Выбор цвета акцента"
            />
            <span className="owner-programs__referral-builder-inspector__hex" title={accentHex}>
              {accentHex.replace(/^#/, "").toUpperCase()}
            </span>
          </div>
        </div>
      </ReferralBuilderInspectorSection>

      <ReferralBuilderInspectorSection sectionTitleId="builder-inspector-section-actions" title="Действия">
        <div className="owner-programs__referral-builder-inspector__actions">
          <button
            type="button"
            className="owner-programs__referral-builder-inspector__action"
            data-testid="builder-inspector-duplicate"
            onClick={() => onDuplicate(selectedBlock.id)}
          >
            Дублировать
          </button>
          <button
            type="button"
            className="owner-programs__referral-builder-inspector__action owner-programs__referral-builder-inspector__action--danger"
            data-testid="builder-inspector-delete"
            onClick={() => onDelete(selectedBlock.id)}
          >
            Удалить
          </button>
        </div>
      </ReferralBuilderInspectorSection>
    </aside>
  );
}

function ReferralBlockCanvas({ sitePublicId = "" }) {
  const [flowInstance, setFlowInstance] = useState(null);
  const flowInstanceRef = useRef(null);
  const flowCanvasWrapRef = useRef(null);
  const pendingFlowViewportRef = useRef(null);
  const prevFlowContentSignatureRef = useRef(null);
  const lastViewTransitionRef = useRef(null);
  useEffect(() => {
    flowInstanceRef.current = flowInstance;
  }, [flowInstance]);

  const [isExpanded, setIsExpanded] = useState(false);
  const isExpandedRef = useRef(isExpanded);
  useLayoutEffect(() => {
    isExpandedRef.current = isExpanded;
  }, [isExpanded]);
  const [expandedCanvasTool, setExpandedCanvasTool] = useState("move");
  const [scanUrl, setScanUrl] = useState("");
  const [scanStatus, setScanStatus] = useState("idle");
  const [scannedBlocks, setScannedBlocks] = useState([]);
  const [scanError, setScanError] = useState("");
  const [scanMeta, setScanMeta] = useState(DEFAULT_SCAN_META);
  const [scanLoaderPhase, setScanLoaderPhase] = useState(0);
  const [scanLoadSession, setScanLoadSession] = useState(0);
  const [selectedInsertionSlotId, setSelectedInsertionSlotId] = useState(null);
  const [insertAfterBuilderBlockId, setInsertAfterBuilderBlockId] = useState(null);
  const [isBlockPickerOpen, setIsBlockPickerOpen] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [builderBlocks, setBuilderBlocks] = useState([]);
  const [selectedBuilderBlockId, setSelectedBuilderBlockId] = useState("");
  const screenshotBlocks = useMemo(
    () => scannedBlocks.filter((block) => block.screenshotDataUrl || block.screenshotUrl),
    [scannedBlocks],
  );
  const orderedInsertionSlotIds = useMemo(
    () => collectInsertionSlotIdsInOrder(screenshotBlocks),
    [screenshotBlocks],
  );
  const isScreenshotImport = scanMeta.visualMode === "screenshot" && screenshotBlocks.length > 0;

  const [workspaceBootstrap, setWorkspaceBootstrap] = useState(() => (sitePublicId ? "loading" : "ready"));
  const pendingNodePositionsFromServerRef = useRef(null);
  const lastSentWorkspaceJsonRef = useRef("");

  useEffect(() => {
    if (!sitePublicId) {
      setWorkspaceBootstrap("ready");
      pendingNodePositionsFromServerRef.current = null;
      return undefined;
    }
    setWorkspaceBootstrap("loading");
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(withSitePublicIdQuery(API_ENDPOINTS.siteIntegration, sitePublicId), {
          credentials: "include",
          headers: ownerSitesAuthHeaders(),
        });
        const payload = await res.json().catch(() => ({}));
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          setWorkspaceBootstrap("error");
          return;
        }
        const raw = payload?.config_json?.referral_builder_workspace;
        const normalized = parseReferralBuilderWorkspace(raw);
        if (normalized) {
          setScanUrl(normalized.scanUrl || "");
          setScannedBlocks(normalized.scannedBlocks);
          setScanMeta({ ...DEFAULT_SCAN_META, ...normalized.scanMeta });
          setBuilderBlocks(normalized.builderBlocks);
          const shots = (normalized.scannedBlocks || []).filter((b) => b.screenshotDataUrl || b.screenshotUrl);
          const validSlots = new Set(collectInsertionSlotIdsInOrder(shots));
          const want = normalized.selectedInsertionSlotId;
          setSelectedInsertionSlotId(
            want && validSlots.has(want) ? want : firstVisibleInsertionSlotId(shots) || null,
          );
          setInsertAfterBuilderBlockId(null);
          const pos = normalized.flowNodePositions;
          if (pos && typeof pos === "object" && Object.keys(pos).length > 0) {
            pendingNodePositionsFromServerRef.current = pos;
          } else {
            pendingNodePositionsFromServerRef.current = null;
          }
        } else {
          pendingNodePositionsFromServerRef.current = null;
        }
        setWorkspaceBootstrap("ready");
      } catch {
        if (!cancelled) {
          setWorkspaceBootstrap("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sitePublicId]);

  /** Центр панели в координатах flow + zoom — чтобы после смены размера канваса контент оставался на том же месте экрана. */
  const captureFlowViewportAnchor = useCallback(() => {
    const inst = flowInstanceRef.current;
    const wrap = flowCanvasWrapRef.current;
    if (!inst || !wrap) {
      return;
    }
    const pane = wrap.querySelector(".react-flow__pane");
    if (!pane) {
      return;
    }
    const rect = pane.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) {
      return;
    }
    let flowPoint;
    try {
      flowPoint = inst.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    } catch {
      return;
    }
    if (!flowPoint || !Number.isFinite(flowPoint.x) || !Number.isFinite(flowPoint.y)) {
      return;
    }
    const zoom = inst.getViewport()?.zoom;
    if (!Number.isFinite(zoom) || zoom <= 0) {
      return;
    }
    pendingFlowViewportRef.current = { x: flowPoint.x, y: flowPoint.y, zoom };
  }, []);

  const runViewTransition = useCallback((update) => {
    const useDocumentVt =
      REFERRAL_BUILDER_DOCUMENT_VIEW_TRANSITION &&
      typeof document !== "undefined" &&
      typeof document.startViewTransition === "function";
    if (useDocumentVt) {
      const vt = document.startViewTransition(() => {
        flushSync(() => {
          update();
        });
      });
      lastViewTransitionRef.current = vt;
      void vt.finished.finally(() => {
        if (lastViewTransitionRef.current === vt) {
          lastViewTransitionRef.current = null;
        }
      });
      return;
    }
    lastViewTransitionRef.current = null;
    update();
  }, []);

  const collapseWorkspaceSmooth = useCallback(() => {
    runViewTransition(() => {
      captureFlowViewportAnchor();
      setIsExpanded(false);
    });
  }, [captureFlowViewportAnchor, runViewTransition]);

  const expandWorkspaceSmooth = useCallback(() => {
    runViewTransition(() => {
      captureFlowViewportAnchor();
      setIsExpanded(true);
    });
  }, [captureFlowViewportAnchor, runViewTransition]);

  const handleSelectInsertionSlot = useCallback(
    (slotId, afterBuilderBlockId = null) => {
      const afterId =
        typeof afterBuilderBlockId === "string" && afterBuilderBlockId.trim() ? afterBuilderBlockId.trim() : null;
      setInsertAfterBuilderBlockId(afterId);
      if (!isScreenshotImport || isExpanded) {
        setSelectedInsertionSlotId(slotId);
        setIsBlockPickerOpen(true);
        return;
      }
      runViewTransition(() => {
        captureFlowViewportAnchor();
        setSelectedInsertionSlotId(slotId);
        setIsExpanded(true);
        setIsBlockPickerOpen(true);
      });
    },
    [captureFlowViewportAnchor, isExpanded, isScreenshotImport, runViewTransition],
  );
  const handleSelectBlock = useCallback((blockId) => {
    setSelectedBlockId(blockId);
    setSelectedBuilderBlockId("");
  }, []);
  const handleSelectBuilderBlock = useCallback((blockId) => {
    setSelectedBuilderBlockId(blockId);
    setSelectedBlockId("");
  }, []);

  const handleAddBuilderBlockOfType = useCallback(
    (type) => {
      if (!type) {
        setIsBlockPickerOpen(false);
        setInsertAfterBuilderBlockId(null);
        return;
      }
      let slotId = selectedInsertionSlotId;
      if (!slotId && screenshotBlocks.length > 0) {
        slotId = firstVisibleInsertionSlotId(screenshotBlocks);
        setSelectedInsertionSlotId(slotId || null);
      }
      const afterTargetId = insertAfterBuilderBlockId;
      const id = newBuilderBlockId();
      const anchorBlock = screenshotBlockForInsertionSlot(slotId || "", screenshotBlocks);
      const siteStyleProfile = anchorBlock ? buildSiteStyleProfileFromScreenshotBlock(anchorBlock) : null;
      const baseCfg = createDefaultBuilderBlockConfig();
      const config =
        siteStyleProfile != null
          ? {
              ...baseCfg,
              siteStyleProfile,
              theme: themeForSiteStyleProfile(siteStyleProfile),
              accentColor: siteStyleProfile.colors?.accent || baseCfg.accentColor,
            }
          : { ...baseCfg };
      const next = {
        id,
        type,
        insertionSlotId: slotId || "",
        config,
      };
      setBuilderBlocks((prev) => {
        const resolvedSlot = slotId || "";
        if (typeof afterTargetId === "string" && afterTargetId && resolvedSlot) {
          const afterIdx = prev.findIndex((b) => b.id === afterTargetId);
          if (afterIdx >= 0) {
            const ref = prev[afterIdx];
            if (builderBlockMatchesInsertionSlot(ref, resolvedSlot, orderedInsertionSlotIds)) {
              return [...prev.slice(0, afterIdx + 1), next, ...prev.slice(afterIdx + 1)];
            }
          }
        }
        return [...prev, next];
      });
      setSelectedBuilderBlockId(id);
      setSelectedBlockId("");
      setInsertAfterBuilderBlockId(null);
      setIsBlockPickerOpen(false);
    },
    [insertAfterBuilderBlockId, orderedInsertionSlotIds, screenshotBlocks, selectedInsertionSlotId],
  );

  const handleChangeBuilderBlockConfig = useCallback((blockId, nextConfig) => {
    setBuilderBlocks((prev) => prev.map((b) => (b.id === blockId ? { ...b, config: nextConfig } : b)));
  }, []);
  const handleInlineEditBuilderBlockField = useCallback((blockId, field, value) => {
    const key = String(field || "").trim();
    if (!key) {
      return;
    }
    setBuilderBlocks((prev) =>
      prev.map((block) => {
        if (block.id !== blockId) {
          return block;
        }
        const nextCfg = { ...(block.config ?? createDefaultBuilderBlockConfig()) };
        nextCfg[key] = value;
        return { ...block, config: nextCfg };
      }),
    );
  }, []);

  const handleDuplicateBuilderBlock = useCallback((blockId) => {
    let createdId = "";
    setBuilderBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      if (idx < 0) {
        return prev;
      }
      createdId = newBuilderBlockId();
      const source = prev[idx];
      const baseCfg = { ...(source.config ?? createDefaultBuilderBlockConfig()) };
      const rawLayers = baseCfg.floatingTextLayers;
      const nextLayers = Array.isArray(rawLayers)
        ? rawLayers.map((layer) => ({
            ...layer,
            id: newBuilderBlockId(),
          }))
        : rawLayers;
      const clone = {
        ...source,
        id: createdId,
        config: { ...baseCfg, floatingTextLayers: nextLayers },
      };
      return [...prev.slice(0, idx + 1), clone, ...prev.slice(idx + 1)];
    });
    if (createdId) {
      window.requestAnimationFrame(() => {
        setSelectedBuilderBlockId(createdId);
      });
    }
  }, []);

  const handleDeleteBuilderBlock = useCallback((blockId) => {
    setBuilderBlocks((prev) => prev.filter((b) => b.id !== blockId));
    setSelectedBuilderBlockId((current) => (current === blockId ? "" : current));
    setInsertAfterBuilderBlockId((cur) => (cur === blockId ? null : cur));
  }, []);
  const nodeTypes = useMemo(
    () => ({
      importedPageStack: ImportedPageStackNode,
      referralPreview: ReferralPreviewNode,
      importedSiteBlock: SiteImportedBlockNode,
      siteBlock: SiteBlockNode,
    }),
    [],
  );

  const isHandMode = isExpanded && expandedCanvasTool === "hand";
  const isTextMode = isExpanded && expandedCanvasTool === "text";
  const isMoveMode = !isHandMode && !isTextMode;

  const freshNodes = useMemo(
    () => {
      if (isScreenshotImport) {
        return [
          {
            id: "imported-page-stack",
            type: "importedPageStack",
            position: { x: IMPORTED_PAGE_STACK_X, y: 0 },
            draggable: true,
            selectable: true,
            data: {
              blocks: screenshotBlocks,
              selectedInsertionSlotId,
              insertAfterBuilderBlockId,
              onSelectInsertionSlot: handleSelectInsertionSlot,
              selectedBlockId,
              onSelectBlock: handleSelectBlock,
              builderBlocks,
              selectedBuilderBlockId,
              onSelectBuilderBlock: handleSelectBuilderBlock,
              onInlineEditBuilderBlockField: handleInlineEditBuilderBlockField,
              onAddBlockAtSlot: handleAddBuilderBlockOfType,
              textEditEnabled: isTextMode,
              overlayPointerEventsNone: isMoveMode,
            },
          },
        ];
      }

      const siteNodes = scannedBlocks.map((block, index) => {
        const type = block.snapshotHtml ? "importedSiteBlock" : "siteBlock";
        return {
          id: `${type}-${block.id}`,
          type,
          position: { x: PAGE_COLUMN_X, y: index * 460 },
          draggable: true,
          selectable: true,
          data: {
            ...block,
            blockId: block.id,
            isSelected: selectedBlockId === block.id,
            onSelectBlock: handleSelectBlock,
          },
        };
      });
      if (siteNodes.length === 0) {
        return [];
      }
      return [
        ...siteNodes,
        {
          id: "referral-preview",
          type: "referralPreview",
          position: { x: REFERRAL_COLUMN_X, y: REFERRAL_DEFAULT_Y },
          draggable: true,
          selectable: true,
          data: {},
        },
      ];
    },
    [
      builderBlocks,
      handleAddBuilderBlockOfType,
      handleSelectBlock,
      handleSelectBuilderBlock,
      handleSelectInsertionSlot,
      handleInlineEditBuilderBlockField,
      insertAfterBuilderBlockId,
      isScreenshotImport,
      scannedBlocks,
      screenshotBlocks,
      selectedBlockId,
      selectedBuilderBlockId,
      selectedInsertionSlotId,
      isMoveMode,
      isTextMode,
    ],
  );

  const [nodes, setNodes] = useState([]);

  useLayoutEffect(() => {
    const pending = pendingNodePositionsFromServerRef.current;
    if (pending && freshNodes.length) {
      const prevFromDisk = freshNodes
        .map((n) => {
          const p = pending[n.id];
          if (p && typeof p === "object" && Number.isFinite(p.x) && Number.isFinite(p.y)) {
            return { ...n, position: { x: p.x, y: p.y } };
          }
          return null;
        })
        .filter(Boolean);
      if (prevFromDisk.length) {
        pendingNodePositionsFromServerRef.current = null;
        setNodes(() => mergeFlowNodePositions(prevFromDisk, freshNodes));
        return;
      }
      pendingNodePositionsFromServerRef.current = null;
    }
    setNodes((prev) => mergeFlowNodePositions(prev, freshNodes));
  }, [freshNodes]);

  const onNodesChange = useCallback(
    (changes) => {
      setNodes((prev) => applyNodeChanges(changes, prev.length > 0 ? prev : freshNodes));
    },
    [freshNodes],
  );

  const displayNodes = nodes.length > 0 ? nodes : freshNodes;

  const workspaceFlowGeometryKey = useMemo(() => {
    const dn = nodes.length > 0 ? nodes : freshNodes;
    try {
      return JSON.stringify(
        dn.map((n) => (n?.id ? { id: n.id, x: n.position?.x, y: n.position?.y } : null)),
      );
    } catch {
      return "";
    }
  }, [nodes, freshNodes]);

  useEffect(() => {
    if (!sitePublicId || workspaceBootstrap !== "ready") {
      return undefined;
    }
    const displayNodesNow = nodes.length > 0 ? nodes : freshNodes;
    const snapshot = buildReferralBuilderWorkspaceSnapshot({
      scanUrl,
      scannedBlocks,
      scanMeta,
      builderBlocks,
      selectedInsertionSlotId: selectedInsertionSlotId || "",
      displayNodes: displayNodesNow,
    });
    const json = JSON.stringify(snapshot);
    if (json === lastSentWorkspaceJsonRef.current) {
      return undefined;
    }
    const tid = window.setTimeout(async () => {
      try {
        const res = await fetch(withSitePublicIdQuery(API_ENDPOINTS.siteIntegration, sitePublicId), {
          method: "PATCH",
          credentials: "include",
          headers: ownerSitesAuthHeaders(),
          body: JSON.stringify({
            site_public_id: sitePublicId,
            referral_builder_workspace: snapshot,
          }),
        });
        if (res.ok) {
          lastSentWorkspaceJsonRef.current = json;
        }
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => window.clearTimeout(tid);
  }, [
    sitePublicId,
    workspaceBootstrap,
    scanUrl,
    scannedBlocks,
    scanMeta,
    builderBlocks,
    selectedInsertionSlotId,
    nodes,
    freshNodes,
    workspaceFlowGeometryKey,
  ]);

  const selectedBuilderBlock = useMemo(
    () => builderBlocks.find((b) => b.id === selectedBuilderBlockId) ?? null,
    [builderBlocks, selectedBuilderBlockId],
  );

  const showScreenshotBuilderChrome =
    isScreenshotImport && screenshotBlocks.length > 0 && isExpanded;

  /** Без builderBlocks / selectedInsertionSlotId — иначе fitView дергается при каждой вставке и съезжает зум. Без isExpanded — зум при развороте на весь экран сохраняем вручную. */
  const flowContentSignature = useMemo(
    () =>
      JSON.stringify({
        isScreenshotImport,
        blockIds: scannedBlocks.map((b) => b.id),
        shotIds: screenshotBlocks.map((b) => b.id),
      }),
    [isScreenshotImport, scannedBlocks, screenshotBlocks],
  );

  useLayoutEffect(() => {
    const root = document.documentElement;
    const immersiveAttr = "data-lk-referral-builder-expanded";
    if (isExpanded) {
      root.setAttribute(immersiveAttr, "");
    } else {
      root.removeAttribute(immersiveAttr);
    }
    return () => {
      root.removeAttribute(immersiveAttr);
    };
  }, [isExpanded]);

  useLayoutEffect(() => {
    if (!flowInstance) {
      return undefined;
    }

    const scheduleAfterCanvasTransition = (fn) => {
      const vt = lastViewTransitionRef.current;
      const run = () => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(fn);
        });
      };
      if (vt && typeof vt.finished?.then === "function") {
        void vt.finished.then(run);
        return;
      }
      run();
    };

    const restore = pendingFlowViewportRef.current;
    if (restore) {
      pendingFlowViewportRef.current = null;
      prevFlowContentSignatureRef.current = flowContentSignature;
      const { x: cx, y: cy, zoom: restoreZoom } = restore;
      const applyRestore = () => {
        const inst = flowInstanceRef.current;
        const wrap = flowCanvasWrapRef.current;
        if (!inst || !wrap) {
          return;
        }
        const pane = wrap.querySelector(".react-flow__pane");
        if (!pane) {
          return;
        }
        const { width, height } = pane.getBoundingClientRect();
        if (typeof inst.setCenter === "function") {
          inst.setCenter(cx, cy, { zoom: restoreZoom, duration: 0 });
          return;
        }
        if (typeof inst.setViewport === "function") {
          inst.setViewport(
            {
              x: width / 2 - cx * restoreZoom,
              y: height / 2 - cy * restoreZoom,
              zoom: restoreZoom,
            },
            { duration: 0 },
          );
        }
      };
      scheduleAfterCanvasTransition(() => {
        applyRestore();
        window.requestAnimationFrame(applyRestore);
      });
      return undefined;
    }

    if (isExpanded) {
      if (prevFlowContentSignatureRef.current !== flowContentSignature) {
        prevFlowContentSignatureRef.current = flowContentSignature;
        scheduleAfterCanvasTransition(() => {
          flowInstance.fitView({
            padding: 0.08,
            maxZoom: 1,
          });
        });
      }
      return undefined;
    }

    prevFlowContentSignatureRef.current = flowContentSignature;
    scheduleAfterCanvasTransition(() => {
      flowInstance.fitView({
        padding: scannedBlocks.length ? 0.16 : 0.25,
        maxZoom: scannedBlocks.length ? 0.82 : 0.9,
      });
    });

    return undefined;
  }, [flowInstance, isExpanded, flowContentSignature, scannedBlocks.length]);

  useEffect(() => {
    if (!isExpanded) {
      setExpandedCanvasTool("move");
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (isBlockPickerOpen) {
          event.preventDefault();
          setIsBlockPickerOpen(false);
          setInsertAfterBuilderBlockId(null);
          return;
        }
        collapseWorkspaceSmooth();
        return;
      }
      if (isTypingIntoField(event.target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.code === "KeyV") {
        event.preventDefault();
        setExpandedCanvasTool("move");
        return;
      }
      if (event.code === "KeyH") {
        event.preventDefault();
        setExpandedCanvasTool("hand");
        return;
      }
      if (event.code === "KeyT") {
        event.preventDefault();
        setExpandedCanvasTool("text");
      }
    };

    const scrollingEl = document.scrollingElement || document.documentElement;
    const lockScrollY = Math.max(0, scrollingEl.scrollTop || window.scrollY || 0);
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    const previousBodyLeft = document.body.style.left;
    const previousBodyRight = document.body.style.right;
    const previousHtmlScrollBehavior = document.documentElement.style.scrollBehavior;

    document.documentElement.style.scrollBehavior = "auto";
    document.body.style.position = "fixed";
    document.body.style.top = `-${lockScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      document.body.style.left = previousBodyLeft;
      document.body.style.right = previousBodyRight;
      document.documentElement.style.scrollBehavior = previousHtmlScrollBehavior;

      const applyScroll = () => {
        if (document.scrollingElement) {
          document.scrollingElement.scrollTop = lockScrollY;
        }
        document.documentElement.scrollTop = lockScrollY;
        if (document.body) {
          document.body.scrollTop = lockScrollY;
        }
      };
      applyScroll();
      window.requestAnimationFrame(applyScroll);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(applyScroll);
      });
    };
  }, [isExpanded, collapseWorkspaceSmooth, isBlockPickerOpen]);

  const logNodeDragStart = useCallback((_event, node) => {
    if (DEBUG_REFERRAL_BUILDER_DRAG) console.log("drag start", node.id);
  }, []);
  const logNodeDrag = useCallback((_event, node) => {
    if (DEBUG_REFERRAL_BUILDER_DRAG) console.log("drag", node.id, node.position);
  }, []);
  const logNodeDragStop = useCallback((_event, node) => {
    if (DEBUG_REFERRAL_BUILDER_DRAG) console.log("drag stop", node.id, node.position);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }
      if (isTypingIntoField(event.target)) {
        return;
      }

      if (selectedBuilderBlockId) {
        event.preventDefault();
        setBuilderBlocks((current) => current.filter((block) => block.id !== selectedBuilderBlockId));
        setSelectedBuilderBlockId("");
        setInsertAfterBuilderBlockId(null);
        return;
      }

      if (!selectedBlockId || !scannedBlocks.some((block) => block.id === selectedBlockId)) {
        return;
      }

      event.preventDefault();
      const nextScanned = scannedBlocks.filter((block) => block.id !== selectedBlockId);
      const nextShots = nextScanned.filter((b) => b.screenshotDataUrl || b.screenshotUrl);
      setScannedBlocks(nextScanned);
      setBuilderBlocks((bb) => remapBuilderBlocksAfterScreenshotRemove(bb, nextShots));
      setSelectedBlockId("");
      setInsertAfterBuilderBlockId(null);
      const validSlots = new Set(collectInsertionSlotIdsInOrder(nextShots));
      setSelectedInsertionSlotId((cur) => {
        if (cur && validSlots.has(cur)) {
          return cur;
        }
        return firstVisibleInsertionSlotId(nextShots) || null;
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [scannedBlocks, selectedBlockId, selectedBuilderBlockId]);

  useEffect(() => {
    if (!scanError) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setScanError("");
      setScanStatus((prev) => (prev === "error" ? "idle" : prev));
    }, 2000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [scanError]);

  useEffect(() => {
    if (scanStatus !== "success") {
      return undefined;
    }
    if (scanMeta.visualMode === "screenshot" && screenshotBlocks.length > 0) {
      const applyPostImportZoom = () => {
        const inst = flowInstanceRef.current;
        if (!inst) {
          return;
        }
        if (typeof inst.setCenter === "function") {
          inst.setCenter(IMPORTED_PAGE_STACK_X + 320, 300, { zoom: POST_IMPORT_SCREENSHOT_ZOOM, duration: 0 });
          return;
        }
        if (typeof inst.setViewport === "function") {
          inst.setViewport({ x: 0, y: 0, zoom: POST_IMPORT_SCREENSHOT_ZOOM }, { duration: 0 });
        }
      };
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(applyPostImportZoom);
      });
    }
    const timeoutId = window.setTimeout(() => {
      setScanStatus("idle");
    }, 2000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [scanMeta.visualMode, scanStatus, screenshotBlocks.length]);

  useEffect(() => {
    if (scanStatus !== "loading") {
      return undefined;
    }
    setScanLoaderPhase(0);
    const tick = () => {
      setScanLoaderPhase((prev) => (prev + 1) % SCAN_LOADER_STATUS_MESSAGES.length);
    };
    const intervalId = window.setInterval(tick, 2600);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [scanStatus, scanLoadSession]);

  const handleToggleExpanded = useCallback(() => {
    if (isExpandedRef.current) {
      setIsBlockPickerOpen(false);
      setInsertAfterBuilderBlockId(null);
      collapseWorkspaceSmooth();
      return;
    }
    expandWorkspaceSmooth();
  }, [collapseWorkspaceSmooth, expandWorkspaceSmooth]);

  const handleScanSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const nextUrl = scanUrl.trim();
      if (!nextUrl) {
        setScanStatus("error");
        setScanError("Укажите URL страницы.");
        setScannedBlocks([]);
        setSelectedInsertionSlotId(null);
        setInsertAfterBuilderBlockId(null);
        setIsBlockPickerOpen(false);
        setSelectedBlockId("");
        setBuilderBlocks([]);
        setSelectedBuilderBlockId("");
        return;
      }

      setScanLoadSession((session) => session + 1);
      setScanStatus("loading");
      setScanError("");
      setScannedBlocks([]);
      setScanMeta(DEFAULT_SCAN_META);
      setSelectedInsertionSlotId(null);
      setInsertAfterBuilderBlockId(null);
      setIsBlockPickerOpen(false);
      setSelectedBlockId("");
      setBuilderBlocks([]);
      setSelectedBuilderBlockId("");

      try {
        const response = await fetch(API_ENDPOINTS.sitePageScan, {
          method: "POST",
          headers: ownerSitesAuthHeaders(),
          credentials: "include",
          body: JSON.stringify({ url: nextUrl, mode: "visual" }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.detail === "string" ? payload.detail : SCAN_ERROR_MESSAGE);
        }
        const normalized = normalizeScanMeta(payload);
        setScannedBlocks(normalized.blocks);
        setScanMeta({
          visualImportAvailable: normalized.visualImportAvailable,
          visualMode: normalized.visualMode,
          detail: normalized.detail,
          platform: normalized.platform,
          visualVideoCount: normalized.visualVideoCount,
        });
        const shots = normalized.blocks.filter((b) => b.screenshotDataUrl || b.screenshotUrl);
        setSelectedInsertionSlotId(firstVisibleInsertionSlotId(shots) || null);
        setInsertAfterBuilderBlockId(null);
        setIsBlockPickerOpen(false);
        setSelectedBlockId("");
        setBuilderBlocks([]);
        setSelectedBuilderBlockId("");
        setScanStatus("success");
      } catch (error) {
        setScanStatus("error");
        setScanError(error instanceof Error && error.message ? error.message : SCAN_ERROR_MESSAGE);
        setScanMeta(DEFAULT_SCAN_META);
        setSelectedInsertionSlotId(null);
        setInsertAfterBuilderBlockId(null);
        setIsBlockPickerOpen(false);
        setSelectedBlockId("");
        setBuilderBlocks([]);
        setSelectedBuilderBlockId("");
      }
    },
    [scanUrl],
  );

  const expandLabel = isExpanded ? "Свернуть" : "На весь экран";
  const isScanning = scanStatus === "loading";
  const flowToolClass = isHandMode
    ? "owner-programs__referral-builder-flow--tool-hand"
    : "owner-programs__referral-builder-flow--tool-move";

  return (
    <div
      className={`owner-programs__referral-builder-workspace${isExpanded ? " owner-programs__referral-builder-workspace--expanded" : ""}`}
    >
      <div className="owner-programs__referral-builder-workspace-chrome">
        <div className="owner-programs__referral-builder-workspace-chrome__tabs">
          <div className="owner-programs__referral-builder-workspace-chrome__tab">
            <p className="owner-programs__referral-builder-workspace-chrome__title">Рабочая область</p>
            <button type="button" className="owner-programs__referral-builder-workspace-chrome__menu" aria-label="Дополнительно">
              <WorkspaceChromeMenuIcon />
            </button>
          </div>
        </div>
        <button type="button" className="owner-programs__referral-builder-workspace-chrome__add" aria-label="Добавить" disabled>
          <WorkspaceChromeAddIcon />
        </button>
      </div>
      <div
        ref={flowCanvasWrapRef}
        className={`owner-programs__referral-builder-canvas${
          REFERRAL_BUILDER_DOCUMENT_VIEW_TRANSITION ? " owner-programs__referral-builder-canvas--doc-view-transition" : ""
        }`}
        data-testid="referral-builder-canvas"
      >
        <div className="owner-programs__referral-builder-scan-overlay">
          <form className="owner-programs__referral-builder-scan-form" onSubmit={handleScanSubmit}>
            <label className="owner-programs__referral-builder-scan-input-wrap" htmlFor="site-page-scan-url">
              <input
                id="site-page-scan-url"
                className="owner-programs__referral-builder-scan-input"
                type="url"
                inputMode="url"
                placeholder="https://example.com/page"
                aria-label="URL страницы"
                value={scanUrl}
                onChange={(event) => setScanUrl(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="owner-programs__referral-builder-scan-button"
              disabled={isScanning}
            >
              {isScanning ? "Импорт…" : "Импорт дизайна"}
            </button>
          </form>
          {scanError ? <div className="owner-programs__referral-builder-scan-error">{scanError}</div> : null}
          {scanStatus === "success" &&
          scanMeta.visualMode === "screenshot" &&
          screenshotBlocks.length > 0 ? (
            <div className="owner-programs__referral-builder-scan-success" data-testid="referral-builder-scan-success">
              {scanMeta.visualVideoCount > 0
                ? `Импортировано ${screenshotBlocks.length} секций, найдено ${scanMeta.visualVideoCount} видео. Видео проигрываются поверх снимка страницы.`
                : `Импортировано ${screenshotBlocks.length} секций.`}
            </div>
          ) : null}
        </div>
        <ReferralBuilderBlocksDock
          visible={showScreenshotBuilderChrome && isBlockPickerOpen}
          onPickType={handleAddBuilderBlockOfType}
        />
        <ReferralBuilderBlockInspector
          visible={showScreenshotBuilderChrome}
          selectedBlock={selectedBuilderBlock}
          onChangeConfig={handleChangeBuilderBlockConfig}
          onDuplicate={handleDuplicateBuilderBlock}
          onDelete={handleDeleteBuilderBlock}
        />
        <ReactFlow
          className={`owner-programs__referral-builder-flow ${flowToolClass}${
            isExpanded ? ` owner-programs__referral-builder-flow--expanded-tool-${expandedCanvasTool}` : ""
          }`}
          nodes={displayNodes}
          edges={[]}
          nodeTypes={nodeTypes}
          proOptions={{ hideAttribution: true }}
          fitViewOptions={{ padding: 0.25, maxZoom: 0.9 }}
          minZoom={0.25}
          maxZoom={3}
          panOnScroll
          zoomOnScroll
          panOnDrag={isHandMode ? [0, 1, 2] : isTextMode ? false : [1, 2]}
          selectionOnDrag={false}
          nodesConnectable={false}
          nodesDraggable={isMoveMode}
          elementsSelectable={isMoveMode}
          onNodesChange={onNodesChange}
          onNodeDragStart={logNodeDragStart}
          onNodeDrag={logNodeDrag}
          onNodeDragStop={logNodeDragStop}
          defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
          onInit={setFlowInstance}
          onPaneClick={() => {
            setSelectedBlockId("");
            setSelectedBuilderBlockId("");
            setSelectedInsertionSlotId(null);
            setInsertAfterBuilderBlockId(null);
            setIsBlockPickerOpen(false);
          }}
        >
          <Background variant="dots" gap={40} size={1} color="rgba(148, 163, 184, 0.28)" />
          <ReferralBuilderFlowToolbar
            onToggleFullscreen={handleToggleExpanded}
            fullscreenTitle={expandLabel}
            isExpanded={isExpanded}
          />
          {isExpanded ? (
            <ReferralBuilderExpandedToolDock tool={expandedCanvasTool} onToolChange={setExpandedCanvasTool} />
          ) : null}
        </ReactFlow>
        {isScanning ? (
          <div
            className="owner-programs__referral-builder-import-loader"
            aria-busy="true"
            aria-live="polite"
            data-testid="referral-builder-import-loader"
          >
            <div className="owner-programs__referral-builder-import-loader__veil" aria-hidden="true" />
            <div className="owner-programs__referral-builder-import-loader__panel">
              <div className="owner-programs__referral-builder-import-loader__orbit" aria-hidden="true">
                <span className="owner-programs__referral-builder-import-loader__moon" />
                <span className="owner-programs__referral-builder-import-loader__moon owner-programs__referral-builder-import-loader__moon--2" />
                <span className="owner-programs__referral-builder-import-loader__moon owner-programs__referral-builder-import-loader__moon--3" />
                <span className="owner-programs__referral-builder-import-loader__core" />
              </div>
              <p className="owner-programs__referral-builder-import-loader__title">Импорт страницы</p>
              <p
                key={scanLoaderPhase}
                className="owner-programs__referral-builder-import-loader__subtitle owner-programs__referral-builder-import-loader__subtitle--pulse"
              >
                {SCAN_LOADER_STATUS_MESSAGES[scanLoaderPhase]}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ProjectReferralBlockScreen() {
  const { sitePublicId } = useParams();
  const resolvedSitePublicId = sitePublicId ? String(sitePublicId).trim() : "";
  return (
    <section
      className="owner-programs__page owner-programs__site-page owner-programs__referral-builder-page"
      data-testid="referral-builder-shell"
    >
      <ReferralBlockCanvas sitePublicId={resolvedSitePublicId} />
    </section>
  );
}
