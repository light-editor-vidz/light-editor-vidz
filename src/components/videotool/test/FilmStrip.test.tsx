import "./setup";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import FilmStrip from "../components/FilmStrip";
import { clearFilmStripCache } from "../components/filmStripCache";

const thumbs = (n: number) => Array.from({ length: n }, (_, i) => `data:image/jpeg;base64,T${i}`);

function mockThumbnails(impl: (path: string, count: number) => Promise<string[]> = async (_, n) => thumbs(n)) {
  const videoThumbnails = vi.fn(impl);
  window.electronAPI = { ...window.electronAPI, videoThumbnails };
  return videoThumbnails;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearFilmStripCache();
});

describe("FilmStrip", () => {
  it("renders the empty placeholder and asks for nothing without a path, duration or width", () => {
    const videoThumbnails = mockThumbnails();
    for (const props of [
      { videoPath: "", duration: 60, trackWidth: 400 },
      { videoPath: "/x.mp4", duration: 0, trackWidth: 400 },
      { videoPath: "/x.mp4", duration: 60, trackWidth: 0 },
    ]) {
      const { container } = render(<FilmStrip {...props} />);
      expect(container.querySelector(".filmstrip-empty")).toBeTruthy();
    }
    expect(videoThumbnails).not.toHaveBeenCalled();
  });

  it("shows one thumbnail per track slot, extracted from the file", async () => {
    const videoThumbnails = mockThumbnails();
    const { container } = render(<FilmStrip videoPath="/x.mp4" duration={60} trackWidth={400} />);
    await act(async () => {});

    // 400px / 80px per thumb = 5
    expect(videoThumbnails).toHaveBeenCalledWith("/x.mp4", 5);
    expect(container.querySelectorAll(".filmstrip-thumb")).toHaveLength(5);
  });

  it("uses at least four thumbnails on a narrow track", async () => {
    const videoThumbnails = mockThumbnails();
    render(<FilmStrip videoPath="/x.mp4" duration={60} trackWidth={40} />);
    await act(async () => {});
    expect(videoThumbnails).toHaveBeenCalledWith("/x.mp4", 4);
  });

  it("stays on the placeholder when the extraction fails", async () => {
    mockThumbnails(async () => {
      throw new Error("ffmpeg");
    });
    const { container } = render(<FilmStrip videoPath="/x.mp4" duration={60} trackWidth={400} />);
    await act(async () => {});
    expect(container.querySelector(".filmstrip-empty")).toBeTruthy();
  });

  it("ignores a late answer once unmounted", async () => {
    let resolve: (t: string[]) => void = () => {};
    mockThumbnails(() => new Promise((r) => (resolve = r)));
    const { unmount, container } = render(<FilmStrip videoPath="/x.mp4" duration={60} trackWidth={400} />);
    unmount();
    await act(async () => resolve(thumbs(5)));
    expect(container.querySelectorAll(".filmstrip-thumb")).toHaveLength(0);
  });

  it("waits for a resize to settle before asking again, and reuses a width already seen", async () => {
    vi.useFakeTimers();
    try {
      const videoThumbnails = mockThumbnails();
      const { rerender, container } = render(<FilmStrip videoPath="/x.mp4" duration={60} trackWidth={400} />);
      await act(async () => {});
      expect(videoThumbnails).toHaveBeenCalledTimes(1);

      // Redimensionnement : les images restent, rien n'est redemandé avant 300 ms de calme.
      rerender(<FilmStrip videoPath="/x.mp4" duration={60} trackWidth={560} />);
      rerender(<FilmStrip videoPath="/x.mp4" duration={60} trackWidth={640} />);
      expect(container.querySelectorAll(".filmstrip-thumb").length).toBeGreaterThan(0);
      await act(async () => {
        vi.advanceTimersByTime(299);
      });
      expect(videoThumbnails).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(2);
      });
      expect(videoThumbnails).toHaveBeenCalledTimes(2);
      expect(videoThumbnails).toHaveBeenLastCalledWith("/x.mp4", 8);

      // Retour à la première largeur : déjà connue, ffmpeg n'est pas relancé.
      rerender(<FilmStrip videoPath="/x.mp4" duration={60} trackWidth={400} />);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(videoThumbnails).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
