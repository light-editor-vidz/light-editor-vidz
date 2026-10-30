import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CategoryRail from "./CategoryRail";
import ShapeView from "./ShapeView";
import type { ShapeElement } from "../../bindings/ShapeElement";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CategoryRail", () => {
  it("lists every category", () => {
    render(<CategoryRail active="text" onChange={vi.fn()} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Text",
      "Videos",
      "Images",
      "Audio",
      "Shapes",
    ]);
  });

  it("marks the active category", () => {
    render(<CategoryRail active="audio" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Audio" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "Text" })).not.toHaveClass("active");
  });

  it("reports the category that was picked", () => {
    const onChange = vi.fn();
    render(<CategoryRail active="text" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));

    expect(onChange).toHaveBeenCalledWith("shape");
  });
});

describe("ShapeView", () => {
  const shape = (over: Partial<ShapeElement> = {}): ShapeElement =>
    ({
      id: "s1",
      shape_type: "rectangle",
      fill: "#ff0000",
      stroke: "none",
      stroke_width: 2,
      width: 100,
      height: 100,
      ...over,
    }) as ShapeElement;

  function draw(over: Partial<ShapeElement> = {}) {
    const { container } = render(<ShapeView element={shape(over)} />);
    return container.querySelector("svg")!;
  }

  it.each([
    ["rectangle", "rect"],
    ["ellipse", "ellipse"],
    ["triangle", "polygon"],
    ["line", "line"],
    ["arrow", "polygon"],
    ["star", "polygon"],
  ])("draws a %s as an SVG %s", (shapeType, tag) => {
    const svg = draw({ shape_type: shapeType as ShapeElement["shape_type"] });
    expect(svg.querySelector(tag)).toBeTruthy();
  });

  it("fills with the flat colour when there is no gradient", () => {
    const svg = draw();
    expect(svg.querySelector("rect")).toHaveAttribute("fill", "#ff0000");
    expect(svg.querySelector("defs")).toBeNull();
  });

  it("declares a gradient and points the fill at it", () => {
    const svg = draw({ gradient_to: "#0000ff", gradient_angle: 90 });
    expect(svg.querySelector("linearGradient")).toHaveAttribute("id", "grad-s1");
    expect(svg.querySelector("rect")).toHaveAttribute("fill", "url(#grad-s1)");
  });

  it("orients the gradient from its angle", () => {
    const horizontal = draw({ gradient_to: "#00f", gradient_angle: 0 }).querySelector("linearGradient")!;
    expect(horizontal.getAttribute("x1")).toBe("0%");
    expect(horizontal.getAttribute("x2")).toBe("100%");

    const vertical = draw({ gradient_to: "#00f", gradient_angle: 90 }).querySelector("linearGradient")!;
    expect(vertical.getAttribute("y1")).toBe("0%");
    expect(vertical.getAttribute("y2")).toBe("100%");
  });

  it("treats a missing angle as zero", () => {
    const svg = draw({ gradient_to: "#00f" });
    expect(svg.querySelector("linearGradient")?.getAttribute("x1")).toBe("0%");
  });

  it("omits the stroke when it is set to none", () => {
    const svg = draw({ stroke: "none" });
    expect(svg.querySelector("rect")).not.toHaveAttribute("stroke");
  });

  it("applies the stroke and its width in model units, not stretched with the box", () => {
    const rect = draw({ stroke: "#000000", stroke_width: 4 }).querySelector("rect")!;
    expect(rect.style.stroke).toBe("rgb(0, 0, 0)");
    expect(rect.style.strokeWidth).toBe("calc(var(--u, 1px) * 4)");
    expect(rect).toHaveAttribute("vector-effect", "non-scaling-stroke");
  });

  it("turns a dash length into a dash array in model units", () => {
    const rect = draw({ stroke: "#000", stroke_dash: 5 }).querySelector("rect")!;
    expect(rect.style.strokeDasharray).toBe("calc(var(--u, 1px) * 5) calc(var(--u, 1px) * 5)");
  });

  it("keeps the corners circular on a non-square box (radius in model units)", () => {
    // Canvas 16:9, boîte carrée en % : rx/ry compensent l'étirement du viewBox.
    const rect = draw({ border_radius: 12, width: 50, height: 50 }).querySelector("rect")!;
    expect(Number(rect.getAttribute("rx"))).toBeCloseTo(2.4);
    expect(Number(rect.getAttribute("ry"))).toBeCloseTo(4.267, 2);
  });

  it("never rounds past half of the smallest side", () => {
    const rect = draw({ border_radius: 5000, width: 20, height: 20 }).querySelector("rect")!;
    expect(Number(rect.getAttribute("rx"))).toBeLessThanOrEqual(50);
    expect(Number(rect.getAttribute("ry"))).toBeLessThanOrEqual(50);
  });

  it("squares the corners when no radius is set", () => {
    expect(draw().querySelector("rect")).toHaveAttribute("rx", "0");
  });

  it("falls back to the fill colour for a line with no stroke", () => {
    const svg = draw({ shape_type: "line" as ShapeElement["shape_type"], stroke: "none" });
    expect(svg.querySelector("line")!.style.stroke).toBe("rgb(255, 0, 0)");
  });
});
