import "./setup";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import GeometrySettings from "../components/GeometrySettings";
import { LangProvider } from "../i18n";

function makeProps(overrides = {}) {
  return {
    rotation: 0,
    straighten: 0,
    perspectiveH: 0,
    perspectiveV: 0,
    onRotationChange: vi.fn(),
    onStraightenChange: vi.fn(),
    onPerspectiveHChange: vi.fn(),
    onPerspectiveVChange: vi.fn(),
    onCommit: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
}

function r(props: ReturnType<typeof makeProps>) {
  return render(
    <LangProvider>
      <GeometrySettings {...props} />
    </LangProvider>,
  );
}

describe("GeometrySettings", () => {
  it("renders all four geometry rows", () => {
    const { container } = r(makeProps());
    expect(container.querySelectorAll(".geometry-row")).toHaveLength(4);
  });

  it("displays current rotation", () => {
    const { container } = r(makeProps({ rotation: 180 }));
    expect(container.textContent).toContain("180°");
  });

  it("rotates by +90 each click (modulo 360)", () => {
    const onRotationChange = vi.fn();
    const { container } = r(makeProps({ rotation: 270, onRotationChange }));
    const btn = container.querySelector(".rotate-control button")!;
    fireEvent.click(btn);
    expect(onRotationChange).toHaveBeenCalledWith(0); // (270+90)%360
  });

  it("rotates 0 → 90", () => {
    const onRotationChange = vi.fn();
    const { container } = r(makeProps({ rotation: 0, onRotationChange }));
    const btn = container.querySelector(".rotate-control button")!;
    fireEvent.click(btn);
    expect(onRotationChange).toHaveBeenCalledWith(90);
  });

  it("calls onStraightenChange when straighten slider moves", () => {
    const onStraightenChange = vi.fn();
    const { container } = r(makeProps({ onStraightenChange }));
    const sliders = container.querySelectorAll('input[type="range"]') as NodeListOf<HTMLInputElement>;
    fireEvent.change(sliders[0], { target: { value: "15" } });
    expect(onStraightenChange).toHaveBeenCalledWith(15);
  });

  it("calls onPerspectiveHChange when h-slider moves", () => {
    const onPerspectiveHChange = vi.fn();
    const { container } = r(makeProps({ onPerspectiveHChange }));
    const sliders = container.querySelectorAll('input[type="range"]') as NodeListOf<HTMLInputElement>;
    fireEvent.change(sliders[1], { target: { value: "-10" } });
    expect(onPerspectiveHChange).toHaveBeenCalledWith(-10);
  });

  it("calls onPerspectiveVChange when v-slider moves", () => {
    const onPerspectiveVChange = vi.fn();
    const { container } = r(makeProps({ onPerspectiveVChange }));
    const sliders = container.querySelectorAll('input[type="range"]') as NodeListOf<HTMLInputElement>;
    fireEvent.change(sliders[2], { target: { value: "20" } });
    expect(onPerspectiveVChange).toHaveBeenCalledWith(20);
  });

  it("reset button triggers onReset", () => {
    const onReset = vi.fn();
    r(makeProps({ onReset }));
    fireEvent.click(screen.getByText(/reset|réinitialiser/i));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("displays all four current values", () => {
    const { container } = r(makeProps({ rotation: 90, straighten: -5, perspectiveH: 10, perspectiveV: 15 }));
    const values = Array.from(container.querySelectorAll(".geometry-value")).map((e) => e.textContent);
    expect(values).toEqual(["90°", "-5°", "10°", "15°"]);
  });

  it("uses range bounds -45 to 45 for sliders", () => {
    const { container } = r(makeProps());
    const sliders = container.querySelectorAll('input[type="range"]');
    sliders.forEach((s) => {
      expect(s.getAttribute("min")).toBe("-45");
      expect(s.getAttribute("max")).toBe("45");
    });
  });
});
