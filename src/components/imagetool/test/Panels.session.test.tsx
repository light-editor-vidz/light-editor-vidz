import "./setup";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AdjustmentsPanel } from "../AdjustmentsPanel";
import { FiltersPanel } from "../FiltersPanel";
import { meta } from "./editorStub";

/**
 * Le défaut corrigé : chaque relâchement de curseur ré-appliquait sa valeur absolue par-dessus
 * l'image déjà modifiée (luminosité 20 puis 25 donnait 45). Ces tests vérifient le contrat
 * qui l'empêche : une session par section, qui remplace la dernière étape.
 */

function setup(Panel: "adjust" | "filter" = "adjust", props: { historyIndex?: number; tabId?: string } = {}) {
  let position = 0;
  const onApply = vi.fn(async () => ++position);
  const onPreview = vi.fn();
  const common = { isLoading: false, onApply, onPreview, historyIndex: 0, tabId: "t1", ...props };
  const ui = (extra: { historyIndex?: number; tabId?: string } = {}) =>
    Panel === "adjust" ? (
      <AdjustmentsPanel {...common} {...extra} />
    ) : (
      <FiltersPanel image={meta()} {...common} {...extra} />
    );
  const view = render(ui());
  return {
    onApply,
    onPreview,
    rerenderWith: (extra: Parameters<typeof ui>[0]) => view.rerender(ui(extra)),
  };
}

const section = (name: string) => userEvent.click(screen.getByRole("button", { name }));
const slider = (label: string) => screen.getByRole("slider", { name: label }) as HTMLInputElement;

function drag(label: string, value: string) {
  const el = slider(label);
  fireEvent.change(el, { target: { value } });
  fireEvent.pointerUp(el);
}

beforeEach(() => vi.clearAllMocks());

describe("slider commits", () => {
  it("does not apply when released without moving", async () => {
    const { onApply, onPreview } = setup();
    await section("Exposure");

    fireEvent.pointerUp(slider("Exposure"));

    expect(onApply).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenCalledWith(null);
  });

  it("does not apply on a mere key release such as Tab", async () => {
    const { onApply } = setup();
    await section("Exposure");

    fireEvent.keyUp(slider("Exposure"), { key: "Tab" });

    expect(onApply).not.toHaveBeenCalled();
  });

  it("applies once after the arrow keys have moved the slider", async () => {
    const { onApply } = setup();
    await section("Exposure");
    const el = slider("Exposure");

    fireEvent.change(el, { target: { value: "0.5" } });
    fireEvent.keyUp(el, { key: "ArrowRight" });
    fireEvent.keyUp(el, { key: "ArrowRight" }); // même valeur : rien de plus

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("does not apply twice for the same value", async () => {
    const { onApply } = setup();
    await section("Exposure");

    drag("Exposure", "1");
    drag("Exposure", "1");

    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
  });

  it("stops the preview when the slider comes back to its starting value", async () => {
    const { onPreview } = setup();
    await section("Exposure");

    fireEvent.change(slider("Exposure"), { target: { value: "1" } });
    expect(onPreview).toHaveBeenLastCalledWith({ type: "exposure", exposure: 1 });
    fireEvent.change(slider("Exposure"), { target: { value: "0" } });

    expect(onPreview).toHaveBeenLastCalledWith(null);
  });
});

describe("non-destructive session", () => {
  it("replaces the previous step instead of stacking when the same section is adjusted again", async () => {
    const { onApply } = setup();
    await section("Brightness / Contrast");

    drag("Brightness", "20");
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    drag("Brightness", "25");
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));

    expect(onApply).toHaveBeenNthCalledWith(1, {
      type: "brightness-contrast",
      brightness: 20,
      contrast: 0,
    });
    expect(onApply).toHaveBeenNthCalledWith(
      2,
      { type: "brightness-contrast", brightness: 25, contrast: 0 },
      { replace: true },
    );
  });

  it("carries both sliders of a section, as absolute values from the same starting image", async () => {
    const { onApply } = setup();
    await section("Brightness / Contrast");

    drag("Brightness", "20");
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    drag("Contrast", "-10");
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));

    expect(onApply).toHaveBeenLastCalledWith(
      { type: "brightness-contrast", brightness: 20, contrast: -10 },
      { replace: true },
    );
  });

  it("starts a new step, and resets the old sliders, when another section is used", async () => {
    const { onApply } = setup();
    await section("Brightness / Contrast");
    drag("Brightness", "20");
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));

    await section("Exposure");
    drag("Exposure", "1");
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));

    expect(onApply).toHaveBeenLastCalledWith({ type: "exposure", exposure: 1 });
    // Son effet fait désormais partie de l'image : le curseur de luminosité repart de zéro.
    await section("Brightness / Contrast");
    expect(slider("Brightness")).toHaveValue("0");
  });

  it("does not replace when the history moved elsewhere in the meantime", async () => {
    const { onApply, rerenderWith } = setup();
    await section("Exposure");
    drag("Exposure", "1");
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));

    rerenderWith({ historyIndex: 0 }); // annulation : l'étape a disparu
    rerenderWith({ historyIndex: 5 });

    expect(slider("Exposure")).toHaveValue("0");
    drag("Exposure", "2");
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    expect(onApply).toHaveBeenLastCalledWith({ type: "exposure", exposure: 2 });
  });

  it("resets the sliders when another tab is shown", async () => {
    const { onApply, rerenderWith } = setup();
    await section("Exposure");
    drag("Exposure", "1");
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));

    rerenderWith({ tabId: "t2" });

    expect(slider("Exposure")).toHaveValue("0");
  });

  it("keeps a slider where it was left when its section is collapsed and reopened", async () => {
    setup();
    await section("Exposure");
    fireEvent.change(slider("Exposure"), { target: { value: "1.5" } });

    await section("Exposure"); // replie
    await section("Exposure"); // rouvre

    expect(slider("Exposure")).toHaveValue("1.5");
  });

  it("queues a change made while another is in flight instead of dropping it", async () => {
    let release!: (n: number) => void;
    const onApply = vi
      .fn()
      .mockImplementationOnce(() => new Promise<number>((r) => (release = r)))
      .mockResolvedValue(2);
    render(<AdjustmentsPanel tabId="t1" isLoading={false} historyIndex={0} onApply={onApply} onPreview={vi.fn()} />);
    await section("Exposure");

    drag("Exposure", "1");
    drag("Exposure", "2");
    drag("Exposure", "3");
    await act(async () => release(1));

    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    // Seule la dernière valeur demandée est rejouée, en remplaçant la première.
    expect(onApply).toHaveBeenLastCalledWith({ type: "exposure", exposure: 3 }, { replace: true });
  });
});

