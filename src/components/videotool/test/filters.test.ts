import "./setup";
import { describe, it, expect } from "vitest";
import { VIDEO_FILTERS, getFilterById } from "../utils/filters";

describe("VIDEO_FILTERS", () => {
  it("exposes a non-empty list", () => {
    expect(VIDEO_FILTERS.length).toBeGreaterThan(0);
  });

  it('starts with a "none" filter', () => {
    expect(VIDEO_FILTERS[0].id).toBe("none");
  });

  it("has unique ids", () => {
    const ids = VIDEO_FILTERS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("provides both en and fr names for every filter", () => {
    for (const f of VIDEO_FILTERS) {
      expect(f.nameEn).toBeTruthy();
      expect(f.nameFr).toBeTruthy();
    }
  });

  it("includes mirror and upside_down (transform-only filters)", () => {
    const ids = VIDEO_FILTERS.map((f) => f.id);
    expect(ids).toContain("mirror");
    expect(ids).toContain("upside_down");
  });

  it("each filter has either css or ffmpeg defined (or is the none filter)", () => {
    for (const f of VIDEO_FILTERS) {
      if (f.id === "none") {
        expect(f.ffmpeg).toBe("");
        continue;
      }
      expect(f.ffmpeg.length).toBeGreaterThan(0);
    }
  });
});

describe("getFilterById", () => {
  it("returns the matching filter by id", () => {
    expect(getFilterById("grayscale").nameEn).toBe("Grayscale");
  });

  it('returns "none" filter as fallback for unknown id', () => {
    expect(getFilterById("does-not-exist").id).toBe("none");
  });

  it('returns "none" filter for empty string', () => {
    expect(getFilterById("").id).toBe("none");
  });

  it("returns mirror filter", () => {
    expect(getFilterById("mirror").ffmpeg).toBe("hflip");
  });
});
