import "./setup";
import { describe, it, expect } from "vitest";
import { isVideoFileName, videoTransform, homography, perspectiveCorners, VIDEO_EXTENSIONS } from "../utils/video";

describe("isVideoFileName", () => {
  it.each(["a.mp4", "a.MOV", "my.clip.mkv", "x.webm", "x.flv", "x.m4v", "x.avi"])("accepts %s", (n) => {
    expect(isVideoFileName(n)).toBe(true);
  });
  it.each(["notes.txt", "mp4", "archive.zip", ".mp4x", "photo.jpg", ""])("rejects %j", (n) => {
    expect(isVideoFileName(n)).toBe(false);
  });
  it("is judged on the extension, never on a MIME type", () => {
    // File.type is "" for MKV/FLV on several platforms.
    expect(isVideoFileName(new File(["x"], "movie.mkv", { type: "" }).name)).toBe(true);
  });
});

describe("videoTransform", () => {
  it("is a plain rotation (total of rotate + straighten) without perspective", () => {
    expect(videoTransform(90, 5, 0, 0, "none")).toBe("rotateZ(95deg)");
  });
  it("adds the flips of the mirror and upside-down filters", () => {
    expect(videoTransform(0, 0, 0, 0, "mirror")).toContain("scaleX(-1)");
    expect(videoTransform(0, 0, 0, 0, "upside_down")).toContain("scaleY(-1)");
    expect(videoTransform(0, 0, 0, 0, "sepia")).not.toContain("scale");
  });
  it("switches to a projective matrix once perspective is set and the size is known", () => {
    expect(videoTransform(0, 0, 20, 0, "none", { w: 640, h: 360 })).toMatch(/^matrix3d\(/);
  });
  it("keeps the keyword form when the size is not known yet", () => {
    expect(videoTransform(0, 0, 20, 0, "none")).toBe("rotateZ(0deg)");
  });
  it("is the identity matrix for a zero-angle perspective with a size", () => {
    // perspective angles of 0 take the keyword path; check the matrix path with a tiny angle instead
    const m = videoTransform(0, 0, 1e-9, 0, "none", { w: 100, h: 50 })
      .replace("matrix3d(", "")
      .replace(")", "")
      .split(",")
      .map(Number);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    m.forEach((v, i) => expect(v).toBeCloseTo(identity[i], 5));
  });
});

describe("homography", () => {
  const unit: [number, number][] = [
    [0, 0],
    [100, 0],
    [0, 50],
    [100, 50],
  ];
  const apply = (m: number[][], [x, y]: [number, number]) => {
    const w = m[2][0] * x + m[2][1] * y + m[2][2];
    return [(m[0][0] * x + m[0][1] * y + m[0][2]) / w, (m[1][0] * x + m[1][1] * y + m[1][2]) / w];
  };

  it("maps each source corner exactly onto its target", () => {
    const to: [number, number][] = [
      [10, 5],
      [90, -5],
      [0, 60],
      [100, 40],
    ];
    const h = homography(unit, to);
    unit.forEach((p, i) => {
      const [x, y] = apply(h, p);
      expect(x).toBeCloseTo(to[i][0], 6);
      expect(y).toBeCloseTo(to[i][1], 6);
    });
  });

  it("is the identity for identical quads", () => {
    const h = homography(unit, unit);
    expect(apply(h, [37, 12])[0]).toBeCloseTo(37, 6);
    expect(apply(h, [37, 12])[1]).toBeCloseTo(12, 6);
  });

  it("uses the export filter's corner formula", () => {
    const [tl, tr, bl, br] = perspectiveCorners(640, 360, 30, 0);
    const s = Math.sin((30 * Math.PI) / 180) * 0.2;
    expect(tl).toEqual([-0, -360 * s]);
    expect(tr).toEqual([640, 360 * s]);
    expect(bl).toEqual([0, 360 + 360 * s]);
    expect(br).toEqual([640, 360 - 360 * s]);
  });
});

describe("VIDEO_EXTENSIONS", () => {
  it("covers what the README promises", () => {
    expect(VIDEO_EXTENSIONS).toEqual(["mp4", "mov", "avi", "mkv", "webm", "flv", "m4v"]);
  });
});
