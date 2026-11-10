import "./setup";
import { describe, it, expect } from "vitest";
import { mergeSegments } from "../utils/timeline";

describe("mergeSegments", () => {
  it("returns empty array for empty input", () => {
    expect(mergeSegments([])).toEqual([]);
  });

  it("returns single segment unchanged", () => {
    const seg = { id: "a", start: 10, end: 30 };
    expect(mergeSegments([seg])).toEqual([seg]);
  });

  it("keeps non-overlapping segments separate", () => {
    const segs = [
      { id: "a", start: 0, end: 20 },
      { id: "b", start: 30, end: 50 },
    ];
    expect(mergeSegments(segs)).toEqual(segs);
  });

  it("merges two overlapping segments", () => {
    const segs = [
      { id: "a", start: 0, end: 30 },
      { id: "b", start: 20, end: 50 },
    ];
    const result = mergeSegments(segs);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ start: 0, end: 50 });
  });

  it("merges two adjacent segments", () => {
    const segs = [
      { id: "a", start: 0, end: 30 },
      { id: "b", start: 30, end: 60 },
    ];
    const result = mergeSegments(segs);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ start: 0, end: 60 });
  });

  it("merges a segment fully contained in another", () => {
    const segs = [
      { id: "a", start: 0, end: 100 },
      { id: "b", start: 20, end: 50 },
    ];
    const result = mergeSegments(segs);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ start: 0, end: 100 });
  });

  it("sorts input before merging", () => {
    const segs = [
      { id: "b", start: 50, end: 80 },
      { id: "a", start: 10, end: 40 },
    ];
    const result = mergeSegments(segs);
    expect(result).toHaveLength(2);
    expect(result[0].start).toBe(10);
    expect(result[1].start).toBe(50);
  });

  it("merges chain of overlapping segments", () => {
    const segs = [
      { id: "a", start: 0, end: 20 },
      { id: "b", start: 15, end: 35 },
      { id: "c", start: 30, end: 50 },
    ];
    const result = mergeSegments(segs);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ start: 0, end: 50 });
  });

  it("preserves the id of the first merged segment", () => {
    const segs = [
      { id: "first", start: 0, end: 30 },
      { id: "second", start: 20, end: 50 },
    ];
    const result = mergeSegments(segs);
    expect(result[0].id).toBe("first");
  });

  it("does not mutate input array", () => {
    const segs = [
      { id: "a", start: 0, end: 20 },
      { id: "b", start: 10, end: 40 },
    ];
    const copy = segs.map((s) => ({ ...s }));
    mergeSegments(segs);
    expect(segs).toEqual(copy);
  });
});
