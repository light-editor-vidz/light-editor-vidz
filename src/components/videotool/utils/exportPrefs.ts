import type { ReframeMode } from "./presets";

/** Où la fenêtre d'export retient ses derniers choix. */
export const EXPORT_PREFS_KEY = "lcv_export_prefs";

/** Le dernier mode de recadrage choisi à l'export (fond flou par défaut). */
export function lastReframeMode(): ReframeMode {
  try {
    return JSON.parse(localStorage.getItem(EXPORT_PREFS_KEY) || "{}").reframeMode === "crop" ? "crop" : "blur";
  } catch {
    return "blur";
  }
}
