import type { MutableRefObject } from "react";
import type { CropApi } from "./hooks/useCrop";
import type { CropRect } from "./types";
import { useT } from "./lib/langContext";

interface CropControlsProps {
  cropRect: CropRect;
  isLoading: boolean;
  /** Commandes de la zone de sélection (ratio, saisie numérique). */
  apiRef?: MutableRefObject<CropApi | null>;
  onApply: () => void;
  onCancel: () => void;
}

const RATIOS: Array<{ id: string; ratio: number | null }> = [
  { id: "free", ratio: null },
  { id: "1:1", ratio: 1 },
  { id: "4:3", ratio: 4 / 3 },
  { id: "3:2", ratio: 3 / 2 },
  { id: "16:9", ratio: 16 / 9 },
  { id: "3:4", ratio: 3 / 4 },
  { id: "2:3", ratio: 2 / 3 },
  { id: "9:16", ratio: 9 / 16 },
];

export function CropControls({ cropRect, isLoading, apiRef, onApply, onCancel }: CropControlsProps) {
  const t = useT();
  const numeric = (field: "width" | "height") => (
    <input
      type="number"
      min={1}
      value={cropRect[field]}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (n >= 1) apiRef?.current?.setRect({ [field]: n });
      }}
      aria-label={t(field === "width" ? "rsz.width" : "rsz.height")}
      className="w-16 px-2 py-0.5 text-xs bg-slate-700 border border-slate-600 rounded text-white text-right"
    />
  );

  return (
    <div className="tool-bar flex items-center gap-3 px-4 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
      <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">{t("toolbar.crop")}</span>
      {apiRef && (
        <>
          <select
            aria-label={t("crop.ratio")}
            defaultValue="free"
            onChange={(e) => apiRef.current?.setAspect(RATIOS.find((r) => r.id === e.target.value)?.ratio ?? null)}
            className="text-xs bg-slate-700 border border-slate-600 rounded text-white px-1.5 py-0.5"
          >
            {RATIOS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id === "free" ? t("crop.ratio-free") : r.id}
              </option>
            ))}
          </select>
          {numeric("width")}
          <span className="text-xs text-slate-500">×</span>
          {numeric("height")}
        </>
      )}
      <div className="flex-1" />
      <button onClick={onCancel} disabled={isLoading} className="toolbar-btn">
        {t("crop.cancel")}
      </button>
      <button
        onClick={onApply}
        disabled={isLoading || cropRect.width < 1 || cropRect.height < 1}
        className="toolbar-btn toolbar-btn--primary"
      >
        {t("crop.apply")}
      </button>
    </div>
  );
}
