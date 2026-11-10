// Les textes de la vue Vidéo suivent la langue de l'éditeur (react-i18next) ; les messages restent
// des objets TypeScript typés (`messages/en.ts`, `messages/fr.ts`), comme ceux de la suite.

import { createContext, useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { en, type Translations } from "./messages/en";
import { fr } from "./messages/fr";

export type Lang = "en" | "fr";
export type { Translations };

export const translations = { en, fr };

const LangOverride = createContext<Lang | null>(null);

/** Impose une langue à un sous-arbre (les tests) ; sinon la langue de l'éditeur s'applique. */
export function LangProvider({ lang, children }: { lang?: Lang; children: ReactNode }) {
  return <LangOverride.Provider value={lang ?? null}>{children}</LangOverride.Provider>;
}

export function useT(): { lang: Lang; t: Translations } {
  const { i18n } = useTranslation();
  const override = useContext(LangOverride);
  const lang: Lang = override ?? (i18n.resolvedLanguage === "fr" ? "fr" : "en");
  return { lang, t: translations[lang] };
}
