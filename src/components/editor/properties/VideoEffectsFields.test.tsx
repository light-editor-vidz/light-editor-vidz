import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEffectsFields } from "./VideoEffectsFields";
import { createVideoElement } from "../../../lib/elements";
import type { Element } from "../../../bindings/Element";

type Video = Extract<Element, { type: "video" }>;
const video = (over: Partial<Video> = {}): Video => ({ ...(createVideoElement("a.mp4", "clip") as Video), ...over });

function setup(over: Partial<Video> = {}) {
  const onUpdate = vi.fn();
  render(<VideoEffectsFields element={video(over)} onUpdate={onUpdate} />);
  return { onUpdate };
}

describe("VideoEffectsFields", () => {
  it("lists the twenty colour filters, none selected by default", () => {
    setup();
    const select = screen.getByDisplayValue("None") as HTMLSelectElement;
    expect(select.options).toHaveLength(20);
    expect(select.value).toBe("none");
  });

  it("chooses a filter, and none removes it", () => {
    const { onUpdate } = setup({ color_filter: "sepia" });
    const select = screen.getByDisplayValue("Sepia");

    fireEvent.change(select, { target: { value: "invert" } });
    fireEvent.change(select, { target: { value: "none" } });

    expect(onUpdate).toHaveBeenNthCalledWith(1, { color_filter: "invert" });
    expect(onUpdate).toHaveBeenNthCalledWith(2, { color_filter: null });
  });

  it("shows the crop as percentages, the whole image by default", () => {
    setup();
    expect(screen.getByLabelText("W")).toHaveValue(100);
    expect(screen.getByLabelText("X")).toHaveValue(0);
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });

  it("changes one side of the crop, keeping it inside the image", () => {
    const { onUpdate } = setup();

    fireEvent.change(screen.getByLabelText("W"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "80" } });

    expect(onUpdate).toHaveBeenNthCalledWith(1, { crop: { x: 0, y: 0, w: 0.5, h: 1 } });
    // x = 80 % avec 100 % de largeur : ramené à 0, soit toute l'image, donc plus de recadrage.
    expect(onUpdate).toHaveBeenNthCalledWith(2, { crop: null });
  });

  it("an existing crop can be edited and reset", () => {
    const { onUpdate } = setup({ crop: { x: 0.25, y: 0, w: 0.5, h: 1 } });
    expect(screen.getByLabelText("X")).toHaveValue(25);

    fireEvent.change(screen.getByLabelText("H"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(onUpdate).toHaveBeenNthCalledWith(1, { crop: { x: 0.25, y: 0, w: 0.5, h: 0.6 } });
    expect(onUpdate).toHaveBeenNthCalledWith(2, { crop: null });
  });
});
