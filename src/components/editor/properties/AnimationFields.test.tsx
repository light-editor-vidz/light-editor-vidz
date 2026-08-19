import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AnimationFields,
  DEFAULT_ANIMATION,
  ANIMATION_OPTIONS,
  TEXT_ONLY_ANIMATION_OPTIONS,
  EASING_OPTIONS,
} from "./AnimationFields";
import type { Element } from "../../../bindings/Element";
import type { Animation } from "../../../bindings/Animation";

const animation = (over: Partial<Animation> = {}): Animation => ({ ...DEFAULT_ANIMATION, ...over }) as Animation;

const element = (over: Partial<Element> = {}): Element =>
  ({
    id: "e1",
    name: "el",
    type: "shape",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    animations: [],
    ...over,
  }) as Element;

function setup(over: Partial<Element> = {}) {
  const onUpdate = vi.fn();
  const view = render(<AnimationFields element={element(over)} onUpdate={onUpdate} />);
  return { onUpdate, ...view };
}

describe("AnimationFields — catalogue", () => {
  it("offers a non-empty option list", () => {
    expect(ANIMATION_OPTIONS.length).toBeGreaterThan(5);
    expect(TEXT_ONLY_ANIMATION_OPTIONS.length).toBeGreaterThan(0);
    expect(EASING_OPTIONS.length).toBeGreaterThan(3);
  });

  it("gives every option a distinct type", () => {
    const types = new Set(ANIMATION_OPTIONS.map((o) => o.type));
    expect(types.size).toBe(ANIMATION_OPTIONS.length);
  });

  it("defaults to a fading entrance", () => {
    expect(DEFAULT_ANIMATION.animation_type).toBe("fade");
    expect(DEFAULT_ANIMATION.direction).toBe("in");
    expect(DEFAULT_ANIMATION.with_fade).toBe(true);
    expect(DEFAULT_ANIMATION.duration).toBeGreaterThan(0);
  });
});

describe("AnimationFields — the list", () => {
  it("starts with nothing but an add button", () => {
    setup();
    expect(screen.getByTitle("Add animation")).toBeInTheDocument();
    expect(screen.queryByTitle("Remove animation")).not.toBeInTheDocument();
  });

  it("adds a default animation", () => {
    const { onUpdate } = setup();

    fireEvent.click(screen.getByTitle("Add animation"));

    expect(onUpdate).toHaveBeenCalledWith({ animations: [DEFAULT_ANIMATION] });
  });

  it("appends to an existing list", () => {
    const existing = animation({ animation_type: "zoom-in" });
    const { onUpdate } = setup({ animations: [existing] } as Partial<Element>);

    fireEvent.click(screen.getByTitle("Add animation"));

    expect(onUpdate).toHaveBeenCalledWith({ animations: [existing, DEFAULT_ANIMATION] });
  });

  it("renders one row per animation", () => {
    setup({ animations: [animation(), animation()] } as Partial<Element>);
    expect(screen.getAllByTitle("Remove animation")).toHaveLength(2);
  });

  it("removes the row that was clicked", () => {
    const first = animation({ animation_type: "fade" });
    const second = animation({ animation_type: "zoom-in" });
    const { onUpdate } = setup({ animations: [first, second] } as Partial<Element>);

    fireEvent.click(screen.getAllByTitle("Remove animation")[0]);

    expect(onUpdate).toHaveBeenCalledWith({ animations: [second] });
  });
});

describe("AnimationFields — editing a row", () => {
  it("changes the animation type", () => {
    const { onUpdate } = setup({ animations: [animation()] } as Partial<Element>);

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "zoom-in" } });

    expect(onUpdate).toHaveBeenCalledWith({
      animations: [expect.objectContaining({ animation_type: "zoom-in" })],
    });
  });

  it("switches between entrance and exit", () => {
    const { onUpdate } = setup({ animations: [animation({ direction: "in" })] } as Partial<Element>);

    fireEvent.click(screen.getByRole("button", { name: "Out" }));

    expect(onUpdate).toHaveBeenCalledWith({
      animations: [expect.objectContaining({ direction: "out" })],
    });
  });

  it("switches back to an entrance", () => {
    const { onUpdate } = setup({
      animations: [animation({ direction: "out" })],
    } as Partial<Element>);

    fireEvent.click(screen.getByRole("button", { name: "In" }));

    expect(onUpdate).toHaveBeenCalledWith({
      animations: [expect.objectContaining({ direction: "in" })],
    });
  });

  it("toggles the combined fade", () => {
    const { onUpdate } = setup({
      animations: [animation({ with_fade: true })],
    } as Partial<Element>);

    fireEvent.click(screen.getByTitle("Combine with fade"));

    expect(onUpdate).toHaveBeenCalledWith({
      animations: [expect.objectContaining({ with_fade: false })],
    });
  });

  it("changes the duration", () => {
    const { onUpdate } = setup({ animations: [animation()] } as Partial<Element>);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1.5" } });

    expect(onUpdate).toHaveBeenCalledWith({
      animations: [expect.objectContaining({ duration: 1.5 })],
    });
  });

  it("changes the easing", () => {
    const { onUpdate } = setup({ animations: [animation()] } as Partial<Element>);

    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "bounce" } });

    expect(onUpdate).toHaveBeenCalledWith({
      animations: [expect.objectContaining({ easing: "bounce" })],
    });
  });

  it("only edits the row that changed", () => {
    const first = animation({ animation_type: "fade" });
    const second = animation({ animation_type: "zoom-in" });
    const { onUpdate } = setup({ animations: [first, second] } as Partial<Element>);

    fireEvent.change(screen.getAllByRole("spinbutton")[1], { target: { value: "2" } });

    expect(onUpdate).toHaveBeenCalledWith({
      animations: [first, expect.objectContaining({ duration: 2 })],
    });
  });
});

describe("AnimationFields — text elements", () => {
  it("groups the reveal animations for text", () => {
    setup({ type: "text", animations: [animation()] } as Partial<Element>);

    const groups = document.querySelectorAll("optgroup");
    expect([...groups].map((g) => g.getAttribute("label"))).toEqual(["Entrance / exit", "Progressive reveal"]);
  });

  it("offers the text-only animations", () => {
    setup({ type: "text", animations: [animation()] } as Partial<Element>);
    expect(screen.getByRole("option", { name: "Typewriter" })).toBeInTheDocument();
  });

  it("hides the text-only animations for other elements", () => {
    setup({ type: "shape", animations: [animation()] } as Partial<Element>);
    expect(screen.queryByRole("option", { name: "Typewriter" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("optgroup")).toHaveLength(0);
  });
});
