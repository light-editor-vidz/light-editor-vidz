import { describe, expect, it } from "vitest";
import { alwaysDenoises, NO_VOICE_CLEANUP, parseVoice } from "./voice";

describe("nettoyage de la voix", () => {
  it("relit un réglage mémorisé", () => {
    expect(parseVoice({ level: "strong", denoise: true, gate: true })).toEqual({
      level: "strong",
      denoise: true,
      gate: true,
    });
  });

  it("revient au défaut pour ce qui est absent ou inconnu", () => {
    expect(parseVoice(undefined)).toEqual(NO_VOICE_CLEANUP);
    expect(parseVoice({ level: "max", denoise: "yes", gate: 1 })).toEqual(NO_VOICE_CLEANUP);
  });

  it("sait quels niveaux réduisent toujours le bruit", () => {
    expect(["off", "light", "medium", "strong"].map((l) => alwaysDenoises(parseVoice({ level: l }).level))).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});
