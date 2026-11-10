import "./setup";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AdjustmentsPanel } from "../AdjustmentsPanel";

const defaultProps = {
  tabId: "tab-1",
  isLoading: false,
  onApply: vi.fn().mockResolvedValue(undefined),
  onPreview: vi.fn(),
};

function renderPanel(props: Partial<typeof defaultProps> = {}) {
  const onApply = vi.fn().mockResolvedValue(undefined);
  const onPreview = vi.fn();
  const view = render(<AdjustmentsPanel {...defaultProps} onApply={onApply} onPreview={onPreview} {...props} />);
  return { onApply, onPreview, ...view };
}

/** Opens a collapsed section by its header button. */
async function openSection(title: string) {
  await userEvent.click(screen.getByRole("button", { name: title }));
}

/**
 * The range input whose own label reads `label`. Started from the sliders rather
 * than the text, because several section headers share a name with their slider.
 */
function sliderFor(label: string): HTMLInputElement {
  const sliders = screen.getAllByRole("slider") as HTMLInputElement[];
  const found = sliders.find((s) => s.parentElement?.querySelector("span")?.textContent === label);
  if (!found) throw new Error(`no slider labelled "${label}"`);
  return found;
}

/** Drags a slider to a value and releases, which is what commits it. */
function dragSlider(label: string, value: string) {
  const slider = sliderFor(label);
  fireEvent.change(slider, { target: { value } });
  fireEvent.pointerUp(slider);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdjustmentsPanel — brightness and contrast", () => {
  it("commits a brightness change", async () => {
    const { onApply } = renderPanel();
    await openSection("Brightness / Contrast");

    dragSlider("Brightness", "30");

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "brightness-contrast", brightness: 30 }));
  });

  it("commits a contrast change", async () => {
    const { onApply } = renderPanel();
    await openSection("Brightness / Contrast");

    dragSlider("Contrast", "-20");

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "brightness-contrast", contrast: -20 }));
  });

  it("commits on key release too", async () => {
    const { onApply } = renderPanel();
    await openSection("Brightness / Contrast");
    const slider = sliderFor("Brightness");

    fireEvent.change(slider, { target: { value: "10" } });
    fireEvent.keyUp(slider);

    expect(onApply).toHaveBeenCalled();
  });
});

describe("AdjustmentsPanel — the other sections", () => {
  it("commits an exposure change", async () => {
    const { onApply } = renderPanel();
    await openSection("Exposure");

    dragSlider("Exposure", "1.5");

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "exposure" }));
  });

  it.each(["Hue", "Saturation", "Lightness"])("commits a %s change", async (label) => {
    const { onApply } = renderPanel();
    await openSection("Hue / Saturation");

    dragSlider(label, "20");

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "hue-saturation" }));
  });

  it("commits a vibrance change", async () => {
    const { onApply } = renderPanel();
    await openSection("Vibrance");

    dragSlider("Vibrance", "40");

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "vibrance" }));
  });

  it.each(["In Black", "In White", "Gamma", "Out Black", "Out White"])("commits a %s change", async (label) => {
    const { onApply } = renderPanel();
    await openSection("Levels");

    dragSlider(label, "2");

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "levels" }));
  });

  it.each(["Temperature", "Tint"])("commits a %s change", async (label) => {
    const { onApply } = renderPanel();
    await openSection("White Balance");

    dragSlider(label, "15");

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "white-balance" }));
  });

  it("commits a sharpen change", async () => {
    const { onApply } = renderPanel();
    await openSection("Sharpen");

    dragSlider("Amount", "2");

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "sharpen" }));
  });

  it.each(["Radius", "Threshold"])("commits a sharpen %s change", async (label) => {
    const { onApply } = renderPanel();
    await openSection("Sharpen");

    dragSlider(label, "3");

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "sharpen" }));
  });

  it("clears the preview once brightness and contrast are back to neutral", async () => {
    const { onPreview } = renderPanel();
    await openSection("Brightness / Contrast");
    dragSlider("Brightness", "30");
    expect(onPreview).toHaveBeenCalledWith({
      type: "brightness-contrast",
      brightness: 30,
      contrast: 0,
    });

    dragSlider("Brightness", "0");

    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it("clears the preview once hue, saturation and lightness are neutral", async () => {
    const { onPreview } = renderPanel();
    await openSection("Hue / Saturation");
    dragSlider("Hue", "40");
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ type: "hue-saturation", hue: 40 }));

    dragSlider("Hue", "0");

    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it("commits a denoise change", async () => {
    const { onApply } = renderPanel();
    await openSection("Denoise");

    dragSlider("Strength", "3");

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "denoise" }));
  });

  it("keeps only one section open at a time", async () => {
    renderPanel();

    await openSection("Exposure");
    expect(screen.getAllByRole("slider")).toHaveLength(1);

    await openSection("Vibrance");
    expect(sliderFor("Vibrance")).toBeInTheDocument();
  });

  it("closes a section when its header is clicked twice", async () => {
    renderPanel();

    await openSection("Vibrance");
    expect(sliderFor("Vibrance")).toBeInTheDocument();

    await openSection("Vibrance");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("leaves the sliders live while an adjustment is running", async () => {
    // The panel never passes `disabled` to its sliders; the blocking overlay it
    // shows during a commit is what stops the user, not the inputs themselves.
    const { onApply } = renderPanel({ isLoading: true });
    await openSection("Vibrance");

    const slider = sliderFor("Vibrance");
    expect(slider).toBeEnabled();
    dragSlider("Vibrance", "20");

    expect(onApply).toHaveBeenCalled();
  });

  it("queues a second commit instead of firing it while one is in flight", async () => {
    const { onApply } = renderPanel();
    await openSection("Vibrance");

    dragSlider("Vibrance", "10");
    dragSlider("Vibrance", "20");

    // The first call is in flight, so the second is held back rather than sent.
    expect(onApply).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(onApply).toHaveBeenCalledTimes(2);
  });
});

