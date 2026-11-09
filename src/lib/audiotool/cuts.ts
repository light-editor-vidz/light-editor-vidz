// Les coupes : les parties de la piste qui sont retirées. Fonctions pures, sans accès au DOM.
//
// Une coupe est `{ id, start, end }` en secondes du fichier (temps « réel »). Ce qui reste une
// fois les coupes retirées, ce sont les segments conservés ; le temps compté le long de ces
// segments est le temps « virtuel », celui que la barre de lecture et le lecteur affichent.

export interface Cut {
  id: string;
  start: number;
  end: number;
}

export interface Segment {
  start: number;
  end: number;
}

/** La plus courte coupe qui vaille la peine d'être faite. */
export const MIN_CUT = 0.05;

/** Trie les coupes et fusionne celles qui se chevauchent ou se touchent. Une coupe fusionnée
 * garde l'identifiant de la plus ancienne. */
export function mergeCuts(cuts: Cut[]): Cut[] {
  if (!cuts.length) return [];
  const sorted = [...cuts].sort((a, b) => a.start - b.start);
  const out = [{ ...sorted[0] }];
  for (const cut of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (cut.start <= last.end) last.end = Math.max(last.end, cut.end);
    else out.push({ ...cut });
  }
  return out;
}

/** Ce que les coupes laissent : des plages `{ start, end }`, dans l'ordre. */
export function keptSegments(cuts: Cut[], duration: number): Segment[] {
  if (!(duration > 0)) return [];
  const kept: Segment[] = [];
  let pos = 0;
  for (const cut of mergeCuts(cuts)) {
    const start = Math.max(0, Math.min(cut.start, duration));
    const end = Math.max(start, Math.min(cut.end, duration));
    if (start > pos) kept.push({ start: pos, end: start });
    pos = Math.max(pos, end);
  }
  if (pos < duration) kept.push({ start: pos, end: duration });
  return kept;
}

/** Durée totale des segments conservés. */
export function keptDuration(kept: Segment[]): number {
  return kept.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
}

/** Temps du fichier → temps le long des segments conservés. Un temps à l'intérieur d'une coupe
 * tombe sur le début de la coupe. */
export function realToVirtual(real: number, kept: Segment[]): number {
  let virtual = 0;
  for (const seg of kept) {
    if (real <= seg.start) break;
    if (real <= seg.end) {
      virtual += real - seg.start;
      break;
    }
    virtual += seg.end - seg.start;
  }
  return virtual;
}

/** Temps le long des segments conservés → temps du fichier. */
export function virtualToReal(virtual: number, kept: Segment[]): number {
  let remaining = Math.max(0, virtual);
  for (const seg of kept) {
    const length = seg.end - seg.start;
    if (remaining <= length) return seg.start + remaining;
    remaining -= length;
  }
  return kept.length ? kept[kept.length - 1].end : 0;
}

/** Les `cuts` de la requête d'export : paires `[début, fin]`, bornées au fichier. */
export function cutRanges(cuts: Cut[], duration: number): [number, number][] {
  return mergeCuts(cuts)
    .map((cut): [number, number] => [Math.max(0, cut.start), Math.min(duration, cut.end)])
    .filter(([start, end]) => end > start);
}

/** « 1:23.4 », « 83.4 » ou « 1:02:03 » → secondes, ou `null` pour toute autre saisie. */
export function parseTimeInput(value: string): number | null {
  const parts = String(value).trim().split(":");
  if (parts.length > 3 || parts.some((part) => part.trim() === "")) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return nums.reduce((total, n) => total * 60 + n, 0);
}

/** Secondes sous la forme `m:ss.t`, pour les champs précis. */
export function fmtPrecise(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00.0";
  // Le total est arrondi d'abord : arrondir les seules secondes pourrait afficher 0:60.0.
  const tenths = Math.round(secs * 10);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}
