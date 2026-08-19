import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Header } from "./Header";
import { BackgroundColorField } from "./BackgroundColorField";
import { BlendModeField } from "./BlendModeField";
import { PositionFields } from "./PositionFields";
import { ImagePanFields } from "./ImagePanFields";
import { LayersPanel } from "./LayersPanel";
import type { Element } from "../../../bindings/Element";

const element = (over: Partial<Element> = {}): Element =>
  ({
    type: "text",
    id: "e1",
    name: "title",
    x: 10.4,
    y: 20.6,
    width: 300.2,
    height: 100.8,
    rotation: 45.3,
    ...over,
  }) as Element;

describe("Header", () => {
  it("shows the title, subtitle and badge colour", () => {
    const { container } = render(
      <Header color="rgb(255, 0, 0)" icon={<span>ico</span>} title="Text" subtitle="A caption" />,
    );

    expect(screen.getByText("Text")).toBeInTheDocument();
    expect(screen.getByText("A caption")).toBeInTheDocument();
    expect(screen.getByText("ico")).toBeInTheDocument();
    expect(container.querySelector(".properties-badge")).toHaveStyle({
      background: "rgb(255, 0, 0)",
    });
  });
});

describe("BackgroundColorField", () => {
  it("reports the field as off with no colour", () => {
    render(<BackgroundColorField value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "None" })).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("turns the background on with the default colour", () => {
    const onChange = vi.fn();
    render(<BackgroundColorField value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "None" }));

    expect(onChange).toHaveBeenCalledWith("rgba(0,0,0,0.35)");
  });

  it("honours a custom default colour", () => {
    const onChange = vi.fn();
    render(<BackgroundColorField value={null} onChange={onChange} defaultColor="rgba(1,2,3,1)" />);

    fireEvent.click(screen.getByRole("button", { name: "None" }));

    expect(onChange).toHaveBeenCalledWith("rgba(1,2,3,1)");
  });

  it("shows the colour picker once a colour is set", () => {
    render(<BackgroundColorField value="rgba(0,0,0,0.35)" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "On" })).toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("clears the background when switched off", () => {
    const onChange = vi.fn();
    render(<BackgroundColorField value="rgba(0,0,0,0.35)" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "On" }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("passes a picked colour straight through", () => {
    const onChange = vi.fn();
    const { container } = render(<BackgroundColorField value="rgba(0,0,0,1)" onChange={onChange} />);

    fireEvent.click(container.querySelectorAll(".properties-swatch")[0]);

    expect(onChange).toHaveBeenCalledWith("rgba(255,255,255,1)");
  });
});

describe("BlendModeField", () => {
  it("lists every blend mode", () => {
    render(<BlendModeField value={null} onChange={vi.fn()} />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Normal",
      "Multiply",
      "Screen",
      "Overlay",
      "Darken",
      "Lighten",
    ]);
  });

  it("shows normal when nothing is set", () => {
    render(<BlendModeField value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("normal");
  });

  it("reports a chosen mode", () => {
    const onChange = vi.fn();
    render(<BlendModeField value={null} onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "multiply" } });

    expect(onChange).toHaveBeenCalledWith("multiply");
  });

  it("reports null when going back to normal", () => {
    const onChange = vi.fn();
    render(<BlendModeField value="screen" onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "normal" } });

    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("PositionFields", () => {
  const boxes = () => screen.getAllByRole("spinbutton") as HTMLInputElement[];

  it("rounds every value for display", () => {
    render(<PositionFields element={element()} onUpdate={vi.fn()} />);
    expect(boxes().map((b) => b.value)).toEqual(["10", "21", "300", "101", "45"]);
  });

  it.each([
    [0, "x"],
    [1, "y"],
    [2, "width"],
    [3, "height"],
    [4, "rotation"],
  ])("reports field %i as %s", (index, key) => {
    const onUpdate = vi.fn();
    render(<PositionFields element={element()} onUpdate={onUpdate} />);

    fireEvent.change(boxes()[index], { target: { value: "42" } });

    expect(onUpdate).toHaveBeenCalledWith({ [key]: 42 });
  });
});

