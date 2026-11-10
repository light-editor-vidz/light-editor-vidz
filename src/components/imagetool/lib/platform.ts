/** macOS utilise Cmd là où les autres plateformes utilisent Ctrl. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Libellé de la touche de raccourci principale, pour les infobulles. */
export const MOD = IS_MAC ? "⌘" : "Ctrl";
