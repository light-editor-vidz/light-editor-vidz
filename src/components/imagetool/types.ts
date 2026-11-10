export interface ImageMeta {
  width: number;
  height: number;
  format: string;
  preview: string;
  /** Petite vignette (≈160 px) pour les préréglages de filtres. */
  thumbnail: string;
  canUndo: boolean;
  canRedo: boolean;
  /** Nombre d'étapes d'historique côté backend, et position courante. */
  historyLen: number;
  historyIndex: number;
  /** Outils de géométrie déjà appliqués à cet état (`crop`, `rotate`, `flip`, `resize`, `canvas`). */
  tools?: string[];
  filename?: string;
  path?: string;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type EditorMode = "idle" | "cropping" | "rotating" | "eyedropper" | "inpainting";

export type ExportFormat = "png" | "jpeg" | "webp" | "bmp" | "tiff";

/** Étape d'historique : une clé de traduction et ses paramètres, pas un texte figé. */
export interface HistoryEntry {
  key: string;
  params?: Record<string, string>;
}

export interface Tab {
  id: string;
  label: string;
  image: ImageMeta;
  history: HistoryEntry[];
  historyIndex: number;
  /** Position d'historique du dernier export : l'onglet est « modifié » s'il diffère. */
  savedIndex: number;
  zoom: number;
}

export type AdjustmentCommand =
  | { type: "brightness-contrast"; brightness: number; contrast: number }
  | { type: "exposure"; exposure: number }
  | { type: "hue-saturation"; hue: number; saturation: number; lightness: number }
  | { type: "vibrance"; vibrance: number }
  | {
      type: "levels";
      inBlack: number;
      inWhite: number;
      gamma: number;
      outBlack: number;
      outWhite: number;
    }
  | { type: "curves"; points: [number, number][] }
  | { type: "white-balance"; temperature: number; tint: number }
  | { type: "sharpen"; amount: number; radius: number; threshold: number }
  | { type: "denoise"; strength: number };

export type FilterCommand =
  | { type: "grayscale"; rWeight: number; gWeight: number; bWeight: number }
  | { type: "sepia"; intensity: number }
  | { type: "invert" }
  | { type: "vignette"; strength: number; feather: number }
  | { type: "grain"; amount: number; monochrome: boolean }
  | { type: "pixelate"; size: number }
  | { type: "posterize"; levels: number }
  | {
      type: "duotone";
      shadowR: number;
      shadowG: number;
      shadowB: number;
      highlightR: number;
      highlightG: number;
      highlightB: number;
    }
  | { type: "sketch" }
  | { type: "lomo"; intensity: number }
  | { type: "vintage"; intensity: number }
  | { type: "cool"; intensity: number }
  | { type: "warm"; intensity: number }
  | { type: "fade"; intensity: number }
  | { type: "drama"; intensity: number }
  | { type: "cross-process"; intensity: number }
  | { type: "blur-gaussian"; radius: number }
  | { type: "blur-motion"; angle: number; distance: number }
  | { type: "blur-radial"; strength: number; samples: number };

/** Description d'un réglage envoyée telle quelle au backend (`apply_command`/`preview_command`). */
export type Command = AdjustmentCommand | FilterCommand | { type: "rotate"; degrees: number };

/** Masque d'inpainting limité à sa boîte englobante. */
export interface MaskBox {
  b64: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PickedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}
