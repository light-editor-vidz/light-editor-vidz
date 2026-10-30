import type { Project } from "../bindings/Project";
import type { Composition } from "../bindings/Composition";
import type { Element } from "../bindings/Element";
import type { AudioTrack } from "../bindings/AudioTrack";
import type { Animation } from "../bindings/Animation";
import type { AnimationType } from "../bindings/AnimationType";
import type { Easing } from "../bindings/Easing";
import type { Transition } from "../bindings/Transition";
import type { TransitionType } from "../bindings/TransitionType";
import type { FitMode } from "../bindings/FitMode";
import type { ShapeType } from "../bindings/ShapeType";
import type { ImagePanType } from "../bindings/ImagePanType";
import i18n from "i18next";
import { recomputeStartTimes } from "./timeline";

/**
 * Convertit le format JSON de l'ancien projet (`/home/sikander/Documents/dev/video`,
 * positions pixel `top/left` + ancre, easing façon GSAP `power2.inOut`) vers notre
 * modèle (`x/y/width/height` en % du canvas, easing kebab-case).
 *
 * Limitation connue : les médias image/vidéo référencés par `src` ne sont PAS
 * recopiés dans le projet. Un chemin absolu (cas de l'ancien format) ne peut pas être lu par
 * l'éditeur, qui n'accède qu'aux fichiers du dossier projet : ces chemins sont listés dans
 * `unresolvedMedia` pour que l'interface prévienne qu'il faut ré-importer les médias.
 */

/** Résultat de l'import : le projet converti et les médias à ré-importer. */
export interface LegacyImport {
  project: Project;
  /** Chemins de médias absolus (ou hors du projet) que l'éditeur ne pourra pas lire. */
  unresolvedMedia: string[];
}

