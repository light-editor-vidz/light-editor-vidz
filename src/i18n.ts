import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "fr"],
    interpolation: { escapeValue: false },
  });

// La langue du document suit celle de l'interface (lecteurs d'écran, césure, correcteur).
const syncDocumentLanguage = (lng: string | undefined) => {
  if (lng) document.documentElement.lang = lng.split("-")[0];
};
syncDocumentLanguage(i18n.resolvedLanguage);
i18n.on("languageChanged", syncDocumentLanguage);

export default i18n;
