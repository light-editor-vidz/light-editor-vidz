import { describe, expect, it } from "vitest";
import type { Project } from "../bindings/Project";
import { clipsUsing, swapMediaSrc } from "./mediaSwap";

const project = {
  audio_tracks: [{ id: "a1", src: "assets/audio/x.mp3" }],
  compositions: [
    {
      id: "c1",
      elements: [
        { id: "v1", type: "video", src: "assets/videos/a.mp4" },
        { id: "v2", type: "video", src: "assets/videos/a.mp4" },
        { id: "t1", type: "text" },
      ],
    },
  ],
} as unknown as Project;

describe("swapMediaSrc", () => {
  it("lists the clips that use a media", () => {
    expect(clipsUsing(project, "assets/videos/a.mp4")).toEqual(["v1", "v2"]);
    expect(clipsUsing(project, "assets/audio/x.mp3")).toEqual(["a1"]);
  });

  it("repoints every clip, or only the one asked for", () => {
    const all = swapMediaSrc(project, "assets/videos/a.mp4", "assets/videos/a-edit.mp4", "all");
    expect(clipsUsing(all, "assets/videos/a-edit.mp4")).toEqual(["v1", "v2"]);
    const one = swapMediaSrc(project, "assets/videos/a.mp4", "assets/videos/a-edit.mp4", "clip", "v2");
    expect(clipsUsing(one, "assets/videos/a-edit.mp4")).toEqual(["v2"]);
    expect(clipsUsing(one, "assets/videos/a.mp4")).toEqual(["v1"]);
  });

  it("repoints an audio track and leaves an unrelated project untouched", () => {
    const audio = swapMediaSrc(project, "assets/audio/x.mp3", "assets/audio/x-edit.mp3", "clip", "a1");
    expect(audio.audio_tracks[0].src).toBe("assets/audio/x-edit.mp3");
    expect(swapMediaSrc(project, "nope", "other", "all")).toBe(project);
  });
});
