import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVideoElement } from "../../lib/elements";
import { DEFAULT_CHROMA_KEY } from "../../lib/chroma";
import type { Element } from "../../bindings/Element";
import { ChromaKeyFields } from "./properties/ChromaKeyFields";
import { VideoElementView } from "./ElementViews";

vi.mock("../../lib/useMediaSource", () => ({
  useMediaSource: () => ({ src: "blob:v", usingBlob: true, blobError: null, fallBack: () => {} }),
}));

type VideoEl = Extract<Element, { type: "video" }>;
const element = (over: Partial<VideoEl> = {}) => ({ ...createVideoElement("v.mp4", "Clip"), ...over }) as VideoEl;
const view = (el: VideoEl) => (
  <VideoElementView element={el} projectDir="/p" localTime={0} playing={false} panTransform="" />
);

describe("aperçu du fond vert", () => {
  /** La prochaine image que `requestAnimationFrame` dessinera. */
  let frame: FrameRequestCallback | null = null;
  const drawn: number[][] = [];
  let tainted = false;

  beforeEach(() => {
    frame = null;
    tainted = false;
    drawn.length = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => ((frame = cb), 1));
    vi.stubGlobal("cancelAnimationFrame", () => (frame = null));
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(1920);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(1080);
    // Deux pixels : le fond vert, puis le sujet.
    const context = {
      clearRect: () => {},
      drawImage: () => {},
      getImageData: () => {
        if (tainted) throw new Error("SecurityError");
        return { data: new Uint8ClampedArray([0, 255, 0, 255, 200, 150, 130, 255]) };
      },
      putImageData: (image: { data: Uint8ClampedArray }) => drawn.push([...image.data]),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("montre la vidéo telle quelle sans fond vert", () => {
    const { container } = render(view(element()));
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("video")).not.toHaveAttribute("crossorigin");
  });

  it("dessine l'image détourée, ramenée à une taille que la lecture suit", () => {
    const { container } = render(view(element({ chroma_key: DEFAULT_CHROMA_KEY })));
    act(() => frame!(0));

    const canvas = container.querySelector("canvas")!;
    expect([canvas.width, canvas.height]).toEqual([960, 540]);
    expect(drawn).toEqual([[0, 0, 0, 0, 200, 150, 130, 255]]);
    expect(container.querySelector("video")).toHaveAttribute("crossorigin", "anonymous");
    expect(container.querySelector("video")!.style.opacity).toBe("0");

    // La même image n'est pas retraitée.
    act(() => frame!(16));
    expect(drawn).toHaveLength(1);
  });

  it("garde la vidéo visible, et le dit, quand les pixels ne sont pas lisibles", () => {
    tainted = true;
    const { container } = render(view(element({ chroma_key: DEFAULT_CHROMA_KEY })));
    act(() => frame!(0));

    expect(screen.getByRole("status")).toHaveTextContent("Green screen preview unavailable");
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("video")!.style.opacity).not.toBe("0");
  });
});

describe("réglages du fond vert", () => {
  it("l'active avec les réglages par défaut", () => {
    const onChange = vi.fn();
    render(<ChromaKeyFields value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Green screen" }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_CHROMA_KEY);
  });

  it("règle la couleur, la tolérance, le bord et le reflet, puis le retire", () => {
    const onChange = vi.fn();
    render(<ChromaKeyFields value={DEFAULT_CHROMA_KEY} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Colour to make transparent"), { target: { value: "#0000ff" } });
    fireEvent.change(screen.getByLabelText("Tolerance"), { target: { value: "0.3" } });
    fireEvent.change(screen.getByLabelText("Edge softness"), { target: { value: "0.2" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Green screen" }));

    expect(onChange.mock.calls.map(([v]) => v)).toEqual([
      { ...DEFAULT_CHROMA_KEY, color: "#0000ff" },
      { ...DEFAULT_CHROMA_KEY, similarity: 0.3 },
      { ...DEFAULT_CHROMA_KEY, blend: 0.2 },
      { ...DEFAULT_CHROMA_KEY, despill: false },
      null,
    ]);
  });
});
