import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ColorPickerField from "./ColorPickerField";

let currentContainer: HTMLElement;

function setup(value = "rgba(255,255,255,1)", presets?: string[]) {
  const onChange = vi.fn();
  const view = render(<ColorPickerField value={value} onChange={onChange} presets={presets} />);
  currentContainer = view.container;
  return { onChange, ...view };
}

/** The free-text field, picked by class: the native colour input also holds a hex value. */
const hexField = () => currentContainer.querySelector(".color-picker-hex") as HTMLInputElement;
const nativePicker = (container: HTMLElement) => container.querySelector('input[type="color"]') as HTMLInputElement;
const alphaSlider = () => screen.getByRole("slider") as HTMLInputElement;

describe("ColorPickerField — swatches", () => {
  it("renders the default presets plus the native picker", () => {
    const { container } = setup();
    expect(container.querySelectorAll(".properties-swatch")).toHaveLength(5);
    expect(nativePicker(container)).toBeInTheDocument();
  });

  it("accepts a custom preset list", () => {
    const { container } = setup("rgba(0,0,0,1)", ["rgba(1,2,3,1)", "rgba(4,5,6,1)"]);
    expect(container.querySelectorAll(".properties-swatch")).toHaveLength(2);
  });

  it("marks the preset matching the current value", () => {
    const { container } = setup("rgba(255,255,255,1)");
    expect(container.querySelectorAll(".properties-swatch.selected")).toHaveLength(1);
  });

  it("reports the preset that was clicked", () => {
    const { onChange, container } = setup();

    fireEvent.click(container.querySelectorAll(".properties-swatch")[2]);

    expect(onChange).toHaveBeenCalledWith("rgba(92,134,255,1)");
  });
});

describe("ColorPickerField — native picker", () => {
  it("shows the current colour as hex", () => {
    const { container } = setup("rgba(255,128,0,1)");
    expect(nativePicker(container)).toHaveValue("#ff8000");
  });

  it("zero-pads each channel", () => {
    const { container } = setup("rgba(1,2,3,1)");
    expect(nativePicker(container)).toHaveValue("#010203");
  });

  it("keeps the alpha when a new colour is picked", () => {
    const { onChange, container } = setup("rgba(255,255,255,0.5)");

    fireEvent.change(nativePicker(container), { target: { value: "#336699" } });

    expect(onChange).toHaveBeenCalledWith("rgba(51,102,153,0.5)");
  });
});

describe("ColorPickerField — text field", () => {
  it("accepts a six-digit hex and keeps the alpha", () => {
    const { onChange } = setup("rgba(0,0,0,0.25)");

    fireEvent.change(hexField(), { target: { value: "#ff0000" } });

    expect(onChange).toHaveBeenCalledWith("rgba(255,0,0,0.25)");
  });

  it("accepts an rgba string as typed", () => {
    const { onChange } = setup();

    fireEvent.change(hexField(), { target: { value: "rgba(1,2,3,0.5)" } });

    expect(onChange).toHaveBeenCalledWith("rgba(1,2,3,0.5)");
  });

  it("tolerates surrounding whitespace", () => {
    const { onChange } = setup();

    fireEvent.change(hexField(), { target: { value: "  #00ff00  " } });

    expect(onChange).toHaveBeenCalledWith("rgba(0,255,0,1)");
  });

  it("keeps a half-typed value on screen without reporting it", () => {
    const { onChange } = setup();

    fireEvent.change(hexField(), { target: { value: "#ff00" } });

    expect(hexField()).toHaveValue("#ff00");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adopts a value pushed in from the parent", () => {
    const { rerender } = setup("rgba(0,0,0,1)");
    fireEvent.change(hexField(), { target: { value: "half-typed" } });

    rerender(<ColorPickerField value="rgba(9,9,9,1)" onChange={vi.fn()} />);

    expect(hexField()).toHaveValue("rgba(9,9,9,1)");
  });
});

describe("ColorPickerField — alpha", () => {
  it("shows the current alpha", () => {
    setup("rgba(0,0,0,0.4)");
    expect(alphaSlider()).toHaveValue("0.4");
  });

  it("defaults the alpha to 1 for an rgb() value", () => {
    setup("rgb(10,20,30)");
    expect(alphaSlider()).toHaveValue("1");
  });

  it("reports a new alpha while keeping the colour", () => {
    const { onChange } = setup("rgba(10,20,30,1)");

    fireEvent.change(alphaSlider(), { target: { value: "0.3" } });

    expect(onChange).toHaveBeenCalledWith("rgba(10,20,30,0.3)");
  });

  it("falls back to opaque white for an unparseable value", () => {
    const { container } = setup("not a colour");
    expect(nativePicker(container)).toHaveValue("#ffffff");
    expect(alphaSlider()).toHaveValue("1");
  });
});
