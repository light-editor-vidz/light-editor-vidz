import "./setup";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import * as Icons from "../components/icons";

describe("icons", () => {
  const names = Object.keys(Icons) as (keyof typeof Icons)[];

  it("exports at least 10 icons", () => {
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  it.each(names)("renders %s as an SVG element", (name) => {
    const Icon = Icons[name];
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("forwards size prop", () => {
    const { container } = render(<Icons.PlayIcon size={32} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("32");
    expect(svg.getAttribute("height")).toBe("32");
  });

  it("forwards arbitrary svg props (className)", () => {
    const { container } = render(<Icons.PlayIcon className="custom" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toBe("custom");
  });
});
