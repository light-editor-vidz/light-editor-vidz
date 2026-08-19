import { describe, expect, it } from "vitest";
import i18n from "./i18n";

// Ce module configure l'instance i18next partagée au démarrage de l'app.
describe("i18n", () => {
  it("expose les deux langues de l'app", () => {
    expect(i18n.options.supportedLngs).toEqual(expect.arrayContaining(["en", "fr"]));
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("fr", "translation")).toBe(true);
  });

  it("retombe sur l'anglais", () => {
    expect(i18n.options.fallbackLng).toEqual(["en"]);
  });

  it("laisse React échapper les valeurs interpolées", () => {
    // React échappe déjà : un double échappement afficherait des entités HTML brutes.
    expect(i18n.options.interpolation?.escapeValue).toBe(false);
  });

  it("détecte la langue plutôt que de la coder en dur", () => {
    expect(i18n.services.languageDetector).toBeDefined();
  });

  it("traduit une clé connue dans les deux langues", () => {
    expect(i18n.getFixedT("en")("common.back")).toBe("Back");
    expect(i18n.getFixedT("fr")("common.back")).not.toBe("common.back");
  });
});
