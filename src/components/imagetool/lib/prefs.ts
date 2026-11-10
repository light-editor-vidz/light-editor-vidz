import type { ExportFormat } from "../types";
import type { Lang } from "./i18n";

export interface Prefs {
  defaultExportFormat: ExportFormat;
  defaultJpegQuality: number;
  gridSize: number;
  language?: Lang;
  /** Thème de couleurs : celui du système, ou clair ou sombre. */
  theme?: Theme;
}

export type Theme = "system" | "light" | "dark";

/** Les tailles de grille proposées dans Affichage ▸ Taille de la grille (comme dans le menu natif). */
export const GRID_SIZES = [10, 25, 50, 100];

export const THEMES: Theme[] = ["system", "light", "dark"];

const KEY = "lciz-prefs";
const DEFAULTS: Prefs = {
  defaultExportFormat: "png",
  defaultJpegQuality: 90,
  gridSize: 50,
  language: "en",
  theme: "system",
};

export function loadPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Stockage indisponible : les préférences ne durent que le temps de la session.
  }
}
