import { useEffect, useState } from "react";
import { useT } from "./lib/langContext";
import { isValidSize, MAX_SIDE, parseDim } from "./lib/limits";
import { SidePanel } from "./ui/SidePanel";

interface Props {
  open: boolean;
  originalWidth: number;
  originalHeight: number;
  isLoading: boolean;
  onResize: (width: number, height: number) => void;
  onClose: () => void;
  onReset?: () => void;
  canReset?: boolean;
}

export function ResizeDialog({
  open,
  originalWidth,
  originalHeight,
  isLoading,
  onResize,
  onClose,
  onReset,
  canReset,
}: Props) {
  // La saisie reste du texte : vider un champ pour retaper une valeur ne le force plus à 1.
  const [width, setWidth] = useState(String(originalWidth));
  const [height, setHeight] = useState(String(originalHeight));
  const [lockRatio, setLockRatio] = useState(true);
  const t = useT();

  useEffect(() => {
    if (open) {
      setWidth(String(originalWidth));
      setHeight(String(originalHeight));
      setLockRatio(true);
    }
  }, [open, originalWidth, originalHeight]);

  if (!open) return null;

  const ratio = originalWidth / originalHeight;

  const handleWidthChange = (raw: string) => {
    setWidth(raw);
    const n = parseDim(raw);
    if (lockRatio && n >= 1) setHeight(String(Math.max(1, Math.round(n / ratio))));
  };

  const handleHeightChange = (raw: string) => {
    setHeight(raw);
    const n = parseDim(raw);
    if (lockRatio && n >= 1) setWidth(String(Math.max(1, Math.round(n * ratio))));
  };

  const w = parseDim(width);
  const h = parseDim(height);
  const valid = isValidSize(w, h);
  const tooLarge = Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && !valid;

  return (
    <SidePanel title={t("rsz.title")} onReset={onReset} canReset={canReset}>
      <p className="text-slate-400 text-xs">
        {t("rsz.original", { w: String(originalWidth), h: String(originalHeight) })}
      </p>

      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-3">
          <span className="text-slate-300 text-sm w-16">{t("rsz.width")}</span>
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input
              type="number"
              min={1}
              max={MAX_SIDE}
              value={width}
              onChange={(e) => handleWidthChange(e.target.value)}
              className="flex-1 min-w-0 bg-slate-700 border border-slate-600 text-white text-sm rounded px-2 py-1.5 text-right"
            />
            <span className="text-slate-400 text-xs w-5">px</span>
          </div>
        </label>

        <div className="flex items-center justify-between gap-3">
          <span className="w-16" />
          <button
            onClick={() => setLockRatio((v) => !v)}
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors
                ${lockRatio ? "text-indigo-400 bg-indigo-950/50" : "text-slate-500 hover:text-slate-300"}`}
            title={lockRatio ? t("rsz.locked") : t("rsz.free")}
          >
            {lockRatio ? <LockIcon /> : <UnlockIcon />}
            {lockRatio ? t("rsz.locked") : t("rsz.free")}
          </button>
        </div>

        <label className="flex items-center justify-between gap-3">
          <span className="text-slate-300 text-sm w-16">{t("rsz.height")}</span>
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input
              type="number"
              min={1}
              max={MAX_SIDE}
              value={height}
              onChange={(e) => handleHeightChange(e.target.value)}
              className="flex-1 min-w-0 bg-slate-700 border border-slate-600 text-white text-sm rounded px-2 py-1.5 text-right"
            />
            <span className="text-slate-400 text-xs w-5">px</span>
          </div>
        </label>
      </div>

      {tooLarge && (
        <p role="alert" className="text-red-300 text-xs -mt-2">
          {t("err.too-large")}
        </p>
      )}

      <div className="flex gap-2 justify-end mt-1">
        <button onClick={onClose} className="toolbar-btn px-4 py-1.5 text-sm">
          {t("rsz.cancel")}
        </button>
        <button
          onClick={() => valid && onResize(w, h)}
          disabled={!valid || isLoading}
          className="toolbar-btn toolbar-btn--primary px-4 py-1.5 text-sm"
        >
          {isLoading ? t("rsz.resizing") : t("rsz.resize")}
        </button>
      </div>
    </SidePanel>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}
