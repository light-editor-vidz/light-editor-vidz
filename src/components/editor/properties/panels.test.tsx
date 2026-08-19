import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AudioProperties } from "./AudioProperties";
import { TextProperties } from "./TextProperties";
import { MediaProperties } from "./MediaProperties";
import { ShapeProperties } from "./ShapeProperties";
import { MultiSelectionProperties } from "./MultiSelectionProperties";
import type { AudioTrack } from "../../../bindings/AudioTrack";
import type { Element } from "../../../bindings/Element";

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

const element = (over: Partial<Element> = {}): Element =>
  ({
    id: "e1",
    name: "el",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    // Every element carries an animation list; the panels map over it unguarded.
    animations: [],
    ...over,
  }) as Element;

/** The first input inside the nearest ancestor of `label` that contains one. */
function inputUnder(label: string): HTMLInputElement {
  let node: HTMLElement | null = screen.getByText(label);
  while (node) {
    const input = node.querySelector("input");
    if (input) return input as HTMLInputElement;
    node = node.parentElement;
  }
  throw new Error(`no input under "${label}"`);
}

/** The colour swatch buttons rendered by a `ColorPickerField` inside `label`'s section. */
function swatchesUnder(label: string): HTMLButtonElement[] {
  return [...sectionOf(label).querySelectorAll(".properties-swatch")] as HTMLButtonElement[];
}

/** The blend-mode dropdown (one per panel). */
function blendModeSelect(): HTMLSelectElement {
  return sectionOf("Blend mode").querySelector("select") as HTMLSelectElement;
}

/** The `.properties-section` block that owns `label`. */
function sectionOf(label: string): HTMLElement {
  const section = screen.getByText(label).closest(".properties-section");
  if (!section) throw new Error(`"${label}" is not inside a properties section`);
  return section as HTMLElement;
}

/** Inputs of the given type inside `label`'s own section (no climbing past it). */
function inputsOfType(label: string, type: string): HTMLInputElement[] {
  return [...sectionOf(label).querySelectorAll(`input[type=${type}]`)] as HTMLInputElement[];
}

/** The last input of the given type in `label`'s section — colour pickers contribute
 * their own inputs first, so the control being tested is the trailing one. */
function inputOfType(label: string, type: string): HTMLInputElement {
  const found = inputsOfType(label, type);
  if (found.length === 0) {
    throw new Error(`no ${type} input under "${label}"`);
  }
  return found[found.length - 1];
}

/** The first button inside the nearest ancestor of `label` that contains one. */
function buttonsUnder(label: string): HTMLButtonElement[] {
  let node: HTMLElement | null = screen.getByText(label);
  while (node) {
    const buttons = node.querySelectorAll("button");
    if (buttons.length) return [...buttons] as HTMLButtonElement[];
    node = node.parentElement;
  }
  throw new Error(`no button under "${label}"`);
}

describe("AudioProperties", () => {
  function setup(over: Partial<AudioTrack> = {}) {
    const onUpdate = vi.fn();
    render(<AudioProperties track={track(over)} onUpdate={onUpdate} />);
    return { onUpdate };
  }

  it("shows the track name", () => {
    setup();
    expect(screen.getByDisplayValue("music")).toBeInTheDocument();
  });

  it("renames the track", () => {
    const { onUpdate } = setup();

    fireEvent.change(screen.getByDisplayValue("music"), { target: { value: "intro" } });

    expect(onUpdate).toHaveBeenCalledWith({ name: "intro" });
  });

  it("toggles solo and mute", () => {
    const { onUpdate } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Solo" }));
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));

    expect(onUpdate).toHaveBeenCalledWith({ solo: true });
    expect(onUpdate).toHaveBeenCalledWith({ muted: true });
  });

  it("labels the mute button as muted once the track is silent", () => {
    setup({ muted: true });
    expect(screen.getByRole("button", { name: "Muted" })).toBeInTheDocument();
  });

  it("changes the volume", () => {
    const { onUpdate } = setup();

    fireEvent.change(inputUnder("Volume"), { target: { value: "0.5" } });

    expect(onUpdate).toHaveBeenCalledWith({ volume: 0.5 });
  });

  it("changes the fades", () => {
    const { onUpdate } = setup();

    fireEvent.change(inputUnder("Fade in (s)"), { target: { value: "2" } });
    fireEvent.change(inputUnder("Fade out (s)"), { target: { value: "3" } });

    expect(onUpdate).toHaveBeenCalledWith({ fade_in: 2 });
    expect(onUpdate).toHaveBeenCalledWith({ fade_out: 3 });
  });

  it("never lets the source in-point go negative", () => {
    const { onUpdate } = setup();

    fireEvent.change(inputUnder("Source in-point (s)"), { target: { value: "-5" } });

    expect(onUpdate).toHaveBeenCalledWith({ audio_offset: 0 });
  });
});

