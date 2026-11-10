import "./setup";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getT } from "../lib/i18n";
import { translateError } from "../lib/errors";
import { isModalOpen, isTypingTarget } from "../lib/dom";
import { isValidSize, MAX_PIXELS, MAX_SIDE, parseDim } from "../lib/limits";
import { loadPrefs, savePrefs } from "../lib/prefs";
import { addRecentFile, clearRecentFiles, getRecentFiles, removeRecentFile } from "../lib/recentFiles";

const en = getT("en");
const fr = getT("fr");

describe("translateError", () => {
  it.each([
    ["Tab not found", "This image is no longer open."],
    ["No image loaded", "No image loaded."],
    ["Nothing to undo", "Nothing to undo."],
    ["Nothing to redo", "Nothing to redo."],
    ["Mask is empty", "Paint over the area to remove first."],
    ["Width and height must be greater than 0", "Width and height must be at least 1 px."],
    ["Canvas size (10×10) must be >= image size (20×20)", "The canvas cannot be smaller than the image."],
  ])('translates "%s"', (raw, expected) => {
    expect(translateError(raw, en)).toBe(expected);
  });

  it("translates into French and fills in the parameters", () => {
    expect(translateError("Crop rect (0,0,9,9) exceeds image bounds (4x3)", fr)).toBe(
      "La zone de recadrage dépasse l’image (4×3).",
    );
  });

  it("recognises the size limit message", () => {
    expect(translateError("Image size 100000×100000 exceeds the limit (30000 px per side, 200 Mpx)", en)).toMatch(
      /too large/,
    );
  });

  it("unwraps an Error", () => {
    expect(translateError(new Error("Tab not found"), en)).toBe("This image is no longer open.");
  });

  it("shows an unknown message as it is", () => {
    expect(translateError("weird failure", en)).toBe("weird failure");
  });
});

describe("keyboard targets", () => {
  const el = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
  };

  it.each(['<input type="text">', '<input type="number">', "<input>", "<textarea></textarea>", "<select></select>"])(
    "treats %s as a text field",
    (html) => {
      expect(isTypingTarget(el(html))).toBe(true);
    },
  );

  it.each([
    '<input type="range">',
    '<input type="checkbox">',
    '<input type="radio">',
    "<button></button>",
    "<div></div>",
  ])("does not treat %s as a text field", (html) => {
    expect(isTypingTarget(el(html))).toBe(false);
  });

  it("copes with a non-element target such as window", () => {
    expect(isTypingTarget(window)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("sees an open modal dialog", () => {
    document.body.innerHTML = "";
    expect(isModalOpen()).toBe(false);
    document.body.innerHTML = '<div role="dialog"></div>';
    expect(isModalOpen()).toBe(true);
    document.body.innerHTML = "";
  });
});

describe("size limits", () => {
  it("parses whole numbers only", () => {
    expect(parseDim("640")).toBe(640);
    expect(parseDim(" 12 ")).toBe(12);
    expect(parseDim("")).toBeNaN();
    expect(parseDim("-5")).toBeNaN();
    expect(parseDim("1.5")).toBeNaN();
    expect(parseDim("abc")).toBeNaN();
  });

  it("accepts a reasonable size and rejects the extremes", () => {
    expect(isValidSize(1, 1)).toBe(true);
    expect(isValidSize(MAX_SIDE, 1000)).toBe(true);
    expect(isValidSize(0, 10)).toBe(false);
    expect(isValidSize(NaN, 10)).toBe(false);
    expect(isValidSize(MAX_SIDE + 1, 1)).toBe(false);
    expect(isValidSize(20_000, 20_000)).toBe(false); // 400 Mpx
    expect(20_000 * 10_000).toBeLessThanOrEqual(MAX_PIXELS);
    expect(isValidSize(20_000, 10_000)).toBe(true);
  });
});

describe("storage resilience", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("keeps the most recent file first, without duplicates, capped at ten", () => {
    for (let i = 0; i < 12; i++) addRecentFile(`/p/${i}.png`);
    addRecentFile("/p/5.png");

    const list = getRecentFiles();
    expect(list[0]).toBe("/p/5.png");
    expect(list).toHaveLength(10);
    expect(new Set(list).size).toBe(10);
  });

  it("forgets a single file", () => {
    addRecentFile("/a.png");
    addRecentFile("/b.png");

    removeRecentFile("/a.png");

    expect(getRecentFiles()).toEqual(["/b.png"]);
  });

  it("ignores a corrupt recent list", () => {
    localStorage.setItem("lciz-recent", '{"not":"a list"}');
    expect(getRecentFiles()).toEqual([]);
    localStorage.setItem("lciz-recent", '[1,"/ok.png",null]');
    expect(getRecentFiles()).toEqual(["/ok.png"]);
  });

  it("does not throw when the storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => addRecentFile("/a.png")).not.toThrow();
    expect(() => removeRecentFile("/a.png")).not.toThrow();
    expect(() => clearRecentFiles()).not.toThrow();
    expect(() => savePrefs({ defaultExportFormat: "png", defaultJpegQuality: 90, gridSize: 50 })).not.toThrow();
  });

  it("falls back to the defaults when the stored preferences are unreadable", () => {
    localStorage.setItem("lciz-prefs", "{broken");
    expect(loadPrefs().defaultExportFormat).toBe("png");
  });
});
