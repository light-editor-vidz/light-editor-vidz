import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import CategoryRail from "./CategoryRail";
import ShapeView from "./ShapeView";
import UpdateStatus from "./UpdateStatus";
import type { ShapeElement } from "../../bindings/ShapeElement";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

const mockCheck = vi.mocked(check);
const mockRelaunch = vi.mocked(relaunch);

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

  it("applies the stroke and its width", () => {
    const svg = draw({ stroke: "#000000", stroke_width: 4 });
    const rect = svg.querySelector("rect")!;
    expect(rect).toHaveAttribute("stroke", "#000000");
    expect(rect).toHaveAttribute("stroke-width", "4");
  });

  it("turns a dash length into a dash array", () => {
    const svg = draw({ stroke: "#000", stroke_dash: 5 });
    expect(svg.querySelector("rect")).toHaveAttribute("stroke-dasharray", "5 5");
  });

  it("rounds the rectangle corners", () => {
    expect(draw({ border_radius: 12 }).querySelector("rect")).toHaveAttribute("rx", "12");
  });

  it("squares the corners when no radius is set", () => {
    expect(draw().querySelector("rect")).toHaveAttribute("rx", "0");
  });

  it("falls back to the fill colour for a line with no stroke", () => {
    const svg = draw({ shape_type: "line" as ShapeElement["shape_type"], stroke: "none" });
    expect(svg.querySelector("line")).toHaveAttribute("stroke", "#ff0000");
  });
});

describe("UpdateStatus", () => {
  const button = () => screen.getByRole("button");

  it("offers to check for updates", () => {
    render(<UpdateStatus />);
    expect(button()).toHaveTextContent("Check for updates");
  });

  it("reports being on the latest version", async () => {
    mockCheck.mockResolvedValue(null);
    render(<UpdateStatus />);

    fireEvent.click(button());

    expect(await screen.findByText("You're on the latest version.")).toBeInTheDocument();
    expect(button()).toHaveTextContent("Check for updates");
  });

  it("downloads, shows progress and relaunches", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (e: Record<string, unknown>) => void) => {
      onEvent({ event: "Started", data: { contentLength: 200 } });
      onEvent({ event: "Progress", data: { chunkLength: 100 } });
    });
    mockCheck.mockResolvedValue({ downloadAndInstall } as never);
    render(<UpdateStatus />);

    fireEvent.click(button());

    await waitFor(() => expect(mockRelaunch).toHaveBeenCalled());
    expect(downloadAndInstall).toHaveBeenCalled();
  });

  it("leaves progress at zero when the total size is unknown", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (e: Record<string, unknown>) => void) => {
      onEvent({ event: "Started", data: {} });
      onEvent({ event: "Progress", data: { chunkLength: 50 } });
    });
    mockCheck.mockResolvedValue({ downloadAndInstall } as never);
    render(<UpdateStatus />);

    fireEvent.click(button());

    await waitFor(() => expect(mockRelaunch).toHaveBeenCalled());
  });

  it("shows the reason when the check fails", async () => {
    mockCheck.mockRejectedValue(new Error("no network"));
    render(<UpdateStatus />);

    fireEvent.click(button());

    expect(await screen.findByText(/no network/)).toBeInTheDocument();
  });

  it("blocks a second click while checking", async () => {
    mockCheck.mockImplementation(() => new Promise(() => {}));
    render(<UpdateStatus />);

    fireEvent.click(button());

    await waitFor(() => expect(button()).toBeDisabled());
    expect(button()).toHaveTextContent("Checking…");
  });
});
