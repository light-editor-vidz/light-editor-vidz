import { describe, expect, it } from "vitest";
import cases from "../../crates/scene-core/src/chroma_cases.json";
import { createKeyer, DEFAULT_CHROMA_KEY, keyPixels } from "./chroma";

describe("fond vert", () => {
  it.each(cases)("donne les mêmes pixels que l'export : $rgb sur $key.color", ({ key, rgb, alpha, out }) => {
    const data = new Uint8ClampedArray([...rgb, 255]);
    keyPixels(data, createKeyer(key, true)!);
    expect([...data]).toEqual([...out, alpha]);
  });

  it("ne retire pas le reflet sous un filtre de couleur", () => {
    expect(createKeyer(DEFAULT_CHROMA_KEY, false)!.despill).toBeNull();
  });

  it("ignore une couleur illisible", () => {
    expect(createKeyer({ ...DEFAULT_CHROMA_KEY, color: "green" }, true)).toBeNull();
  });
});
