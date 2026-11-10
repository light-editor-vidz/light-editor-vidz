// Les textes de la vue Image vivent dans les fichiers de traduction de l'éditeur
// (`imageTool.*`) ; ce module garde l'interface `getT` / `useT` du code d'origine.

import i18n from "i18next";

export type Lang = "en" | "fr";

export type T = (key: string, vars?: Record<string, string>) => string;

/** Traducteur dans la langue `lang`, hors composant. */
export function getT(lang: Lang): T {
  const t = i18n.getFixedT(lang);
  return (key, vars) => String(t(`imageTool.${key}`, vars));
}