describe("TextProperties", () => {
  const text = (over: Partial<Element> = {}) =>
    element({
      type: "text",
      content: "Hello",
      color: "rgba(255,255,255,1)",
      alignment: "center",
      vertical_alignment: "center",
      font_size: 5,
      ...over,
    } as Partial<Element>) as Extract<Element, { type: "text" }>;

  function setup(over: Partial<Element> = {}) {
    const onUpdate = vi.fn();
    render(<TextProperties element={text(over)} onUpdate={onUpdate} />);
    return { onUpdate };
  }

  it("shows the text properties header", () => {
    setup();
    expect(screen.getByText("Text properties")).toBeInTheDocument();
  });

  it("edits the content", () => {
    const { onUpdate } = setup();

    fireEvent.change(screen.getByDisplayValue("Hello"), { target: { value: "Bonjour" } });

    expect(onUpdate).toHaveBeenCalledWith({ content: "Bonjour" });
  });

  it("changes the font size", () => {
    const { onUpdate } = setup();

    fireEvent.change(inputUnder("Font"), { target: { value: "Inter" } });

    expect(onUpdate).toHaveBeenCalledWith({ font_family: "Inter" });
  });

  it("switches the font size between auto and fixed", () => {
    const { onUpdate } = setup({ font_size: 5 } as Partial<Element>);

    fireEvent.click(screen.getByRole("button", { name: "Auto" }));

    expect(onUpdate).toHaveBeenCalledWith({ font_size: null });
  });

  it("gives an auto size a concrete value when switched back", () => {
    const { onUpdate } = setup({ font_size: null } as Partial<Element>);

    fireEvent.click(screen.getByRole("button", { name: "Auto" }));

    expect(onUpdate).toHaveBeenCalledWith({ font_size: 5 });
  });

  it("toggles bold and italic", () => {
    const { onUpdate } = setup({ font_weight: "normal", font_style: "normal" } as Partial<Element>);
    const buttons = screen.getAllByRole("button");

    fireEvent.click(buttons.find((b) => b.textContent === "B") ?? buttons[1]);
    fireEvent.click(buttons.find((b) => b.textContent === "I") ?? buttons[2]);

    expect(onUpdate).toHaveBeenCalledWith({ font_weight: "bold" });
    expect(onUpdate).toHaveBeenCalledWith({ font_style: "italic" });
  });

  it("changes the horizontal alignment", () => {
    const { onUpdate } = setup();
    fireEvent.click(buttonsUnder("Alignment")[0]);

    expect(onUpdate).toHaveBeenCalledWith({ alignment: "left" });
  });

  it("changes the vertical alignment", () => {
    const { onUpdate } = setup();
    fireEvent.click(buttonsUnder("Vertical alignment")[0]);

    expect(onUpdate).toHaveBeenCalledWith({ vertical_alignment: "top" });
  });

  it("changes the colour", () => {
    const { onUpdate } = setup();
    const row = screen.getByText("Color").parentElement!;

    fireEvent.click(row.querySelectorAll(".properties-swatch")[1]);

    expect(onUpdate).toHaveBeenCalled();
  });
  it("switches the font size between auto and a fixed value", () => {
    const { onUpdate } = setup({ font_size: 5 } as Partial<Element>);

    fireEvent.click(screen.getByTitle(/Auto-fit font size/));

    expect(onUpdate).toHaveBeenCalledWith({ font_size: null });
  });

  it("comes back to a fixed size from auto", () => {
    const { onUpdate } = setup({ font_size: null } as Partial<Element>);

    fireEvent.click(screen.getByTitle(/Auto-fit font size/));

    expect(onUpdate).toHaveBeenCalledWith({ font_size: 5 });
  });

  it("disables the size field while auto is on", () => {
    setup({ font_size: null } as Partial<Element>);

    expect(inputOfType("Font", "number")).toBeDisabled();
  });

  it("changes the letter spacing", () => {
    const { onUpdate } = setup({ letter_spacing: null } as Partial<Element>);

    fireEvent.change(inputOfType("Letter spacing", "number"), { target: { value: "1.5" } });

    expect(onUpdate).toHaveBeenCalledWith({ letter_spacing: 1.5 });
  });

  it("changes the line height", () => {
    const { onUpdate } = setup({ line_height: null } as Partial<Element>);

    fireEvent.change(inputOfType("Line height", "number"), { target: { value: "1.4" } });

    expect(onUpdate).toHaveBeenCalledWith({ line_height: 1.4 });
  });

  it("shows the defaults when spacing and line height are unset", () => {
    setup({ letter_spacing: null, line_height: null } as Partial<Element>);

    expect(inputOfType("Letter spacing", "number")).toHaveValue(0);
    expect(inputOfType("Line height", "number")).toHaveValue(1);
  });

  it("turns a text shadow on and off", () => {
    const { onUpdate } = setup({ text_shadow: null } as Partial<Element>);

    fireEvent.click(buttonsUnder("Text shadow")[0]);
    expect(onUpdate).toHaveBeenCalledWith({ text_shadow: "rgba(0,0,0,0.6)" });
  });

  it("removes an existing text shadow", () => {
    const { onUpdate } = setup({ text_shadow: "rgba(0,0,0,0.6)" } as Partial<Element>);

    fireEvent.click(buttonsUnder("Text shadow")[0]);

    expect(onUpdate).toHaveBeenCalledWith({ text_shadow: null });
  });

  it("changes the font size", () => {
    const { onUpdate } = setup({ font_size: 5 } as Partial<Element>);

    fireEvent.change(inputOfType("Font", "number"), { target: { value: "8.5" } });

    expect(onUpdate).toHaveBeenCalledWith({ font_size: 8.5 });
  });

  it("picks a background colour from the swatches", () => {
    const { onUpdate } = setup({ background_color: "rgba(0,0,0,0.35)" } as Partial<Element>);

    fireEvent.click(swatchesUnder("Background color")[0]);

    expect(onUpdate).toHaveBeenCalledWith({ background_color: "rgba(255,255,255,1)" });
  });

  it("picks a text shadow colour once the shadow is on", () => {
    const { onUpdate } = setup({ text_shadow: "rgba(0,0,0,0.6)" } as Partial<Element>);

    fireEvent.click(swatchesUnder("Text shadow")[1]);

    expect(onUpdate).toHaveBeenCalledWith({ text_shadow: "rgba(15,15,21,1)" });
  });

  it("changes the blend mode", () => {
    const { onUpdate } = setup({ blend_mode: null } as Partial<Element>);

    fireEvent.change(blendModeSelect(), { target: { value: "multiply" } });

    expect(onUpdate).toHaveBeenCalledWith({ blend_mode: "multiply" });
  });

  it("clears the blend mode back to normal", () => {
    const { onUpdate } = setup({ blend_mode: "screen" } as Partial<Element>);

    fireEvent.change(blendModeSelect(), { target: { value: "normal" } });

    expect(onUpdate).toHaveBeenCalledWith({ blend_mode: null });
  });

  it("toggles underline and strikethrough independently", () => {
    const { onUpdate } = setup({ underline: false, strikethrough: true } as Partial<Element>);
    const [underline, strike] = buttonsUnder("Decoration");

    fireEvent.click(underline);
    expect(onUpdate).toHaveBeenCalledWith({ underline: true });

    fireEvent.click(strike);
    expect(onUpdate).toHaveBeenCalledWith({ strikethrough: false });
  });
});

