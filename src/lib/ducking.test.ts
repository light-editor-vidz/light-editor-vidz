import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../bindings/Project";
import { createAudioTrack } from "./audio";
import { projectVoiceRanges } from "./commands";
import { duckGain, voiceSignature } from "./ducking";
import { useVoiceRanges } from "./useVoiceRanges";

vi.mock("./commands", () => ({ projectVoiceRanges: vi.fn() }));

const project = (duck_db: number, name = "Music"): Project =>
  ({
    name: "P",
    duration: 10,
    compositions: [],
    audio_tracks: [{ ...createAudioTrack("assets/m.mp3", name), id: "m", duck_db }],
  }) as unknown as Project;

describe("duckGain", () => {
  const ranges = [{ start: 2, end: 4 }];
  const floor = 10 ** (-12 / 20);

  it("baisse la musique de la valeur choisie pendant la voix", () => {
    expect(duckGain(ranges, 1, 12)).toBe(1);
    expect(duckGain(ranges, 3, 12)).toBeCloseTo(floor, 5);
  });

  it("descend vite et remonte progressivement", () => {
    expect(duckGain(ranges, 2.01, 12)).toBeCloseTo((1 + floor) / 2, 5);
    expect(duckGain(ranges, 4.2, 12)).toBeCloseTo((1 + floor) / 2, 5);
    expect(duckGain(ranges, 4.5, 12)).toBe(1);
  });

  it("ne touche pas une piste qui ne doit pas baisser", () => {
    expect(duckGain(ranges, 3, 0)).toBe(1);
  });
});

describe("analyse de la voix", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("n'a lieu que si une piste doit baisser", () => {
    expect(voiceSignature(project(0))).toBeNull();
    expect(voiceSignature(project(12))).not.toBeNull();
  });

  it("n'est pas refaite pour un changement sans effet sur le son", () => {
    expect(voiceSignature(project(12, "A"))).toBe(voiceSignature(project(12, "B")));
  });

  it("attend la fin des changements, puis rend les passages voisés", async () => {
    vi.useFakeTimers();
    vi.mocked(projectVoiceRanges).mockResolvedValue([{ start: 1, end: 2 }]);
    const { result, rerender } = renderHook(({ p }) => useVoiceRanges(p, "/p"), {
      initialProps: { p: project(6) },
    });
    rerender({ p: project(12) });
    expect(projectVoiceRanges).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(projectVoiceRanges).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([{ start: 1, end: 2 }]);

    rerender({ p: project(0) });
    expect(result.current).toEqual([]);
  });
});
