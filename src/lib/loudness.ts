/** Volumes ressentis proposés à l'export (LUFS) : plateformes vidéo, podcasts, télévision. */
export const LOUDNESS_TARGETS = [-14, -16, -23] as const;

/** La valeur d'une liste de choix : un volume visé, ou `null` pour laisser le son tel quel. */
export const parseLoudness = (value: unknown): number | null =>
  LOUDNESS_TARGETS.find((target) => target === Number(value)) ?? null;
