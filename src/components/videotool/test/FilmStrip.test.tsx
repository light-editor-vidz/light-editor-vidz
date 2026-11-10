import "./setup";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import FilmStrip from "../components/FilmStrip";

describe("FilmStrip", () => {
  it("renders empty placeholder when no videoUrl provided", () => {
    const { container } = render(<FilmStrip videoUrl="" duration={0} trackWidth={0} />);
    expect(container.querySelector(".filmstrip-empty")).toBeTruthy();
  });

  it("renders empty placeholder when duration is 0", () => {
    const { container } = render(<FilmStrip videoUrl="x.mp4" duration={0} trackWidth={500} />);
    expect(container.querySelector(".filmstrip-empty")).toBeTruthy();
  });

  it("renders empty placeholder when trackWidth is 0", () => {
    const { container } = render(<FilmStrip videoUrl="x.mp4" duration={60} trackWidth={0} />);
    expect(container.querySelector(".filmstrip-empty")).toBeTruthy();
  });

  it("does not throw on mount when all props are valid", () => {
    expect(() => render(<FilmStrip videoUrl="file://x.mp4" duration={60} trackWidth={400} />)).not.toThrow();
  });

  it("uses empty class when no thumbs yet captured", () => {
    const { container } = render(<FilmStrip videoUrl="file://x.mp4" duration={60} trackWidth={400} />);
    expect(container.querySelector(".filmstrip-empty")).toBeTruthy();
  });
});

// ─── Thumbnail extraction ────────────────────────────────────────────────────
// jsdom has no media pipeline, so the offscreen <video> and <canvas> the
// component creates are stubbed at the document level.

import { vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";

type FakeVideo = HTMLVideoElement & { __seek: (t: number) => void };

let lastVideo: FakeVideo | null = null;
let seeks: number[] = [];
let realCreateElement: typeof document.createElement;

beforeEach(() => {
  seeks = [];
  lastVideo = null;
  realCreateElement = document.createElement.bind(document);

  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag === "canvas") {
      const canvas = realCreateElement("canvas") as HTMLCanvasElement;
      canvas.getContext = (() => ({ drawImage: vi.fn() })) as unknown as HTMLCanvasElement["getContext"];
      canvas.toDataURL = () => "data:image/jpeg;base64,STUB";
      return canvas;
    }
    if (tag === "video") {
      const video = realCreateElement("video") as FakeVideo;
      let time = 0;
      Object.defineProperty(video, "currentTime", {
        configurable: true,
        get: () => time,
        set: (t: number) => {
          time = t;
          seeks.push(t);
          act(() => {
            video.dispatchEvent(new Event("seeked"));
          });
        },
      });
      video.__seek = (t) => {
        video.currentTime = t;
      };
      lastVideo = video;
      return video;
    }
    return realCreateElement(tag);
  }) as typeof document.createElement);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FilmStrip thumbnails", () => {
  it("captures one thumbnail per track slot", () => {
    const { container } = render(<FilmStrip videoUrl="x.mp4" duration={60} trackWidth={400} />);
    act(() => {
      lastVideo!.dispatchEvent(new Event("loadedmetadata"));
    });
    // 400px / 80px per thumb = 5
    expect(container.querySelectorAll(".filmstrip-thumb")).toHaveLength(5);
  });

  it("uses at least four thumbnails on a narrow track", () => {
    const { container } = render(<FilmStrip videoUrl="x.mp4" duration={60} trackWidth={40} />);
    act(() => {
      lastVideo!.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(container.querySelectorAll(".filmstrip-thumb")).toHaveLength(4);
  });

  it("starts at the first frame", () => {
    render(<FilmStrip videoUrl="x.mp4" duration={60} trackWidth={400} />);
    act(() => {
      lastVideo!.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(seeks[0]).toBe(0);
  });

  // Seeking to exactly `duration` often emits no `seeked` event, or decodes a
  // black frame — so the last thumbnail lands just short of the end.
  it("never seeks to the exact end of the video", () => {
    render(<FilmStrip videoUrl="x.mp4" duration={60} trackWidth={400} />);
    act(() => {
      lastVideo!.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(Math.max(...seeks)).toBeLessThan(60);
    expect(Math.max(...seeks)).toBeCloseTo(59.95, 2);
  });

  it("walks forward through the video", () => {
    render(<FilmStrip videoUrl="x.mp4" duration={60} trackWidth={400} />);
    act(() => {
      lastVideo!.dispatchEvent(new Event("loadedmetadata"));
    });
    const ascending = seeks.every((t, i) => i === 0 || t >= seeks[i - 1]);
    expect(ascending).toBe(true);
  });

  it("stops capturing once unmounted", () => {
    const { unmount } = render(<FilmStrip videoUrl="x.mp4" duration={60} trackWidth={400} />);
    unmount();
    const before = seeks.length;
    act(() => {
      lastVideo!.dispatchEvent(new Event("seeked"));
    });
    expect(seeks.length).toBe(before);
  });
});
