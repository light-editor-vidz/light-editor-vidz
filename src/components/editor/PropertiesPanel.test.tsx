import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PropertiesPanel from "./PropertiesPanel";
import { LayersPanel } from "./properties/LayersPanel";
import type { Element } from "../../bindings/Element";
import type { AudioTrack } from "../../bindings/AudioTrack";

const element = (over: Partial<Element> = {}): Element =>
  ({
    id: "e1",
    name: "Layer 1",
    type: "shape",
    shape_type: "rectangle",
    fill: "rgba(255,255,255,1)",
    stroke: "none",
    stroke_width: 1,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    start_time: 0,
    duration: null,
    animations: [],
    ...over,
  }) as Element;

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

function setup(over: Partial<Parameters<typeof PropertiesPanel>[0]> = {}) {
  const handlers = {
    onUpdate: vi.fn(),
    onUpdateAudio: vi.fn(),
    onReorder: vi.fn(),
    onSelectLayer: vi.fn(),
    onReorderLayer: vi.fn(),
    onDeleteLayer: vi.fn(),
    onAlign: vi.fn(),
    onDistribute: vi.fn(),
    onGroup: vi.fn(),
    onUngroup: vi.fn(),
  };
  const view = render(
    <PropertiesPanel
      element={null}
      audioTrack={null}
      activeCompositionDuration={30}
      elements={[]}
      selectedIds={[]}
      {...handlers}
      {...over}
    />,
  );
  return { ...handlers, ...view };
}

describe("PropertiesPanel — what it shows", () => {
  it("invites the user to select something when nothing is selected", () => {
    setup();
    expect(screen.getByText("No element selected")).toBeInTheDocument();
  });

  it("shows the audio panel for a selected track, whatever else is selected", () => {
    setup({ audioTrack: track(), element: element(), selectedIds: ["e1", "e2"] });

    expect(screen.getByDisplayValue("music")).toBeInTheDocument();
    expect(screen.queryByText("Shape properties")).not.toBeInTheDocument();
  });

  it("shows the multi-selection tools for more than one element", () => {
    setup({ selectedIds: ["e1", "e2"], elements: [element(), element({ id: "e2" })] });

    expect(screen.getByText("Align, distribute, or edit together")).toBeInTheDocument();
    expect(screen.queryByText("Shape properties")).not.toBeInTheDocument();
  });

  it.each([
    ["shape", "Shape properties", {}],
    ["text", "Text properties", { content: "hi", color: "rgba(0,0,0,1)", font_size: 4 }],
    ["image", "Image properties", { src: "a.png", fit_mode: "cover" }],
    [
      "video",
      "Video properties",
      {
        src: "a.mp4",
        fit_mode: "cover",
        video_offset: 0,
        playback_speed: 1,
        volume: 1,
        muted: false,
      },
    ],
  ])("shows the %s panel", (type, heading, extra) => {
    setup({ element: element({ type, ...extra } as Partial<Element>), selectedIds: ["e1"] });

    expect(screen.getByText(heading)).toBeInTheDocument();
  });
});

describe("PropertiesPanel — the reorder strip", () => {
  it("brings the element forwards and backwards", () => {
    const { onReorder } = setup({ element: element(), selectedIds: ["e1"] });

    fireEvent.click(screen.getByTitle("Bring forward"));
    fireEvent.click(screen.getByTitle("Send backward"));

    expect(onReorder).toHaveBeenNthCalledWith(1, 1);
    expect(onReorder).toHaveBeenNthCalledWith(2, -1);
  });

  it("deletes the selected element", () => {
    const { onDeleteLayer } = setup({ element: element(), selectedIds: ["e1"] });

    fireEvent.click(screen.getByTitle("Delete"));

    expect(onDeleteLayer).toHaveBeenCalledWith("e1");
  });

  it("has no reorder strip without a selection", () => {
    setup();
    expect(screen.queryByTitle("Bring forward")).not.toBeInTheDocument();
  });
});

describe("PropertiesPanel — the layer list", () => {
  const three = [element(), element({ id: "e2", name: "Layer 2" }), element({ id: "e3", name: "Layer 3" })];

  it("accompanies every state of the panel", () => {
    for (const over of [
      {},
      { element: element(), selectedIds: ["e1"] },
      { audioTrack: track() },
      { selectedIds: ["e1", "e2"] },
    ]) {
      const { unmount } = setup({ elements: three, ...over });
      expect(screen.getByText("Layer 2")).toBeInTheDocument();
      unmount();
    }
  });
});

describe("LayersPanel", () => {
  function setupLayers(elements: Element[], selectedIds: string[] = []) {
    const handlers = {
      onSelectLayer: vi.fn(),
      onReorderLayer: vi.fn(),
      onDeleteLayer: vi.fn(),
    };
    render(<LayersPanel elements={elements} selectedIds={selectedIds} {...handlers} />);
    return handlers;
  }

  const three = [
    element({ id: "e1", name: "Bottom" }),
    element({ id: "e2", name: "Middle", type: "text", content: "x" } as Partial<Element>),
    element({ id: "e3", name: "Top", type: "image", src: "a.png" } as Partial<Element>),
  ];

  it("renders nothing when the composition is empty", () => {
    setupLayers([]);
    expect(screen.queryByText("Layers")).not.toBeInTheDocument();
  });

  it("lists the topmost layer first", () => {
    setupLayers(three);

    const names = [...document.querySelectorAll(".layers-row-name")].map((n) => n.textContent);
    expect(names).toEqual(["Top", "Middle", "Bottom"]);
  });

  it("marks the selected rows", () => {
    setupLayers(three, ["e2"]);

    const selected = document.querySelectorAll(".layers-row.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("Middle");
  });

  it("selects a layer on click", () => {
    const { onSelectLayer } = setupLayers(three);

    fireEvent.click(screen.getByText("Middle"));

    expect(onSelectLayer).toHaveBeenCalledWith("e2", false);
  });

  it("adds to the selection when a modifier is held", () => {
    const { onSelectLayer } = setupLayers(three);

    fireEvent.click(screen.getByText("Middle"), { shiftKey: true });

    expect(onSelectLayer).toHaveBeenCalledWith("e2", true);
  });

  it("deletes a layer without also selecting it", () => {
    const { onDeleteLayer, onSelectLayer } = setupLayers(three);

    fireEvent.click(document.querySelectorAll(".layers-row-delete")[0]);

    expect(onDeleteLayer).toHaveBeenCalledWith("e3");
    expect(onSelectLayer).not.toHaveBeenCalled();
  });

  it("reorders by dropping onto the destination row", () => {
    const { onReorderLayer } = setupLayers(three);
    const rows = document.querySelectorAll(".layers-row");
    const store: Record<string, string> = {};
    const dataTransfer = {
      setData: (k: string, v: string) => {
        store[k] = v;
      },
      getData: (k: string) => store[k] ?? "",
    };

    fireEvent.dragStart(rows[0], { dataTransfer });
    // Dropping the top row onto the last one sends it to the bottom of the z-order.
    fireEvent.drop(rows[2], { dataTransfer });

    expect(onReorderLayer).toHaveBeenCalledWith("e3", 0);
  });

  it("ignores a drop that carries no layer", () => {
    const { onReorderLayer } = setupLayers(three);
    const rows = document.querySelectorAll(".layers-row");

    fireEvent.drop(rows[1], { dataTransfer: { getData: () => "" } });

    expect(onReorderLayer).not.toHaveBeenCalled();
  });
});
