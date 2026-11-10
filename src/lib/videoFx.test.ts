import { describe, expect, it } from "vitest";
import {
  COLOR_FILTERS,
  FULL_CROP,
  clampCrop,
  cropViewBox,
  cssFilterFor,
  isFullCrop,
  videoEffectsStyle,
} from "./videoFx";

describe("colour filters", () => {
  it("shares the twenty filters of the Video view, 'none' first", () => {
    expect(COLOR_FILTERS).toHaveLength(20);
    expect(COLOR_FILTERS[0].id).toBe("none");
  });

  it("gives a CSS filter for a real one and nothing for none, unknown, missing or CSS-less ones", () => {
    expect(cssFilterFor("grayscale")).toBe("grayscale(100%)");
    expect(cssFilterFor("none")).toBeUndefined();
    expect(cssFilterFor("nope")).toBeUndefined();
    expect(cssFilterFor(null)).toBeUndefined();
    expect(cssFilterFor("vignette")).toBeUndefined();
  });
});

describe("crop", () => {
  it("keeps the area inside the image with a minimum size", () => {
    expect(clampCrop({ x: 0.9, y: -1, w: 0.5, h: 5 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(clampCrop({ x: 0, y: 0, w: 0, h: 0 })).toMatchObject({ w: 0.02, h: 0.02 });
  });

  it("knows the full image", () => {
    expect(isFullCrop(null)).toBe(true);
    expect(isFullCrop(undefined)).toBe(true);
    expect(isFullCrop(FULL_CROP)).toBe(true);
    expect(isFullCrop({ x: 0, y: 0, w: 0.9, h: 1 })).toBe(false);
  });

  it("is an object-view-box inset: top, right, bottom, left", () => {
    expect(cropViewBox({ x: 0.25, y: 0.1, w: 0.5, h: 0.8 })).toBe("inset(10% 25% 10% 25%)");
    expect(cropViewBox(null)).toBeUndefined();
    expect(cropViewBox(FULL_CROP)).toBeUndefined();
  });

  it("combines both effects in the preview style", () => {
    expect(videoEffectsStyle({ color_filter: "sepia", crop: { x: 0.5, y: 0, w: 0.5, h: 1 } })).toEqual({
      filter: "sepia(100%)",
      objectViewBox: "inset(0% 0% 0% 50%)",
    });
    expect(videoEffectsStyle({ color_filter: null, crop: null })).toEqual({});
  });
});
