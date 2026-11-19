import { describe, expect, it } from "vitest";
import type { AudioTrack } from "../bindings/AudioTrack";
import type { Element } from "../bindings/Element";
import { DEFAULT_SETTINGS } from "./audiotool/settings";
import {
  audioClipSettings,
  audioSettingsFromClip,
  neutralizeBaked,
  trimToCuts,
  videoClipSettings,
  videoEditableFromClip,
} from "./clipSettings";

const video = {
  id: "v1",
  type: "video",
  src: "assets/videos/a.mp4",
  video_offset: 2,
  playback_speed: 2,
  muted: true,
  crop: { x: 0.25, y: 0, w: 0.5, h: 1 },
  color_filter: "sepia",
} as unknown as Extract<Element, { type: "video" }>;

const track = {
  id: "a1",
  src: "assets/audio/x.mp3",
  audio_offset: 1,
  duration: 4,
  speed: 1.5,
  fade_in: 0.5,
  fade_out: 1,
  fade_curve: "equal-power",
  filter: { kind: "low-pass", frequency: 800, slope: 24, q: 1 },
} as unknown as AudioTrack;

describe("trimToCuts", () => {
  it("cuts what is before the entry and after the exit", () => {
    expect(trimToCuts(2, 6, 20)).toEqual([
      { id: "clip-head", start: 0, end: 2 },
      { id: "clip-tail", start: 8, end: 20 },
    ]);
  });
  it("cuts nothing for an untrimmed clip, or a clip that runs to the end", () => {
    expect(trimToCuts(0, 20, 20)).toEqual([]);
    expect(trimToCuts(0, null, 20)).toEqual([]);
    expect(trimToCuts(5, null, 20)).toEqual([{ id: "clip-head", start: 0, end: 5 }]);
  });
});

describe("video clip", () => {
  it("is read in source seconds and handed to the video view with pixel crop", () => {
    const clip = videoClipSettings(video, 3);
    expect(clip).toMatchObject({ kind: "video", offset: 2, length: 6, speed: 2, muted: true, filter: "sepia" });
    if (clip.kind !== "video") throw new Error("video expected");
    const editable = videoEditableFromClip(clip, 20, { w: 1920, h: 1080 });
    expect(editable).toMatchObject({
      speed: 2,
      muted: true,
      filter: "sepia",
      crop: { x: 480, y: 0, w: 960, h: 1080 },
    });
    expect(editable.cutSegments.map((c) => [c.start, c.end])).toEqual([
      [0, 2],
      [8, 20],
    ]);
  });
  it("has no filter or crop when the clip has none", () => {
    const clip = videoClipSettings({ ...video, crop: null, color_filter: null } as typeof video, 3);
    if (clip.kind !== "video") throw new Error("video expected");
    expect(videoEditableFromClip(clip, 20, { w: 100, h: 100 })).toMatchObject({ crop: null, filter: "none" });
  });
});

describe("audio clip", () => {
  it("is handed to the audio view", () => {
    const clip = audioClipSettings(track);
    if (clip.kind !== "audio") throw new Error("audio expected");
    expect(clip.length).toBe(6);
    const s = audioSettingsFromClip(clip, 30, DEFAULT_SETTINGS);
    expect(s).toMatchObject({
      fadeIn: 0.5,
      fadeOut: 1,
      fadeCurve: "equal-power",
      filterType: "lowpass",
      filterFreq: 800,
      filterSlope: 24,
    });
    expect(s.speedStep).toBe(5);
    expect(s.cuts.map((c) => [c.start, c.end])).toEqual([
      [0, 1],
      [7, 30],
    ]);
  });
});

describe("neutralizeBaked", () => {
  it("resets what the new version already contains", () => {
    expect(neutralizeBaked(video)).toMatchObject({
      video_offset: 0,
      playback_speed: 1,
      crop: null,
      color_filter: null,
      muted: true,
    });
    expect(neutralizeBaked(track)).toMatchObject({ audio_offset: 0, fade_in: 0, fade_out: 0, speed: 1, filter: null });
  });
  it("leaves an image untouched", () => {
    const image = { id: "i", type: "image" } as unknown as Element;
    expect(neutralizeBaked(image)).toBe(image);
  });
});
