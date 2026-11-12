// Les réglages de la vue Audio : ce qu'un pas d'annulation sauvegarde.

import type { Cut } from "./cuts";
import { DEFAULT_Q, type ExportFormat, type FilterType, type WavDepth } from "./helpers";

/** Les vitesses que le curseur parcourt, comme dans LightCutVidz. */
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export interface AudioSettings {
  cuts: Cut[];
  fadeIn: number;
  fadeOut: number;
  fadeCurve: "linear" | "equal-power";
  normalize: boolean;
  /** Indice dans `SPEEDS`. */
  speedStep: number;
  filterType: FilterType;
  filterFreq: number;
  filterSlope: number;
  filterQ: number;
  filterBandwidth: number;
}

export const DEFAULT_SETTINGS: AudioSettings = {
  cuts: [],
  fadeIn: 0,
  fadeOut: 0,
  fadeCurve: "linear",
  normalize: false,
  speedStep: 3,
  filterType: "",
  filterFreq: 1000,
  filterSlope: 12,
  filterQ: DEFAULT_Q,
  filterBandwidth: 500,
};

export const speedOf = (settings: AudioSettings): number => SPEEDS[settings.speedStep] ?? 1;

export interface ExportChoice {
  format: ExportFormat;
  wavDepth: WavDepth;
}

export const HISTORY_LIMIT = 100;

/** Les mêmes réglages ? (les coupes se comparent par valeur). */
export function sameSettings(a: AudioSettings, b: AudioSettings): boolean {
  return (
    JSON.stringify(a.cuts) === JSON.stringify(b.cuts) &&
    (Object.keys(a) as (keyof AudioSettings)[]).every((k) => k === "cuts" || a[k] === b[k])
  );
}

export interface History {
  /** Instantanés enregistrés ; `index` est l'état courant parmi eux. */
  steps: AudioSettings[];
  index: number;
}

export const newHistory = (settings: AudioSettings = DEFAULT_SETTINGS): History => ({ steps: [settings], index: 0 });

/** Enregistre `settings` comme nouveau pas (ignoré s'il est identique au courant). Ce qui avait été
 * annulé est oublié, et l'historique est borné. */
export function record(history: History, settings: AudioSettings): History {
  if (sameSettings(settings, history.steps[history.index])) return history;
  const steps = [...history.steps.slice(0, history.index + 1), settings].slice(-HISTORY_LIMIT);
  return { steps, index: steps.length - 1 };
}

export const canUndo = (h: History): boolean => h.index > 0;
export const canRedo = (h: History): boolean => h.index < h.steps.length - 1;
export const undo = (h: History): History => (canUndo(h) ? { ...h, index: h.index - 1 } : h);
export const redo = (h: History): History => (canRedo(h) ? { ...h, index: h.index + 1 } : h);
export const current = (h: History): AudioSettings => h.steps[h.index];
/** Revient (ou avance) directement à l'étape `index`. */
export const goto = (h: History, index: number): History =>
  index >= 0 && index < h.steps.length ? { ...h, index } : h;
