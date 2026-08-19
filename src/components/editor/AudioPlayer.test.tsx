import { render, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import AudioPlayer from "./AudioPlayer";
import { acquireMediaObjectUrl } from "../../lib/mediaCache";
import type { AudioTrack } from "../../bindings/AudioTrack";
import type { Project } from "../../bindings/Project";

vi.mock("../../lib/mediaCache", () => ({ acquireMediaObjectUrl: vi.fn() }));

const mockAcquire = vi.mocked(acquireMediaObjectUrl);

const track = (over: Partial<AudioTrack> = {}): AudioTrack =>
  ({
    id: "a1",
    name: "music",
    src: "assets/audio/a.mp3",
    start_time: 0,
    duration: 30,
    volume: 1,
    muted: false,
    solo: false,
    audio_offset: 0,
    fade_in: 0,
    fade_out: 0,
    ...over,
  }) as AudioTrack;

const project = (tracks: AudioTrack[]) => ({ audio_tracks: tracks, compositions: [] }) as unknown as Project;

const release = vi.fn();

/** jsdom stubs `play`/`pause` away; record them so the sync effect can be observed. */
const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();

async function renderPlayer(tracks: AudioTrack[], currentTime = 0, playing = true) {
  const view = render(
    <AudioPlayer project={project(tracks)} projectDir="/p" currentTime={currentTime} playing={playing} />,
  );
  await act(async () => {});
  return view;
}

const audios = () => [...document.querySelectorAll("audio")] as HTMLAudioElement[];

beforeEach(() => {
  vi.clearAllMocks();
  mockAcquire.mockImplementation(() => ({ promise: Promise.resolve("blob:a"), release }));
  HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement["play"];
  HTMLMediaElement.prototype.pause = pause;
});

describe("AudioPlayer", () => {
  it("renders one silent audio element per track", async () => {
    await renderPlayer([track(), track({ id: "a2", src: "b.mp3" })]);
    expect(audios()).toHaveLength(2);
  });

  it("renders nothing for a project without audio", async () => {
    await renderPlayer([]);
    expect(audios()).toHaveLength(0);
  });

  it("loads each track through the media cache", async () => {
    await renderPlayer([track()]);

    expect(mockAcquire).toHaveBeenCalledWith("/p", "assets/audio/a.mp3");
    await waitFor(() => expect(audios()[0].src).toContain("blob:a"));
  });

  it("releases the cached URL on unmount", async () => {
    const view = await renderPlayer([track()]);

    view.unmount();

    expect(release).toHaveBeenCalled();
  });

  it("stays quiet when the file cannot be read", async () => {
    mockAcquire.mockImplementation(() => ({ promise: Promise.reject(new Error("gone")), release }));

    await renderPlayer([track()]);

    expect(audios()[0].getAttribute("src")).toBeNull();
  });

  it("plays a track that is under the playhead", async () => {
    await renderPlayer([track({ start_time: 0, duration: 30 })], 5, true);
    expect(play).toHaveBeenCalled();
  });

  it("pauses a track the playhead has not reached", async () => {
    await renderPlayer([track({ start_time: 10 })], 5, true);

    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
  });

  it("pauses a track the playhead has passed", async () => {
    await renderPlayer([track({ start_time: 0, duration: 4 })], 5, true);
    expect(play).not.toHaveBeenCalled();
  });

  it("keeps an open-ended track playing forever", async () => {
    await renderPlayer([track({ duration: null })], 9999, true);
    expect(play).toHaveBeenCalled();
  });

  it("pauses everything when the editor is paused", async () => {
    await renderPlayer([track()], 5, false);

    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
  });

  it("applies the track volume", async () => {
    await renderPlayer([track({ volume: 0.4 })], 1);
    expect(audios()[0].volume).toBeCloseTo(0.4);
  });

  it("clamps an out-of-range volume", async () => {
    await renderPlayer([track({ volume: 4 })], 1);
    expect(audios()[0].volume).toBe(1);
  });

  it("silences a muted track", async () => {
    await renderPlayer([track({ muted: true })], 1);
    expect(audios()[0].volume).toBe(0);
  });

  it("silences the non-solo tracks once one track is soloed", async () => {
    await renderPlayer([track({ id: "a1", solo: true, volume: 1 }), track({ id: "a2", src: "b.mp3", volume: 1 })], 1);

    expect(audios()[0].volume).toBe(1);
    expect(audios()[1].volume).toBe(0);
  });

  it("seeks the element to its offset within the track", async () => {
    await renderPlayer([track({ start_time: 2, audio_offset: 1 })], 5);
    // 5s on the timeline, 2s in → 3s into the track, +1s of source offset.
    expect(audios()[0].currentTime).toBeCloseTo(4);
  });

  it("never seeks before the start of the file", async () => {
    await renderPlayer([track({ start_time: 0, audio_offset: -10 })], 0.1);
    expect(audios()[0].currentTime).toBe(0);
  });
});
