type Params = Record<string, string>;
type Translate = (key: string, vars?: Params) => string;

/** Messages du backend (anglais, techniques) reconnus et leur clé de traduction. */
const RULES: Array<[RegExp, string, ((m: RegExpMatchArray) => Params)?]> = [
  [/^Tab not found/, "err.tab-not-found"],
  [/^No image loaded/, "err.no-image"],
  [/^Nothing to undo/, "err.nothing-to-undo"],
  [/^Nothing to redo/, "err.nothing-to-redo"],
  [/exceeds image bounds \((\d+)x(\d+)\)/, "err.crop-bounds", (m) => ({ w: m[1], h: m[2] })],
  [/exceeds the limit/, "err.too-large"],
  [/^Mask is empty/, "err.mask-empty"],
  [/must be greater than 0/, "err.zero-size"],
  [/^Canvas size .* must be >= image size/, "err.canvas-smaller"],
];

/** Traduit une erreur du backend ; les messages inconnus sont affichés tels quels. */
export function translateError(err: unknown, t: Translate): string {
  const raw = err instanceof Error ? err.message : String(err);
  for (const [re, key, vars] of RULES) {
    const m = raw.match(re);
    if (m) return t(key, vars?.(m));
  }
  return raw;
}
