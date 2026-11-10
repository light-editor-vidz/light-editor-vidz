import "./setup";
import { describe, it, expect } from "vitest";
import { aspectValue, fitAspect, resizeLocked } from "../utils/crop";

const frame = { w: 1920, h: 1080 };

describe("aspectValue", () => {
  it('reads "w:h"', () => {
    expect(aspectValue("9:16")).toBeCloseTo(0.5625);
    expect(aspectValue("1:1")).toBe(1);
  });
});

describe("fitAspect", () => {
  it("makes the largest centred 9:16 box in a landscape frame", () => {
    expect(fitAspect(frame, "9:16")).toEqual({ x: 656, y: 0, w: 608, h: 1080 });
  });
  it("makes a full-width 16:9 box in a portrait frame, centred vertically", () => {
    expect(fitAspect({ w: 1080, h: 1920 }, "16:9")).toEqual({ x: 0, y: 656, w: 1080, h: 608 });
  });
  it("keeps a frame that already has the ratio", () => {
    expect(fitAspect(frame, "16:9")).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });
});

describe("resizeLocked", () => {
  const box = { x: 100, y: 100, w: 400, h: 400 };

  it("grows from the bottom-right corner, top-left staying put, ratio kept", () => {
    const r = resizeLocked(box, "br", 100, 0, frame, 1);
    expect(r).toEqual({ x: 100, y: 100, w: 500, h: 500 });
  });

  it("shrinks from the top-left corner, bottom-right staying put", () => {
    const r = resizeLocked(box, "tl", 100, 100, frame, 1);
    expect(r).toEqual({ x: 200, y: 200, w: 300, h: 300 });
  });

  it("keeps a 9:16 ratio whatever the pointer does", () => {
    const r = resizeLocked({ x: 0, y: 0, w: 270, h: 480 }, "br", 90, 10, frame, 9 / 16);
    expect(r.w / r.h).toBeCloseTo(9 / 16, 1);
  });

  it("never leaves the frame", () => {
    const r = resizeLocked(box, "br", 5000, 5000, frame, 1);
    expect(r.x + r.w).toBeLessThanOrEqual(frame.w);
    expect(r.y + r.h).toBeLessThanOrEqual(frame.h);
    expect(r.w).toBe(r.h);
  });

  it("never goes below the minimum", () => {
    const r = resizeLocked(box, "br", -5000, -5000, frame, 1, 20);
    expect(r.w).toBe(20);
  });
});
