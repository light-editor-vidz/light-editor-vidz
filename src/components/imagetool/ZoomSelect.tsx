import { useEffect, useRef, useState } from "react";
import { useT } from "./lib/langContext";

interface ZoomSelectProps {
  zoom: number;
  presets: number[];
  onChange: (value: number) => void;
}

function formatZoom(z: number) {
  return `${Math.round(z * 100)}%`;
}

export function ZoomSelect({ zoom, presets, onChange }: ZoomSelectProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const label = presets.includes(zoom) ? formatZoom(zoom) : `${formatZoom(zoom)} *`;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="toolbar-btn px-2 py-0.5 text-xs w-20 text-center tabular-nums"
        aria-label={t("a11y.zoom-level")}
        title={t("a11y.zoom-level")}
      >
        {label}
      </button>

      {open && (
        <ul
          className="absolute bottom-full mb-1 right-0 bg-slate-800 border border-slate-600 rounded shadow-xl py-1 min-w-[5rem] z-50"
          role="listbox"
          aria-label={t("a11y.zoom-presets")}
        >
          {presets.map((p) => (
            <li
              key={p}
              role="option"
              aria-selected={p === zoom}
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
              className={`px-3 py-1 text-xs text-center cursor-pointer tabular-nums select-none
                ${p === zoom ? "bg-indigo-600 text-white" : "text-slate-200 hover:bg-slate-700"}`}
            >
              {formatZoom(p)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
