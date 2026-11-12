import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  HISTORY_LIMIT,
  SPEEDS,
  canRedo,
  canUndo,
  current,
  goto,
  newHistory,
  record,
  redo,
  sameSettings,
  speedOf,
  undo,
} from "./settings";

const with_ = (patch: Partial<typeof DEFAULT_SETTINGS>) => ({ ...DEFAULT_SETTINGS, ...patch });

describe("speed steps", () => {
  it("starts at normal speed", () => {
    expect(speedOf(DEFAULT_SETTINGS)).toBe(1);
    expect(SPEEDS[DEFAULT_SETTINGS.speedStep]).toBe(1);
  });

  it("maps a step to its speed, and an unknown step to normal speed", () => {
    expect(speedOf(with_({ speedStep: 0 }))).toBe(0.25);
    expect(speedOf(with_({ speedStep: 8 }))).toBe(4);
    expect(speedOf(with_({ speedStep: 99 }))).toBe(1);
  });
});

describe("sameSettings", () => {
  it("compares cuts by value and every other field by identity", () => {
    const cut = { id: "a", start: 1, end: 2 };
    expect(sameSettings(with_({ cuts: [cut] }), with_({ cuts: [{ ...cut }] }))).toBe(true);
    expect(sameSettings(with_({ cuts: [cut] }), with_({ cuts: [{ ...cut, end: 3 }] }))).toBe(false);
    expect(sameSettings(with_({ fadeIn: 1 }), with_({ fadeIn: 2 }))).toBe(false);
    expect(sameSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS })).toBe(true);
  });
});

describe("history", () => {
  it("starts with a single step, nothing to undo or redo", () => {
    const h = newHistory();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(current(h)).toBe(DEFAULT_SETTINGS);
  });

  it("records a change, undoes it and redoes it", () => {
    let h = record(newHistory(), with_({ fadeIn: 2 }));
    expect(current(h).fadeIn).toBe(2);
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(current(h).fadeIn).toBe(0);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(current(h).fadeIn).toBe(2);
  });

  it("ignores a step identical to the current one", () => {
    const h = newHistory();
    expect(record(h, { ...DEFAULT_SETTINGS })).toBe(h);
  });

  it("forgets what was undone once a new change is made", () => {
    let h = record(newHistory(), with_({ fadeIn: 1 }));
    h = record(h, with_({ fadeIn: 2 }));
    h = undo(undo(h));
    h = record(h, with_({ fadeOut: 3 }));
    expect(canRedo(h)).toBe(false);
    expect(h.steps).toHaveLength(2);
  });

  it("undo and redo at the ends change nothing", () => {
    const h = newHistory();
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("is bounded", () => {
    let h = newHistory();
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = record(h, with_({ fadeIn: i }));
    expect(h.steps).toHaveLength(HISTORY_LIMIT);
    expect(current(h).fadeIn).toBe(HISTORY_LIMIT + 20);
  });

  it("jumps straight to a step, keeping the steps after it", () => {
    let h = newHistory();
    h = record(h, with_({ fadeIn: 1 }));
    h = record(h, with_({ fadeIn: 2 }));
    h = goto(h, 0);
    expect(current(h)).toEqual(DEFAULT_SETTINGS);
    expect(h.steps).toHaveLength(3);
    expect(current(goto(h, 2)).fadeIn).toBe(2);
    expect(goto(h, 9)).toBe(h);
  });
});
