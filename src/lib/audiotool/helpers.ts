// Fonctions pures de la vue Audio, sans accès au DOM.

import { cutRanges, keptDuration, keptSegments, type Cut } from "./cuts";

/** −1 dBFS, le pic auquel le moteur normalise (`normalize::TARGET_PEAK`). */
export const TARGET_PEAK = 0.8912509;

/** Secondes au format m:ss. */
export function fmtTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) secs = 0;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

export type FadeCurve = "linear" | "equal-power";

/** Gain d'un fondu entrant à la fraction `x` (0 → 1) de sa durée, selon la courbe. */
function rising(x: number, curve: FadeCurve | string): number {
  x = Math.max(0, Math.min(1, x));
  return curve === "equal-power" ? Math.sin((x * Math.PI) / 2) : x;
}

export interface FadeRegion {
  start?: number;
  end?: number;
  fadeIn?: number;
  fadeOut?: number;
  curve?: FadeCurve | string;
}

/**
 * Gain de l'enveloppe de fondus au temps `time`, relatif à la région conservée.
 *
 * Le moteur applique le fondu entrant puis le fondu sortant l'un après l'autre : là où ils se
 * chevauchent, les gains se multiplient (ce n'est pas le minimum des deux).
 */
export function fadeGainAt(
  time: number,
  { start = 0, end = 0, fadeIn = 0, fadeOut = 0, curve = "linear" }: FadeRegion = {},
): number {
  if (!(end > start)) return 1;
  let gain = 1;
  if (fadeIn > 0 && time < start + fadeIn) gain *= rising((time - start) / fadeIn, curve);
  if (fadeOut > 0 && time > end - fadeOut) gain *= rising((end - time) / fadeOut, curve);
  return Math.max(0, Math.min(1, gain));
}

const OVERLAP_STEPS = 24;
const CURVE_STEPS = 24;

/**
 * Points de rupture `[temps, gain]` de l'enveloppe de fondus de `from` à la fin de la région,
 * pour une automation linéaire par morceaux d'un `GainNode`. Le produit de deux rampes qui se
 * chevauchent est une parabole : cette portion est échantillonnée finement.
 */
export function fadeEnvelopePoints(region: FadeRegion, from: number): [number, number][] {
  const { start = 0, end = 0, fadeIn = 0, fadeOut = 0 } = region;
  if (!(end > start)) return [[from, 1]];
  const times = new Set<number>([from, end]);
  const add = (t: number) => {
    if (t > from && t < end) times.add(t);
  };
  add(start);
  if (fadeIn > 0) add(start + fadeIn);
  if (fadeOut > 0) add(end - fadeOut);
  const overlapFrom = end - fadeOut;
  const overlapTo = start + fadeIn;
  if (fadeIn > 0 && fadeOut > 0 && overlapFrom < overlapTo) {
    for (let i = 1; i < OVERLAP_STEPS; i++) {
      add(overlapFrom + ((overlapTo - overlapFrom) * i) / OVERLAP_STEPS);
    }
  }
  // Une rampe courbe n'est pas une droite entre ses extrémités : on l'échantillonne.
  if (region.curve === "equal-power") {
    for (let i = 1; i < CURVE_STEPS; i++) {
      if (fadeIn > 0) add(start + (fadeIn * i) / CURVE_STEPS);
      if (fadeOut > 0) add(end - fadeOut + (fadeOut * i) / CURVE_STEPS);
    }
  }
  return [...times]
    .filter((t) => t >= from)
    .sort((a, b) => a - b)
    .map((t): [number, number] => [t, fadeGainAt(t, region)]);
}

/** Q linéaire de l'étage `k` (à partir de 1) d'une cascade de Butterworth de `stages` étages —
 * les valeurs du moteur, pour que le filtre de l'aperçu ait la même forme. */
export function butterworthQ(stages: number, k: number): number {
  return 1 / (2 * Math.cos((Math.PI * (2 * k - 1)) / (4 * stages)));
}

/** Q tel qu'un BiquadFilterNode l'attend pour un passe-bas ou un passe-haut : en décibels. */
export function qToDb(q: number): number {
  return 20 * Math.log10(q);
}

export const DEFAULT_Q = Math.SQRT1_2;

export const SLOPES = [12, 24, 36, 48];

/** Q d'un passe-bande de fréquence centrale et de largeur de bande données. */
export function bandpassQ(freq: number, bandwidth: number): number {
  return bandwidth > 0 ? freq / bandwidth : 1.0;
}

