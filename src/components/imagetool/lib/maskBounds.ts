/**
 * Boîte englobante des traits peints sur le canevas du masque d'inpainting. Elle évite de relire
 * (et de parcourir) tout le canevas à l'application : 96 Mo à 24 Mpx, sur le fil principal.
 */
export interface MaskRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const bounds = new WeakMap<HTMLCanvasElement, MaskRect>();

/** Agrandit la boîte pour inclure un disque de centre (`x`, `y`) et de rayon `r` (pixels image). */
export function growMaskBounds(canvas: HTMLCanvasElement, x: number, y: number, r: number): void {
  const b = bounds.get(canvas);
  const x0 = Math.floor(x - r) - 1;
  const y0 = Math.floor(y - r) - 1;
  const x1 = Math.ceil(x + r) + 1;
  const y1 = Math.ceil(y + r) + 1;
  bounds.set(
    canvas,
    b
      ? { x0: Math.min(b.x0, x0), y0: Math.min(b.y0, y0), x1: Math.max(b.x1, x1), y1: Math.max(b.y1, y1) }
      : { x0, y0, x1, y1 },
  );
}

export function resetMaskBounds(canvas: HTMLCanvasElement): void {
  bounds.delete(canvas);
}

/** Zone à lire, bornée au canevas ; `null` si rien n'a été enregistré (on lit alors tout). */
export function maskBounds(canvas: HTMLCanvasElement): MaskRect | null {
  const b = bounds.get(canvas);
  if (!b) return null;
  return {
    x0: Math.max(0, b.x0),
    y0: Math.max(0, b.y0),
    x1: Math.min(canvas.width, b.x1),
    y1: Math.min(canvas.height, b.y1),
  };
}
