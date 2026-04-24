import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Background, ControlButton, Controls, Panel, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { API_ENDPOINTS } from "../../../config/api";
import { ownerSitesAuthHeaders } from "./ownerSitesListApi";

const PREVIEW_CHIPS = ["до 15%", "личная ссылка", "выплаты ежемесячно"];
const SCAN_ERROR_MESSAGE = "Не удалось просканировать страницу. Проверьте URL или попробуйте другую страницу.";
const DEFAULT_SCAN_META = { visualImportAvailable: null, visualMode: "", detail: "", platform: "generic" };
const PAGE_COLUMN_X = -620;
const IMPORTED_PAGE_STACK_X = -520;
const REFERRAL_COLUMN_X = 160;
const REFERRAL_DEFAULT_Y = 160;

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
        screenshotDataUrl:
          typeof block.screenshot_data_url === "string" ? block.screenshot_data_url.trim() : "",
        screenshotUrl: typeof block.screenshot_url === "string" ? block.screenshot_url.trim() : "",
        kind: typeof block.kind === "string" && block.kind.trim() ? block.kind.trim() : "generic",
        position: typeof block.position === "number" ? block.position : index + 1,
        width: numericOr(block.width, 1200),
        height: numericOr(block.height, 640),
        platform:
          typeof block.platform === "string" && block.platform.trim() ? block.platform.trim() : platform,
      };
    })
    .filter(Boolean);
}

function normalizeScanMeta(payload) {
  const blocks = normalizeScannedBlocks(payload);
  return {
    blocks,
    visualImportAvailable:
      payload?.visual_import_available === false
        ? false
        : blocks.some((block) => Boolean(block.screenshotDataUrl || block.screenshotUrl || block.snapshotHtml)),
    visualMode: typeof payload?.visual_mode === "string" ? payload.visual_mode.trim() : "",
    detail: typeof payload?.detail === "string" ? payload.detail.trim() : "",
    platform: payload?.platform === "tilda" ? "tilda" : "generic",
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

        <button type="button" className="owner-programs__referral-preview-button">
          Стать рефералом
        </button>
      </div>
    </div>
  );
}

function ReferralPreviewNode() {
  return <ReferralPreviewCard testId="referral-builder-preview-node" />;
}

