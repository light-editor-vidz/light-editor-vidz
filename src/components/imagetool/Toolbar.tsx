import type { EditorMode } from "./types";
import { useT } from "./lib/langContext";

interface ToolbarProps {
  hasImage: boolean;
  mode: EditorMode;
  isLoading: boolean;
  showFlipBar?: boolean;
  showAdjustments?: boolean;
  onAdjustmentsOpen?: () => void;
  showFilters?: boolean;
  onFiltersOpen?: () => void;
  onCropMode: () => void;
  onRotateMode: () => void;
  onFlipOpen: () => void;
  resizeOpen?: boolean;
  onResizeOpen: () => void;
  canvasResizeOpen?: boolean;
  onCanvasResizeOpen: () => void;
  showExif?: boolean;
  onToggleExif?: () => void;
  showGrid?: boolean;
  onToggleGrid?: () => void;
  onCopy?: () => void;
  onEyedropperMode?: () => void;
  onInpaintMode?: () => void;
}

interface BtnProps {
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  /** Infobulle et nom accessible du bouton. */
  title: string;
  /** Titre du bloc, au-dessus du bouton. */
  heading: string;
  /** Texte du bouton : l'action. */
  label: string;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
  children: React.ReactNode;
}

/**
 * Un bloc de la barre latérale, comme dans LightCutVidz : un titre, puis un bouton large avec
 * son icône. Le bouton de l'outil ouvert est coloré.
 */
function SidebarBtn({ onClick, disabled, active, title, heading, label, children, ...aria }: BtnProps) {
  return (
    <div className="tool-section">
      <div className="tool-label">{heading}</div>
      <button
        onClick={onClick}
        disabled={disabled}
        title={title}
        aria-label={aria["aria-label"] ?? title}
        aria-pressed={aria["aria-pressed"]}
        className={`tool-toggle-btn${active ? " tool-toggle-btn--active" : ""}`}
      >
        {children}
        <span className="tool-toggle-btn-label">{label}</span>
      </button>
    </div>
  );
}

