import { describe, expect, it } from "vitest";
import i18n from "i18next";
import { describeError, isExportCancelled } from "./errors";

describe("describeError", () => {
  it("traduit une erreur connue du backend", () => {
    expect(describeError("A project already exists at this location: /x/y.lvproj")).toBe(
      "A project already exists at this location: /x/y.lvproj",
    );
  });

  it("suit la langue de l'interface", async () => {
    await i18n.changeLanguage("fr");
    expect(describeError("An export is already running.")).toBe("Un export est déjà en cours.");
    expect(describeError("File too large")).toBe("Fichier trop volumineux.");
    await i18n.changeLanguage("en");
  });

  it("garde le détail utile (chemin, cause)", async () => {
    await i18n.changeLanguage("fr");
    expect(describeError("Failed to read project: No such file")).toContain("No such file");
    await i18n.changeLanguage("en");
  });

  it("laisse passer une erreur inconnue telle quelle, objets Error compris", () => {
    expect(describeError("quelque chose d'inattendu")).toBe("quelque chose d'inattendu");
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("traduit une erreur structurée du backend d'après son code", async () => {
    await i18n.changeLanguage("fr");
    const error = { code: "read_project", detail: "No such file", message: "Failed to read project: No such file" };
    expect(describeError(error)).toBe("Lecture du projet impossible : No such file");
    await i18n.changeLanguage("en");
  });

  it("affiche le message brut d'une erreur structurée inconnue", () => {
    expect(describeError({ code: "unknown", detail: "x", message: "boom" })).toBe("boom");
    expect(describeError({ code: "brand_new", detail: "x", message: "Nouveau" })).toBe("Nouveau");
  });

  it("reconnaît l'annulation d'export, structurée ou non", () => {
    expect(isExportCancelled({ code: "export_cancelled", detail: "", message: "export-cancelled" })).toBe(true);
    expect(isExportCancelled("export-cancelled")).toBe(true);
    expect(isExportCancelled({ code: "ffmpeg_missing", detail: "", message: "x" })).toBe(false);
  });
});
