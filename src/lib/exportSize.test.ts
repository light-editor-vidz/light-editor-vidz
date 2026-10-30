import { describe, expect, it } from "vitest";
import { exportDimensions } from "./exportSize";

describe("exportDimensions", () => {
  it("garde la taille du projet pour « original » (dimensions paires à l'affichage)", () => {
    expect(exportDimensions(1920, 1080, "original")).toMatchObject({
      width: null,
      height: null,
      effective: { width: 1920, height: 1080 },
    });
    expect(exportDimensions(101, 75, "original").effective).toEqual({ width: 102, height: 76 });
  });

  it("applique la cible à la hauteur d'une vidéo horizontale", () => {
    expect(exportDimensions(1920, 1080, 720)).toMatchObject({ width: 1280, height: 720 });
  });

  it("applique la cible au plus petit côté d'une vidéo verticale", () => {
    // 1080×1920 en « 720p » : 720×1280, et non 404×720.
    expect(exportDimensions(1080, 1920, 720)).toMatchObject({ width: 720, height: 1280 });
    expect(exportDimensions(1080, 1920, 1080)).toMatchObject({ width: 1080, height: 1920 });
  });

  it("ne dépasse jamais la taille du projet", () => {
    expect(exportDimensions(1280, 720, 1080)).toMatchObject({ width: 1280, height: 720 });
  });

  it("rend des dimensions paires", () => {
    const { width, height } = exportDimensions(1000, 563, 480);
    expect((width ?? 0) % 2).toBe(0);
    expect((height ?? 0) % 2).toBe(0);
  });
});