/** Chemin que l'éditeur ne peut pas résoudre : absolu (Unix, Windows, URL) ou remontant. */
function isUnresolvableSrc(src: string): boolean {
  return (
    src !== "" &&
    (/^([a-zA-Z]:[\\/]|[\\/]|[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)/.test(src) || src.split(/[\\/]/).includes(".."))
  );
}

/** Unité de longueur du modèle : 1/1000 de la largeur du canvas (`LENGTH_UNITS_PER_WIDTH`). L'ancien
 * format exprimait épaisseurs et rayons en pixels du canvas. */
function pxToUnits(px: number, canvasWidth: number): number {
  return (px / canvasWidth) * 1000;
}

const VALID_FIT_MODES: FitMode[] = ["fit-height", "fit-width", "fit-largest", "cover", "stretch"];
const VALID_SHAPE_TYPES: ShapeType[] = ["rectangle", "ellipse", "triangle", "line", "arrow", "star"];
const VALID_PAN_TYPES: ImagePanType[] = ["zoomIn", "zoomOut", "panLeft", "panRight", "panUp", "panDown"];

function newId(): string {
  return crypto.randomUUID();
}

/** "power2.inOut" (GSAP, ancien projet) -> "power2-in-out" (notre schéma kebab-case). */
function convertEasing(raw: unknown): Easing {
  const s = typeof raw === "string" ? raw : "linear";
  const kebab = s
    .replace(/\./g, "-")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase() as Easing;
  const VALID: Easing[] = [
    "linear",
    "power1-in",
    "power1-out",
    "power1-in-out",
    "power2-in",
    "power2-out",
    "power2-in-out",
    "power3-in",
    "power3-out",
    "power3-in-out",
    "bounce",
  ];
  return VALID.includes(kebab) ? kebab : "linear";
}

const VALID_ANIMATION_TYPES: AnimationType[] = [
  "fade",
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
  "zoom-in",
  "zoom-out",
  "rotate",
  "flip",
  "blur",
  "fade-up",
  "fade-down",
  "fade-left",
  "fade-right",
  "skew-left",
  "skew-right",
  "roll",
  "spin",
  "bounce",
  "drop",
  "typewriter",
  "word-reveal",
  "line-reveal",
];

const VALID_TRANSITION_TYPES: TransitionType[] = [
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
  "zoom",
  "flip-h",
  "flip-v",
  "rotate-cw",
  "rotate-ccw",
  "blur",
  "wipe-left",
  "wipe-right",
  "wipe-up",
  "wipe-down",
  "fade",
];

function convertAnimations(raw: unknown): Animation[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((a): Animation[] => {
    if (!a || typeof a !== "object") return [];
    const type = (a as Record<string, unknown>).type;
    if (typeof type !== "string" || !VALID_ANIMATION_TYPES.includes(type as AnimationType)) return [];
    return [
      {
        animation_type: type as AnimationType,
        direction: (a as Record<string, unknown>).direction === "out" ? "out" : "in",
        duration: Number((a as Record<string, unknown>).duration) || 0.6,
        easing: convertEasing((a as Record<string, unknown>).easing),
        with_fade: !!(a as Record<string, unknown>).withFade,
      },
    ];
  });
}

function convertTransition(raw: unknown): Transition | null {
  if (!raw || typeof raw !== "object") return null;
  const type = (raw as Record<string, unknown>).type;
  if (typeof type !== "string" || !VALID_TRANSITION_TYPES.includes(type as TransitionType)) return null;
  return {
    transition_type: type as TransitionType,
    duration: Number((raw as Record<string, unknown>).duration) || 0.6,
    easing: convertEasing((raw as Record<string, unknown>).easing),
  };
}

/** Reproduit `reverseAnchor` de l'ancien projet : ancre -> coin haut-gauche, en pixels. */
function reverseAnchor(
  top: number,
  left: number,
  width: number,
  height: number,
  topOrigin: string,
  leftOrigin: string,
): { x: number; y: number } {
  const y = topOrigin === "top" ? top : topOrigin === "center" ? top - height / 2 : top - height;
  const x = leftOrigin === "left" ? left : leftOrigin === "center" ? left - width / 2 : left - width;
  return { x, y };
}

interface GeometryPx {
  x: number;
  y: number;
  width: number;
  height: number;
}

function toPercent(px: GeometryPx, canvasWidth: number, canvasHeight: number) {
  return {
    x: (px.x / canvasWidth) * 100,
    y: (px.y / canvasHeight) * 100,
    width: (px.width / canvasWidth) * 100,
    height: (px.height / canvasHeight) * 100,
  };
}

function convertElement(
  raw: unknown,
  canvasWidth: number,
  canvasHeight: number,
  unresolvedMedia: string[],
): Element | null {
  if (!raw || typeof raw !== "object") return null;
  const el = raw as Record<string, unknown>;
  const type = el.type;
  if (type !== "text" && type !== "image" && type !== "video" && type !== "shape") return null;

  const widthPx = Number(el.width) || (type === "shape" ? 200 : 400);
  const heightPx = Number(el.height) || (type === "shape" ? 100 : 300);
  const topOrigin = typeof el.topOrigin === "string" ? el.topOrigin : "center";
  const leftOrigin = typeof el.leftOrigin === "string" ? el.leftOrigin : "center";
  const { x, y } = reverseAnchor(Number(el.top) || 0, Number(el.left) || 0, widthPx, heightPx, topOrigin, leftOrigin);
  const geo = toPercent({ x, y, width: widthPx, height: heightPx }, canvasWidth, canvasHeight);

  const base = {
    id: typeof el.id === "string" ? el.id : newId(),
    name: typeof el.name === "string" ? el.name : type,
    start_time: Number(el.startTime) || 0,
    duration: el.duration != null ? Number(el.duration) : null,
    x: geo.x,
    y: geo.y,
    width: geo.width,
    height: geo.height,
    rotation: el.rotation != null ? Number(el.rotation) : 0,
    animations: convertAnimations(el.animations),
    group_id: null,
    blend_mode: null,
  };

  if (type === "text") {
    return {
      type: "text",
      ...base,
      content: typeof el.content === "string" ? el.content : "",
      alignment: el.alignment === "left" || el.alignment === "right" ? el.alignment : "center",
      vertical_alignment:
        el.verticalAlignment === "top" || el.verticalAlignment === "bottom" ? el.verticalAlignment : "middle",
      color: typeof el.color === "string" ? el.color : "rgba(255,255,255,1)",
      background_color: typeof el.backgroundColor === "string" ? el.backgroundColor : null,
      // Ancien : fontSize en px absolus. Nouveau : cqw (% de la largeur du canvas).
      font_size: el.fontSize != null ? (Number(el.fontSize) / canvasWidth) * 100 : null,
      font_family: typeof el.fontFamily === "string" ? el.fontFamily : null,
      font_weight: el.fontWeight === "bold" ? "bold" : "normal",
      font_style: el.fontStyle === "italic" ? "italic" : "normal",
      letter_spacing: null,
      line_height: null,
      text_shadow: null,
      underline: false,
      strikethrough: false,
    };
  }

  const fitMode: FitMode = VALID_FIT_MODES.includes(el.fitMode as FitMode) ? (el.fitMode as FitMode) : "cover";
  const panRaw = el.imagePan as Record<string, unknown> | undefined;
  const imagePan =
    panRaw && typeof panRaw === "object" && VALID_PAN_TYPES.includes(panRaw.type as ImagePanType)
      ? { pan_type: panRaw.type as ImagePanType, intensity: Number(panRaw.intensity) || 0.5 }
      : null;

  const src = typeof el.src === "string" ? el.src : "";
  if ((type === "image" || type === "video") && isUnresolvableSrc(src)) unresolvedMedia.push(src);

  if (type === "image") {
    return {
      type: "image",
      ...base,
      src,
      fit_mode: fitMode,
      background_color: typeof el.backgroundColor === "string" ? el.backgroundColor : null,
      image_pan: imagePan,
      corner_radius: null,
      border_color: null,
      border_width: null,
    };
  }

  if (type === "video") {
    return {
      type: "video",
      ...base,
      src,
      fit_mode: fitMode,
      background_color: typeof el.backgroundColor === "string" ? el.backgroundColor : null,
      image_pan: imagePan,
      video_offset: Number(el.videoOffset) || 0,
      corner_radius: null,
      border_color: null,
      border_width: null,
      volume: 1,
      muted: false,
      playback_speed: 1,
      loop_video: false,
    };
  }

  // shape
  return {
    type: "shape",
    ...base,
    shape_type: VALID_SHAPE_TYPES.includes(el.shapeType as ShapeType) ? (el.shapeType as ShapeType) : "rectangle",
    fill: typeof el.fill === "string" ? el.fill : "rgba(99,102,241,1)",
    stroke: typeof el.stroke === "string" ? el.stroke : "none",
    stroke_width: el.strokeWidth != null ? pxToUnits(Number(el.strokeWidth), canvasWidth) : 3,
    border_radius: el.borderRadius != null ? pxToUnits(Number(el.borderRadius), canvasWidth) : null,
    stroke_dash: null,
    gradient_to: null,
    gradient_angle: null,
  };
}

function convertComposition(
  raw: unknown,
  canvasWidth: number,
  canvasHeight: number,
  fallbackDuration: number,
  unresolvedMedia: string[],
): Composition {
  const comp = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const elements = Array.isArray(comp.elements)
    ? comp.elements.flatMap((e) => {
        const converted = convertElement(e, canvasWidth, canvasHeight, unresolvedMedia);
        return converted ? [converted] : [];
      })
    : [];

  return {
    id: typeof comp.id === "string" ? comp.id : newId(),
    name: typeof comp.name === "string" ? comp.name : i18n.t("defaults.importedScene"),
    start_time: Number(comp.startTime) || 0,
    duration: Number(comp.duration) || fallbackDuration,
    elements,
    transition_in: convertTransition(comp.transitionIn),
    transition_out: convertTransition(comp.transitionOut),
    overlap_next: Number(comp.overlapNext) || 0,
  };
}

function convertAudioTrack(raw: unknown): AudioTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  return {
    id: typeof t.id === "string" ? t.id : newId(),
    name: typeof t.name === "string" ? t.name : i18n.t("defaults.audioTrack"),
    src: typeof t.src === "string" ? t.src : "",
    start_time: Number(t.startTime) || 0,
    duration: t.duration != null ? Number(t.duration) : null,
    volume: t.volume != null ? Math.max(0, Math.min(1, Number(t.volume))) : 1,
    audio_offset: Number(t.audioOffset) || 0,
    fade_in: 0,
    fade_out: 0,
    muted: false,
    solo: false,
  };
}

