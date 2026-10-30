import { describe, expect, it } from "vitest";
import { isCompleteColor } from "./color";

describe("isCompleteColor", () => {
  it("accepte les formats que l'export comprend", () => {
    for (const ok of [
      "#fff",
      "#ffff",
      "#ff8800",
      "#ff880080",
      "rgb(1,2,3)",
      "rgba(1, 2, 3, 0.5)",
      "rgb(1 2 3 / 50%)",
      "hsl(120, 50%, 50%)",
      "hsla(120deg, 50%, 50%, 0.3)",
    ]) {
      expect(isCompleteColor(ok), ok).toBe(true);
    }
  });

  it("refuse les saisies partielles ou invalides pendant la frappe", () => {
    for (const bad of ["", "#ff", "#ff880", "rgba(", "rgba(12", "rgba(1,2,3", "rgb(1,2)", "hsl(", "12", "var(--x)"]) {
      expect(isCompleteColor(bad), bad).toBe(false);
    }
  });

  it("refuse les mots-clés qui n'ont pas de couleur fixe", () => {
    expect(isCompleteColor("currentColor")).toBe(false);
    expect(isCompleteColor("Canvas")).toBe(false);
  });
});
