import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import Timeline from "./Timeline";
import type { Project } from "../../bindings/Project";
import type { Composition } from "../../bindings/Composition";
import type { Element } from "../../bindings/Element";
import type { AudioTrack } from "../../bindings/AudioTrack";

const element = (over: Partial<Element> = {}): Element =>
  ({
    id: "e1",
    name: "Title",
    type: "text",
    content: "hi",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    start_time: 0,
    duration: 5,
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
    elements: [],
    ...over,
  }) as Composition;

const track = (over: Partial<AudioTrack> = {}): AudioTrack =>
  ({
    id: "a1",
    name: "Music",
    src: "a.mp3",
    start_time: 0,
    duration: 8,
    volume: 1,
    muted: false,
    solo: false,
    audio_offset: 0,
    fade_in: 0,
    fade_out: 0,
    ...over,
  }) as AudioTrack;

const project = (over: Partial<Project> = {}): Project =>
  ({
    name: "P",
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 10,
    compositions: [composition()],
    audio_tracks: [],
    ...over,
  }) as unknown as Project;

/** The lane strip is 1000 px wide starting at x = 0; the default zoom is 40 px/s. */
const LANES_RECT = { left: 0, top: 0, width: 1000, height: 200, right: 1000, bottom: 200 };
const PX_PER_SEC = 40;

function setup(over: Partial<Parameters<typeof Timeline>[0]> = {}) {
  const handlers = {
    onSelectComposition: vi.fn(),
    onSelectElement: vi.fn(),
    onAddComposition: vi.fn(),
    onSeek: vi.fn(),
    onResizeComposition: vi.fn(),
    onUpdateOverlap: vi.fn(),
    onRenameComposition: vi.fn(),
    onReorderComposition: vi.fn(),
    onDeleteComposition: vi.fn(),
    onDuplicateComposition: vi.fn(),
    onUpdateElementTiming: vi.fn(),
    onUpdateAudioTiming: vi.fn(),
    onSplit: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onSearchChange: vi.fn(),
  };
  const view = render(
    <Timeline
      project={project()}
      activeCompositionId="c1"
      selectedElementIds={[]}
      currentTime={0}
      searchQuery=""
      {...handlers}
      {...over}
    />,
  );
  const lanes = document.querySelector(".timeline-lanes") as HTMLElement;
  lanes.getBoundingClientRect = () => LANES_RECT as DOMRect;
  return { ...handlers, lanes, ...view };
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement;
const qa = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];

/** Presses `target`, moves the pointer `dx` pixels to the right, then releases. */
function drag(target: HTMLElement, dx: number) {
  fireEvent.pointerDown(target, { clientX: 200, clientY: 0 });
  fireEvent.pointerMove(window, { clientX: 200 + dx, clientY: 0 });
  fireEvent.pointerUp(window);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Timeline — the toolbar", () => {
  it("splits, deletes and duplicates the selection", () => {
    const { onSplit, onDelete, onDuplicate } = setup({ selectedElementIds: ["e1"] });

    fireEvent.click(screen.getByRole("button", { name: /Split/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Duplicate$/ }));

    expect(onSplit).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
    expect(onDuplicate).toHaveBeenCalled();
  });

  it("disables the clip actions without a selection", () => {
    setup({ selectedElementIds: [] });

    expect(screen.getByRole("button", { name: /Split/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Delete$/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Duplicate$/ })).toBeDisabled();
  });

  it("only allows splitting one clip at a time", () => {
    setup({ selectedElementIds: ["e1", "e2"] });

    expect(screen.getByRole("button", { name: /Split/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Delete$/ })).toBeEnabled();
  });

  it("moves the active scene along the timeline", () => {
    const { onReorderComposition } = setup({
      project: project({ compositions: [composition(), composition({ id: "c2", start_time: 10 })] }),
      activeCompositionId: "c2",
    });

    fireEvent.click(screen.getByTitle("Move scene earlier"));

    expect(onReorderComposition).toHaveBeenCalledWith("c2", -1);
  });

  it("cannot move the first scene earlier nor the last one later", () => {
    setup({
      project: project({ compositions: [composition(), composition({ id: "c2", start_time: 10 })] }),
      activeCompositionId: "c1",
    });

    expect(screen.getByTitle("Move scene earlier")).toBeDisabled();

    fireEvent.click(screen.getByTitle("Move scene later"));
  });

  it("duplicates and deletes the active scene", () => {
    const { onDuplicateComposition, onDeleteComposition } = setup({
      project: project({ compositions: [composition(), composition({ id: "c2", start_time: 10 })] }),
    });

    fireEvent.click(screen.getByTitle("Duplicate scene"));
    fireEvent.click(screen.getByTitle("Delete scene"));

    expect(onDuplicateComposition).toHaveBeenCalledWith("c1");
    expect(onDeleteComposition).toHaveBeenCalledWith("c1");
  });

  it("refuses to delete the only scene", () => {
    setup();
    expect(screen.getByTitle("Delete scene")).toBeDisabled();
  });

  it("reports what is typed in the search box", () => {
    const { onSearchChange } = setup();

    fireEvent.change(q(".timeline-search"), { target: { value: "log" } });

    expect(onSearchChange).toHaveBeenCalledWith("log");
  });
});