export function Toolbar({
  hasImage,
  mode,
  isLoading,
  showFlipBar,
  showAdjustments,
  onAdjustmentsOpen,
  showFilters,
  onFiltersOpen,
  onCropMode,
  onRotateMode,
  onFlipOpen,
  resizeOpen,
  onResizeOpen,
  canvasResizeOpen,
  onCanvasResizeOpen,
  showExif,
  onToggleExif,
  showGrid,
  onToggleGrid,
  onCopy,
  onEyedropperMode,
  onInpaintMode,
}: ToolbarProps) {
  const t = useT();
  const disabled = !hasImage || isLoading;

  return (
    <aside className="tool-sidebar">
      {/* Transform tools */}
      <SidebarBtn
        onClick={onCropMode}
        disabled={disabled}
        active={mode === "cropping"}
        title={t("tooltip.crop")}
        heading={t("toolbar.crop")}
        label={t("tool.crop")}
        aria-pressed={mode === "cropping"}
      >
        <CropIcon />
      </SidebarBtn>
      <SidebarBtn
        onClick={onRotateMode}
        disabled={disabled}
        active={mode === "rotating"}
        title={t("tooltip.rotate")}
        heading={t("toolbar.rotate")}
        label={t("tool.rotate")}
        aria-pressed={mode === "rotating"}
      >
        <RotateIcon />
      </SidebarBtn>
      <SidebarBtn
        onClick={onFlipOpen}
        disabled={disabled}
        active={showFlipBar}
        title={t("tooltip.flip")}
        heading={t("toolbar.flip")}
        label={t("tool.flip")}
        aria-label={t("tooltip.flip")}
        aria-pressed={showFlipBar}
      >
        <FlipIcon />
      </SidebarBtn>

      <SidebarBtn
        onClick={onResizeOpen}
        active={resizeOpen}
        aria-pressed={resizeOpen}
        disabled={disabled}
        title={t("tooltip.resize")}
        heading={t("toolbar.resize")}
        label={t("tool.resize")}
        aria-label={t("tooltip.resize")}
      >
        <ResizeIcon />
      </SidebarBtn>
      <SidebarBtn
        onClick={onCanvasResizeOpen}
        active={canvasResizeOpen}
        aria-pressed={canvasResizeOpen}
        disabled={disabled}
        title={t("tooltip.canvas")}
        heading={t("toolbar.canvas")}
        label={t("tool.canvas")}
        aria-label={t("tooltip.canvas")}
      >
        <CanvasResizeIcon />
      </SidebarBtn>
      <SidebarBtn
        onClick={onEyedropperMode}
        disabled={disabled}
        active={mode === "eyedropper"}
        title={t("tooltip.picker")}
        heading={t("toolbar.picker")}
        label={t("tool.picker")}
        aria-label={t("tooltip.picker")}
        aria-pressed={mode === "eyedropper"}
      >
        <EyedropperIcon />
      </SidebarBtn>
      <SidebarBtn
        onClick={onInpaintMode}
        disabled={disabled}
        active={mode === "inpainting"}
        title={t("tooltip.inpaint")}
        heading={t("toolbar.inpaint")}
        label={t("tool.inpaint")}
        aria-label={t("tooltip.inpaint")}
        aria-pressed={mode === "inpainting"}
      >
        <InpaintIcon />
      </SidebarBtn>
      <SidebarBtn
        onClick={onAdjustmentsOpen}
        disabled={disabled}
        active={showAdjustments}
        title={t("tooltip.adjust")}
        heading={t("toolbar.adjust")}
        label={t("tool.adjust")}
        aria-label={t("tooltip.adjust")}
        aria-pressed={showAdjustments}
      >
        <AdjustmentsIcon />
      </SidebarBtn>
      <SidebarBtn
        onClick={onFiltersOpen}
        disabled={disabled}
        active={showFilters}
        title={t("tooltip.filters")}
        heading={t("toolbar.filters")}
        label={t("tool.filters")}
        aria-label={t("tooltip.filters")}
        aria-pressed={showFilters}
      >
        <FiltersIcon />
      </SidebarBtn>

      <SidebarBtn
        onClick={onCopy}
        disabled={disabled}
        title={t("tooltip.copy")}
        heading={t("toolbar.copy")}
        label={t("tool.copy")}
        aria-label={t("tooltip.copy")}
      >
        <CopyIcon />
      </SidebarBtn>
      <SidebarBtn
        onClick={onToggleGrid}
        disabled={!hasImage}
        active={showGrid}
        title={t("tooltip.grid")}
        heading={t("toolbar.grid")}
        label={t("tool.grid")}
        aria-label={t("tooltip.grid")}
        aria-pressed={showGrid}
      >
        <GridIcon />
      </SidebarBtn>
      <SidebarBtn
        onClick={onToggleExif}
        disabled={!hasImage}
        active={showExif}
        title={t("tooltip.exif")}
        heading={t("toolbar.exif")}
        label={t("tool.exif")}
        aria-label={t("tooltip.exif")}
        aria-pressed={showExif}
      >
        <InfoIcon />
      </SidebarBtn>
    </aside>
  );
}

function CropIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 2 6 6 2 6" />
      <polyline points="18 22 18 18 22 18" />
      <path d="M2 12h14v10" />
      <path d="M12 2v14H2" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 16H3v-4" />
      <path d="M3 12l5-5" />
      <path d="M17 8h4v4" />
      <path d="M21 12l-5 5" />
      <path d="M12 3v18" strokeDasharray="3 2" />
    </svg>
  );
}

function ResizeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

function CanvasResizeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="5" width="14" height="14" rx="1" strokeDasharray="3 2" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </svg>
  );
}

function EyedropperIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 14l-6-6-8.5 8.5a2.12 2.12 0 0 0 3 3L17 11" />
      <path d="M7 17L4.5 19.5a2.12 2.12 0 0 1-3-3L4 14" />
      <circle cx="19" cy="5" r="2" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="8" strokeWidth="3" strokeLinecap="round" />
      <line x1="12" y1="12" x2="12" y2="16" />
    </svg>
  );
}

function AdjustmentsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="8" cy="6" r="2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="18" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FiltersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" strokeLinecap="round" />
      <path d="M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" strokeLinecap="round" />
    </svg>
  );
}

function InpaintIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 14l-6-6-8 8a2.83 2.83 0 0 0 4 4l8-8" />
      <path d="M6.5 17.5L3 21" strokeLinecap="round" />
      <circle cx="18" cy="4" r="2" fill="currentColor" stroke="none" />
      <path d="M3 12h1M7 4v1M12 3h1" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}
