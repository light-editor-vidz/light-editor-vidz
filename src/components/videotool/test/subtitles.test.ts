import "./setup";
import { describe, it, expect } from "vitest";
import {
  getWordWindows,
  getCharWindows,
  getActiveCue,
  getActiveWordIndex,
  getActiveCharCount,
} from "../utils/subtitles";
import type { SubtitleCue } from "../utils/srt";

const cue: SubtitleCue = { id: 1, start: 10, end: 12, text: "a bb ccc" };

describe("getWordWindows", () => {
  it("splits proportionally to word length", () => {
    const windows = getWordWindows(cue);
    expect(windows).toHaveLength(3);
    // total chars = 1 + 2 + 3 = 6, duration = 2s -> a=1/6*2=0.333, bb=2/6*2=0.667, ccc=3/6*2=1
    expect(windows[0].start).toBeCloseTo(10);
    expect(windows[0].end).toBeCloseTo(10.333, 2);
    expect(windows[1].end).toBeCloseTo(11, 2);
    expect(windows[2].end).toBeCloseTo(12);
    expect(windows.map((w) => w.text)).toEqual(["a", "bb", "ccc"]);
  });

  it("returns empty array for blank text", () => {
    expect(getWordWindows({ id: 1, start: 0, end: 1, text: "   " })).toEqual([]);
  });

  it("snaps the last window end to the cue end", () => {
    const windows = getWordWindows(cue);
    expect(windows[windows.length - 1].end).toBe(cue.end);
  });
});

describe("getCharWindows", () => {
  it("produces cumulative text per character", () => {
    const windows = getCharWindows({ id: 1, start: 0, end: 1, text: "abc" });
    expect(windows.map((w) => w.text)).toEqual(["a", "ab", "abc"]);
  });

  it("splits duration evenly across characters", () => {
    const windows = getCharWindows({ id: 1, start: 0, end: 3, text: "abc" });
    expect(windows[0].end).toBeCloseTo(1);
    expect(windows[1].end).toBeCloseTo(2);
    expect(windows[2].end).toBe(3);
  });

  it("handles unicode characters", () => {
    const windows = getCharWindows({ id: 1, start: 0, end: 1, text: "Dôme" });
    expect(windows).toHaveLength(4);
  });
});

describe("getActiveCue", () => {
  const cues: SubtitleCue[] = [
    { id: 1, start: 0, end: 2, text: "first" },
    { id: 2, start: 2, end: 4, text: "second" },
  ];

  it("finds the cue containing the given time", () => {
    expect(getActiveCue(cues, 1)?.text).toBe("first");
    expect(getActiveCue(cues, 2)?.text).toBe("second");
  });

  it("returns null outside any cue window", () => {
    expect(getActiveCue(cues, 5)).toBeNull();
  });
});

describe("getActiveWordIndex", () => {
  it("returns the index of the active word window", () => {
    expect(getActiveWordIndex(cue, 10)).toBe(0);
    expect(getActiveWordIndex(cue, 10.5)).toBe(1);
    expect(getActiveWordIndex(cue, 11.5)).toBe(2);
  });

  it("clamps to the last word when time is past the cue end", () => {
    expect(getActiveWordIndex(cue, 100)).toBe(2);
  });

  it("returns -1 for a cue with no words", () => {
    expect(getActiveWordIndex({ id: 1, start: 0, end: 1, text: " " }, 0)).toBe(-1);
  });
});

describe("getActiveCharCount", () => {
  const c: SubtitleCue = { id: 1, start: 0, end: 3, text: "abc" };

  it("grows as time advances through the cue", () => {
    expect(getActiveCharCount(c, 0)).toBe(1);
    expect(getActiveCharCount(c, 1.5)).toBe(2);
    expect(getActiveCharCount(c, 2.5)).toBe(3);
  });

  it("reveals all characters once past the cue end", () => {
    expect(getActiveCharCount(c, 100)).toBe(3);
  });
});