describe("MediaProperties", () => {
  const image = (over: Partial<Element> = {}) =>
    element({ type: "image", src: "a.png", fit_mode: "contain", ...over } as Partial<Element>);
  const video = (over: Partial<Element> = {}) =>
    element({
      type: "video",
      src: "a.mp4",
      fit_mode: "contain",
      video_offset: 0,
      duration: 10,
      volume: 1,
      muted: false,
      ...over,
    } as Partial<Element>);

  function setup(el: Element) {
    const onUpdate = vi.fn();
    render(
      <MediaProperties
        element={el as Extract<Element, { type: "image" | "video" }>}
        onUpdate={onUpdate}
        activeDuration={30}
      />,
    );
    return { onUpdate };
  }

  it("titles itself after the media type", () => {
    setup(image());
    expect(screen.getByText("Image properties")).toBeInTheDocument();
  });

  it("titles a video accordingly", () => {
    setup(video());
    expect(screen.getByText("Video properties")).toBeInTheDocument();
  });

  it("changes the fit mode", () => {
    const { onUpdate } = setup(image());

    // The Ken Burns picker is a second combobox, so scope to the Fit row.
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "cover" } });

    expect(onUpdate).toHaveBeenCalledWith({ fit_mode: "cover" });
  });

  it("offers no sound controls for an image", () => {
    setup(image());
    expect(screen.queryByText("Volume")).not.toBeInTheDocument();
  });

  it("mutes and unmutes a video", () => {
    const { onUpdate } = setup(video());

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));

    expect(onUpdate).toHaveBeenCalledWith({ muted: true });
  });

  it("changes the video volume", () => {
    const { onUpdate } = setup(video());

    fireEvent.change(inputUnder("Volume"), { target: { value: "0.4" } });

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ volume: 0.4 }));
  });

  it("disables the volume slider once muted", () => {
    setup(video({ muted: true } as Partial<Element>));

    expect(inputUnder("Volume")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Muted" })).toBeInTheDocument();
  });

  it("offers no trim range for an image", () => {
    setup(image());
    expect(screen.queryByText("Trim range (s)")).not.toBeInTheDocument();
  });

  it("shows the trim range as source-time in and out points", () => {
    // offset 2 s, 30 s actives à vitesse 2 → sortie à 2 + 60 = 62 s dans la source.
    setup(video({ video_offset: 2, playback_speed: 2 } as Partial<Element>));

    expect(inputUnder("In")).toHaveValue(2);
    expect(inputUnder("Out")).toHaveValue(62);
  });

  it("moving the in point keeps the out point where it was", () => {
    const { onUpdate } = setup(video({ video_offset: 2, playback_speed: 1 } as Partial<Element>));

    // Sortie actuelle : 2 + 30 = 32. En avançant l'entrée à 5, la durée compense.
    fireEvent.change(inputUnder("In"), { target: { value: "5" } });

    expect(onUpdate).toHaveBeenCalledWith({ video_offset: 5, duration: 27 });
  });

  it("refuses a negative in point", () => {
    const { onUpdate } = setup(video({ video_offset: 2, playback_speed: 1 } as Partial<Element>));

    fireEvent.change(inputUnder("In"), { target: { value: "-5" } });

    expect(onUpdate).toHaveBeenCalledWith({ video_offset: 0, duration: 32 });
  });

  it("moving the out point only changes the duration", () => {
    const { onUpdate } = setup(video({ video_offset: 2, playback_speed: 1 } as Partial<Element>));

    fireEvent.change(inputUnder("Out"), { target: { value: "12" } });

    expect(onUpdate).toHaveBeenCalledWith({ duration: 10 });
  });

  it("keeps a sliver of clip when the out point is dragged past the in point", () => {
    const { onUpdate } = setup(video({ video_offset: 10, playback_speed: 1 } as Partial<Element>));

    fireEvent.change(inputUnder("Out"), { target: { value: "0" } });

    expect(onUpdate).toHaveBeenCalledWith({ duration: 0.1 });
  });

  it("accounts for the playback speed when trimming", () => {
    const { onUpdate } = setup(video({ video_offset: 0, playback_speed: 2 } as Partial<Element>));

    // 20 s de source à vitesse 2 = 10 s sur la timeline.
    fireEvent.change(inputUnder("Out"), { target: { value: "20" } });

    expect(onUpdate).toHaveBeenCalledWith({ duration: 10 });
  });

  it("changes the playback speed", () => {
    const { onUpdate } = setup(video({ playback_speed: 1 } as Partial<Element>));

    fireEvent.change(inputUnder("Playback speed"), { target: { value: "1.5" } });

    expect(onUpdate).toHaveBeenCalledWith({ playback_speed: 1.5 });
  });

  it("switches what happens at the end of the clip", () => {
    const { onUpdate } = setup(video({ loop_video: false } as Partial<Element>));

    fireEvent.change(screen.getByDisplayValue("Freeze on last frame"), { target: { value: "loop" } });

    expect(onUpdate).toHaveBeenCalledWith({ loop_video: true });
  });

  it("shows the looping choice when it is already on", () => {
    setup(video({ loop_video: true } as Partial<Element>));

    expect(screen.getByDisplayValue("Loop")).toBeInTheDocument();
  });

  it("changes the corner radius", () => {
    const { onUpdate } = setup(image());

    fireEvent.change(inputOfType("Corner radius", "range"), { target: { value: "12" } });

    expect(onUpdate).toHaveBeenCalledWith({ corner_radius: 12 });
  });

  it("adds a border with sensible defaults", () => {
    const { onUpdate } = setup(image({ border_color: null } as Partial<Element>));

    fireEvent.click(buttonsUnder("Border")[0]);

    expect(onUpdate).toHaveBeenCalledWith({ border_color: "rgba(255,255,255,1)", border_width: 2 });
  });

  it("removes the border colour and width together", () => {
    const { onUpdate } = setup(image({ border_color: "rgba(1,2,3,1)", border_width: 4 } as Partial<Element>));

    fireEvent.click(buttonsUnder("Border")[0]);

    expect(onUpdate).toHaveBeenCalledWith({ border_color: null, border_width: null });
  });

  it("changes the border width once a border exists", () => {
    const { onUpdate } = setup(image({ border_color: "rgba(1,2,3,1)", border_width: 2 } as Partial<Element>));

    fireEvent.change(inputOfType("Border", "number"), { target: { value: "5" } });

    expect(onUpdate).toHaveBeenCalledWith({ border_width: 5 });
  });

  it("picks a background colour", () => {
    const { onUpdate } = setup(image({ background_color: "rgba(0,0,0,1)" } as Partial<Element>));

    fireEvent.click(swatchesUnder("Background color")[2]);

    expect(onUpdate).toHaveBeenCalledWith({ background_color: "rgba(92,134,255,1)" });
  });

  it("picks a border colour once a border exists", () => {
    const { onUpdate } = setup(image({ border_color: "rgba(255,255,255,1)", border_width: 2 } as Partial<Element>));

    fireEvent.click(swatchesUnder("Border")[1]);

    expect(onUpdate).toHaveBeenCalledWith({ border_color: "rgba(15,15,21,1)" });
  });

  it("changes the blend mode", () => {
    const { onUpdate } = setup(image({ blend_mode: null } as Partial<Element>));

    fireEvent.change(blendModeSelect(), { target: { value: "overlay" } });

    expect(onUpdate).toHaveBeenCalledWith({ blend_mode: "overlay" });
  });

  it("hides the border width until a border exists", () => {
    setup(image({ border_color: null } as Partial<Element>));

    // Sans bordure, aucun champ de largeur n'est proposé.
    expect(inputsOfType("Border", "number")).toHaveLength(0);
  });
});