function InlineReferralPreview({ blockConfig }) {
  void blockConfig;
  return (
    <div className="imported-page-referral-inline" data-testid="referral-builder-inline-preview">
      <ReferralPreviewCard inline />
    </div>
  );
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

function InsertSlot({ index, active, onSelectInsertionIndex }) {
  return (
    <div className={`imported-page-insert-slot${active ? " is-active" : ""}`} data-testid="imported-page-insert-slot">
      <button
        type="button"
        className="imported-page-insert-slot__button"
        onClick={() => onSelectInsertionIndex(index)}
        aria-pressed={active ? "true" : "false"}
      >
        + Вставить реферальный блок здесь
      </button>
    </div>
  );
}

function ImportedScreenshotSection({ block, position, selected = false, onSelectBlock }) {
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

  return (
    <div
      className={`imported-page-section${selected ? " is-selected" : ""}`}
      data-testid="imported-page-section"
      data-position={position}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={selected ? "true" : "false"}
    >
      <img
        src={block.screenshotDataUrl || block.screenshot_data_url || block.screenshotUrl || ""}
        alt=""
        data-testid="imported-page-section-image"
      />
    </div>
  );
}

function ImportedPageStackNode({ data }) {
  const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
  const selectedInsertionIndex = Number.isInteger(data?.selectedInsertionIndex) ? data.selectedInsertionIndex : null;
  const onSelectInsertionIndex =
    typeof data?.onSelectInsertionIndex === "function" ? data.onSelectInsertionIndex : () => {};
  const selectedBlockId = typeof data?.selectedBlockId === "string" ? data.selectedBlockId : "";
  const onSelectBlock = typeof data?.onSelectBlock === "function" ? data.onSelectBlock : () => {};
  const blockConfig = data?.blockConfig ?? null;
  const showReferralInline = Boolean(data?.showReferralInline);

  return (
    <div className="imported-page-stack-node" data-testid="imported-page-stack-node">
      <div className="imported-page-stack-node__bar">
        <span>Импортированная страница</span>
        <span>{blocks.length} секций</span>
      </div>

      <div className="imported-page-stack-node__body">
        <InsertSlot
          index={0}
          active={selectedInsertionIndex === 0}
          onSelectInsertionIndex={onSelectInsertionIndex}
        />
        {showReferralInline && selectedInsertionIndex === 0 ? <InlineReferralPreview blockConfig={blockConfig} /> : null}

        {blocks.map((block, index) => (
          <Fragment key={block.id}>
            <ImportedScreenshotSection
              block={block}
              position={index + 1}
              selected={selectedBlockId === block.id}
              onSelectBlock={onSelectBlock}
            />
            <InsertSlot
              index={index + 1}
              active={selectedInsertionIndex === index + 1}
              onSelectInsertionIndex={onSelectInsertionIndex}
            />
            {showReferralInline && selectedInsertionIndex === index + 1 ? (
              <InlineReferralPreview blockConfig={blockConfig} />
            ) : null}
          </Fragment>
        ))}
      </div>
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

function ReferralBlockCanvas() {
  const [flowInstance, setFlowInstance] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [scanUrl, setScanUrl] = useState("");
  const [scanStatus, setScanStatus] = useState("idle");
  const [scannedBlocks, setScannedBlocks] = useState([]);
  const [scanError, setScanError] = useState("");
  const [scanMeta, setScanMeta] = useState(DEFAULT_SCAN_META);
  const [selectedInsertionIndex, setSelectedInsertionIndex] = useState(null);
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const screenshotBlocks = useMemo(
    () => scannedBlocks.filter((block) => block.screenshotDataUrl || block.screenshotUrl),
    [scannedBlocks],
  );
  const isScreenshotImport = scanMeta.visualMode === "screenshot" && screenshotBlocks.length > 0;
  const handleSelectInsertionIndex = useCallback((index) => {
    setSelectedInsertionIndex(index);
  }, []);
  const handleSelectBlock = useCallback((blockId) => {
    setSelectedBlockId(blockId);
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

  const nodes = useMemo(
    () => {
      if (isScreenshotImport) {
        const pageNodes = [
          {
            id: "imported-page-stack",
            type: "importedPageStack",
            position: { x: IMPORTED_PAGE_STACK_X, y: 0 },
            draggable: false,
            selectable: true,
            data: {
              blocks: screenshotBlocks,
              selectedInsertionIndex,
              onSelectInsertionIndex: handleSelectInsertionIndex,
              selectedBlockId,
              onSelectBlock: handleSelectBlock,
              blockConfig: null,
              showReferralInline: selectedInsertionIndex != null,
            },
          },
        ];

        if (selectedInsertionIndex == null) {
          pageNodes.push({
            id: "referral-preview-1",
            type: "referralPreview",
            position: { x: REFERRAL_COLUMN_X, y: REFERRAL_DEFAULT_Y },
            draggable: false,
            selectable: true,
            data: {},
          });
        }

        return pageNodes;
      }

      const siteNodes = scannedBlocks.map((block, index) => {
        const type = block.snapshotHtml ? "importedSiteBlock" : "siteBlock";
        return {
          id: `${type}-${block.id}`,
          type,
          position: { x: PAGE_COLUMN_X, y: index * 460 },
          draggable: false,
          selectable: true,
          data: {
            ...block,
            blockId: block.id,
            isSelected: selectedBlockId === block.id,
            onSelectBlock: handleSelectBlock,
          },
        };
      });
      return [
        ...siteNodes,
        {
          id: "referral-preview-1",
          type: "referralPreview",
          position: { x: REFERRAL_COLUMN_X, y: REFERRAL_DEFAULT_Y },
          draggable: false,
          selectable: true,
          data: {},
        },
      ];
    },
    [
      handleSelectBlock,
      handleSelectInsertionIndex,
      isScreenshotImport,
      scannedBlocks,
      screenshotBlocks,
      selectedBlockId,
      selectedInsertionIndex,
    ],
  );

  useEffect(() => {
    if (!flowInstance) {
      return undefined;
    }

    window.requestAnimationFrame(() => {
      flowInstance.fitView({
        padding: isExpanded ? 0.08 : scannedBlocks.length ? 0.16 : 0.25,
        maxZoom: isExpanded ? 1 : scannedBlocks.length ? 0.82 : 0.9,
      });
    });

    return undefined;
  }, [flowInstance, isExpanded, nodes]);

  useEffect(() => {
    if (!isExpanded) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsExpanded(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isExpanded]);

  useEffect(() => {
    if (!selectedBlockId || !scannedBlocks.some((block) => block.id === selectedBlockId)) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }
      if (isTypingIntoField(event.target)) {
        return;
      }

      const removedIndex = scannedBlocks.findIndex((block) => block.id === selectedBlockId);
      if (removedIndex < 0) {
        return;
      }

      event.preventDefault();
      setScannedBlocks((current) => current.filter((block) => block.id !== selectedBlockId));
      setSelectedBlockId("");
      setSelectedInsertionIndex((current) => {
        if (current == null || current <= removedIndex) {
          return current;
        }
        return Math.max(0, current - 1);
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [scannedBlocks, selectedBlockId]);

  const handleToggleExpanded = useCallback(() => {
    setIsExpanded((current) => !current);
  }, []);

  const handleScanSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const nextUrl = scanUrl.trim();
      if (!nextUrl) {
        setScanStatus("error");
        setScanError("Укажите URL страницы.");
        setScannedBlocks([]);
        setSelectedInsertionIndex(null);
        setSelectedBlockId("");
        return;
      }

      setScanStatus("loading");
      setScanError("");
      setScannedBlocks([]);
      setScanMeta(DEFAULT_SCAN_META);
      setSelectedInsertionIndex(null);
      setSelectedBlockId("");

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
        });
        setSelectedInsertionIndex(null);
        setSelectedBlockId("");
        setScanStatus("success");
      } catch (error) {
        setScanStatus("error");
        setScanError(error instanceof Error && error.message ? error.message : SCAN_ERROR_MESSAGE);
        setScanMeta(DEFAULT_SCAN_META);
        setSelectedInsertionIndex(null);
        setSelectedBlockId("");
      }
    },
    [scanUrl],
  );

  const expandLabel = isExpanded ? "Свернуть" : "На весь экран";

  return (
    <div
      className={`owner-programs__referral-builder-canvas${isExpanded ? " owner-programs__referral-builder-canvas--expanded" : ""}`}
      data-testid="referral-builder-canvas"
    >
      <ReactFlow
        className="owner-programs__referral-builder-flow"
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 0.9 }}
        minZoom={0.25}
        maxZoom={1.5}
        panOnScroll
        zoomOnScroll
        panOnDrag
        nodesConnectable={false}
        nodesDraggable={false}
        defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
        onInit={setFlowInstance}
        onPaneClick={() => setSelectedBlockId("")}
      >
        <Panel
          position="top-center"
          className="owner-programs__referral-builder-scan-panel"
          style={{
            left: "50%",
            right: "auto",
            transform: "translateX(-50%)",
            margin: "0",
            width: "auto",
            maxWidth: "calc(100% - 32px)",
          }}
        >
          <form className="owner-programs__referral-builder-scan-form" onSubmit={handleScanSubmit}>
            <div className="owner-programs__referral-builder-scan-controls">
              <input
                id="site-page-scan-url"
                className="owner-programs__referral-builder-scan-input"
                type="url"
                inputMode="url"
                placeholder="https://example.com/page"
                value={scanUrl}
                onChange={(event) => setScanUrl(event.target.value)}
                aria-label="URL страницы"
              />
              <button
                type="submit"
                className="owner-programs__referral-builder-scan-button"
                disabled={scanStatus === "loading"}
              >
                {scanStatus === "loading" ? "Импорт..." : "Импортировать дизайн"}
              </button>
            </div>
            {scanError ? <p className="owner-programs__referral-builder-scan-error">{scanError}</p> : null}
          </form>
        </Panel>
        <Background variant="dots" gap={24} size={1} color="rgba(148, 163, 184, 0.35)" />
        <Controls position="bottom-left" showInteractive={false} showFitView={false}>
          <ControlButton onClick={handleToggleExpanded} title={expandLabel} aria-label={expandLabel}>
            <FullscreenIcon active={isExpanded} />
          </ControlButton>
        </Controls>
      </ReactFlow>
    </div>
  );
}

export default function ProjectReferralBlockScreen() {
  return (
    <section
      className="owner-programs__page owner-programs__site-page owner-programs__referral-builder-page"
      data-testid="referral-builder-shell"
    >
      <ReferralBlockCanvas />
    </section>
  );
}
