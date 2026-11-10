const NON_TEXT_INPUTS = new Set(["range", "checkbox", "radio", "button", "submit", "color", "file"]);

/**
 * Vrai si la cible d'un évènement clavier est un champ où l'on saisit du texte. Un curseur
 * ou une case à cocher n'en est pas un : Ctrl+Z doit continuer d'annuler après avoir réglé
 * un curseur, qui garde le focus.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.tagName === "INPUT") return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
  return el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable === true;
}

/** Vrai si une boîte de dialogue modale est ouverte (les raccourcis de l'éditeur se taisent). */
export function isModalOpen(): boolean {
  return document.querySelector('dialog[open], [role="dialog"]') !== null;
}