describe("ShapeProperties", () => {
  const shape = (over: Partial<Element> = {}) =>
    element({
      type: "shape",
      shape_type: "rectangle",
      fill: "rgba(255,255,255,1)",
      stroke: "none",
      stroke_width: 2,
      ...over,
    } as Partial<Element>) as Extract<Element, { type: "shape" }>;

  function setup(over: Partial<Element> = {}) {
    const onUpdate = vi.fn();
    render(<ShapeProperties element={shape(over)} onUpdate={onUpdate} />);
    return { onUpdate };
  }

  it("shows the shape header and type", () => {
    setup();
    expect(screen.getByText("Shape properties")).toBeInTheDocument();
    expect(screen.getByText("Shape type")).toBeInTheDocument();
  });

  it("changes the shape type", () => {
    const { onUpdate } = setup();
    fireEvent.click(buttonsUnder("Shape type")[1]);

    expect(onUpdate).toHaveBeenCalled();
  });

  it("turns a gradient on and off", () => {
    const { onUpdate } = setup();

    fireEvent.click(screen.getByRole("button", { name: "None" }));

    expect(onUpdate).toHaveBeenCalled();
  });

  it("shows the corner radius only for a rectangle", () => {
    setup({ shape_type: "rectangle" } as Partial<Element>);
    expect(screen.getByText("Corner radius")).toBeInTheDocument();
  });

  it("hides the corner radius for an ellipse", () => {
    setup({ shape_type: "ellipse" } as Partial<Element>);
    expect(screen.queryByText("Corner radius")).not.toBeInTheDocument();
  });

  it("offers every shape type", () => {
    setup();

    const select = screen.getByDisplayValue("Rectangle");
    expect(select.querySelectorAll("option")).toHaveLength(6);
  });

  it("switches to another shape type", () => {
    const { onUpdate } = setup();

    fireEvent.change(screen.getByDisplayValue("Rectangle"), { target: { value: "star" } });

    expect(onUpdate).toHaveBeenCalledWith({ shape_type: "star" });
  });

  it("changes the stroke width", () => {
    const { onUpdate } = setup();

    fireEvent.change(inputUnder("Stroke"), { target: { value: "6" } });

    expect(onUpdate).toHaveBeenCalledWith({ stroke_width: 6 });
  });

  it("turns the stroke on", () => {
    const { onUpdate } = setup({ stroke: "none" } as Partial<Element>);

    fireEvent.click(buttonsUnder("Stroke")[0]);

    expect(onUpdate).toHaveBeenCalledWith({ stroke: "rgba(255,255,255,1)" });
  });

  it("turns the stroke off", () => {
    const { onUpdate } = setup({ stroke: "rgba(1,2,3,1)" } as Partial<Element>);

    fireEvent.click(buttonsUnder("Stroke")[0]);

    expect(onUpdate).toHaveBeenCalledWith({ stroke: "none" });
  });

  it("turns a dashed stroke on and off", () => {
    const { onUpdate } = setup({ stroke_dash: null } as Partial<Element>);

    fireEvent.click(screen.getByTitle("Dashed stroke"));
    expect(onUpdate).toHaveBeenCalledWith({ stroke_dash: 6 });

    onUpdate.mockClear();
    render(<ShapeProperties element={shape({ stroke_dash: 6 } as Partial<Element>)} onUpdate={onUpdate} />);
    fireEvent.click(screen.getAllByTitle("Dashed stroke")[1]);
    expect(onUpdate).toHaveBeenCalledWith({ stroke_dash: null });
  });

  it("changes the dash length once dashing is on", () => {
    const { onUpdate } = setup({ stroke_dash: 6 } as Partial<Element>);

    fireEvent.change(inputOfType("Stroke", "range"), { target: { value: "12" } });

    expect(onUpdate).toHaveBeenCalledWith({ stroke_dash: 12 });
  });

  it("changes the corner radius of a rectangle", () => {
    const { onUpdate } = setup({ shape_type: "rectangle", border_radius: 0 } as Partial<Element>);

    fireEvent.change(inputOfType("Corner radius", "range"), { target: { value: "20" } });

    expect(onUpdate).toHaveBeenCalledWith({ border_radius: 20 });
  });

  it("adds a gradient with a default colour and angle", () => {
    const { onUpdate } = setup({ gradient_to: null } as Partial<Element>);

    fireEvent.click(buttonsUnder("Gradient")[0]);

    expect(onUpdate).toHaveBeenCalledWith({ gradient_to: "rgba(255,255,255,1)", gradient_angle: 0 });
  });

  it("removes the gradient colour and angle together", () => {
    const { onUpdate } = setup({ gradient_to: "rgba(1,2,3,1)", gradient_angle: 45 } as Partial<Element>);

    fireEvent.click(buttonsUnder("Gradient")[0]);

    expect(onUpdate).toHaveBeenCalledWith({ gradient_to: null, gradient_angle: null });
  });

  it("picks a stroke colour once the stroke is on", () => {
    const { onUpdate } = setup({ stroke: "rgba(255,255,255,1)" } as Partial<Element>);

    fireEvent.click(swatchesUnder("Stroke")[3]);

    expect(onUpdate).toHaveBeenCalledWith({ stroke: "rgba(164,92,255,1)" });
  });

  it("picks a gradient colour once the gradient is on", () => {
    const { onUpdate } = setup({
      gradient_to: "rgba(255,255,255,1)",
      gradient_angle: 0,
    } as Partial<Element>);

    fireEvent.click(swatchesUnder("Gradient")[4]);

    expect(onUpdate).toHaveBeenCalledWith({ gradient_to: "rgba(56,209,122,1)" });
  });

  it("changes the blend mode", () => {
    const { onUpdate } = setup({ blend_mode: null } as Partial<Element>);

    fireEvent.change(blendModeSelect(), { target: { value: "darken" } });

    expect(onUpdate).toHaveBeenCalledWith({ blend_mode: "darken" });
  });

  it("changes the gradient angle", () => {
    const { onUpdate } = setup({
      shape_type: "ellipse",
      gradient_to: "rgba(1,2,3,1)",
      gradient_angle: 0,
    } as Partial<Element>);

    fireEvent.change(inputOfType("Gradient", "range"), { target: { value: "90" } });

    expect(onUpdate).toHaveBeenCalledWith({ gradient_angle: 90 });
  });
});