describe("Timeline — the ruler", () => {
  it("labels every five seconds up to at least thirty", () => {
    setup();

    // A short project still gets a thirty-second ruler.
    expect(qa(".timeline-tick").map((n) => n.textContent)).toEqual([
      "00:00",
      "00:05",
      "00:10",
      "00:15",
      "00:20",
      "00:25",
      "00:30",
    ]);
  });

  it("stretches the ruler for a long project", () => {
    setup({ project: project({ duration: 62, compositions: [composition({ duration: 62 })] }) });

    expect(qa(".timeline-tick").map((n) => n.textContent)).toContain("01:05");
  });

  it("seeks where the ruler is clicked", () => {
    const { onSeek } = setup();

    fireEvent.pointerDown(q(".timeline-ruler"), { clientX: 4 * PX_PER_SEC });

    expect(onSeek).toHaveBeenCalledWith(4);
  });

  it("scrubs while the pointer is held down", () => {
    const { onSeek } = setup();

    fireEvent.pointerDown(q(".timeline-ruler"), { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 6 * PX_PER_SEC });
    fireEvent.pointerUp(window);

    expect(onSeek).toHaveBeenLastCalledWith(6);
  });

  it("stops scrubbing after the pointer is released", () => {
    const { onSeek } = setup();

    fireEvent.pointerDown(q(".timeline-ruler"), { clientX: 0 });
    fireEvent.pointerUp(window);
    onSeek.mockClear();
    fireEvent.pointerMove(window, { clientX: 300 });

    expect(onSeek).not.toHaveBeenCalled();
  });

  it("clamps a seek to the project bounds", () => {
    const { onSeek } = setup();

    fireEvent.pointerDown(q(".timeline-ruler"), { clientX: -500 });
    expect(onSeek).toHaveBeenLastCalledWith(0);

    fireEvent.pointerDown(q(".timeline-ruler"), { clientX: 5000 });
    expect(onSeek).toHaveBeenLastCalledWith(10);
  });

  it("places the playhead at the current time", () => {
    setup({ currentTime: 3 });
    expect(q(".timeline-playhead").style.left).toBe(`${3 * PX_PER_SEC}px`);
  });

  it("rescales everything when the zoom changes", () => {
    setup({ currentTime: 3 });

    fireEvent.change(q(".timeline-zoom"), { target: { value: "80" } });

    expect(q(".timeline-playhead").style.left).toBe("240px");
  });
});

describe("Timeline — scenes", () => {
  const two = project({
    compositions: [
      composition({ id: "c1", name: "Intro", duration: 4 }),
      composition({ id: "c2", name: "Outro", start_time: 4, duration: 6 }),
    ],
  });

  it("draws one block per scene, marking the active one", () => {
    setup({ project: two, activeCompositionId: "c2" });

    const blocks = qa(".timeline-scene-block");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].className).not.toContain("active");
    expect(blocks[1].className).toContain("active");
  });

  it("sizes and positions the blocks from the scene timings", () => {
    setup({ project: two });

    const blocks = qa(".timeline-scene-block");
    expect(blocks[1].style.left).toBe(`${4 * PX_PER_SEC}px`);
    expect(blocks[1].style.width).toBe(`${6 * PX_PER_SEC - 2}px`);
  });

  it("selects a scene when its block is pressed", () => {
    const { onSelectComposition, onSeek } = setup({ project: two });

    fireEvent.pointerDown(qa(".timeline-scene-block")[1], { clientX: 300 });

    expect(onSelectComposition).toHaveBeenCalledWith("c2");
    // The press must not also scrub the ruler underneath.
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("resizes a scene by dragging its right edge", () => {
    const { onResizeComposition } = setup({ project: two });

    drag(qa(".timeline-scene-resize")[0], 2 * PX_PER_SEC);

    expect(onResizeComposition).toHaveBeenCalledWith("c1", 6);
  });

  it("never shrinks a scene to nothing", () => {
    const { onResizeComposition } = setup({ project: two });

    drag(qa(".timeline-scene-resize")[0], -5000);

    expect(onResizeComposition).toHaveBeenLastCalledWith("c1", 0.2);
  });

  it("adds a scene after the last one", () => {
    const { onAddComposition, onSelectComposition } = setup({ project: two });

    fireEvent.pointerDown(screen.getByTitle("Add a scene"));

    expect(onAddComposition).toHaveBeenCalled();
    expect(onSelectComposition).not.toHaveBeenCalled();
  });

  it("offers a crossfade field on every scene but the last", () => {
    setup({ project: two });
    expect(qa(".timeline-scene-overlap")).toHaveLength(1);
  });

  it("reports a new crossfade", () => {
    const { onUpdateOverlap, onSelectComposition } = setup({ project: two });
    const field = qa(".timeline-scene-overlap")[0];

    fireEvent.pointerDown(field);
    fireEvent.change(field, { target: { value: "0.5" } });

    expect(onUpdateOverlap).toHaveBeenCalledWith("c1", 0.5);
    expect(onSelectComposition).not.toHaveBeenCalled();
  });
});

