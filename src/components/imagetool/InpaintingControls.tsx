import { useT } from "./lib/langContext";

interface InpaintingControlsProps {
  brushSize: number;
  isLoading: boolean;
  /** Faux tant que rien n'est peint : il n'y a alors rien à supprimer. */
  canApply?: boolean;
  onBrushSizeChange: (size: number) => void;
  onClear: () => void;
  onCancel: () => void;
  onApply: () => void;
}

export function InpaintingControls({
  brushSize,
  isLoading,
  canApply = true,
  onBrushSizeChange,
  onClear,
  onCancel,
  onApply,
}: InpaintingControlsProps) {
  const t = useT();
  return (
    <div className="tool-bar flex items-center gap-3 px-4 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
      <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">{t("tooltip.inpaint")}</span>
      <span className="tool-hint text-xs text-slate-500">{t("inp.hint")}</span>

      <div className="flex items-center gap-2 ml-2">
        <span className="text-xs text-slate-400">{t("inp.brush")}</span>
        <input
          type="range"
          min={5}
          max={200}
          step={5}
          value={brushSize}
          onChange={(e) => onBrushSizeChange(Number(e.target.value))}
          className="w-24 accent-blue-500"
          disabled={isLoading}
        />
        <span className="text-xs text-slate-400 font-mono w-8">{brushSize}</span>
      </div>

      <div className="flex-1" />

      <button onClick={onClear} disabled={isLoading} className="toolbar-btn">
        {t("inp.clear")}
      </button>
      <button onClick={onCancel} disabled={isLoading} className="toolbar-btn">
        {t("inp.cancel")}
      </button>
      <button onClick={onApply} disabled={isLoading || !canApply} className="toolbar-btn toolbar-btn--primary">
        {isLoading ? t("inp.applying") : t("inp.apply")}
      </button>
    </div>
  );
}
