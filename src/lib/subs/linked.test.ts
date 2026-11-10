import { describe, expect, it } from "vitest";
import type { Project } from "../../bindings/Project";
import type { Composition } from "../../bindings/Composition";
import type { AudioTrack } from "../../bindings/AudioTrack";
import type { Element } from "../../bindings/Element";
import { createVideoElement } from "../elements";
import {
  attachLinked,
  cuesToSrt,
  expandLinkedSubtitles,
  isLinkedElementId,
  remapCues,
  srtToLinked,
  syncLinkedCues,
} from "./linked";

const subs = (enabled = true) => ({
  enabled,
  cues: [{ start: 1, end: 2, text: "Hello" }],
  font_size: 3,
  color: "red",
  position: "top",
});
const comp = (id: string, start: number, elements: Element[] = []): Composition => ({
  id,
  name: id,
  start_time: start,
  duration: 5,
  elements,
  transition_in: null,
  transition_out: null,
  overlap_next: 0,
});
const project = (compositions: Composition[], audio_tracks: AudioTrack[] = []): Project => ({
  name: "p",
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 10,
  compositions,
  audio_tracks,
});
const video = (patch: object = {}) => ({ ...createVideoElement("a.mp4", "a"), subtitles: subs(), ...patch }) as Element;
const track = (patch: object = {}) =>
  ({
    id: "t",
    name: "t",
    src: "s.wav",
    start_time: 0,
    duration: null,
    audio_offset: 0,
    speed: 1,
    subtitles: subs(),
    ...patch,
  }) as AudioTrack;

describe("expandLinkedSubtitles", () => {
  it("shows the cues of a video in its scene, styled and not selectable", () => {
    const out = expandLinkedSubtitles(project([comp("a", 0), comp("b", 5, [video({ start_time: 1 })])]));
    const el = out.compositions[1].elements[1];
    expect(el.type).toBe("text");
    expect(isLinkedElementId(el.id)).toBe(true);
    expect(el.start_time).toBe(2);
    expect(el.duration).toBe(1);
    expect(el.y).toBe(6);
    if (el.type === "text") {
      expect(el.content).toBe("Hello");
      expect(el.color).toBe("red");
      expect(el.font_size).toBe(3);
    }
  });

  it("shows the cues of a sound on the scene they fall in", () => {
    const out = expandLinkedSubtitles(project([comp("a", 0), comp("b", 5)], [track({ start_time: 5 })]));
    expect(out.compositions[0].elements).toHaveLength(0);
    expect(out.compositions[1].elements[0].start_time).toBe(1);
  });

  it("follows the trim and speed of the media", () => {
    const out = expandLinkedSubtitles(project([comp("a", 0, [video({ video_offset: 1, playback_speed: 2 })])]));
    expect(out.compositions[0].elements[1].duration).toBe(0.5);
    expect(out.compositions[0].elements[1].start_time).toBe(0);
  });

  it("shows nothing when it is off and keeps stable ids", () => {
    const off = project([comp("a", 0, [video({ subtitles: subs(false) })])]);
    expect(expandLinkedSubtitles(off)).toBe(off);
    const on = project([comp("a", 0, [video({ id: "v" })])]);
    expect(expandLinkedSubtitles(on).compositions[0].elements[1].id).toBe(
      expandLinkedSubtitles(on).compositions[0].elements[1].id,
    );
  });
});

describe("SRT and timing", () => {
  it("round-trips through SRT", () => {
    const cues = [{ start: 1.5, end: 62.25, text: "Hi" }];
    expect(cuesToSrt(cues)).toBe("1\n00:00:01,500 --> 00:01:02,250\nHi\n");
    expect(srtToLinked(cuesToSrt(cues), true)?.cues).toEqual(cues);
    expect(srtToLinked("", true)).toBeNull();
  });

  it("removes the cut parts and applies the speed", () => {
    const cues = [
      { start: 1, end: 2, text: "kept" },
      { start: 3, end: 4, text: "cut" },
      { start: 6, end: 8, text: "after" },
    ];
    const kept = [
      { start: 0, end: 2.5 },
      { start: 5, end: 10 },
    ];
    expect(remapCues(cues, kept, 2)).toEqual([
      { start: 0.5, end: 1, text: "kept" },
      { start: 1.75, end: 2.75, text: "after" },
    ]);
  });
});

describe("keeping usages in step", () => {
  const twice = () => project([comp("a", 0, [video({ id: "1" }), video({ id: "2", subtitles: subs(false) })])]);

  it("updates the texts of every usage of the file", () => {
    const out = syncLinkedCues(twice(), "a.mp4", [{ start: 0, end: 1, text: "New" }]);
    for (const el of out.compositions[0].elements)
      if (el.type === "video") expect(el.subtitles?.cues[0].text).toBe("New");
  });

  it("activates only the media it was generated from", () => {
    const linked = { ...subs(), cues: [{ start: 0, end: 1, text: "Gen" }] };
    const out = attachLinked(twice(), "2", "a.mp4", linked);
    const [a, b] = out.compositions[0].elements;
    if (a.type === "video" && b.type === "video") {
      expect(a.subtitles?.cues[0].text).toBe("Gen");
      expect(b.subtitles?.enabled).toBe(true);
    }
  });
});
