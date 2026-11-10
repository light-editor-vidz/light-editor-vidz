import { useEffect, useState } from "react";
import type { Anchor } from "./lib/tauri";
import { useT } from "./lib/langContext";
import { isValidSize, MAX_SIDE, parseDim } from "./lib/limits";
import { SidePanel } from "./ui/SidePanel";

interface Props {
  open: boolean;
  originalWidth: number;
  originalHeight: number;
  isLoading: boolean;
  onResize: (width: number, height: number, anchor: Anchor, fill: [number, number, number, number]) => void;
  onClose: () => void;
  onReset?: () => void;
  canReset?: boolean;
}

const ANCHORS: Anchor[][] = [
  ["top-left", "top-center", "top-right"],
  ["middle-left", "center", "middle-right"],
  ["bottom-left", "bottom-center", "bottom-right"],
];

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function CanvasResizeDialog({
  open,
  originalWidth,
  originalHeight,
  isLoading,
  onResize,
  onClose,
  onReset,
  canReset,
}: Props) {
  // Saisie conservée en texte : on peut effacer un champ pour retaper sa valeur.
  const [width, setWidth] = useState(String(originalWidth));
  const [height, setHeight] = useState(String(originalHeight));
  const [lockRatio, setLockRatio] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>("center");
  const [fillHex, setFillHex] = useState("#ffffff");
  const [transparent, setTransparent] = useState(false);
  const t = useT();

  useEffect(() => {
    if (open) {
      setWidth(String(originalWidth));
      setHeight(String(originalHeight));
      setLockRatio(false);
      setAnchor("center");
      setFillHex("#ffffff");
      setTransparent(false);
    }
  }, [open, originalWidth, originalHeight]);

  if (!open) return null;

  const ratio = originalWidth / (originalHeight || 1);

  const handleWidthChange = (raw: string) => {
    setWidth(raw);
    const n = parseDim(raw);
    if (lockRatio && n >= 1) setHeight(String(Math.round(n / ratio)));
  };

  const handleHeightChange = (raw: string) => {
    setHeight(raw);
    const n = parseDim(raw);
    if (lockRatio && n >= 1) setWidth(String(Math.round(n * ratio)));
  };

  // Le canevas ne peut que grandir : une valeur trop petite est ramenée à la taille d'origine.
  const handleWidthBlur = () => {
    const w = Math.max(originalWidth, parseDim(width) || originalWidth);
    setWidth(String(w));
    if (lockRatio) setHeight(String(Math.max(originalHeight, Math.round(w / ratio))));
  };

  const handleHeightBlur = () => {
    const h = Math.max(originalHeight, parseDim(height) || originalHeight);
    setHeight(String(h));
    if (lockRatio) setWidth(String(Math.max(originalWidth, Math.round(h * ratio))));
  };

  const w = parseDim(width);
  const h = parseDim(height);
  const valid = isValidSize(w, h) && w >= originalWidth && h >= originalHeight;
  const tooLarge = w >= originalWidth && h >= originalHeight && !isValidSize(w, h) && w >= 1 && h >= 1;

  const handleConfirm = () => {
    if (!valid) return;
    const [r, g, b] = hexToRgb(fillHex);
    const a = transparent ? 0 : 255;
    onResize(w, h, anchor, [r, g, b, a]);
  };

  return (
    <SidePanel title={t("cvs.title")} onReset={onReset} canReset={canReset}>
      <p className="text-slate-400 text-xs">{t("cvs.hint", { w: String(originalWidth), h: String(originalHeight) })}</p>

      {/* Size inputs */}
      <div className="flex gap-2 items-center">
        <div className="flex flex-col gap-3 flex-1 min-w-0">
          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-300 text-sm w-16">{t("cvs.width")}</span>
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input
                type="number"
                min={originalWidth}
                max={MAX_SIDE}
                value={width}
                onChange={(e) => handleWidthChange(e.target.value)}
                onBlur={handleWidthBlur}
                className="flex-1 min-w-0 bg-slate-700 border border-slate-600 text-white text-sm rounded px-2 py-1.5 text-right"
              />
              <span className="text-slate-400 text-xs w-5">px</span>
            </div>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-slate-300 text-sm w-16">{t("cvs.height")}</span>
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input
                type="number"
                min={originalHeight}
                max={MAX_SIDE}
                value={height}
                onChange={(e) => handleHeightChange(e.target.value)}
                onBlur={handleHeightBlur}
                className="flex-1 min-w-0 bg-slate-700 border border-slate-600 text-white text-sm rounded px-2 py-1.5 text-right"
              />
              <span className="text-slate-400 text-xs w-5">px</span>
            </div>
          </label>
        </div>

        {/* Lock ratio */}
        <button
          type="button"
          onClick={() => setLockRatio((l) => !l)}
          title={lockRatio ? t("cvs.unlock") : t("cvs.lock")}
          className={`w-7 h-7 rounded flex items-center justify-center transition-colors shrink-0
              ${lockRatio ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}
        >
          {lockRatio ? <LockIcon /> : <UnlockIcon />}
        </button>
      </div>

      {tooLarge && (
        <p role="alert" className="text-red-300 text-xs -mt-2">
          {t("err.too-large")}
        </p>
      )}

      {/* Anchor picker */}
      <div className="flex items-center gap-4">
        <span className="text-slate-300 text-sm w-16 shrink-0">{t("cvs.anchor")}</span>
        <div className="grid grid-cols-3 gap-1">
          {ANCHORS.map((row) =>
            row.map((a) => (
              <button
                key={a}
                onClick={() => setAnchor(a)}
                title={t(`cvs.anchor.${a}`)}
                aria-label={t(`cvs.anchor.${a}`)}
                aria-pressed={anchor === a}
                className={`w-7 h-7 rounded flex items-center justify-center transition-colors
                    ${anchor === a ? "bg-indigo-600" : "bg-slate-700 hover:bg-slate-600"}`}
              >
                <span className={`w-2 h-2 rounded-full ${anchor === a ? "bg-white" : "bg-slate-400"}`} />
              </button>
            )),
          )}
        </div>
        <span className="text-slate-400 text-xs">{t(`cvs.anchor.${anchor}`)}</span>
      </div>

      {/* Fill color */}
      <div className="flex items-center gap-4">
        <span className="text-slate-300 text-sm w-16 shrink-0">{t("cvs.fill")}</span>
        <input
          type="color"
          value={fillHex}
          disabled={transparent}
          onChange={(e) => setFillHex(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border border-slate-600 disabled:opacity-30"
        />
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={transparent}
            onChange={(e) => setTransparent(e.target.checked)}
            className="accent-indigo-500"
          />
          {t("cvs.transparent")}
        </label>
      </div>

      <div className="flex gap-2 justify-end mt-1">
        <button onClick={onClose} className="toolbar-btn px-4 py-1.5 text-sm">
          {t("cvs.cancel")}
        </button>
        <button
          onClick={handleConfirm}
          disabled={!valid || isLoading}
          className="toolbar-btn toolbar-btn--primary px-4 py-1.5 text-sm"
        >
          {isLoading ? t("cvs.applying") : t("cvs.apply")}
        </button>
      </div>
    </SidePanel>
  );
}
