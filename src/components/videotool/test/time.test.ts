import "./setup";
import { describe, it, expect } from "vitest";
import {
  formatTime,
  formatTimePrecise,
  parseTimeInput,
  getKeptSegments,
  getVirtualDuration,
  realToVirtual,
  virtualToReal,
} from "../utils/time";

describe("formatTime", () => {
  it("formats zero", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("formats seconds only", () => {
    expect(formatTime(45)).toBe("0:45");
  });

  it("formats minutes and seconds", () => {
    expect(formatTime(90)).toBe("1:30");
  });

  it("formats hours", () => {
    expect(formatTime(3661)).toBe("1:01:01");
  });

  it("pads single-digit seconds", () => {
    expect(formatTime(65)).toBe("1:05");
  });

  it("handles negative values gracefully", () => {
    expect(formatTime(-1)).toBe("0:00");
  });

  it("handles NaN gracefully", () => {
    expect(formatTime(NaN)).toBe("0:00");
  });
});

describe("formatTimePrecise", () => {
  it("formats with one decimal", () => {
    expect(formatTimePrecise(5.5)).toBe("0:05.5");
  });

  it("formats minutes correctly", () => {
    expect(formatTimePrecise(65.2)).toBe("1:05.2");
  });

  it("pads seconds below 10", () => {
    expect(formatTimePrecise(9.0)).toBe("0:09.0");
  });
});

describe("parseTimeInput", () => {
  it("parses plain seconds", () => {
    expect(parseTimeInput("83.5")).toBe(83.5);
  });

  it("parses M:SS format", () => {
    expect(parseTimeInput("1:23")).toBe(83);
  });

  it("parses M:SS.s format", () => {
    expect(parseTimeInput("1:23.5")).toBeCloseTo(83.5);
  });

  it("parses H:MM:SS format", () => {
    expect(parseTimeInput("1:01:01")).toBe(3661);
  });

  it("returns null for invalid input", () => {
    expect(parseTimeInput("abc")).toBeNull();
  });

  it("handles whitespace", () => {
    expect(parseTimeInput("  45  ")).toBe(45);
  });

  it("returns null for empty string", () => {
    expect(parseTimeInput("")).toBeNull();
  });
});

describe("getKeptSegments", () => {
  it("returns full duration when no cuts", () => {
    expect(getKeptSegments([], 100)).toEqual([{ start: 0, end: 100 }]);
  });

  it("returns empty when duration is zero", () => {
    expect(getKeptSegments([], 0)).toEqual([]);
  });

  it("returns segment before and after a single cut", () => {
    const result = getKeptSegments([{ start: 30, end: 60 }], 100);
    expect(result).toEqual([
      { start: 0, end: 30 },
      { start: 60, end: 100 },
    ]);
  });

  it("returns nothing when cut covers full duration", () => {
    expect(getKeptSegments([{ start: 0, end: 100 }], 100)).toEqual([]);
  });

  it("handles cut at the very start", () => {
    expect(getKeptSegments([{ start: 0, end: 40 }], 100)).toEqual([{ start: 40, end: 100 }]);
  });

  it("handles cut at the very end", () => {
    expect(getKeptSegments([{ start: 80, end: 100 }], 100)).toEqual([{ start: 0, end: 80 }]);
  });

  it("handles multiple non-overlapping cuts", () => {
    const result = getKeptSegments(
      [
        { start: 20, end: 40 },
        { start: 60, end: 80 },
      ],
      100,
    );
    expect(result).toEqual([
      { start: 0, end: 20 },
      { start: 40, end: 60 },
      { start: 80, end: 100 },
    ]);
  });

  it("handles unsorted cuts", () => {
    const result = getKeptSegments(
      [
        { start: 60, end: 80 },
        { start: 20, end: 40 },
      ],
      100,
    );
    expect(result).toEqual([
      { start: 0, end: 20 },
      { start: 40, end: 60 },
      { start: 80, end: 100 },
    ]);
  });

  it("handles overlapping cuts correctly", () => {
    const result = getKeptSegments(
      [
        { start: 20, end: 60 },
        { start: 40, end: 80 },
      ],
      100,
    );
    expect(result).toEqual([
      { start: 0, end: 20 },
      { start: 80, end: 100 },
    ]);
  });
});

describe("getVirtualDuration", () => {
  it("returns 0 for empty segments", () => {
    expect(getVirtualDuration([])).toBe(0);
  });

  it("returns duration of a single segment", () => {
    expect(getVirtualDuration([{ start: 10, end: 40 }])).toBe(30);
  });

  it("sums multiple segments", () => {
    expect(
      getVirtualDuration([
        { start: 0, end: 20 },
        { start: 50, end: 70 },
      ]),
    ).toBe(40);
  });
});

describe("realToVirtual", () => {
  const kept = [
    { start: 0, end: 30 },
    { start: 60, end: 100 },
  ];

  it("maps start of first segment to 0", () => {
    expect(realToVirtual(0, kept)).toBe(0);
  });

  it("maps time inside first segment", () => {
    expect(realToVirtual(15, kept)).toBe(15);
  });

  it("maps end of first segment", () => {
    expect(realToVirtual(30, kept)).toBe(30);
  });

  it("maps start of second segment to virtual boundary", () => {
    expect(realToVirtual(60, kept)).toBe(30);
  });

  it("maps time inside second segment", () => {
    expect(realToVirtual(80, kept)).toBe(50);
  });

  it("maps real time before kept segments to 0", () => {
    expect(realToVirtual(-5, kept)).toBe(0);
  });

  it("returns 0 for empty kept segments", () => {
    expect(realToVirtual(10, [])).toBe(0);
  });
});

describe("virtualToReal", () => {
  const kept = [
    { start: 0, end: 30 },
    { start: 60, end: 100 },
  ];

  it("maps virtual 0 to real 0", () => {
    expect(virtualToReal(0, kept)).toBe(0);
  });

  it("maps virtual time inside first segment", () => {
    expect(virtualToReal(15, kept)).toBe(15);
  });

  it("maps exact virtual boundary to end of first segment", () => {
    // virtualTime=30 equals the full length of the first segment → maps to its end (real 30)
    expect(virtualToReal(30, kept)).toBe(30);
  });

  it("maps virtual time just past boundary into second segment", () => {
    // virtualTime=31 → 1s into second segment → real 60+1=61
    expect(virtualToReal(31, kept)).toBe(61);
  });

  it("maps virtual time inside second segment", () => {
    expect(virtualToReal(50, kept)).toBe(80);
  });

  it("clamps to last segment end when virtualTime exceeds total", () => {
    expect(virtualToReal(999, kept)).toBe(100);
  });

  it("returns 0 for empty kept segments", () => {
    expect(virtualToReal(10, [])).toBe(0);
  });

  it("roundtrips: realToVirtual then virtualToReal", () => {
    const real = 75;
    const virtual = realToVirtual(real, kept);
    expect(virtualToReal(virtual, kept)).toBeCloseTo(real);
  });
});

// Rounding the seconds alone lets them reach 60 without carrying into the
// minutes, so the cut editor showed impossible times like "0:60.0".
describe("formatTimePrecise rollover", () => {
  it.each([
    [59.9, "0:59.9"],
    [59.95, "1:00.0"],
    [59.96, "1:00.0"],
    [59.99, "1:00.0"],
    [60, "1:00.0"],
    [119.97, "2:00.0"],
    [3599.99, "60:00.0"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatTimePrecise(input)).toBe(expected);
  });

  it("never renders sixty seconds", () => {
    for (let i = 0; i < 2000; i++) {
      expect(formatTimePrecise(i * 0.037)).not.toMatch(/:60\./);
    }
  });

  it("pads single-digit seconds", () => {
    expect(formatTimePrecise(65.4)).toBe("1:05.4");
  });

  it("keeps one decimal place", () => {
    expect(formatTimePrecise(5.04)).toBe("0:05.0");
    expect(formatTimePrecise(5.06)).toBe("0:05.1");
  });

  it("guards against invalid input", () => {
    expect(formatTimePrecise(-1)).toBe("0:00.0");
    expect(formatTimePrecise(NaN)).toBe("0:00.0");
    expect(formatTimePrecise(Infinity)).toBe("0:00.0");
  });
});