describe("AdjustmentsPanel — curves", () => {
  async function openCurves() {
    const view = renderPanel();
    await openSection("Curves");
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 }) as DOMRect;
    return { ...view, canvas };
  }

  it("draws the curve editor", async () => {
    const { canvas } = await openCurves();
    expect(canvas).toBeInTheDocument();
  });

  it("adds a point on click and commits it on release", async () => {
    const { canvas, onApply } = await openCurves();

    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(canvas);

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "curves" }));
  });

  it("drags an existing point", async () => {
    const { canvas, onApply } = await openCurves();
    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });

    fireEvent.mouseMove(canvas, { clientX: 120, clientY: 80 });
    fireEvent.mouseUp(canvas);

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "curves" }));
  });

  it("ignores a move with no point grabbed", async () => {
    const { canvas, onApply } = await openCurves();

    fireEvent.mouseMove(canvas, { clientX: 50, clientY: 50 });

    expect(onApply).not.toHaveBeenCalled();
  });

  it("commits when the pointer leaves mid-drag", async () => {
    const { canvas, onApply } = await openCurves();
    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });

    fireEvent.mouseLeave(canvas);

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "curves" }));
  });

  it("removes a point on right-click", async () => {
    const { canvas, onApply } = await openCurves();
    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(canvas);
    // Let the first commit settle: a commit made while another is in flight is queued.
    await act(async () => {});
    onApply.mockClear();

    fireEvent.contextMenu(canvas, { clientX: 100, clientY: 100 });

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "curves", points: [] }));
  });

  it("refuse un onzième point de contrôle", async () => {
    const { canvas, onApply } = await openCurves();

    // La courbe accepte dix points de contrôle au plus.
    for (let i = 1; i <= 10; i++) {
      fireEvent.mouseDown(canvas, { clientX: i * 18, clientY: 200 - i * 18 });
      fireEvent.mouseUp(canvas);
      await act(async () => {});
    }
    const tenth = onApply.mock.calls[onApply.mock.calls.length - 1][0] as {
      points: [number, number][];
    };
    expect(tenth.points).toHaveLength(10);

    fireEvent.mouseDown(canvas, { clientX: 195, clientY: 2 });
    fireEvent.mouseUp(canvas);
    await act(async () => {});

    const last = onApply.mock.calls[onApply.mock.calls.length - 1][0] as {
      points: [number, number][];
    };
    expect(last.points).toHaveLength(10);
  });

  /** Pose une suite de points sur la courbe, en laissant chaque commit repartir. */
  async function plot(canvas: HTMLCanvasElement, points: [number, number][]) {
    for (const [x, y] of points) {
      fireEvent.mouseDown(canvas, { clientX: x, clientY: y });
      fireEvent.mouseUp(canvas);
      await act(async () => {});
    }
  }

  it("accepte un palier plat dans la courbe", async () => {
    // Deux points à la même hauteur : la pente du segment est nulle et la spline
    // doit rester plate plutôt que de diverger.
    const { canvas, onApply } = await openCurves();

    await plot(canvas, [
      [60, 100],
      [140, 100],
    ]);

    const last = onApply.mock.calls[onApply.mock.calls.length - 1][0] as {
      points: [number, number][];
    };
    expect(last.points).toHaveLength(2);
    expect(last.points[0][1]).toBeCloseTo(last.points[1][1], 5);
  });

  it("accepte une pente très raide sans déborder", async () => {
    // Deux points proches en x mais éloignés en y : la spline monotone doit brider
    // la pente au lieu de dépasser hors de [0, 1].
    const { canvas, onApply } = await openCurves();

    await plot(canvas, [
      [20, 190],
      [95, 180],
      [105, 10],
      [180, 5],
    ]);

    const last = onApply.mock.calls[onApply.mock.calls.length - 1][0] as {
      points: [number, number][];
    };
    expect(last.points).toHaveLength(4);
    expect(last.points.every(([, y]) => y >= 0 && y <= 1)).toBe(true);
  });

  it("ignores a right-click away from any point", async () => {
    const { canvas, onApply } = await openCurves();
    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(canvas);
    await act(async () => {});
    onApply.mockClear();

    fireEvent.contextMenu(canvas, { clientX: 10, clientY: 190 });

    expect(onApply).not.toHaveBeenCalled();
  });
});

describe("AdjustmentsPanel — reset", () => {
  it("clears the preview and calls back", async () => {
    const onReset = vi.fn();
    const { onPreview } = renderPanel({ onReset, canReset: true } as never);
    // The reset button only lights up once something has been changed.
    await openSection("Vibrance");
    dragSlider("Vibrance", "30");

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(onPreview).toHaveBeenCalledWith(null);
    expect(onReset).toHaveBeenCalled();
  });

  it("puts every slider back to its default", async () => {
    renderPanel({ onReset: vi.fn(), canReset: true } as never);
    await openSection("Vibrance");
    dragSlider("Vibrance", "50");

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(sliderFor("Vibrance")).toHaveValue("0");
  });

  it("clears the preview when the tab goes away", async () => {
    const { onPreview, rerender } = renderPanel();

    rerender(<AdjustmentsPanel tabId={null} isLoading={false} onApply={vi.fn()} onPreview={onPreview} />);

    expect(onPreview).toHaveBeenCalledWith(null);
  });
});
