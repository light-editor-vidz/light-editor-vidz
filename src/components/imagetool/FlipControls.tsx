import { useT } from "./lib/langContext";

interface FlipControlsProps {
  isLoading: boolean;
  onFlipH: () => void;
  onFlipV: () => void;
}

export function FlipControls({ isLoading, onFlipH, onFlipV }: FlipControlsProps) {
  const t = useT();
  return (
    <div className="tool-bar flex items-center gap-3 px-4 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
      <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">{t("toolbar.flip")}</span>

      <button onClick={onFlipH} disabled={isLoading} className="toolbar-btn" aria-label={t("a11y.flip-h")}>
        <FlipHIcon />
        {t("flip.horizontal")}
      </button>

      <button onClick={onFlipV} disabled={isLoading} className="toolbar-btn" aria-label={t("a11y.flip-v")}>
        <FlipVIcon />
        {t("flip.vertical")}
      </button>
    </div>
  );
}

function FlipHIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v18" strokeDasharray="2 2" />
      <path d="M3 8l4 4-4 4" />
      <path d="M21 8l-4 4 4 4" />
    </svg>
  );
}

function FlipVIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12h18" strokeDasharray="2 2" />
      <path d="M8 3l4 4 4-4" />
      <path d="M8 21l4-4 4 4" />
    </svg>
  );
}
