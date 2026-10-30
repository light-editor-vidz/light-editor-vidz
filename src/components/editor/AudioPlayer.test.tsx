import { render, act, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import AudioPlayer from "./AudioPlayer";
import { acquireMediaObjectUrl } from "../../lib/mediaCache";
import type { AudioTrack } from "../../bindings/AudioTrack";
import type { Project } from "../../bindings/Project";
import { createPlaybackClock } from "../../lib/playbackClock";

vi.mock("../../lib/mediaCache", () => ({ acquireMediaObjectUrl: vi.fn() }));
vi.mock("../../lib/assetUrl", () => ({ streamUrl: (dir: string, rel: string) => `lvmedia://${dir}::${rel}` }));

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

const project = (tracks: AudioTrack[]) =>
  ({ audio_tracks: tracks, compositions: [], duration: 30 }) as unknown as Project;

const release = vi.fn();

/** jsdom stubs `play`/`pause` away; record them so the sync effect can be observed. */
const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();

async function renderPlayer(tracks: AudioTrack[], currentTime = 0, playing = true) {
  const view = render(
    <AudioPlayer
      project={project(tracks)}
      projectDir="/p"
      clock={createPlaybackClock(currentTime)}
      playing={playing}
    />,
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

  it("streams each track through lvmedia:// without reading the file", async () => {
    await renderPlayer([track()]);

    expect(audios()[0].getAttribute("src")).toBe("lvmedia:///p::assets/audio/a.mp3");
    expect(mockAcquire).not.toHaveBeenCalled();
  });

  it("falls back to the cached blob URL when the stream is refused", async () => {
    await renderPlayer([track()]);

    fireEvent.error(audios()[0]);

    await waitFor(() => expect(audios()[0].src).toContain("blob:a"));
    expect(mockAcquire).toHaveBeenCalledWith("/p", "assets/audio/a.mp3");
  });

  it("releases the cached blob on unmount", async () => {
    const view = await renderPlayer([track()]);
    fireEvent.error(audios()[0]);
    await act(async () => {});

    view.unmount();

    expect(release).toHaveBeenCalled();
  });

  it("stays quiet when neither the stream nor the blob can be read", async () => {
    mockAcquire.mockImplementation(() => ({ promise: Promise.reject(new Error("gone")), release }));
    await renderPlayer([track()]);

    fireEvent.error(audios()[0]);
    await act(async () => {});

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

describe("AudioPlayer — fondus", () => {
  it("module le volume selon le fondu d'entrée, à partir du début de la piste", async () => {
    const clock = createPlaybackClock(5);
    render(
      <AudioPlayer
        project={project([track({ start_time: 4, fade_in: 2, duration: 20 })])}
        projectDir="/p"
        clock={clock}
        playing
      />,
    );
    await act(async () => {});
    expect(audios()[0].volume).toBeCloseTo(0.5);
    await act(async () => clock.set(7));
    expect(audios()[0].volume).toBeCloseTo(1);
  });

  it("baisse le volume pendant le fondu de sortie", async () => {
    const clock = createPlaybackClock(9);
    render(
      <AudioPlayer
        project={project([track({ start_time: 0, fade_out: 2, duration: 10 })])}
        projectDir="/p"
        clock={clock}
        playing
      />,
    );
    await act(async () => {});
    expect(audios()[0].volume).toBeCloseTo(0.5);
  });

  it("ne relance pas la lecture à chaque image", async () => {
    const clock = createPlaybackClock(1);
    render(<AudioPlayer project={project([track()])} projectDir="/p" clock={clock} playing />);
    await act(async () => {});
    const calls = play.mock.calls.length;
    for (const t of [1.1, 1.2, 1.3, 1.4]) await act(async () => clock.set(t));
    expect(play.mock.calls.length).toBe(calls);
  });
});
