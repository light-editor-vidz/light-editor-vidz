import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CanvasStage from "./CanvasStage";
import type { Project } from "../../bindings/Project";
import type { Composition } from "../../bindings/Composition";
import type { Element } from "../../bindings/Element";

vi.mock("../../lib/mediaCache", () => ({
  acquireMediaObjectUrl: () => ({ promise: Promise.resolve("blob:a"), release: () => {} }),
}));
vi.mock("../../lib/assetUrl", () => ({
  assetUrl: (dir: string, path: string) => `asset://${dir}/${path}`,
}));

const element = (over: Partial<Element> = {}): Element =>
  ({
    id: "e1",
    name: "Title",
    type: "text",
    content: "Hello",
    color: "rgba(255,255,255,1)",
    alignment: "center",
    vertical_alignment: "center",
    font_size: 5,
    x: 10,
    y: 10,
    width: 20,
    height: 20,
    rotation: 0,
    start_time: 0,
    duration: null,
    animations: [],
    ...over,
  }) as Element;

const composition = (over: Partial<Composition> = {}): Composition =>
  ({
    id: "c1",
    name: "Scene 1",
    start_time: 0,
    duration: 10,
    overlap_next: 0,
    transition_in: null,
    transition_out: null,
    elements: [],
    ...over,
  }) as Composition;

const project = (over: Partial<Project> = {}): Project =>
  ({
    name: "P",
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 10,
    compositions: [],
    audio_tracks: [],
    ...over,
  }) as unknown as Project;

/** A 1000×1000 stage at the origin, so 1 px == 0.1 %. */
const STAGE_RECT = { left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000 };

