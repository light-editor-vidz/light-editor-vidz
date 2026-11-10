import "./setup";
import { describe, it, expect } from "vitest";
import { en } from "../messages/en";
import { fr } from "../messages/fr";

const LOCALES = { en, fr } as const;
type Locale = keyof typeof LOCALES;

describe("locale parity", () => {
  it("defines the same keys in every language", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps the same value shape for every key", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(typeof fr[key], `${String(key)} differs in type`).toBe(typeof en[key]);
    }
  });

  it("leaves no message empty", () => {
    for (const [lang, dict] of Object.entries(LOCALES)) {
      for (const [key, value] of Object.entries(dict)) {
        if (typeof value === "string") {
          expect(value.trim(), `${lang}.${key} is empty`).not.toBe("");
        }
      }
    }
  });
});

// Pluralisation is per-language logic, so the parameterised messages need
// exercising in every locale — not just the one the tests happen to render in.
describe.each(["en", "fr"] as Locale[])("%s pluralised messages", (lang) => {
  const t = LOCALES[lang];

  it("cuts_count uses the singular for one", () => {
    expect(t.cuts_count(1)).toBe(lang === "en" ? "1 cut" : "1 coupe");
  });

  it("cuts_count uses the plural beyond one", () => {
    expect(t.cuts_count(3)).toBe(lang === "en" ? "3 cuts" : "3 coupes");
  });

  it("tl_cuts uses the singular for one", () => {
    expect(t.tl_cuts(1)).toBe(lang === "en" ? "1 cut" : "1 coupe");
  });

  it("tl_cuts uses the plural beyond one", () => {
    expect(t.tl_cuts(2)).toBe(lang === "en" ? "2 cuts" : "2 coupes");
  });

  it("export_cuts_removed uses the singular for one", () => {
    expect(t.export_cuts_removed(1)).toBe(lang === "en" ? "1 segment removed" : "1 segment supprimé");
  });

  // French agrees both the noun and the past participle; English only the noun.
  it("export_cuts_removed uses the plural beyond one", () => {
    expect(t.export_cuts_removed(4)).toBe(lang === "en" ? "4 segments removed" : "4 segments supprimés");
  });

  it("handles zero as a plural", () => {
    expect(t.cuts_count(0)).toBe(lang === "en" ? "0 cut" : "0 coupe");
  });
});
