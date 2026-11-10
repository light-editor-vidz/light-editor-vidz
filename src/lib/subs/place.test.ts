import { describe, expect, it } from "vitest";
import type { Project } from "../../bindings/Project";
import type { Composition } from "../../bindings/Composition";
import type { AudioTrack } from "../../bindings/AudioTrack";
import { createVideoElement } from "../elements";
import { addCuesToProject, cuesOfAudioTrack, cuesOfVideoElement } from "./place";

const comp = (id: string, start: number, duration: number): Composition => ({
  id,
  name: id,
  start_time: start,
  duration,
  elements: [],
  transition_in: null,
  transition_out: null,
  overlap_next: 0,
});
const project = (compositions: Composition[]): Project => ({
  name: "p",
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 10,
  compositions,
  audio_tracks: [],
});

function video(patch: Record<string, unknown>) {
  const el = createVideoElement("media/a.mp4", "a");
  if (el.type !== "video") throw new Error("not a video");
  return { ...el, ...patch } as typeof el;
}

describe("cuesOfVideoElement", () => {
  it("shifts cues to the scene and element start", () => {
    const el = video({ start_time: 1, duration: 4, video_offset: 0, playback_speed: 1 });
    const out = cuesOfVideoElement([{ start: 0.5, end: 2, text: "a" }], el, 5, 10);
    expect(out).toEqual([{ start: 6.5, end: 8, text: "a" }]);
  });

  it("drops what falls outside the played range and clips the edges", () => {
    const el = video({ start_time: 0, duration: 3, video_offset: 2, playback_speed: 1 });
    const out = cuesOfVideoElement(
      [
        { start: 0, end: 1, text: "before" },
        { start: 1, end: 3, text: "edge" },
        { start: 6, end: 8, text: "after" },
      ],
      el,
      0,
      10,
    );
    expect(out).toEqual([{ start: 0, end: 1, text: "edge" }]);
  });

  it("scales time by the playback speed", () => {
    const el = video({ start_time: 0, duration: 5, video_offset: 0, playback_speed: 2 });
    const out = cuesOfVideoElement([{ start: 2, end: 4, text: "x" }], el, 0, 5);
    expect(out).toEqual([{ start: 1, end: 2, text: "x" }]);
  });

  it("plays until the end of the scene without a duration", () => {
    const el = video({ start_time: 1, duration: null, video_offset: 0, playback_speed: 1 });
    const out = cuesOfVideoElement([{ start: 0, end: 9, text: "x" }], el, 0, 4);
    expect(out).toEqual([{ start: 1, end: 4, text: "x" }]);
  });
});

describe("cuesOfAudioTrack", () => {
  const track = (patch: Partial<AudioTrack>) =>
    ({
      id: "t",
      name: "t",
      src: "a.wav",
      start_time: 2,
      duration: null,
      audio_offset: 1,
      speed: 1,
      ...patch,
    }) as AudioTrack;

  it("maps source time to the absolute track start", () => {
    const out = cuesOfAudioTrack([{ start: 1, end: 3, text: "x" }], track({}), 10);
    expect(out).toEqual([{ start: 2, end: 4, text: "x" }]);
  });

  it("ignores what comes before the offset and after the track end", () => {
    const out = cuesOfAudioTrack(
      [
        { start: 0, end: 0.5, text: "before" },
        { start: 3, end: 9, text: "long" },
      ],
      track({ duration: 3 }),
      10,
    );
    expect(out).toEqual([{ start: 4, end: 5, text: "long" }]);
  });
});

describe("addCuesToProject", () => {
  it("creates one text element per cue, relative to its scene", () => {
    const p = project([comp("a", 0, 5), comp("b", 5, 5)]);
    const { project: next, added } = addCuesToProject(p, [{ start: 6, end: 8, text: "hello" }]);
    expect(added).toBe(1);
    expect(next.compositions[0].elements).toHaveLength(0);
    const el = next.compositions[1].elements[0];
    expect(el.type).toBe("text");
    expect(el.start_time).toBe(1);
    expect(el.duration).toBe(2);
    if (el.type === "text") expect(el.content).toBe("hello");
  });

  it("splits a cue that crosses a scene boundary", () => {
    const p = project([comp("a", 0, 5), comp("b", 5, 5)]);
    const { project: next, added } = addCuesToProject(p, [{ start: 4, end: 6, text: "x" }]);
    expect(added).toBe(2);
    expect(next.compositions[0].elements[0].start_time).toBe(4);
    expect(next.compositions[0].elements[0].duration).toBe(1);
    expect(next.compositions[1].elements[0].start_time).toBe(0);
    expect(next.compositions[1].elements[0].duration).toBe(1);
  });

  it("ignores cues outside the project and does not mutate the input", () => {
    const p = project([comp("a", 0, 5)]);
    const { project: next, added } = addCuesToProject(p, [{ start: 7, end: 8, text: "x" }]);
    expect(added).toBe(0);
    expect(next).toBe(p);
    expect(p.compositions[0].elements).toHaveLength(0);
  });
});
