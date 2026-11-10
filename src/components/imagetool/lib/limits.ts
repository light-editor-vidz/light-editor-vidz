/** Mêmes bornes que le backend (`commands/imaging.rs`) : au-delà, l'allocation risque de tuer le processus. */
export const MAX_SIDE = 30_000;
export const MAX_PIXELS = 200_000_000;

/** Entier lu dans un champ de saisie (`NaN` si vide ou invalide). */
export function parseDim(raw: string): number {
  return /^\d+$/.test(raw.trim()) ? parseInt(raw, 10) : NaN;
}

export function isValidSize(w: number, h: number): boolean {
  return (
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    w >= 1 &&
    h >= 1 &&
    w <= MAX_SIDE &&
    h <= MAX_SIDE &&
    w * h <= MAX_PIXELS
  );
}
