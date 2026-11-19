import { describe, expect, it } from "vitest";
import { syncMedia } from "./mediaSync";

const media = (currentTime: number, playbackRate = 1) => ({ currentTime, playbackRate });

describe("syncMedia", () => {
  it("leaves a playing media alone while it is within 40 ms", () => {
    const m = media(10.03);
    syncMedia(m, 10, true, 1);
    expect(m).toEqual({ currentTime: 10.03, playbackRate: 1 });
  });

  it("catches a small drift up smoothly instead of jumping", () => {
    const late = media(9.9);
    syncMedia(late, 10, true, 1);
    expect(late.currentTime).toBe(9.9);
    expect(late.playbackRate).toBeGreaterThan(1);

    const early = media(10.1);
    syncMedia(early, 10, true, 1);
    expect(early.playbackRate).toBeLessThan(1);
  });

  it("jumps beyond a quarter of a second and restores the normal rate", () => {
    const m = media(9.5, 1.08);
    syncMedia(m, 10, true, 1);
    expect(m).toEqual({ currentTime: 10, playbackRate: 1 });
  });

  it("returns to the base rate (the element's own speed) once back in sync", () => {
    const m = media(10.01, 2.1);
    syncMedia(m, 10, true, 2);
    expect(m.playbackRate).toBe(2);
  });

  it("follows frame stepping when paused, down to half a frame", () => {
    const m = media(10);
    syncMedia(m, 10.2, false, 1);
    expect(m.currentTime).toBe(10.2);
    syncMedia(m, 10.205, false, 1);
    expect(m.currentTime).toBe(10.2);
  });

  it("does not chase a media that has not really started yet, whatever the drift", () => {
    for (const state of [{ paused: true }, { seeking: true }, { readyState: 2 }]) {
      const m = { currentTime: 9, playbackRate: 1, ...state };
      syncMedia(m, 10, true, 1);
      expect(m).toMatchObject({ currentTime: 9, playbackRate: 1 });
    }
  });

  it("corrects a media that is playing and ready", () => {
    const m = { currentTime: 9, playbackRate: 1, paused: false, seeking: false, readyState: 4 };
    syncMedia(m, 10, true, 1);
    expect(m.currentTime).toBe(10);
  });

  it("still puts a paused media on the displayed image", () => {
    const m = { currentTime: 9, playbackRate: 1, paused: true };
    syncMedia(m, 10, false, 1);
    expect(m.currentTime).toBe(10);
  });
});