describe("Timeline — renaming a scene", () => {
  it("turns the name into a field on double-click", () => {
    setup();

    fireEvent.doubleClick(screen.getByText("Scene 1"));

    expect(q(".timeline-scene-name-input")).toBeInTheDocument();
  });

  it("commits the new name on blur", () => {
    const { onRenameComposition } = setup();
    fireEvent.doubleClick(screen.getByText("Scene 1"));

    const input = q(".timeline-scene-name-input");
    fireEvent.change(input, { target: { value: " Opening " } });
    fireEvent.blur(input);

    expect(onRenameComposition).toHaveBeenCalledWith("c1", "Opening");
    expect(q(".timeline-scene-name-input")).toBeNull();
  });

  it("keeps the old name when the field is emptied", () => {
    const { onRenameComposition } = setup();
    fireEvent.doubleClick(screen.getByText("Scene 1"));

    const input = q(".timeline-scene-name-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    expect(onRenameComposition).toHaveBeenCalledWith("c1", "Scene 1");
  });

  it("commits on Enter", () => {
    const { onRenameComposition } = setup();
    fireEvent.doubleClick(screen.getByText("Scene 1"));

    const input = q(".timeline-scene-name-input");
    fireEvent.change(input, { target: { value: "Opening" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRenameComposition).toHaveBeenCalledWith("c1", "Opening");
  });

  it("abandons the rename on Escape", () => {
    const { onRenameComposition } = setup();
    fireEvent.doubleClick(screen.getByText("Scene 1"));

    fireEvent.keyDown(q(".timeline-scene-name-input"), { key: "Escape" });

    expect(onRenameComposition).not.toHaveBeenCalled();
    expect(q(".timeline-scene-name-input")).toBeNull();
  });

  it("does not select the scene while typing in the field", () => {
    const { onSelectComposition } = setup();
    fireEvent.doubleClick(screen.getByText("Scene 1"));

    fireEvent.pointerDown(q(".timeline-scene-name-input"));
    fireEvent.click(q(".timeline-scene-name-input"));

    expect(onSelectComposition).not.toHaveBeenCalled();
  });
});

describe("Timeline — element clips", () => {
  const withElements = project({
    compositions: [
      composition({
        elements: [element(), element({ id: "e2", name: "Logo", type: "image", src: "a.png", start_time: 2 })],
      }),
    ],
  });

  it("gives every element a labelled lane", () => {
    setup({ project: withElements });

    expect(qa(".timeline-label-name").map((n) => n.textContent)).toEqual(["Title", "Logo"]);
    expect(qa(".timeline-clip")).toHaveLength(2);
  });

  it("marks the selected clips", () => {
    setup({ project: withElements, selectedElementIds: ["e2"] });

    const clips = qa(".timeline-clip");
    expect(clips[0].className).not.toContain("selected");
    expect(clips[1].className).toContain("selected");
  });

  it("filters the lanes by the search query", () => {
    setup({ project: withElements, searchQuery: "lo" });

    expect(qa(".timeline-label-name").map((n) => n.textContent)).toEqual(["Logo"]);
  });

  it("matches the query without regard to case", () => {
    setup({ project: withElements, searchQuery: "TITLE" });
    expect(qa(".timeline-clip-name").map((n) => n.textContent)).toEqual(["Title"]);
  });

  it("positions a clip after the start of its scene", () => {
    setup({
      project: project({
        compositions: [composition({ start_time: 3, elements: [element({ start_time: 1, duration: 2 })] })],
      }),
    });

    expect(q(".timeline-clip").style.left).toBe(`${4 * PX_PER_SEC}px`);
    expect(q(".timeline-clip").style.width).toBe(`${2 * PX_PER_SEC - 2}px`);
  });

  it("stretches an open-ended clip to the end of its scene", () => {
    setup({
      project: project({
        compositions: [composition({ duration: 10, elements: [element({ start_time: 4, duration: null })] })],
      }),
    });

    expect(q(".timeline-clip").style.width).toBe(`${6 * PX_PER_SEC - 2}px`);
  });

  it("moves a clip along its lane", () => {
    const { onUpdateElementTiming, onSelectElement } = setup({ project: withElements });

    drag(qa(".timeline-clip")[0], 3 * PX_PER_SEC);

    expect(onSelectElement).toHaveBeenCalledWith("e1");
    expect(onUpdateElementTiming).toHaveBeenLastCalledWith("e1", 3, 5);
  });

  it("keeps a clip inside its scene", () => {
    const { onUpdateElementTiming } = setup({ project: withElements });

    drag(qa(".timeline-clip")[0], -5000);
    expect(onUpdateElementTiming).toHaveBeenLastCalledWith("e1", 0, 5);

    drag(qa(".timeline-clip")[0], 5000);
    expect(onUpdateElementTiming).toHaveBeenLastCalledWith("e1", 9.8, 5);
  });

  it("resizes a clip from its right edge", () => {
    const { onUpdateElementTiming } = setup({ project: withElements });

    drag(qa(".timeline-clip-resize")[0], 2 * PX_PER_SEC);

    expect(onUpdateElementTiming).toHaveBeenLastCalledWith("e1", 0, 7);
  });

  it("never resizes a clip past the end of its scene", () => {
    const { onUpdateElementTiming } = setup({ project: withElements });

    drag(qa(".timeline-clip-resize")[0], 5000);

    expect(onUpdateElementTiming).toHaveBeenLastCalledWith("e1", 0, 10);
  });

  it("never resizes a clip to nothing", () => {
    const { onUpdateElementTiming } = setup({ project: withElements });

    drag(qa(".timeline-clip-resize")[0], -5000);

    expect(onUpdateElementTiming).toHaveBeenLastCalledWith("e1", 0, 0.2);
  });

  it("shows no clip lane when the active scene is missing", () => {
    setup({ project: withElements, activeCompositionId: "nope" });
    expect(qa(".timeline-clip")).toHaveLength(0);
  });
});

describe("Timeline — audio clips", () => {
  const withAudio = project({ audio_tracks: [track()] });

  it("shows the audio tracks whatever the active scene", () => {
    setup({ project: withAudio, activeCompositionId: "nope" });

    expect(qa(".timeline-label-name").map((n) => n.textContent)).toEqual(["Music"]);
    expect(q(".timeline-clip").style.width).toBe(`${8 * PX_PER_SEC - 2}px`);
  });

  it("filters the audio tracks too", () => {
    setup({ project: withAudio, searchQuery: "zzz" });
    expect(qa(".timeline-clip")).toHaveLength(0);
  });

  it("stretches an open-ended track to the end of the project", () => {
    setup({ project: project({ audio_tracks: [track({ start_time: 2, duration: null })] }) });

    expect(q(".timeline-clip").style.width).toBe(`${8 * PX_PER_SEC - 2}px`);
  });

  it("moves an audio track along the whole project", () => {
    const { onUpdateAudioTiming, onSelectElement } = setup({ project: withAudio });

    drag(q(".timeline-clip"), 1 * PX_PER_SEC);

    expect(onSelectElement).toHaveBeenCalledWith("a1");
    expect(onUpdateAudioTiming).toHaveBeenLastCalledWith("a1", 1, 8);
  });

  it("keeps an audio track inside the project", () => {
    const { onUpdateAudioTiming } = setup({ project: withAudio });

    drag(q(".timeline-clip"), -5000);
    expect(onUpdateAudioTiming).toHaveBeenLastCalledWith("a1", 0, 8);

    drag(q(".timeline-clip"), 5000);
    expect(onUpdateAudioTiming).toHaveBeenLastCalledWith("a1", 9.8, 8);
  });

  it("resizes an audio track within the project bounds", () => {
    const { onUpdateAudioTiming } = setup({ project: withAudio });

    drag(q(".timeline-clip-resize"), 1 * PX_PER_SEC);
    expect(onUpdateAudioTiming).toHaveBeenLastCalledWith("a1", 0, 9);

    drag(q(".timeline-clip-resize"), 5000);
    expect(onUpdateAudioTiming).toHaveBeenLastCalledWith("a1", 0, 10);

    drag(q(".timeline-clip-resize"), -5000);
    expect(onUpdateAudioTiming).toHaveBeenLastCalledWith("a1", 0, 0.2);
  });
});
