import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRef } from "react";
import ElementInteraction, { type GeometryPatch, type SnapGuides } from "./ElementInteraction";

/** The stage is a 1000×1000 square at the origin, so 1 px == 0.1 %. */
const STAGE_RECT = { left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000 };

const geometry = (over: Partial<GeometryPatch> = {}): GeometryPatch => ({
  x: 20,
  y: 20,
  width: 20,
  height: 20,
  rotation: 0,
  ...over,
});

function setup(
  over: Partial<GeometryPatch> = {},
  opts: { selected?: boolean; siblings?: { x: number; y: number; width: number; height: number }[] } = {},
) {
  const onChange = vi.fn<(patch: Partial<GeometryPatch>) => void>();
  const onSelect = vi.fn<(additive: boolean) => void>();
  const onGuides = vi.fn<(guides: SnapGuides | null) => void>();
  const stageRef = createRef<HTMLDivElement>();

  function Harness() {
    return (
      <div ref={stageRef}>
        <ElementInteraction
          geometry={geometry(over)}
          selected={opts.selected ?? true}
          accentColor="#f0f"
          stageRef={stageRef}
          siblings={opts.siblings ?? []}
          onChange={onChange}
          onSelect={onSelect}
          onGuides={onGuides}
        >
          <span>content</span>
        </ElementInteraction>
      </div>
    );
  }

  const view = render(<Harness />);
  stageRef.current!.getBoundingClientRect = () => STAGE_RECT as DOMRect;
  return { onChange, onSelect, onGuides, ...view };
}

const box = () => document.querySelector(".element-interaction") as HTMLElement;
const handle = (id: string) => document.querySelector(`.element-handle-${id}`) as HTMLElement;
const rotateHandle = () => document.querySelector(".element-rotate-handle") as HTMLElement;

/** Presses `target`, moves the pointer by (dx, dy) pixels, then releases. */
function drag(target: HTMLElement, dx: number, dy: number, init: Partial<PointerEventInit> = {}) {
  fireEvent.pointerDown(target, { clientX: 100, clientY: 100, ...init });
  fireEvent.pointerMove(window, { clientX: 100 + dx, clientY: 100 + dy });
  fireEvent.pointerUp(window);
}

const lastPatch = (onChange: ReturnType<typeof vi.fn>) =>
  onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as Partial<GeometryPatch>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ElementInteraction — chrome", () => {
  it("places the box from the geometry", () => {
    setup({ x: 10, y: 30, width: 40, height: 50 });

    expect(box().style.left).toBe("10%");
    expect(box().style.top).toBe("30%");
    expect(box().style.width).toBe("40%");
    expect(box().style.height).toBe("50%");
  });

  it("rotates the box when the element is turned", () => {
    setup({ rotation: 45 });
    expect(box().style.transform).toBe("rotate(45deg)");
  });

  it("leaves an unrotated element untransformed", () => {
    setup({ rotation: 0 });
    expect(box().style.transform).toBe("");
  });

  it("renders its children", () => {
    const { getByText } = setup();
    expect(getByText("content")).toBeInTheDocument();
  });

  it("shows eight resize handles and a rotate handle once selected", () => {
    setup();

    expect(document.querySelectorAll(".element-handle")).toHaveLength(8);
    expect(rotateHandle()).toBeInTheDocument();
    expect(document.querySelector(".element-outline")).toBeInTheDocument();
  });

  it("hides the handles when the element is not selected", () => {
    setup({}, { selected: false });

    expect(document.querySelectorAll(".element-handle")).toHaveLength(0);
    expect(rotateHandle()).toBeNull();
  });
});

