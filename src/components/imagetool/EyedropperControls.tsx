import { useRef, useState } from "react";
import { useT } from "./lib/langContext";
import type { PickedColor } from "./types";

interface EyedropperControlsProps {
  color: PickedColor | null;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function CopyChip({ label, value, onCopied }: { label: string; value: string; onCopied: (label: string) => void }) {
  const t = useT();
  const handleClick = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => onCopied(label))
      .catch(() => {});
  };

  return (
    <button
      onClick={handleClick}
      title={t("a11y.copy", { label })}
      className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono text-slate-300 hover:text-white hover:bg-slate-700 transition-colors group"
    >
      <span className="text-slate-500 text-[10px] uppercase tracking-wider">{label}</span>
      <span>{value}</span>
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="opacity-0 group-hover:opacity-50 transition-opacity shrink-0"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    </button>
  );
}

export function EyedropperControls({ color }: EyedropperControlsProps) {
  const t = useT();
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopied = (label: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCopiedLabel(label);
    timerRef.current = setTimeout(() => setCopiedLabel(null), 1500);
  };

  const hex = color
    ? `#${[color.r, color.g, color.b]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()}`
    : null;
  const hsl = color ? rgbToHsl(color.r, color.g, color.b) : null;

  return (
    <div className="tool-bar flex items-center gap-2 px-4 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
      <span className="text-xs text-slate-400 font-medium uppercase tracking-wider shrink-0">{t("eye.title")}</span>

      {color && hex ? (
        <>
          <div
            className="w-5 h-5 rounded border border-slate-600 shrink-0 cursor-pointer"
            style={{ background: hex }}
            onClick={() => {
              navigator.clipboard
                .writeText(hex)
                .then(() => handleCopied("HEX"))
                .catch(() => {});
            }}
            title={t("a11y.copy-hex")}
          />
          <div className="flex flex-col items-start gap-0.5 w-full">
            <CopyChip label="HEX" value={hex} onCopied={handleCopied} />
            <CopyChip label="RGB" value={`rgb(${color.r}, ${color.g}, ${color.b})`} onCopied={handleCopied} />
            {color.a < 255 && (
              <CopyChip
                label="RGBA"
                value={`rgba(${color.r}, ${color.g}, ${color.b}, ${(color.a / 255).toFixed(2)})`}
                onCopied={handleCopied}
              />
            )}
            {hsl && <CopyChip label="HSL" value={`hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)`} onCopied={handleCopied} />}
          </div>

          {/* Copied feedback */}
          <div
            className={[
              "flex items-center gap-1 text-xs text-emerald-400 font-medium transition-all duration-200",
              copiedLabel ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-1 pointer-events-none",
            ].join(" ")}
            aria-live="polite"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {t("eye.copied", { label: copiedLabel ?? "" })}
          </div>
        </>
      ) : (
        <span className="text-xs text-slate-600 ml-2">{t("eye.hint")}</span>
      )}
    </div>
  );
}
