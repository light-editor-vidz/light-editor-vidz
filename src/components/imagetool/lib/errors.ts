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
  [/^Expected .* mask bytes/, "err.mask-invalid"],
  [/^Mask .* doesn't fit image/, "err.mask-fit"],
  [/^Nothing to fill from/, "err.nothing-to-fill"],
  [/^Image too large to decode/, "err.decode-too-large"],
  [/^Invalid rotation angle/, "err.bad-angle"],
  [/^History step .* out of range|^No history/, "err.history-range"],
  [/^The history changed while/, "err.history-changed"],
  [/^(Undo|Redo) failed/, "err.undo-failed"],
  [/^Unknown (anchor|flip direction|tool)/, "err.bad-option"],
  [/^Unsupported format/, "err.unsupported-format"],
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
