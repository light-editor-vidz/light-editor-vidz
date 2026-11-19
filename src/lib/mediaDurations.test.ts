import { describe, expect, it } from "vitest";
import { exceedsMedia } from "./mediaDurations";

describe("exceedsMedia", () => {
  it("is false while the media duration is unknown", () => {
    expect(exceedsMedia(0, 10, 1, undefined)).toBe(false);
  });
  it("compares the source seconds the clip needs with the media duration", () => {
    expect(exceedsMedia(2, 8, 1, 10)).toBe(false);
    expect(exceedsMedia(2, 8.5, 1, 10)).toBe(true);
    expect(exceedsMedia(0, 6, 2, 10)).toBe(true);
    expect(exceedsMedia(0, 5, 2, 10)).toBe(false);
  });
});