describe("filters", () => {
  it("applies a preset as a step of its own, never as a replacement", async () => {
    const { onApply } = setup("filter");

    await userEvent.click(screen.getByTitle("Sépia"));
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByTitle("Invert"));
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));

    expect(onApply).toHaveBeenNthCalledWith(1, { type: "sepia", intensity: 1 });
    expect(onApply).toHaveBeenNthCalledWith(2, { type: "invert" });
  });

  it("replaces on a second drag of the same filter slider", async () => {
    const { onApply } = setup("filter");
    await section("Pixelate");

    drag("Size", "20");
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    drag("Size", "30");
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));

    expect(onApply).toHaveBeenLastCalledWith({ type: "pixelate", size: 30 }, { replace: true });
  });

  it("does not apply a filter just because its slider was clicked", async () => {
    const { onApply } = setup("filter");
    await section("Vignette");

    fireEvent.pointerUp(slider("Strength"));

    expect(onApply).not.toHaveBeenCalled();
  });

  it("previews a filter slider with the real command, not a CSS approximation", async () => {
    const { onPreview } = setup("filter");
    await section("Vignette");

    fireEvent.change(slider("Strength"), { target: { value: "0.9" } });

    expect(onPreview).toHaveBeenLastCalledWith({ type: "vignette", strength: 0.9, feather: 0.5 });
  });

  it("uses the small thumbnail, not the full image, for the preset previews", () => {
    setup("filter");

    const img = screen.getAllByRole("img")[0] as HTMLImageElement;
    expect(img.src).toContain("TTT");
  });

  it("keeps cool and warm independent", async () => {
    const { onApply } = setup("filter");
    await section("Cool / Warm");

    drag("Cool", "0.5");
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    drag("Warm", "0.5");
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));

    expect(onApply).toHaveBeenNthCalledWith(1, { type: "cool", intensity: 0.5 });
    expect(onApply).toHaveBeenNthCalledWith(2, { type: "warm", intensity: 0.5 });
  });

  it("toggling monochrome applies grain straight away", async () => {
    const { onApply } = setup("filter");
    await section("Grain");

    await userEvent.click(screen.getByRole("checkbox"));

    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply).toHaveBeenCalledWith({ type: "grain", amount: 0.3, monochrome: false });
  });
});