/** Borne une fréquence de filtre à la plage qu'accepte un BiquadFilterNode. */
export function clampFilterFreq(freq: number, sampleRate: number): number {
  const nyquist = sampleRate / 2 - 1;
  if (!Number.isFinite(freq)) return 1000;
  return Math.max(1, Math.min(freq, nyquist));
}

export type FilterType = "" | "lowpass" | "highpass" | "bandpass";

/** Chaînes de filtre comprises par le `FilterSpec::parse` du moteur. */
export function buildFilterSpecs({
  type,
  freq,
  bandwidth,
  slope = 12,
  q = null,
}: {
  type: FilterType | string;
  freq?: number | string;
  bandwidth?: number | string;
  slope?: number;
  q?: number | null;
}): string[] {
  if (type === "lowpass" || type === "highpass") {
    const parts: (string | number)[] = [type, freq ?? ""];
    // Q n'existe que sur un seul étage de 12 dB/octave, et ne compte que s'il n'est pas celui
    // par défaut.
    const customQ = slope === 12 && q != null && Math.abs(q - DEFAULT_Q) > 1e-3;
    if (slope !== 12 || customQ) parts.push(slope);
    if (customQ) parts.push(q as number);
    return [parts.join(":")];
  }
  if (type === "bandpass") return [`bandpass:${freq}:${bandwidth}`];
  return [];
}

export type WavDepth = "float32" | "pcm24" | "pcm16";
export type ExportFormat = "wav" | "mp3" | "flac" | "ogg" | "m4a";

/** Réglages de l'interface, tels que les lisent la validation et la requête d'export. */
export interface UiSettings {
  filePath?: string;
  format?: ExportFormat | string;
  duration?: number;
  sampleRate?: number;
  cuts?: Cut[];
  fadeIn?: number;
  fadeOut?: number;
  fadeCurve?: FadeCurve | string;
  normalize?: boolean;
  speed?: number;
  filterType?: FilterType | string;
  filterFreq?: number | string;
  filterBandwidth?: number | string;
  filterSlope?: number | string;
  filterQ?: number | string;
  wavDepth?: WavDepth | string;
}

/** Requête de la commande `audio_process`. */
export interface ProcessOptions {
  input: string;
  output: string;
  format: string;
  cuts: [number, number][];
  fade_in: number | null;
  fade_out: number | null;
  fade_curve: FadeCurve;
  wav_depth: string | null;
  normalize: boolean;
  speed: number | null;
  filters: string[];
}

export function buildProcessOptions(ui: UiSettings, outputPath: string): ProcessOptions {
  const fadeIn = ui.fadeIn ?? 0;
  const fadeOut = ui.fadeOut ?? 0;
  const speed = ui.speed ?? 1;
  return {
    input: ui.filePath ?? "",
    output: outputPath,
    format: ui.format ?? "wav",
    cuts: cutRanges(ui.cuts ?? [], Number.isFinite(ui.duration) ? (ui.duration as number) : 0),
    fade_in: fadeIn > 0 ? fadeIn : null,
    fade_out: fadeOut > 0 ? fadeOut : null,
    fade_curve: ui.fadeCurve === "equal-power" ? "equal-power" : "linear",
    wav_depth: ui.format === "wav" ? ui.wavDepth || "float32" : null,
    normalize: !!ui.normalize,
    speed: Math.abs(speed - 1.0) > 1e-6 ? speed : null,
    filters: buildFilterSpecs({
      type: ui.filterType ?? "",
      freq: ui.filterFreq ?? 1000,
      bandwidth: ui.filterBandwidth,
      slope: Number(ui.filterSlope ?? 12),
      q: ui.filterQ === undefined || ui.filterQ === "" ? null : Number(ui.filterQ),
    }),
  };
}

/** Ce qui ferait refuser ces réglages par le moteur. */
export interface Problem {
  code: string;
  field: string;
  params: Record<string, string>;
}

/**
 * Ce qui ferait refuser ces réglages par le moteur, ou `null` si rien ne le ferait.
 *
 * Renvoyé sous la forme d'une erreur du moteur — `{ code, params, field }` — pour que les
 * mêmes traductions `err.<code>` servent aux deux, et que l'export soit refusé avant un aller-
 * retour plutôt qu'après.
 */
