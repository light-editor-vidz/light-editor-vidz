/** Le nettoyage de la voix demandé à l'export (voir `scene_core::voice`). */

export const VOICE_LEVELS = ["off", "light", "medium", "strong"] as const;
export type VoiceLevel = (typeof VOICE_LEVELS)[number];

export interface VoiceCleanup {
  level: VoiceLevel;
  denoise: boolean;
  gate: boolean;
}

export const NO_VOICE_CLEANUP: VoiceCleanup = { level: "off", denoise: false, gate: false };

/** Les niveaux moyen et fort réduisent toujours le bruit. */
export const alwaysDenoises = (level: VoiceLevel): boolean => level === "medium" || level === "strong";

/** Un réglage relu du stockage : tout champ absent ou inconnu reprend sa valeur par défaut. */
export function parseVoice(value: unknown): VoiceCleanup {
  const raw = (value ?? {}) as Partial<Record<keyof VoiceCleanup, unknown>>;
  return {
    level: VOICE_LEVELS.find((level) => level === raw.level) ?? "off",
    denoise: raw.denoise === true,
    gate: raw.gate === true,
  };
}