/** Rend un id unique : l'ancien format pouvait réutiliser le même id dans plusieurs scènes, or
 * `findElement` et les sélections adressent un élément par son seul id. */
function dedupeIds(compositions: Composition[]): Composition[] {
  const seen = new Set<string>();
  const unique = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      return id;
    }
    const fresh = newId();
    seen.add(fresh);
    return fresh;
  };
  return compositions.map((comp) => ({
    ...comp,
    id: unique(comp.id),
    elements: comp.elements.map((el) => ({ ...el, id: unique(el.id) }) as Element),
  }));
}

/** Dimension paire (x264 en yuv420p refuse les dimensions impaires), au moins 2. */
function evenDimension(value: number): number {
  return Math.max(2, Math.round(value) & ~1);
}

export function parseLegacyProject(raw: unknown): LegacyImport {
  if (!raw || typeof raw !== "object") throw new Error(i18n.t("defaults.invalidJson"));
  const data = raw as Record<string, unknown>;
  const width = evenDimension(Number(data.width) || 1920);
  const height = evenDimension(Number(data.height) || 1080);
  const duration = Number(data.duration) || 5;
  const fpsValue = Number(data.fps);
  const fps = Number.isFinite(fpsValue) && fpsValue >= 1 && fpsValue <= 240 ? Math.round(fpsValue) : 30;
  const unresolvedMedia: string[] = [];

  const compositions = Array.isArray(data.compositions)
    ? data.compositions.map((c) => convertComposition(c, width, height, duration, unresolvedMedia))
    : [];

  const audioTracks = Array.isArray(data.audioTracks)
    ? data.audioTracks.flatMap((t) => {
        const converted = convertAudioTrack(t);
        if (converted && isUnresolvableSrc(converted.src)) unresolvedMedia.push(converted.src);
        return converted ? [converted] : [];
      })
    : [];

  const finalCompositions =
    compositions.length > 0 ? compositions : [convertComposition({}, width, height, duration, unresolvedMedia)];

  // `start_time` des scènes et durée du projet sont recalculés : ceux du fichier legacy peuvent
  // ne pas refléter les chevauchements (donc la durée d'export).
  const project = recomputeStartTimes({
    name: typeof data.name === "string" ? data.name : i18n.t("defaults.importedProject"),
    width,
    height,
    fps,
    duration,
    compositions: dedupeIds(finalCompositions),
    // L'ancien format stockait déjà les pistes au niveau projet avec un startTime absolu —
    // même convention que le modèle actuel, aucune réassignation nécessaire.
    audio_tracks: audioTracks,
  });
  return { project, unresolvedMedia: Array.from(new Set(unresolvedMedia)) };
}

export function parseLegacyProjectJSON(raw: unknown): Project {
  return parseLegacyProject(raw).project;
}