export function validateSettings(ui: UiSettings): Problem | null {
  const duration = Number.isFinite(ui.duration) ? (ui.duration as number) : 0;

  // Ce que les coupes laissent est ce qui est exporté.
  const region = duration > 0 ? keptDuration(keptSegments(ui.cuts ?? [], duration)) : 0;
  if (duration > 0 && !(region > 0)) return { code: "trim_empty", field: "tl-track", params: {} };

  const fades: [string, number | undefined, string][] = [
    ["in", ui.fadeIn, "fadein"],
    ["out", ui.fadeOut, "fadeout"],
  ];
  for (const [which, secs, field] of fades) {
    // Le moteur mesure les fondus en images entières ; la tolérance couvre l'arrondi d'une valeur
    // de curseur par rapport à la même région.
    if (secs !== undefined && secs > 0 && secs > region + 0.0005) {
      return { code: "fade_too_long", field, params: { which, secs: secs.toFixed(2) } };
    }
  }

  if (ui.filterType) {
    const nyquist = (ui.sampleRate ?? 0) / 2;
    const freq = Number(ui.filterFreq);
    if (String(ui.filterFreq).trim() === "" || !Number.isFinite(freq)) {
      return { code: "filter_value", field: "filter-freq", params: { value: String(ui.filterFreq) } };
    }
    if (!(freq > 0 && freq < nyquist)) {
      return {
        code: "filter_range",
        field: "filter-freq",
        params: { kind: ui.filterType, hz: String(freq), max: String(nyquist) },
      };
    }
    if (ui.filterType !== "bandpass") {
      if (!SLOPES.includes(Number(ui.filterSlope ?? 12))) {
        return { code: "filter_slope", field: "filter-slope", params: { value: String(ui.filterSlope) } };
      }
      // Q n'est un réglage que sur un seul étage : les filtres plus raides le fixent.
      if (Number(ui.filterSlope ?? 12) === 12 && ui.filterQ !== undefined) {
        const q = Number(ui.filterQ);
        if (String(ui.filterQ).trim() === "" || !(q > 0) || !Number.isFinite(q)) {
          return { code: "filter_q", field: "filter-q", params: { value: String(ui.filterQ) } };
        }
      }
    }
    if (ui.filterType === "bandpass") {
      const bw = Number(ui.filterBandwidth);
      if (String(ui.filterBandwidth).trim() === "" || !Number.isFinite(bw)) {
        return { code: "filter_value", field: "filter-bw", params: { value: String(ui.filterBandwidth) } };
      }
      if (!(bw > 0)) {
        return { code: "filter_bandwidth", field: "filter-bw", params: { hz: String(bw) } };
      }
    }
  }
  return null;
}

/** Erreur structurée renvoyée par une commande du moteur. */
export interface EngineError {
  code: string;
  params?: Record<string, string>;
  message?: string;
}

type Translate = (key: string, vars?: Record<string, string>) => string;

/**
 * Texte lisible pour ce qu'un `invoke` a rejeté : une erreur structurée du moteur
 * (`{ code, params, message }`), une chaîne, ou une `Error` JS. `t` renvoie la clé elle-même
 * quand elle n'a pas de traduction.
 */
export function describeEngineError(err: unknown, t: Translate): string {
  if (err && typeof err === "object" && typeof (err as EngineError).code === "string") {
    const e = err as EngineError;
    // Les erreurs sans formulation propre portent leur message anglais.
    if (e.code === "generic") return e.message ?? e.code;
    // `which` choisit entre les variantes d'un même code (fondu entrant / sortant).
    for (const key of [`audioTool.err.${e.code}.${e.params?.which}`, `audioTool.err.${e.code}`]) {
      const text = t(key, e.params);
      if (text !== key) return text;
    }
    return e.message ?? e.code;
  }
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}

/** Dernier composant d'un chemin, quel que soit son séparateur. */
export function baseName(path: string): string {
  return String(path).split(/[\\/]/).pop() ?? "";
}

/** Nom d'export suggéré : `<nom de la source>-edit.<ext>`, à côté de la source. */
export function defaultOutputPath(sourcePath: string, ext: string): string {
  const name = baseName(sourcePath);
  const dir = sourcePath.slice(0, sourcePath.length - name.length);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${dir}${stem}-edit.${ext}`;
}

/** Pic des tranches de la forme d'onde qui recouvrent `[start, end]` secondes. */
export function waveformPeak(
  waveform: ArrayLike<number> | null | undefined,
  duration: number,
  start: number,
  end: number,
): number {
  if (!waveform?.length || !(duration > 0)) return 0;
  const n = waveform.length;
  const from = Math.max(0, Math.floor((start / duration) * n));
  const to = Math.min(n, Math.ceil((end / duration) * n));
  let peak = 0;
  for (let i = from; i < to; i++) if (waveform[i] > peak) peak = waveform[i];
  return peak;
}