describe("ElementInteraction — selecting", () => {
  it("selects on press", () => {
    const { onSelect } = setup();

    fireEvent.pointerDown(box(), { clientX: 0, clientY: 0 });

    expect(onSelect).toHaveBeenCalledWith(false);
  });

  it.each(["shiftKey", "metaKey", "ctrlKey"] as const)("treats %s as additive", (key) => {
    const { onSelect } = setup();

    fireEvent.pointerDown(box(), { clientX: 0, clientY: 0, [key]: true });

    expect(onSelect).toHaveBeenCalledWith(true);
  });

  it("selects but does not move when the stage is not mounted", () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    render(
      <ElementInteraction
        geometry={geometry()}
        selected
        accentColor="#f0f"
        stageRef={{ current: null }}
        siblings={[]}
        onChange={onChange}
        onSelect={onSelect}
      >
        <span>content</span>
      </ElementInteraction>,
    );

    // No laid-out stage to measure against: the drag must be a no-op, not a crash.
    fireEvent.pointerDown(box(), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });

    expect(onSelect).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ElementInteraction — moving", () => {
  it("moves the element by the pointer delta", () => {
    const { onChange } = setup({ x: 20, y: 20 });

    drag(box(), 100, 50);

    expect(lastPatch(onChange)).toEqual({ x: 30, y: 25 });
  });

  it("never lets the element leave the stage", () => {
    const { onChange } = setup({ x: 20, y: 20, width: 20, height: 20 });

    drag(box(), -1000, -1000);

    expect(lastPatch(onChange)).toEqual({ x: 0, y: 0 });
  });

  it("stops at the far edge", () => {
    const { onChange } = setup({ x: 20, y: 20, width: 20, height: 20 });

    drag(box(), 1000, 1000);

    expect(lastPatch(onChange)).toEqual({ x: 80, y: 80 });
  });

  it("stops moving once the pointer is released", () => {
    const { onChange } = setup();

    drag(box(), 100, 0);
    onChange.mockClear();
    fireEvent.pointerMove(window, { clientX: 900, clientY: 900 });

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ElementInteraction — snapping", () => {
  it("snaps the left edge to the stage edge and reports the guide", () => {
    const { onChange, onGuides } = setup({ x: 1, y: 40, width: 20, height: 20 });

    drag(box(), 1, 0);

    expect(lastPatch(onChange).x).toBe(0);
    expect(onGuides).toHaveBeenCalledWith(expect.objectContaining({ vertical: [0] }));
  });

  it("snaps the centre to the middle of the stage", () => {
    const { onChange, onGuides } = setup({ x: 39.5, y: 5, width: 20, height: 10 });

    drag(box(), 1, 0);

    // 39.6 + 10 = 49.6, within the 1.2 threshold of the 50 centre line.
    expect(lastPatch(onChange).x).toBe(40);
    expect(onGuides).toHaveBeenCalledWith(expect.objectContaining({ vertical: [50] }));
  });

  it("snaps the right edge to the far side", () => {
    const { onChange } = setup({ x: 79, y: 5, width: 20, height: 10 });

    drag(box(), 5, 0);

    expect(lastPatch(onChange).x).toBe(80);
  });

  it("snaps vertically to a sibling's top edge", () => {
    const { onChange, onGuides } = setup(
      { x: 5, y: 29, width: 10, height: 10 },
      { siblings: [{ x: 60, y: 30, width: 10, height: 10 }] },
    );

    drag(box(), 0, 5);

    expect(lastPatch(onChange).y).toBe(30);
    expect(onGuides).toHaveBeenCalledWith(expect.objectContaining({ horizontal: [30] }));
  });

  it("snaps the bottom edge to a sibling", () => {
    const { onChange } = setup(
      { x: 5, y: 60, width: 10, height: 10 },
      { siblings: [{ x: 60, y: 20, width: 10, height: 51 }] },
    );

    drag(box(), 0, 5);

    // Bottom lands on 71, the sibling's own bottom edge.
    expect(lastPatch(onChange).y).toBe(61);
  });

  it("reports no guide when nothing is near", () => {
    const { onGuides } = setup({ x: 20, y: 20, width: 13, height: 13 });

    fireEvent.pointerDown(box(), { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 144, clientY: 144 });

    expect(onGuides).toHaveBeenLastCalledWith({ vertical: [], horizontal: [] });
  });

  it("clears the guides when the drag ends", () => {
    const { onGuides } = setup();

    drag(box(), 100, 100);

    expect(onGuides).toHaveBeenLastCalledWith(null);
  });
});

describe("ElementInteraction — resizing", () => {
  it("grows from the east handle", () => {
    const { onChange } = setup({ x: 20, y: 20, width: 20, height: 20 });

    drag(handle("e"), 100, 0);

    expect(lastPatch(onChange)).toMatchObject({ x: 20, width: 30, height: 20 });
  });

  it("grows from the south handle", () => {
    const { onChange } = setup({ x: 20, y: 20, width: 20, height: 20 });

    drag(handle("s"), 0, 100);

    expect(lastPatch(onChange)).toMatchObject({ y: 20, height: 30 });
  });

  it("moves the origin when dragging the west handle", () => {
    const { onChange } = setup({ x: 20, y: 20, width: 20, height: 20 });

    drag(handle("w"), 50, 0);

    expect(lastPatch(onChange)).toMatchObject({ x: 25, width: 15 });
  });

  it("moves the origin when dragging the north handle", () => {
    const { onChange } = setup({ x: 20, y: 20, width: 20, height: 20 });

    drag(handle("n"), 0, 50);

    expect(lastPatch(onChange)).toMatchObject({ y: 25, height: 15 });
  });

  it("resizes on both axes from a corner", () => {
    const { onChange } = setup({ x: 20, y: 20, width: 20, height: 20 });

    drag(handle("se"), 100, 100);

    expect(lastPatch(onChange)).toMatchObject({ width: 30, height: 30 });
  });

  it("keeps a minimum size when shrinking from the west", () => {
    const { onChange } = setup({ x: 20, y: 20, width: 20, height: 20 });

    drag(handle("nw"), 1000, 1000);

    expect(lastPatch(onChange)).toMatchObject({ x: 37, y: 37, width: 3, height: 3 });
  });

  it("keeps a minimum size when shrinking from the east", () => {
    const { onChange } = setup({ x: 20, y: 20, width: 20, height: 20 });

    drag(handle("se"), -1000, -1000);

    expect(lastPatch(onChange)).toMatchObject({ width: 3, height: 3 });
  });

  it("never grows past the stage", () => {
    const { onChange } = setup({ x: 20, y: 20, width: 20, height: 20 });

    drag(handle("se"), 1000, 1000);

    expect(lastPatch(onChange)).toMatchObject({ width: 80, height: 80 });
  });

  it("does not report snap guides while resizing", () => {
    const { onGuides } = setup();

    fireEvent.pointerDown(handle("e"), { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 100 });

    expect(onGuides).not.toHaveBeenCalledWith(expect.objectContaining({ vertical: expect.anything() }));
  });
});

describe("ElementInteraction — rotating", () => {
  it("points the element at the pointer", () => {
    // Centred on (300, 300) in stage pixels.
    const { onChange } = setup({ x: 20, y: 20, width: 20, height: 20 });

    fireEvent.pointerDown(rotateHandle(), { clientX: 300, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 600, clientY: 300 });

    // Pointer due east of the centre → 90° from the upright position.
    expect(lastPatch(onChange)).toEqual({ rotation: 90 });
  });

  it("reads straight up as zero", () => {
    const { onChange } = setup({ x: 20, y: 20, width: 20, height: 20 });

    fireEvent.pointerDown(rotateHandle(), { clientX: 300, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 0 });

    expect(lastPatch(onChange)).toEqual({ rotation: 0 });
  });

  it("reads straight down as half a turn", () => {
    const { onChange } = setup({ x: 20, y: 20, width: 20, height: 20 });

    fireEvent.pointerDown(rotateHandle(), { clientX: 300, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 900 });

    expect(lastPatch(onChange)).toEqual({ rotation: 180 });
  });
});
