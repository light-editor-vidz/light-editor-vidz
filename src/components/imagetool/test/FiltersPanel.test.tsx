import "./setup";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { FiltersPanel } from "../FiltersPanel";

const mockImage = {
  width: 100,
  height: 100,
  format: "png",
  preview: "data:image/png;base64,abc",
  thumbnail: "data:image/png;base64,TTT",
  canUndo: false,
  canRedo: false,
  historyLen: 1,
  historyIndex: 0,
};

const defaultProps = {
  tabId: "tab-1",
  image: mockImage as typeof mockImage | null,
  isLoading: false,
  onApply: vi.fn().mockResolvedValue(undefined),
  onPreview: vi.fn(),
};

function renderPanel(props: Partial<typeof defaultProps> = {}) {
  return render(<FiltersPanel {...defaultProps} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FiltersPanel", () => {
  it("renders nothing when tabId is null", () => {
    const { container } = render(
      <FiltersPanel tabId={null} image={mockImage} isLoading={false} onApply={vi.fn()} onPreview={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the Filters header", () => {
    renderPanel();
    expect(screen.getByText("Filters")).toBeInTheDocument();
  });

  it("renders all 11 preset labels", () => {
    renderPanel();
    ["B&W", "Sépia", "Invert", "Lomo", "Vintage", "Cool", "Warm", "Fade", "Drama", "Cross", "Sketch"].forEach((name) =>
      expect(screen.getAllByText(name).length).toBeGreaterThanOrEqual(1),
    );
  });

  it("renders placeholder tiles when image is null", () => {
    renderPanel({ image: null });
    // Preset labels still visible but no img elements
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("renders img thumbnails when image is provided", () => {
    renderPanel();
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(11);
  });

  it("all sections are collapsed by default", () => {
    renderPanel();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("renders all parametric section titles", () => {
    renderPanel();
    [
      "B&W Mixer",
      "Vignette",
      "Grain",
      "Pixelate",
      "Posterize",
      "Blur",
      "Cool / Warm",
      "Cross-process",
      "Duotone",
    ].forEach((title) => expect(screen.getByText(title)).toBeInTheDocument());
    // Sépia, Lomo, Vintage, Drama, Fade also appear as preset labels — at least 2 occurrences each
    ["Sépia", "Lomo", "Vintage", "Drama", "Fade"].forEach((title) =>
      expect(screen.getAllByText(title).length).toBeGreaterThanOrEqual(2),
    );
  });

  it("clicking a section opens it", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Vignette"));
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("clicking an open section collapses it", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Vignette"));
    await userEvent.click(screen.getByText("Vignette"));
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("only one section can be open at a time", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Grain"));
    await userEvent.click(screen.getByText("Pixelate"));
    // Grain collapses, only Pixelate slider visible
    expect(screen.getAllByRole("slider")).toHaveLength(1);
  });

  // ── Preset click ─────────────────────────────────────────────────────────────

  it("clicking the grayscale preset calls onApply with grayscale cmd", async () => {
    renderPanel();
    await userEvent.click(screen.getByTitle("B&W"));
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({
      type: "grayscale",
      rWeight: 0.299,
      gWeight: 0.587,
      bWeight: 0.114,
    });
  });

  it("clicking the invert preset calls onApply with invert cmd", async () => {
    renderPanel();
    await userEvent.click(screen.getByTitle("Invert"));
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "invert" });
  });

  it("clicking the sketch preset calls onApply with sketch cmd", async () => {
    renderPanel();
    await userEvent.click(screen.getByTitle("Sketch"));
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "sketch" });
  });

  // ── Grayscale mixer ───────────────────────────────────────────────────────────

  it("B&W Mixer: sliders commit with all three weights", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("B&W Mixer"));
    const [rSlider] = screen.getAllByRole("slider");
    fireEvent.change(rSlider, { target: { value: "0.5" } });
    fireEvent.pointerUp(rSlider, { target: { value: "0.5" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "grayscale",
        rWeight: 0.5,
      }),
    );
  });

  it("B&W Mixer: the green channel commits all three weights", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("B&W Mixer"));
    const [, gSlider] = screen.getAllByRole("slider");

    fireEvent.change(gSlider, { target: { value: "0.4" } });
    fireEvent.pointerUp(gSlider, { target: { value: "0.4" } });

    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "grayscale", gWeight: 0.4 }));
    expect(defaultProps.onPreview).toHaveBeenCalledWith(expect.objectContaining({ type: "grayscale", gWeight: 0.4 }));
  });

  it("B&W Mixer: the blue channel commits all three weights", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("B&W Mixer"));
    const [, , bSlider] = screen.getAllByRole("slider");

    fireEvent.change(bSlider, { target: { value: "0.2" } });
    fireEvent.pointerUp(bSlider, { target: { value: "0.2" } });

    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith(expect.objectContaining({ type: "grayscale", bWeight: 0.2 }));
  });

  it("B&W Mixer: the three weights travel together", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("B&W Mixer"));
    const [r, g, b] = screen.getAllByRole("slider");

    fireEvent.change(r, { target: { value: "0.5" } });
    fireEvent.change(g, { target: { value: "0.3" } });
    fireEvent.change(b, { target: { value: "0.2" } });
    fireEvent.pointerUp(b, { target: { value: "0.2" } });

    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({
      type: "grayscale",
      rWeight: 0.5,
      gWeight: 0.3,
      bWeight: 0.2,
    });
  });

  it("B&W Mixer: onChange asks for a real preview of the command", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("B&W Mixer"));
    const [rSlider] = screen.getAllByRole("slider");
    fireEvent.change(rSlider, { target: { value: "0.8" } });
    expect(defaultProps.onPreview).toHaveBeenCalledWith(expect.objectContaining({ type: "grayscale", rWeight: 0.8 }));
  });

  // ── Vignette ──────────────────────────────────────────────────────────────────

  it("Vignette: commit sends strength and feather", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Vignette"));
    const [strengthSlider] = screen.getAllByRole("slider");
    fireEvent.change(strengthSlider, { target: { value: "0.5" } });
    fireEvent.pointerUp(strengthSlider, { target: { value: "0.5" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "vignette",
        strength: 0.5,
      }),
    );
  });

  it("Vignette: the feather slider commits with the strength", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Vignette"));
    const [strength, feather] = screen.getAllByRole("slider");
    fireEvent.change(strength, { target: { value: "0.6" } });

    fireEvent.change(feather, { target: { value: "0.3" } });
    fireEvent.pointerUp(feather, { target: { value: "0.3" } });

    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({
      type: "vignette",
      strength: 0.6,
      feather: 0.3,
    });
  });

  // ── Grain ─────────────────────────────────────────────────────────────────────

  it("Grain: commit sends amount and monochrome", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Grain"));
    const [amountSlider] = screen.getAllByRole("slider");
    fireEvent.change(amountSlider, { target: { value: "0.6" } });
    fireEvent.pointerUp(amountSlider, { target: { value: "0.6" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "grain",
        amount: 0.6,
        monochrome: true,
      }),
    );
  });

  it("Grain: toggling monochrome checkbox triggers Rust call", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Grain"));
    const checkbox = screen.getByRole("checkbox");
    await userEvent.click(checkbox);
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "grain",
        monochrome: false,
      }),
    );
  });

  // ── Pixelate ──────────────────────────────────────────────────────────────────

  it("Pixelate: commit sends size", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Pixelate"));
    const [slider] = screen.getAllByRole("slider");
    fireEvent.change(slider, { target: { value: "20" } });
    fireEvent.pointerUp(slider, { target: { value: "20" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "pixelate", size: 20 });
  });

  // ── Posterize ─────────────────────────────────────────────────────────────────

  it("Posterize: commit sends levels", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Posterize"));
    const [slider] = screen.getAllByRole("slider");
    fireEvent.change(slider, { target: { value: "6" } });
    fireEvent.pointerUp(slider, { target: { value: "6" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "posterize", levels: 6 });
  });

  // ── Blur ──────────────────────────────────────────────────────────────────────

  it("Blur: gaussian is the default type", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Blur"));
    expect(screen.getByText("Gaussian").closest("button")).toHaveClass("bg-indigo-600");
  });

  it("Blur gaussian: commit sends blur-gaussian", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Blur"));
    const [slider] = screen.getAllByRole("slider");
    fireEvent.change(slider, { target: { value: "5" } });
    fireEvent.pointerUp(slider, { target: { value: "5" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "blur-gaussian", radius: 5 });
  });

  it("Blur: switching to motion shows angle and distance sliders", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Blur"));
    await userEvent.click(screen.getByText("Motion"));
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("Blur motion: commit sends blur-motion", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Blur"));
    await userEvent.click(screen.getByText("Motion"));
    const [angleSlider, distSlider] = screen.getAllByRole("slider");
    fireEvent.change(angleSlider, { target: { value: "45" } });
    fireEvent.change(distSlider, { target: { value: "15" } });
    fireEvent.pointerUp(distSlider, { target: { value: "15" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({
      type: "blur-motion",
      angle: 45,
      distance: 15,
    });
  });

  it("Blur: switching to radial shows strength and samples sliders", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Blur"));
    await userEvent.click(screen.getByText("Radial"));
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("Blur radial: commit sends blur-radial", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Blur"));
    await userEvent.click(screen.getByText("Radial"));
    const [strengthSlider] = screen.getAllByRole("slider");
    fireEvent.change(strengthSlider, { target: { value: "0.5" } });
    fireEvent.pointerUp(strengthSlider, { target: { value: "0.5" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "blur-radial",
        strength: 0.5,
      }),
    );
  });

  it("Blur radial: the sample count travels with the strength", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Blur"));
    await userEvent.click(screen.getByText("Radial"));
    const [strength, samples] = screen.getAllByRole("slider");
    fireEvent.change(strength, { target: { value: "0.7" } });

    fireEvent.change(samples, { target: { value: "24" } });
    fireEvent.pointerUp(samples, { target: { value: "24" } });

    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({
      type: "blur-radial",
      strength: 0.7,
      samples: 24,
    });
  });

  // ── Bonus parametric sections ─────────────────────────────────────────────────

  it("Sépia section: commit sends sepia with intensity", async () => {
    renderPanel();
    // 'Sépia' appears twice: preset label (index 0) and section title (index 1)
    await userEvent.click(screen.getAllByText("Sépia")[1]);
    const [slider] = screen.getAllByRole("slider");
    fireEvent.change(slider, { target: { value: "0.5" } });
    fireEvent.pointerUp(slider, { target: { value: "0.5" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "sepia", intensity: 0.5 });
  });

  it("Lomo section: commit sends lomo with intensity", async () => {
    renderPanel();
    await userEvent.click(screen.getAllByText("Lomo")[1]);
    const [slider] = screen.getAllByRole("slider");
    fireEvent.change(slider, { target: { value: "0.7" } });
    fireEvent.pointerUp(slider, { target: { value: "0.7" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "lomo", intensity: 0.7 });
  });

  it("Vintage section: commit sends vintage with intensity", async () => {
    renderPanel();
    await userEvent.click(screen.getAllByText("Vintage")[1]);
    const [slider] = screen.getAllByRole("slider");
    fireEvent.change(slider, { target: { value: "0.4" } });
    fireEvent.pointerUp(slider, { target: { value: "0.4" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "vintage", intensity: 0.4 });
  });

  it("Cool/Warm section: Cool slider commits cool cmd", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Cool / Warm"));
    const [coolSlider] = screen.getAllByRole("slider");
    fireEvent.change(coolSlider, { target: { value: "0.6" } });
    fireEvent.pointerUp(coolSlider, { target: { value: "0.6" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "cool", intensity: 0.6 });
  });

  it("Cool/Warm section: Warm slider commits warm cmd", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Cool / Warm"));
    const [, warmSlider] = screen.getAllByRole("slider");
    fireEvent.change(warmSlider, { target: { value: "0.8" } });
    fireEvent.pointerUp(warmSlider, { target: { value: "0.8" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "warm", intensity: 0.8 });
  });

  it("Fade section: commit sends fade with intensity", async () => {
    renderPanel();
    // 'Fade' appears twice: preset label (index 0) and section title (index 1)
    await userEvent.click(screen.getAllByText("Fade")[1]);
    const [slider] = screen.getAllByRole("slider");
    fireEvent.change(slider, { target: { value: "0.3" } });
    fireEvent.pointerUp(slider, { target: { value: "0.3" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "fade", intensity: 0.3 });
  });

  it("Drama section: commit sends drama with intensity", async () => {
    renderPanel();
    await userEvent.click(screen.getAllByText("Drama")[1]);
    const [slider] = screen.getAllByRole("slider");
    fireEvent.change(slider, { target: { value: "0.9" } });
    fireEvent.pointerUp(slider, { target: { value: "0.9" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "drama", intensity: 0.9 });
  });

  it("Cross-process section: commit sends cross-process with intensity", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Cross-process"));
    const [slider] = screen.getAllByRole("slider");
    fireEvent.change(slider, { target: { value: "0.5" } });
    fireEvent.pointerUp(slider, { target: { value: "0.5" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "cross-process", intensity: 0.5 });
  });

  // ── Duotone ───────────────────────────────────────────────────────────────────

  it("Duotone: clicking a pair calls onApply with shadow and highlight", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Duotone"));
    await userEvent.click(screen.getByText("Gold / Teal"));
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "duotone",
        shadowR: 60,
        shadowG: 20,
        shadowB: 0,
        highlightR: 200,
        highlightG: 230,
        highlightB: 120,
      }),
    );
  });

  it("Duotone: all 6 pairs are rendered", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Duotone"));
    ["Gold / Teal", "Purple / Yellow", "Cyan / Red", "Navy / Peach", "Forest / Sun", "Black / White"].forEach((name) =>
      expect(screen.getByText(name)).toBeInTheDocument(),
    );
  });

  // ── Loading state ─────────────────────────────────────────────────────────────

  it("shows loading spinner and pulse bar when isLoading", () => {
    renderPanel({ isLoading: true });
    expect(document.querySelector(".animate-spin")).toBeTruthy();
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("shows overlay when isLoading", () => {
    renderPanel({ isLoading: true });
    // Overlay div style is display:block when isLoading
    const overlay = document.querySelector('[class*="absolute"][class*="inset-0"]') as HTMLElement;
    expect(overlay).toBeTruthy();
  });

  // ── In-flight queue ───────────────────────────────────────────────────────────

  it("second commit while first is in-flight is queued", async () => {
    let resolveFn: () => void;
    const onApply = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFn = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    renderPanel({ onApply });
    await userEvent.click(screen.getAllByText("Sépia")[1]);
    const [slider] = screen.getAllByRole("slider");

    // First commit
    fireEvent.change(slider, { target: { value: "0.3" } });
    fireEvent.pointerUp(slider, { target: { value: "0.3" } });

    // Second commit while first is still in flight
    fireEvent.change(slider, { target: { value: "0.7" } });
    fireEvent.pointerUp(slider, { target: { value: "0.7" } });

    // Resolve the first
    resolveFn!();

    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    expect(onApply).toHaveBeenNthCalledWith(2, { type: "sepia", intensity: 0.7 });
  });
});
