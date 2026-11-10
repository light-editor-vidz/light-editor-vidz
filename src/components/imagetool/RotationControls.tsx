import { useEffect, useRef, useState } from "react";
import { useT } from "./lib/langContext";

interface RotationControlsProps {
  /** Rotation exacte de ±90°, ajoutée à l'historique. */
  onRotate: (degrees: number) => void | Promise<unknown>;
  /**
   * Applique un angle libre, mesuré depuis l'image d'avant la rotation. Avec `replace`, la
   * dernière rotation est remplacée au lieu de s'empiler. Renvoie la position dans
   * l'historique, ou `undefined` en cas d'échec.
   */
  onApplyAngle?: (degrees: number, replace: boolean) => Promise<number | void>;
  /** Écart d'angle par rapport à l'image affichée, pour l'aperçu instantané pendant le glissement. */
  onPreviewAngle?: (delta: number) => void;
  historyIndex?: number;
  isLoading: boolean;
}

const DEBOUNCE_MS = 500;

export function RotationControls({
  onRotate,
  onApplyAngle,
  onPreviewAngle,
  historyIndex = 0,
  isLoading,
}: RotationControlsProps) {
  const t = useT();
  const [degrees, setDegrees] = useState(0);
  // Angle déjà présent dans l'image affichée, et si une rotation libre de cette session
  // est déjà dans l'historique (auquel cas la suivante la remplace).
  const applied = useRef(0);
  const pushed = useRef(false);
  const expectedIndex = useRef(historyIndex);
  const busy = useRef(false);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (historyIndex === expectedIndex.current) return;
    // Quelqu'un d'autre a touché à l'historique (±90°, annuler…) : on repart de zéro.
    expectedIndex.current = historyIndex;
    applied.current = 0;
    pushed.current = false;
    setDegrees(0);
  }, [historyIndex]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const preview = (value: number) => {
    setDegrees(value);
    onPreviewAngle?.(value - applied.current);
  };

  const commit = async (value: number) => {
    if (timer.current) clearTimeout(timer.current);
    if (!onApplyAngle || value === applied.current) return;
    if (busy.current) {
      pending.current = value;
      return;
    }
    busy.current = true;
    let target: number | null = value;
    while (target !== null) {
      const replace = pushed.current;
      const before = expectedIndex.current;
      if (!replace) expectedIndex.current = before + 1;
      const position = await onApplyAngle(target, replace);
      if (position === undefined) {
        expectedIndex.current = before;
        setDegrees(applied.current);
        onPreviewAngle?.(0);
        pending.current = null;
        break;
      }
      pushed.current = true;
      applied.current = target;
      target = pending.current !== applied.current ? pending.current : null;
      pending.current = null;
    }
    busy.current = false;
  };

  const handleChange = (raw: number) => {
    preview(clamp(raw));
  };

  return (
    <div className="tool-bar flex items-center gap-3 px-4 py-2 bg-slate-800 border-t border-slate-700">
      <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">{t("toolbar.rotate")}</span>

      <button
        onClick={() => onRotate(-90)}
        disabled={isLoading}
        className="toolbar-btn"
        title={t("rot.ccw")}
        aria-label={t("rot.ccw")}
      >
        <RotateCcwIcon />
        −90°
      </button>

      <button
        onClick={() => onRotate(90)}
        disabled={isLoading}
        className="toolbar-btn"
        title={t("rot.cw")}
        aria-label={t("rot.cw")}
      >
        <RotateCwIcon />
        +90°
      </button>

      <div className="w-px h-5 bg-slate-600" />

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <span>{t("rot.angle")}</span>
        <input
          type="range"
          min="-180"
          max="180"
          step="1"
          value={degrees}
          onChange={(e) => handleChange(Number(e.target.value))}
          onPointerUp={() => void commit(degrees)}
          onKeyUp={() => void commit(degrees)}
          className="w-32 accent-indigo-500"
          aria-label={t("a11y.rot-slider")}
        />
        <input
          type="number"
          min="-180"
          max="180"
          value={degrees}
          onChange={(e) => {
            const value = Number(e.target.value);
            handleChange(value);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => void commit(clamp(value)), DEBOUNCE_MS);
          }}
          onBlur={() => void commit(degrees)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit(degrees);
          }}
          className="w-16 px-2 py-1 text-xs bg-slate-700 border border-slate-600 rounded text-white text-center"
          aria-label={t("a11y.rot-degrees")}
        />
        <span className="text-slate-400">°</span>
      </label>
    </div>
  );
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.max(-180, Math.min(180, value)) : 0;
}

function RotateCcwIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function RotateCwIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