function setup(over: Partial<Parameters<typeof CanvasStage>[0]> = {}) {
  const handlers = {
    onTogglePlay: vi.fn(),
    onSeekToStart: vi.fn(),
    onSelectElement: vi.fn(),
    onMarqueeSelect: vi.fn(),
    onUpdateElement: vi.fn(),
    onSetTransitionIn: vi.fn(),
    onSetTransitionOut: vi.fn(),
    onSeekToNext: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
  const view = render(
    <CanvasStage
      project={project()}
      projectDir="/p"
      composition={composition()}
      localTime={0}
      playing={false}
      selectedIds={[]}
      canUndo
      canRedo
      {...handlers}
      {...over}
    />,
  );
  stage().getBoundingClientRect = () => STAGE_RECT as DOMRect;
  return { ...handlers, ...view };
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement;
const qa = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const stage = () => q(".canvas-stage");

/** Drags on the empty stage from (x1, y1) to (x2, y2), in stage pixels. */
function marquee(x1: number, y1: number, x2: number, y2: number, init: PointerEventInit = {}) {
  fireEvent.pointerDown(stage(), { clientX: x1, clientY: y1, ...init });
  fireEvent.pointerMove(window, { clientX: x2, clientY: y2 });
  fireEvent.pointerUp(window);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CanvasStage — the toolbar", () => {
  it("undoes and redoes", () => {
    const { onUndo, onRedo } = setup();

    fireEvent.click(screen.getByTitle("Undo"));
    fireEvent.click(screen.getByTitle("Redo"));

    expect(onUndo).toHaveBeenCalled();
    expect(onRedo).toHaveBeenCalled();
  });

  it("greys out undo and redo when there is no history", () => {
    setup({ canUndo: false, canRedo: false });

    expect(screen.getByTitle("Undo")).toBeDisabled();
    expect(screen.getByTitle("Redo")).toBeDisabled();
  });

  it("zooms in and out around a hundred percent", () => {
    setup();

    fireEvent.click(screen.getByTitle("Zoom in"));
    expect(screen.getByText("110%")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Zoom out"));
    fireEvent.click(screen.getByTitle("Zoom out"));
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("never zooms beyond its limits", () => {
    setup();

    for (let i = 0; i < 40; i++) fireEvent.click(screen.getByTitle("Zoom in"));
    expect(screen.getByText("300%")).toBeInTheDocument();

    for (let i = 0; i < 60; i++) fireEvent.click(screen.getByTitle("Zoom out"));
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("scales the canvas as it zooms", () => {
    setup();

    expect(q(".canvas-zoom-wrap").style.transform).toBe("");
    fireEvent.click(screen.getByTitle("Zoom in"));
    expect(q(".canvas-zoom-wrap").style.transform).toBe("scale(1.1)");
  });

  it("returns to a hundred percent from either fit control", () => {
    setup();
    fireEvent.click(screen.getByTitle("Zoom in"));

    fireEvent.click(screen.getByText("fit"));
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Zoom in"));
    fireEvent.click(screen.getByTitle("Fit (100%)"));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});

describe("CanvasStage — scene transitions", () => {
  it("offers every transition on both pickers", () => {
    setup();

    const [entrance] = qa(".canvas-transition-select");
    expect(entrance.querySelectorAll("option")).toHaveLength(16);
    expect(screen.getAllByRole("option", { name: "None" })).toHaveLength(2);
  });

  it("shows the transitions already on the scene", () => {
    setup({
      composition: composition({
        transition_in: { transition_type: "fade", duration: 1 },
        transition_out: { transition_type: "zoom", duration: 1 },
      } as Partial<Composition>),
    });

    const [entrance, exit] = qa(".canvas-transition-select") as HTMLSelectElement[];
    expect(entrance.value).toBe("fade");
    expect(exit.value).toBe("zoom");
  });

  it("sets an entrance transition", () => {
    const { onSetTransitionIn } = setup();

    fireEvent.change(screen.getByTitle("Scene entrance transition"), { target: { value: "slide-left" } });

    expect(onSetTransitionIn).toHaveBeenCalledWith("slide-left");
  });

  it("sets an exit transition", () => {
    const { onSetTransitionOut } = setup();

    fireEvent.change(screen.getByTitle("Scene exit transition"), { target: { value: "wipe-up" } });

    expect(onSetTransitionOut).toHaveBeenCalledWith("wipe-up");
  });

  it("clears a transition back to none", () => {
    const { onSetTransitionIn } = setup({
      composition: composition({
        transition_in: { transition_type: "fade", duration: 1 },
      } as Partial<Composition>),
    });

    fireEvent.change(screen.getByTitle("Scene entrance transition"), { target: { value: "" } });

    expect(onSetTransitionIn).toHaveBeenCalledWith(null);
  });

  it("fades the whole stage in at the start of the scene", () => {
    setup({
      composition: composition({
        transition_in: { transition_type: "fade", duration: 1 },
      } as Partial<Composition>),
      localTime: 0,
    });

    expect(Number(stage().style.opacity)).toBeLessThan(1);
  });

  it("clips the stage during a wipe", () => {
    setup({
      composition: composition({
        transition_in: { transition_type: "wipe-left", duration: 1 },
      } as Partial<Composition>),
      localTime: 0.5,
    });

    expect(stage().style.clipPath).not.toBe("");
  });
});

describe("CanvasStage — playback bar", () => {
  it("plays and pauses", () => {
    const { onTogglePlay } = setup();

    fireEvent.click(q(".play-btn"));

    expect(onTogglePlay).toHaveBeenCalled();
  });

  it("jumps to the start and to the next scene", () => {
    const { onSeekToStart, onSeekToNext } = setup();

    fireEvent.click(screen.getByTitle("Back to start"));
    fireEvent.click(screen.getByTitle("Next"));

    expect(onSeekToStart).toHaveBeenCalled();
    expect(onSeekToNext).toHaveBeenCalled();
  });

  it("shows the global timecode, not the scene-local one", () => {
    setup({
      composition: composition({ start_time: 4 }),
      localTime: 2,
      project: project({ duration: 10, fps: 30 }),
    });

    expect(q(".playback-timecode").textContent).toContain("00:06:00");
  });
});

describe("CanvasStage — elements", () => {
  const withTwo = composition({
    elements: [
      element(),
      element({ id: "e2", name: "Logo", type: "image", src: "a.png", fit_mode: "cover", x: 60, y: 60 }),
    ],
  });

  it("renders every element that is under the playhead", () => {
    setup({ composition: withTwo });
    expect(qa(".element-interaction")).toHaveLength(2);
  });

  it("hides an element that has not started yet", () => {
    setup({
      composition: composition({ elements: [element({ start_time: 5, duration: 2 })] }),
      localTime: 1,
    });

    expect(qa(".element-interaction")).toHaveLength(0);
  });

  it("hides an element whose time is up", () => {
    setup({
      composition: composition({ elements: [element({ start_time: 0, duration: 2 })] }),
      localTime: 5,
    });

    expect(qa(".element-interaction")).toHaveLength(0);
  });

  it("shows the selection outline on the selected element only", () => {
    setup({ composition: withTwo, selectedIds: ["e2"] });
    expect(qa(".element-outline")).toHaveLength(1);
  });

  it("reports a click on an element", () => {
    const { onSelectElement } = setup({ composition: withTwo });

    fireEvent.pointerDown(qa(".element-interaction")[0], { clientX: 100, clientY: 100 });

    expect(onSelectElement).toHaveBeenCalledWith("e1", false);
  });

  it("adds to the selection with a modifier", () => {
    const { onSelectElement } = setup({ composition: withTwo });

    fireEvent.pointerDown(qa(".element-interaction")[1], { clientX: 100, clientY: 100, shiftKey: true });

    expect(onSelectElement).toHaveBeenCalledWith("e2", true);
  });

  it("reports a geometry change from a drag", () => {
    const { onUpdateElement } = setup({ composition: withTwo });

    fireEvent.pointerDown(qa(".element-interaction")[0], { clientX: 500, clientY: 500 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 500 });
    fireEvent.pointerUp(window);

    expect(onUpdateElement).toHaveBeenCalledWith("e1", expect.objectContaining({ x: 30 }));
  });

  it("draws the snap guides raised by a drag", () => {
    setup({ composition: composition({ elements: [element({ x: 0.5, y: 0.5 })] }) });

    fireEvent.pointerDown(q(".element-interaction"), { clientX: 500, clientY: 500 });
    fireEvent.pointerMove(window, { clientX: 495, clientY: 495 });

    expect(qa(".snap-guide-v")).toHaveLength(1);
    expect(qa(".snap-guide-h")).toHaveLength(1);

    fireEvent.pointerUp(window);
    expect(qa(".snap-guide")).toHaveLength(0);
  });

  it.each([
    ["shape", { type: "shape", shape_type: "rectangle", fill: "#fff", stroke: "none", stroke_width: 0 }, "svg"],
    ["image", { type: "image", src: "a.png", fit_mode: "cover" }, "img"],
    [
      "video",
      {
        type: "video",
        src: "a.mp4",
        fit_mode: "cover",
        volume: 1,
        muted: true,
        video_offset: 0,
        playback_speed: 1,
      },
      "video",
    ],
  ])("renders a %s element", async (_name, over, selector) => {
    setup({ composition: composition({ elements: [element(over as Partial<Element>)] }) });
    await act(async () => {});

    expect(q(`.element-interaction ${selector}`)).toBeTruthy();
  });

  it("renders a text element with its content", () => {
    setup({ composition: composition({ elements: [element({ content: "Bonjour" })] }) });
    expect(screen.getByText("Bonjour")).toBeInTheDocument();
  });

  it("reveals only part of the text mid-animation", () => {
    setup({
      composition: composition({
        elements: [
          element({
            content: "abcdefghij",
            duration: 10,
            animations: [
              { animation_type: "typewriter", direction: "in", duration: 10, easing: "linear", with_fade: false },
            ],
          } as Partial<Element>),
        ],
      }),
      localTime: 5,
    });

    expect(screen.getByText("abcde")).toBeInTheDocument();
  });
});

describe("CanvasStage — marquee selection", () => {
  const withTwo = composition({
    elements: [
      element({ id: "e1", x: 10, y: 10, width: 20, height: 20 }),
      element({ id: "e2", x: 70, y: 70, width: 20, height: 20 }),
    ],
  });

  it("draws the rectangle while the pointer is down", () => {
    setup({ composition: withTwo });

    fireEvent.pointerDown(stage(), { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });

    const rect = q(".marquee-select");
    expect(rect.style.left).toBe("10%");
    expect(rect.style.width).toBe("30%");
    expect(rect.style.height).toBe("20%");

    fireEvent.pointerUp(window);
    expect(q(".marquee-select")).toBeNull();
  });

  it("normalises a rectangle drawn backwards", () => {
    setup({ composition: withTwo });

    fireEvent.pointerDown(stage(), { clientX: 400, clientY: 300 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 100 });

    expect(q(".marquee-select").style.left).toBe("10%");
    fireEvent.pointerUp(window);
  });

  it("selects the elements it overlaps", () => {
    const { onMarqueeSelect } = setup({ composition: withTwo });

    marquee(0, 0, 400, 400);

    expect(onMarqueeSelect).toHaveBeenCalledWith(["e1"], false);
  });

  it("selects both elements when the rectangle covers the stage", () => {
    const { onMarqueeSelect } = setup({ composition: withTwo });

    marquee(0, 0, 1000, 1000);

    expect(onMarqueeSelect).toHaveBeenCalledWith(["e1", "e2"], false);
  });

  it("ignores elements that are not on screen at this time", () => {
    const { onMarqueeSelect } = setup({
      composition: composition({
        elements: [
          element({ id: "e1", x: 10, y: 10, width: 20, height: 20 }),
          element({ id: "e2", x: 10, y: 10, width: 20, height: 20, start_time: 8, duration: 1 }),
        ],
      }),
      localTime: 1,
    });

    marquee(0, 0, 1000, 1000);

    expect(onMarqueeSelect).toHaveBeenCalledWith(["e1"], false);
  });

  it("keeps the existing selection when a modifier is held", () => {
    const { onMarqueeSelect } = setup({ composition: withTwo });

    marquee(0, 0, 1000, 1000, { metaKey: true });

    expect(onMarqueeSelect).toHaveBeenCalledWith(["e1", "e2"], true);
  });

  it("clears the selection on a bare click", () => {
    const { onSelectElement, onMarqueeSelect } = setup({ composition: withTwo });

    marquee(100, 100, 100, 100);

    expect(onSelectElement).toHaveBeenCalledWith(null, false);
    expect(onMarqueeSelect).not.toHaveBeenCalled();
  });

  it("keeps the selection on a bare additive click", () => {
    const { onSelectElement } = setup({ composition: withTwo });

    marquee(100, 100, 100, 100, { shiftKey: true });

    expect(onSelectElement).not.toHaveBeenCalled();
  });
});

describe("CanvasStage — sizing", () => {
  /**
   * jsdom does not lay anything out, so the stage is sized by hand: give the wrapper a size,
   * then fire the ResizeObserver callback the component registered.
   */
  function resizeTo(width: number, height: number) {
    const wrap = q(".canvas-stage-wrap");
    Object.defineProperty(wrap, "clientWidth", { value: width, configurable: true });
    Object.defineProperty(wrap, "clientHeight", { value: height, configurable: true });
    act(() => {
      observers.forEach((cb) => cb());
    });
  }

  let observers: (() => void)[] = [];

  beforeEach(() => {
    observers = [];
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  it("fits a landscape canvas to the width it is given", () => {
    setup({ project: project({ width: 1920, height: 1080 }) });

    // 400 usable px wide, plenty of height: the width wins.
    resizeTo(468, 2000);

    expect(stage().style.width).toBe("400px");
    expect(stage().style.height).toBe("225px");
  });

  it("fits a portrait canvas to the height it is given", () => {
    setup({ project: project({ width: 1080, height: 1920 }) });

    resizeTo(2000, 268);

    expect(stage().style.height).toBe("200px");
    expect(stage().style.width).toBe("113px");
  });

  it("never grows the stage past its maximum width", () => {
    setup({ project: project({ width: 1920, height: 1080 }) });

    resizeTo(5000, 5000);

    expect(stage().style.width).toBe("860px");
  });

  it("leaves the stage alone when there is no room at all", () => {
    setup();

    resizeTo(10, 10);

    expect(stage().style.width).toBe("");
  });
});
