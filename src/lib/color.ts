/** Couleurs système CSS : valides pour le navigateur mais sans valeur fixe, inconnues de l'export. */
const SYSTEM_COLORS = new Set([
  "canvas",
  "canvastext",
  "linktext",
  "visitedtext",
  "activetext",
  "buttonface",
  "buttontext",
  "buttonborder",
  "field",
  "fieldtext",
  "highlight",
  "highlighttext",
  "selecteditem",
  "selecteditemtext",
  "mark",
  "marktext",
  "graytext",
  "accentcolor",
  "accentcolortext",
  "currentcolor",
]);

const NUMBER = "-?\\d*\\.?\\d+%?";
const COLOR_FUNCTION = new RegExp(
  `^(?:rgba?|hsla?)\\(\\s*${NUMBER}(?:deg)?\\s*[,\\s]\\s*${NUMBER}\\s*[,\\s]\\s*${NUMBER}\\s*(?:[,/]\\s*${NUMBER}\\s*)?\\)$`,
  "i",
);

/**
 * Vrai si `raw` est une couleur complète que l'export comprend aussi (hex 3/4/6/8 chiffres,
 * rgb()/rgba()/hsl()/hsla(), nom de couleur CSS, `transparent`). Une saisie partielle comme
 * `rgba(12` n'est pas enregistrée pendant la frappe.
 */
export function isCompleteColor(raw: string): boolean {
  const value = raw.trim();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return true;
  if (COLOR_FUNCTION.test(value)) return true;
  if (!/^[a-z]+$/i.test(value) || SYSTEM_COLORS.has(value.toLowerCase())) return false;
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", value);
}