describe("ImagePanFields", () => {
  type MediaEl = Extract<Element, { type: "image" | "video" }>;
  const media = (over: Partial<MediaEl> = {}) =>
    element({ type: "image", src: "a.png", ...over } as Partial<Element>) as MediaEl;

  it("lists every Ken Burns option", () => {
    render(<ImagePanFields element={media()} onUpdate={vi.fn()} />);
    expect(screen.getAllByRole("option")).toHaveLength(7);
  });

  it("shows no intensity slider while the effect is off", () => {
    render(<ImagePanFields element={media()} onUpdate={vi.fn()} />);
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("turns the effect on with a default intensity", () => {
    const onUpdate = vi.fn();
    render(<ImagePanFields element={media()} onUpdate={onUpdate} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zoomIn" } });

    expect(onUpdate).toHaveBeenCalledWith({
      image_pan: { pan_type: "zoomIn", intensity: 0.5 },
    });
  });

  it("keeps the current intensity when switching effect", () => {
    const onUpdate = vi.fn();
    render(
      <ImagePanFields
        element={media({ image_pan: { pan_type: "zoomIn", intensity: 0.8 } } as Partial<MediaEl>)}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "panLeft" } });

    expect(onUpdate).toHaveBeenCalledWith({
      image_pan: { pan_type: "panLeft", intensity: 0.8 },
    });
  });

  it("clears the effect when set back to none", () => {
    const onUpdate = vi.fn();
    render(
      <ImagePanFields
        element={media({ image_pan: { pan_type: "zoomIn", intensity: 0.5 } } as Partial<MediaEl>)}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });

    expect(onUpdate).toHaveBeenCalledWith({ image_pan: null });
  });

  it("reports a new intensity", () => {
    const onUpdate = vi.fn();
    render(
      <ImagePanFields
        element={media({ image_pan: { pan_type: "zoomIn", intensity: 0.5 } } as Partial<MediaEl>)}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.75" } });

    expect(onUpdate).toHaveBeenCalledWith({
      image_pan: { pan_type: "zoomIn", intensity: 0.75 },
    });
  });
});

describe("LayersPanel", () => {
  const layers: Element[] = [
    element({ id: "a", name: "bottom" }),
    element({ id: "b", name: "middle", type: "image", src: "x.png" } as Partial<Element>),
    element({ id: "c", name: "top", type: "shape" } as Partial<Element>),
  ];

  function setup(selectedIds: string[] = []) {
    const onSelectLayer = vi.fn();
    const onReorderLayer = vi.fn();
    const onDeleteLayer = vi.fn();
    const view = render(
      <LayersPanel
        elements={layers}
        selectedIds={selectedIds}
        onSelectLayer={onSelectLayer}
        onReorderLayer={onReorderLayer}
        onDeleteLayer={onDeleteLayer}
      />,
    );
    return { onSelectLayer, onReorderLayer, onDeleteLayer, ...view };
  }

  it("renders nothing without layers", () => {
    const { container } = render(
      <LayersPanel
        elements={[]}
        selectedIds={[]}
        onSelectLayer={vi.fn()}
        onReorderLayer={vi.fn()}
        onDeleteLayer={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the topmost layer first", () => {
    const { container } = setup();
    expect([...container.querySelectorAll(".layers-row-name")].map((n) => n.textContent)).toEqual([
      "top",
      "middle",
      "bottom",
    ]);
  });

  it("marks the selected layers", () => {
    const { container } = setup(["b"]);
    expect(container.querySelectorAll(".layers-row.selected")).toHaveLength(1);
  });

  it("selects a layer on click", () => {
    const { onSelectLayer } = setup();

    fireEvent.click(screen.getByText("middle"));

    expect(onSelectLayer).toHaveBeenCalledWith("b", false);
  });

  it.each(["shiftKey", "metaKey", "ctrlKey"])("treats %s as an additive click", (modifier) => {
    const { onSelectLayer } = setup();

    fireEvent.click(screen.getByText("middle"), { [modifier]: true });

    expect(onSelectLayer).toHaveBeenCalledWith("b", true);
  });

  it("deletes a layer without selecting it", () => {
    const { onDeleteLayer, onSelectLayer, container } = setup();

    fireEvent.click(container.querySelectorAll(".layers-row-delete")[0]);

    expect(onDeleteLayer).toHaveBeenCalledWith("c");
    expect(onSelectLayer).not.toHaveBeenCalled();
  });

  it("reorders a layer on drop, using the z-order index", () => {
    const { onReorderLayer, container } = setup();
    const rows = container.querySelectorAll(".layers-row");
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "a"),
    };

    fireEvent.dragStart(rows[0], { dataTransfer });
    fireEvent.dragOver(rows[2], { dataTransfer });
    fireEvent.drop(rows[2], { dataTransfer });

    // The last row on screen is the bottom layer, index 0.
    expect(onReorderLayer).toHaveBeenCalledWith("a", 0);
  });

  it("ignores a drop carrying no layer id", () => {
    const { onReorderLayer, container } = setup();
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => "") };

    fireEvent.drop(container.querySelectorAll(".layers-row")[0], { dataTransfer });

    expect(onReorderLayer).not.toHaveBeenCalled();
  });
});