describe("MultiSelectionProperties", () => {
  function setup(count = 3) {
    const handlers = {
      onAlign: vi.fn(),
      onDistribute: vi.fn(),
      onGroup: vi.fn(),
      onUngroup: vi.fn(),
    };
    render(<MultiSelectionProperties count={count} {...handlers} />);
    return handlers;
  }

  it("says how many elements are selected", () => {
    setup(4);
    expect(screen.getByText("Align, distribute, or edit together")).toBeInTheDocument();
  });

  it.each([
    ["Align left", "left"],
    ["Align center (horizontal)", "center-h"],
    ["Align right", "right"],
    ["Align top", "top"],
    ["Align middle (vertical)", "center-v"],
    ["Align bottom", "bottom"],
  ])("%s reports the %s edge", (title, edge) => {
    const { onAlign } = setup();

    fireEvent.click(screen.getByTitle(title));

    expect(onAlign).toHaveBeenCalledWith(edge);
  });

  it.each([
    ["Distribute horizontally", "horizontal"],
    ["Distribute vertically", "vertical"],
  ])("%s reports the %s axis", (title, axis) => {
    const { onDistribute } = setup();

    fireEvent.click(screen.getByTitle(title));

    expect(onDistribute).toHaveBeenCalledWith(axis);
  });

  it("groups and ungroups", () => {
    const { onGroup, onUngroup } = setup();

    fireEvent.click(screen.getByRole("button", { name: /Group/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ungroup/ }));

    expect(onGroup).toHaveBeenCalled();
    expect(onUngroup).toHaveBeenCalled();
  });
});
