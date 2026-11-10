import "./setup";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import Timeline from "../components/Timeline";
import { LangProvider } from "../i18n";
import type { TrimSegment } from "../types";

class ResizeObserverStub {
  observe() {
    /* noop */
  }
  unobserve() {
    /* noop */
  }
  disconnect() {
    /* noop */
  }
}

beforeEach(() => {
  // jsdom doesn't ship ResizeObserver
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
});

function mockTrackRect(container: HTMLElement, left = 0, width = 100) {
  const track = container.querySelector(".tl-track") as HTMLElement;
  track.getBoundingClientRect = () =>
    ({
      left,
      top: 0,
      right: left + width,
      bottom: 40,
      width,
      height: 40,
      x: left,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  track.setPointerCapture = vi.fn();
  return track;
}

function makeProps(
  overrides: Partial<{
    duration: number;
    currentTime: number;
    cutSegments: TrimSegment[];
    videoUrl: string;
    onSeek: (t: number) => void;
    onCutSegmentsChange: (segs: TrimSegment[]) => void;
    onCutSegmentsChangeLive: (segs: TrimSegment[]) => void;
    onCommit: () => void;
  }> = {},
) {
  return {
    duration: 100,
    currentTime: 0,
    cutSegments: [],
    videoUrl: "file:///x.mp4",
    onSeek: vi.fn(),
    onCutSegmentsChange: vi.fn(),
    onCutSegmentsChangeLive: vi.fn(),
    onCommit: vi.fn(),
    ...overrides,
  };
}

function r(props: ReturnType<typeof makeProps>) {
  return render(
    <LangProvider>
      <Timeline {...props} />
    </LangProvider>,
  );
}

describe("Timeline", () => {
  it("renders the trim label", () => {
    const { container } = r(makeProps());
    expect(container.querySelector(".tl-label")).toBeTruthy();
  });

  it("renders the filmstrip area", () => {
    const { container } = r(makeProps());
    expect(container.querySelector(".filmstrip, .filmstrip-empty")).toBeTruthy();
  });

  it("renders cut segments with correct positioning", () => {
    const { container } = r(
      makeProps({
        cutSegments: [{ id: "a", start: 20, end: 40 }],
      }),
    );
    const cut = container.querySelector(".tl-cut") as HTMLElement;
    expect(cut).toBeTruthy();
    expect(cut.style.left).toBe("20%");
    expect(cut.style.width).toBe("20%");
  });

  it("shows the cut count and clear button when segments exist", () => {
    const { container } = r(
      makeProps({
        cutSegments: [{ id: "a", start: 0, end: 10 }],
      }),
    );
    expect(container.querySelector(".tl-cut-count")).toBeTruthy();
    expect(container.querySelector(".tl-clear-btn")).toBeTruthy();
  });

  it("does not show clear button without segments", () => {
    const { container } = r(makeProps());
    expect(container.querySelector(".tl-clear-btn")).toBeNull();
  });

  it("clear button clears all segments", () => {
    const onCutSegmentsChange = vi.fn();
    const { container } = r(
      makeProps({
        cutSegments: [{ id: "a", start: 0, end: 10 }],
        onCutSegmentsChange,
      }),
    );
    fireEvent.click(container.querySelector(".tl-clear-btn")!);
    expect(onCutSegmentsChange).toHaveBeenCalledWith([]);
  });

  it("delete button on a cut removes only that segment", () => {
    const onCutSegmentsChange = vi.fn();
    const { container } = r(
      makeProps({
        cutSegments: [
          { id: "a", start: 0, end: 10 },
          { id: "b", start: 20, end: 30 },
        ],
        onCutSegmentsChange,
      }),
    );
    const deleteButtons = container.querySelectorAll(".tl-cut-delete");
    fireEvent.click(deleteButtons[0]);
    expect(onCutSegmentsChange).toHaveBeenCalledWith([{ id: "b", start: 20, end: 30 }]);
  });

  it("renders a ruler with major ticks", () => {
    const { container } = r(makeProps({ duration: 60 }));
    expect(container.querySelector(".tl-ruler")).toBeTruthy();
    expect(container.querySelectorAll(".tl-tick.major").length).toBeGreaterThan(0);
  });

  it("renders empty ruler when duration is 0", () => {
    const { container } = r(makeProps({ duration: 0 }));
    const ruler = container.querySelector(".tl-ruler");
    expect(ruler?.children.length).toBe(0);
  });

  it("positions the playhead based on currentTime", () => {
    const { container } = r(makeProps({ currentTime: 25 }));
    const playhead = container.querySelector(".tl-playhead") as HTMLElement;
    expect(playhead.style.left).toBe("25%");
  });

  it("seeks when clicking the track (without drag distance)", () => {
    const onSeek = vi.fn();
    const { container } = r(makeProps({ onSeek }));
    const track = mockTrackRect(container, 0, 100);
    fireEvent.pointerDown(track, { clientX: 50, pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: 50, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(50);
  });

  it("creates a new cut on drag with sufficient distance", () => {
    const onCutSegmentsChange = vi.fn();
    const { container } = r(makeProps({ onCutSegmentsChange }));
    const track = mockTrackRect(container, 0, 100);
    fireEvent.pointerDown(track, { clientX: 10, pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: 30, pointerId: 1 });
    expect(onCutSegmentsChange).toHaveBeenCalled();
    const newCuts = onCutSegmentsChange.mock.calls[0][0];
    expect(newCuts).toHaveLength(1);
    expect(newCuts[0].start).toBeCloseTo(10, 0);
    expect(newCuts[0].end).toBeCloseTo(30, 0);
  });

  it("selects a cut when clicking inside it", () => {
    const { container } = r(
      makeProps({
        cutSegments: [{ id: "a", start: 20, end: 40 }],
      }),
    );
    const cut = container.querySelector(".tl-cut") as HTMLElement;
    fireEvent.click(cut);
    expect(cut.className).toContain("selected");
  });

  it("renders the cut editor (precise time inputs) when a cut is selected", () => {
    const { container } = r(
      makeProps({
        cutSegments: [{ id: "a", start: 20, end: 40 }],
      }),
    );
    const cut = container.querySelector(".tl-cut") as HTMLElement;
    fireEvent.click(cut);
    expect(container.querySelector(".cut-editor")).toBeTruthy();
    expect(container.querySelectorAll(".cut-editor-input").length).toBe(2);
  });

  it("does not create a cut for very short drags", () => {
    const onCutSegmentsChange = vi.fn();
    const onSeek = vi.fn();
    const { container } = r(makeProps({ onSeek, onCutSegmentsChange }));
    const track = mockTrackRect(container, 0, 100);
    fireEvent.pointerDown(track, { clientX: 50, pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: 50, pointerId: 1 });
    expect(onCutSegmentsChange).not.toHaveBeenCalled();
    expect(onSeek).toHaveBeenCalledWith(50);
  });
});

// ─── Drag gestures ───────────────────────────────────────────────────────────

function trackOf(container: Element) {
  const track = container.querySelector(".tl-track") as HTMLElement;
  track.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 1000, bottom: 60, width: 1000, height: 60, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  // jsdom implements neither pointer capture method.
  track.setPointerCapture = () => {};
  track.releasePointerCapture = () => {};
  return track;
}

describe("Timeline drag gestures", () => {
  const oneCut = [{ id: "a", start: 10, end: 30 }];

  // Before this, every pointermove pushed its own undo step: one drag cost the
  // user dozens of Ctrl+Z presses.
  it("reports a drag as live changes, never as discrete history entries", () => {
    const onCutSegmentsChange = vi.fn();
    const onCutSegmentsChangeLive = vi.fn();
    const { container } = r(
      makeProps({
        cutSegments: oneCut,
        onCutSegmentsChange,
        onCutSegmentsChangeLive,
      }),
    );
    const track = trackOf(container);

    fireEvent.pointerDown(track, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 220, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 260, pointerId: 1 });

    expect(onCutSegmentsChangeLive).toHaveBeenCalledTimes(3);
    expect(onCutSegmentsChange).not.toHaveBeenCalled();
  });

  it("closes the gesture when the pointer is released", () => {
    const onCommit = vi.fn();
    const { container } = r(makeProps({ cutSegments: oneCut, onCommit }));
    const track = trackOf(container);

    fireEvent.pointerDown(track, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 260, pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: 260, pointerId: 1 });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("does not close a gesture that never started", () => {
    const onCommit = vi.fn();
    const { container } = r(makeProps({ cutSegments: oneCut, onCommit }));
    const track = trackOf(container);
    fireEvent.pointerUp(track, { clientX: 260, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("merges cuts dragged on top of each other", () => {
    const onCutSegmentsChangeLive = vi.fn();
    // Two adjacent cuts; the drag leaves them overlapping.
    const overlapping = [
      { id: "a", start: 10, end: 30 },
      { id: "b", start: 25, end: 50 },
    ];
    const { container } = r(makeProps({ cutSegments: overlapping, onCutSegmentsChangeLive }));
    const track = trackOf(container);

    fireEvent.pointerDown(track, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 240, pointerId: 1 });
    onCutSegmentsChangeLive.mockClear();
    fireEvent.pointerUp(track, { clientX: 240, pointerId: 1 });

    const calls = onCutSegmentsChangeLive.mock.calls;
    const merged = calls[calls.length - 1][0];
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ start: 10, end: 50 });
  });

  it("leaves non-overlapping cuts alone on release", () => {
    const onCutSegmentsChangeLive = vi.fn();
    const separate = [
      { id: "a", start: 10, end: 20 },
      { id: "b", start: 40, end: 50 },
    ];
    const { container } = r(makeProps({ cutSegments: separate, onCutSegmentsChangeLive }));
    const track = trackOf(container);

    fireEvent.pointerDown(track, { clientX: 150, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 160, pointerId: 1 });
    onCutSegmentsChangeLive.mockClear();
    fireEvent.pointerUp(track, { clientX: 160, pointerId: 1 });

    expect(onCutSegmentsChangeLive).not.toHaveBeenCalled();
  });

  it("creating a new cut stays a single discrete history entry", () => {
    const onCutSegmentsChange = vi.fn();
    const onCutSegmentsChangeLive = vi.fn();
    const { container } = r(makeProps({ onCutSegmentsChange, onCutSegmentsChangeLive }));
    const track = trackOf(container);

    fireEvent.pointerDown(track, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: 300, pointerId: 1 });

    expect(onCutSegmentsChange).toHaveBeenCalledTimes(1);
    expect(onCutSegmentsChangeLive).not.toHaveBeenCalled();
    expect(onCutSegmentsChange.mock.calls[0][0][0]).toMatchObject({ start: 10, end: 30 });
  });
});

describe("Timeline precise time inputs", () => {
  const oneCut = [{ id: "a", start: 20, end: 40 }];

  function selectCut(props = {}) {
    const onCutSegmentsChange = vi.fn();
    const { container } = r(makeProps({ cutSegments: oneCut, onCutSegmentsChange, ...props }));
    fireEvent.click(container.querySelector(".tl-cut") as HTMLElement);
    const [startInput, endInput] = Array.from(container.querySelectorAll(".cut-editor-input")) as HTMLInputElement[];
    return { container, startInput, endInput, onCutSegmentsChange };
  }

  it("accepts a mm:ss.t start", () => {
    const { startInput, onCutSegmentsChange } = selectCut();
    fireEvent.focus(startInput);
    fireEvent.change(startInput, { target: { value: "0:25.0" } });
    fireEvent.blur(startInput);
    expect(onCutSegmentsChange).toHaveBeenCalledWith([{ id: "a", start: 25, end: 40 }]);
  });

  it("accepts a bare seconds value", () => {
    const { endInput, onCutSegmentsChange } = selectCut();
    fireEvent.focus(endInput);
    fireEvent.change(endInput, { target: { value: "55" } });
    fireEvent.blur(endInput);
    expect(onCutSegmentsChange).toHaveBeenCalledWith([{ id: "a", start: 20, end: 55 }]);
  });

  it("ignores an unparseable value", () => {
    const { startInput, onCutSegmentsChange } = selectCut();
    fireEvent.focus(startInput);
    fireEvent.change(startInput, { target: { value: "later" } });
    fireEvent.blur(startInput);
    expect(onCutSegmentsChange).not.toHaveBeenCalled();
  });

  it("never lets the start cross the end", () => {
    const { startInput, onCutSegmentsChange } = selectCut();
    fireEvent.focus(startInput);
    fireEvent.change(startInput, { target: { value: "99" } });
    fireEvent.blur(startInput);
    const [updated] = onCutSegmentsChange.mock.calls[0][0];
    expect(updated.start).toBeLessThan(updated.end);
  });

  it("never lets the end cross the start", () => {
    const { endInput, onCutSegmentsChange } = selectCut();
    fireEvent.focus(endInput);
    fireEvent.change(endInput, { target: { value: "0" } });
    fireEvent.blur(endInput);
    const [updated] = onCutSegmentsChange.mock.calls[0][0];
    expect(updated.end).toBeGreaterThan(updated.start);
  });

  it("clamps the end to the video duration", () => {
    const { endInput, onCutSegmentsChange } = selectCut({ duration: 50 });
    fireEvent.focus(endInput);
    fireEvent.change(endInput, { target: { value: "999" } });
    fireEvent.blur(endInput);
    expect(onCutSegmentsChange.mock.calls[0][0][0].end).toBe(50);
  });

  it("clamps a negative start to zero", () => {
    const { startInput, onCutSegmentsChange } = selectCut();
    fireEvent.focus(startInput);
    fireEvent.change(startInput, { target: { value: "-10" } });
    fireEvent.blur(startInput);
    expect(onCutSegmentsChange.mock.calls[0][0][0].start).toBe(0);
  });

  it("deletes the cut from the editor and drops the selection", () => {
    const { container, onCutSegmentsChange } = selectCut();
    fireEvent.click(container.querySelector(".cut-editor-delete")!);
    expect(onCutSegmentsChange).toHaveBeenCalledWith([]);
    expect(container.querySelector(".cut-editor-placeholder")).toBeTruthy();
  });

  it("seeks from the editor jump buttons", () => {
    const onSeek = vi.fn();
    const { container } = r(makeProps({ cutSegments: oneCut, onSeek }));
    fireEvent.click(container.querySelector(".tl-cut") as HTMLElement);
    fireEvent.click(container.querySelectorAll(".cut-editor-seek")[0]);
    expect(onSeek).toHaveBeenCalledWith(20);
  });
});

describe("Timeline — redimensionnement d’une coupe", () => {
  const seg = { id: "a", start: 20, end: 40 };

  /** Saisit une poignée à `fromX` puis glisse jusqu'à `toX` (piste de 100 px = 100 s). */
  function dragHandle(fromX: number, toX: number, cutSegments = [seg]) {
    const onCutSegmentsChangeLive = vi.fn();
    const props = { ...makeProps({ cutSegments }), onCutSegmentsChangeLive };
    const { container } = r(props);
    const track = mockTrackRect(container);

    fireEvent.pointerDown(track, { clientX: fromX, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: toX, pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: toX, pointerId: 1 });
    return { ...props, onCutSegmentsChangeLive };
  }

  it("déplace le bord gauche", () => {
    const props = dragHandle(20, 10);

    expect(props.onCutSegmentsChangeLive).toHaveBeenCalledWith([{ id: "a", start: 10, end: 40 }]);
    expect(props.onCommit).toHaveBeenCalled();
  });

  it("déplace le bord droit", () => {
    const props = dragHandle(40, 60);

    expect(props.onCutSegmentsChangeLive).toHaveBeenCalledWith([{ id: "a", start: 20, end: 60 }]);
  });

  it("empêche le bord gauche de dépasser le bord droit", () => {
    const props = dragHandle(20, 90);

    const calls = props.onCutSegmentsChangeLive.mock.calls;
    const last = calls[calls.length - 1][0];
    expect(last[0].start).toBeLessThan(last[0].end);
  });

  it("empêche le bord droit de repasser avant le bord gauche", () => {
    const props = dragHandle(40, 0);

    const calls = props.onCutSegmentsChangeLive.mock.calls;
    const last = calls[calls.length - 1][0];
    expect(last[0].end).toBeGreaterThan(last[0].start);
  });

  it("borne le bord gauche à zéro", () => {
    const props = dragHandle(20, -50);

    expect(props.onCutSegmentsChangeLive).toHaveBeenCalledWith([{ id: "a", start: 0, end: 40 }]);
  });

  it("borne le bord droit à la durée de la vidéo", () => {
    const props = dragHandle(40, 500);

    expect(props.onCutSegmentsChangeLive).toHaveBeenCalledWith([{ id: "a", start: 20, end: 100 }]);
  });

  it("sélectionne la coupe qu’on redimensionne", () => {
    const props = makeProps({ cutSegments: [seg] });
    const { container } = r(props);
    const track = mockTrackRect(container);

    fireEvent.pointerDown(track, { clientX: 20, pointerId: 1 });

    expect(container.querySelector(".tl-cut.selected")).toBeTruthy();
  });
});

describe("Timeline — déplacement d’une coupe", () => {
  const seg = { id: "a", start: 20, end: 40 };

  it("déplace la zone en gardant sa durée", () => {
    const props = makeProps({ cutSegments: [seg] });
    const { container } = r(props);
    const track = mockTrackRect(container);

    // 30 est au milieu de la zone, hors des poignées de 8 px.
    fireEvent.pointerDown(track, { clientX: 30, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 50, pointerId: 1 });

    expect(props.onCutSegmentsChangeLive).toHaveBeenCalledWith([{ id: "a", start: 40, end: 60 }]);
  });

  it("bute sur la fin de la vidéo sans se raccourcir", () => {
    const props = makeProps({ cutSegments: [seg] });
    const { container } = r(props);
    const track = mockTrackRect(container);

    fireEvent.pointerDown(track, { clientX: 30, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 500, pointerId: 1 });

    expect(props.onCutSegmentsChangeLive).toHaveBeenCalledWith([{ id: "a", start: 80, end: 100 }]);
  });

  it("bute sur le début de la vidéo", () => {
    const props = makeProps({ cutSegments: [seg] });
    const { container } = r(props);
    const track = mockTrackRect(container);

    fireEvent.pointerDown(track, { clientX: 30, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: -100, pointerId: 1 });

    expect(props.onCutSegmentsChangeLive).toHaveBeenCalledWith([{ id: "a", start: 0, end: 20 }]);
  });

  it("ignore un glisser sur une coupe qui vient de disparaître", () => {
    const props = makeProps({ cutSegments: [seg] });
    const { container, rerender } = r(props);
    const track = mockTrackRect(container);
    fireEvent.pointerDown(track, { clientX: 30, pointerId: 1 });

    // La coupe est retirée en cours de geste (undo clavier, par exemple).
    rerender(
      <LangProvider>
        <Timeline {...makeProps({ cutSegments: [], onCutSegmentsChangeLive: props.onCutSegmentsChangeLive })} />
      </LangProvider>,
    );
    fireEvent.pointerMove(track, { clientX: 50, pointerId: 1 });

    expect(props.onCutSegmentsChangeLive).not.toHaveBeenCalled();
  });
});

describe("Timeline — vidéo sans durée", () => {
  it("ne réagit pas au pointeur tant que la durée est inconnue", () => {
    const props = makeProps({ duration: 0 });
    const { container } = r(props);
    const track = mockTrackRect(container);

    fireEvent.pointerDown(track, { clientX: 30, pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: 60, pointerId: 1 });

    expect(props.onCutSegmentsChange).not.toHaveBeenCalled();
    expect(props.onSeek).not.toHaveBeenCalled();
  });

  it("place la tête de lecture à zéro sans durée", () => {
    const { container } = r(makeProps({ duration: 0, currentTime: 5 }));

    expect((container.querySelector(".tl-playhead") as HTMLElement).style.left).toBe("0%");
  });
});
// ─── Fixes: preview of the drawn zone, tiny cuts, keyboard, cancellation ─────

import { rulerStep } from "../components/Timeline";

describe("Timeline — drawing a new cut", () => {
  it("shows the zone while the pointer is still down", () => {
    const { container } = r(makeProps());
    const track = trackOf(container);
    fireEvent.pointerDown(track, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 300, pointerId: 1 });
    const draft = container.querySelector(".tl-cut-draft") as HTMLElement;
    expect(draft).toBeTruthy();
    expect(draft.style.left).toBe("10%");
    expect(draft.style.width).toBe("20%");
  });

  it("removes the preview on release and commits the real cut", () => {
    const onCutSegmentsChange = vi.fn();
    const { container } = r(makeProps({ onCutSegmentsChange }));
    const track = trackOf(container);
    fireEvent.pointerDown(track, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: 300, pointerId: 1 });
    expect(container.querySelector(".tl-cut-draft")).toBeNull();
    expect(onCutSegmentsChange).toHaveBeenCalledTimes(1);
  });

  it("drops the preview when the pointer is cancelled, without cutting anything", () => {
    const onCutSegmentsChange = vi.fn();
    const { container } = r(makeProps({ onCutSegmentsChange }));
    const track = trackOf(container);
    fireEvent.pointerDown(track, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 300, pointerId: 1 });
    fireEvent.pointerCancel(track, { pointerId: 1 });
    expect(container.querySelector(".tl-cut-draft")).toBeNull();
    expect(onCutSegmentsChange).not.toHaveBeenCalled();
  });
});

describe("Timeline — closing gestures", () => {
  // Otherwise the next, unrelated edit is folded into the interrupted drag.
  it("closes a move gesture when the pointer is cancelled", () => {
    const onCommit = vi.fn();
    const { container } = r(makeProps({ cutSegments: [{ id: "a", start: 10, end: 30 }], onCommit }));
    const track = trackOf(container);
    fireEvent.pointerDown(track, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 220, pointerId: 1 });
    fireEvent.pointerCancel(track, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe("Timeline — very narrow cuts", () => {
  // 1% of a 1000px track is 10px: narrower than two 8px resize handles, so it
  // used to have no "middle" to grab.
  const tiny = [{ id: "t", start: 50, end: 51 }];

  it("moves a narrow cut when pressed inside it", () => {
    const onCutSegmentsChangeLive = vi.fn();
    const { container } = r(makeProps({ cutSegments: tiny, onCutSegmentsChangeLive }));
    const track = trackOf(container);
    fireEvent.pointerDown(track, { clientX: 505, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 605, pointerId: 1 });
    const [segs] = onCutSegmentsChangeLive.mock.calls[0];
    expect(segs[0].start).toBeCloseTo(60, 0);
    expect(segs[0].end - segs[0].start).toBeCloseTo(1, 5);
  });
});

describe("Timeline — keyboard and typed times", () => {
  it("Delete removes the selected cut", () => {
    const onCutSegmentsChange = vi.fn();
    const { container } = r(makeProps({ cutSegments: [{ id: "a", start: 10, end: 30 }], onCutSegmentsChange }));
    fireEvent.click(container.querySelector(".tl-cut")!);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onCutSegmentsChange).toHaveBeenCalledWith([]);
  });

  it("does nothing on Delete when no cut is selected", () => {
    const onCutSegmentsChange = vi.fn();
    r(makeProps({ cutSegments: [{ id: "a", start: 10, end: 30 }], onCutSegmentsChange }));
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onCutSegmentsChange).not.toHaveBeenCalled();
  });

  it("leaves Backspace alone while a time field has focus", () => {
    const onCutSegmentsChange = vi.fn();
    const { container } = r(makeProps({ cutSegments: [{ id: "a", start: 10, end: 30 }], onCutSegmentsChange }));
    fireEvent.click(container.querySelector(".tl-cut")!);
    const input = container.querySelector(".cut-editor-input") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onCutSegmentsChange).not.toHaveBeenCalled();
  });

  it("merges a cut whose typed time makes it overlap another", () => {
    const onCutSegmentsChange = vi.fn();
    const cuts = [
      { id: "a", start: 10, end: 20 },
      { id: "b", start: 40, end: 50 },
    ];
    const { container } = r(makeProps({ cutSegments: cuts, onCutSegmentsChange }));
    fireEvent.click(container.querySelectorAll(".tl-cut")[0]);
    const [, endInput] = container.querySelectorAll(".cut-editor-input");
    fireEvent.focus(endInput);
    fireEvent.change(endInput, { target: { value: "0:45.0" } });
    fireEvent.blur(endInput);
    const [merged] = onCutSegmentsChange.mock.calls[0];
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ start: 10, end: 50 });
  });
});

describe("rulerStep", () => {
  it("uses fine steps for short videos", () => {
    expect(rulerStep(20)).toBe(1);
  });

  it("never produces more than ~15 labelled ticks, however long the video", () => {
    for (const duration of [30, 120, 600, 3600, 3 * 3600, 10 * 3600]) {
      const labels = Math.floor(duration / (rulerStep(duration) * 5)) + 1;
      expect(labels, `${duration}s`).toBeLessThanOrEqual(15);
    }
  });

  it("grows with the duration", () => {
    expect(rulerStep(3 * 3600)).toBeGreaterThan(rulerStep(600));
  });
});
