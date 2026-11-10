import { describe, expect, it } from "vitest";
import { describeError } from "../errors";

describe("subtitle errors", () => {
  it("translates the codes of the subtitle engine", () => {
    expect(describeError({ code: "no_audio", message: "x" })).toBe("This media has no audio to transcribe.");
    expect(describeError({ code: "network_unreachable", message: "x" })).toMatch(/network/i);
  });

  it("shows the message of an error without a code", () => {
    expect(describeError({ code: null, message: "Something odd" })).toBe("Something odd");
    expect(describeError({ code: null, message: "The project has no audio to export." })).toMatch(/no sound/);
  });

  it("keeps the engine's message for an unknown code", () => {
    expect(describeError({ code: "brand_new", message: "Something odd" })).toBe("Something odd");
  });
});
