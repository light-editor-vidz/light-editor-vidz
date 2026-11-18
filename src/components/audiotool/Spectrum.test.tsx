import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Spectrum from "./Spectrum";

const ctx2d = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  createLinearGradient: () => ({ addColorStop: vi.fn() }),
  fillStyle: "",
};

afterEach(() => vi.unstubAllGlobals());

describe("Spectrum", () => {
  it("runs one animation loop, whatever the number of resizes", () => {
    let resized: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          resized = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    HTMLCanvasElement.prototype.getContext = (() => ctx2d) as never;
    Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(HTMLCanvasElement.prototype, "clientHeight", { configurable: true, value: 50 });
    const analyser = { frequencyBinCount: 64, getByteFrequencyData: vi.fn() } as unknown as AnalyserNode;

    render(<Spectrum analyser={analyser} playing />);
    expect(frames).toHaveLength(1);

    for (let i = 0; i < 5; i++) resized(); // redimensionnements pendant la lecture
    expect(frames).toHaveLength(1);

    frames[0](0); // une image d'animation : une seule suivante est demandée
    expect(frames).toHaveLength(2);
  });
});
