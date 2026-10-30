import type { GeometryPatch, HandleId } from "../components/editor/ElementInteraction";

/** Part minimale (en % du canvas) d'un élément qui doit rester dans le canvas : on peut le placer
 * en partie hors-champ (entrées/sorties animées), pas le perdre. */
export const MIN_VISIBLE = 5;

/** Position bornée pour qu'au moins `MIN_VISIBLE` % de l'élément reste dans le canvas. */
export function clampPosition(position: number, size: number): number {
  const min = Math.min(0, MIN_VISIBLE - size);
  const max = 100 - Math.min(MIN_VISIBLE, size);
  return Math.min(max, Math.max(min, position));
}

/** Taille minimale (en % du canvas) d'un élément redimensionné. */
const MIN_SIZE = 3;

/**
 * Nouvelle géométrie après le redimensionnement par une poignée. Le déplacement de la souris est
 * exprimé dans le repère de l'élément (rotation inverse) : sur un élément tourné, la poignée
 * suit le curseur et le bord opposé reste fixe à l'écran. Calcul en pixels (les % de largeur et
 * de hauteur du canvas n'ont pas la même échelle), converti en % à la fin.
 */
export function resizeGeometry(
  start: GeometryPatch,
  handle: HandleId,
  dxPx: number,
  dyPx: number,
  stageWidth: number,
  stageHeight: number,
): Partial<GeometryPatch> {
  const theta = (start.rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // Déplacement dans le repère local de l'élément.
  const localDx = dxPx * cos + dyPx * sin;
  const localDy = -dxPx * sin + dyPx * cos;

  const w0 = (start.width / 100) * stageWidth;
  const h0 = (start.height / 100) * stageHeight;
  const minW = (MIN_SIZE / 100) * stageWidth;
  const minH = (MIN_SIZE / 100) * stageHeight;
  const left = handle === "nw" || handle === "w" || handle === "sw";
  const right = handle === "ne" || handle === "e" || handle === "se";
  const top = handle === "nw" || handle === "n" || handle === "ne";
  const bottom = handle === "sw" || handle === "s" || handle === "se";

  const w1 = left ? Math.max(minW, w0 - localDx) : right ? Math.max(minW, w0 + localDx) : w0;
  const h1 = top ? Math.max(minH, h0 - localDy) : bottom ? Math.max(minH, h0 + localDy) : h0;
  // Le centre se décale de la moitié de la variation, du côté de la poignée (repère local).
  const shiftX = left ? -(w1 - w0) / 2 : right ? (w1 - w0) / 2 : 0;
  const shiftY = top ? -(h1 - h0) / 2 : bottom ? (h1 - h0) / 2 : 0;
  const centerX = ((start.x + start.width / 2) / 100) * stageWidth + shiftX * cos - shiftY * sin;
  const centerY = ((start.y + start.height / 2) / 100) * stageHeight + shiftX * sin + shiftY * cos;

  return {
    x: ((centerX - w1 / 2) / stageWidth) * 100,
    y: ((centerY - h1 / 2) / stageHeight) * 100,
    width: (w1 / stageWidth) * 100,
    height: (h1 / stageHeight) * 100,
  };
}
