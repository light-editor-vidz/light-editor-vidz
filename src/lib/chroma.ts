/** Fond vert dans l'aperçu : la même formule que l'export (`scene_core::chroma`) ; les cas de
 * `chroma_cases.json` vérifient que les deux concordent. */

import type { ChromaKey } from "../bindings/ChromaKey";

export const DEFAULT_CHROMA_KEY: ChromaKey = { color: "#00ff00", similarity: 0.2, blend: 0.1, despill: true };

const chroma = (r: number, g: number, b: number): [number, number] => [
  -0.168736 * r - 0.331264 * g + 0.5 * b,
  0.5 * r - 0.418688 * g - 0.081312 * b,
];

const unit = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export interface Keyer {
  /** Part (0..1) d'un pixel de cette couleur qui reste visible. */
  opacity: (r: number, g: number, b: number) => number;
  /** Le canal (0, 1, 2) dont l'excès est retiré, ou `null`. */
  despill: number | null;
}

/** `allowDespill` est faux quand un filtre de couleur s'applique : le reflet change de couleur.
 * `null` si la couleur est illisible. */
export function createKeyer(key: ChromaKey, allowDespill: boolean): Keyer | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(key.color);
  if (!match) return null;
  const channels = match.slice(1).map((hex) => parseInt(hex, 16));
  const [u, v] = chroma(channels[0], channels[1], channels[2]);
  const similarity = unit(key.similarity);
  const blend = unit(key.blend);
  const dominant = channels.findIndex((c, i) => channels.every((other, j) => i === j || c > other));
  return {
    despill: key.despill && allowDespill && dominant >= 0 ? dominant : null,
    opacity: (r, g, b) => {
      const [pu, pv] = chroma(r, g, b);
      const distance = Math.sqrt(((pu - u) ** 2 + (pv - v) ** 2) / (2 * 255 * 255));
      if (blend > 0.0001) return unit((distance - similarity) / blend);
      return distance > similarity ? 1 : 0;
    },
  };
}

/** Détoure des pixels RGBA non prémultipliés (ceux de `getImageData`), sur place. */
export function keyPixels(data: Uint8ClampedArray, keyer: Keyer): void {
  const channel = keyer.despill;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = Math.round(data[i + 3] * keyer.opacity(data[i], data[i + 1], data[i + 2]));
    if (channel !== null) {
      const ceiling = Math.max(data[i + ((channel + 1) % 3)], data[i + ((channel + 2) % 3)]);
      if (data[i + channel] > ceiling) data[i + channel] = ceiling;
    }
    data[i + 3] = alpha;
  }
}
