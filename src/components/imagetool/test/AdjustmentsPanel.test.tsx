import "./setup";
import { render, screen, fireEvent } from "@testing-library/react";
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
  return render(<AdjustmentsPanel {...defaultProps} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdjustmentsPanel", () => {
  it("renders nothing when tabId is null", () => {
    const { container } = render(
      <AdjustmentsPanel tabId={null} isLoading={false} onApply={vi.fn()} onPreview={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the Adjustments header", () => {
    renderPanel();
    expect(screen.getByText("Adjustments")).toBeInTheDocument();
  });

  it("renders all 9 section titles", () => {
    renderPanel();
    [
      "Brightness / Contrast",
      "Exposure",
      "Hue / Saturation",
      "Vibrance",
      "Levels",
      "Curves",
      "White Balance",
      "Sharpen",
      "Denoise",
    ].forEach((t) => expect(screen.getByRole("button", { name: t })).toBeInTheDocument());
  });

  it("has no Apply or Reset buttons", () => {
    renderPanel();
    expect(screen.queryByText("Apply")).toBeNull();
    expect(screen.queryByText("Reset")).toBeNull();
  });

  it("all sections are collapsed by default", () => {
    renderPanel();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("clicking a section opens it", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Brightness / Contrast"));
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("clicking an open section collapses it", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Brightness / Contrast"));
    await userEvent.click(screen.getByText("Brightness / Contrast"));
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("only one section can be open at a time", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("Brightness / Contrast"));
    expect(screen.getAllByRole("slider")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Exposure" }));
    expect(screen.getAllByRole("slider")).toHaveLength(1);
  });

  it("moving a slider asks for a preview of that exact command — nothing is applied", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Exposure" }));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
    expect(defaultProps.onPreview).toHaveBeenCalledWith({ type: "exposure", exposure: 1 });
    expect(defaultProps.onApply).not.toHaveBeenCalled();
  });

  it("releasing a slider (pointerUp) triggers the Rust call", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Exposure" }));
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "1" } });
    fireEvent.pointerUp(slider, { target: { value: "1" } });
    await vi.waitFor(() => expect(defaultProps.onApply).toHaveBeenCalledTimes(1));
    expect(defaultProps.onApply).toHaveBeenCalledWith({ type: "exposure", exposure: 1 });
  });

  it("Brightness/Contrast onCommit sends both slider values", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onApply });
    await userEvent.click(screen.getByText("Brightness / Contrast"));
    const [brSlider, ctSlider] = screen.getAllByRole("slider");
    fireEvent.change(brSlider, { target: { value: "50" } });
    fireEvent.change(ctSlider, { target: { value: "-30" } });
    fireEvent.pointerUp(ctSlider, { target: { value: "-30" } });
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply).toHaveBeenCalledWith({
      type: "brightness-contrast",
      brightness: 50,
      contrast: -30,
    });
  });

  it("Levels onCommit sends all 5 parameters", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onApply });
    await userEvent.click(screen.getByText("Levels"));
    const sliders = screen.getAllByRole("slider");
    fireEvent.change(sliders[0], { target: { value: "20" } });
    fireEvent.pointerUp(sliders[0], { target: { value: "20" } });
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "levels",
        inBlack: 20,
        inWhite: 255,
        gamma: 1,
        outBlack: 0,
        outWhite: 255,
      }),
    );
  });

  it("shows loading overlay when isLoading", () => {
    renderPanel({ isLoading: true });
    // Loading pulse bar is rendered under the header
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("second commit while first is in flight is queued, not dropped", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: "Exposure" }));
    const slider = screen.getByRole("slider");

    // First commit
    fireEvent.change(slider, { target: { value: "1" } });
    fireEvent.pointerUp(slider, { target: { value: "1" } });

    // Second commit while first is still in flight
    fireEvent.change(slider, { target: { value: "2" } });
    fireEvent.pointerUp(slider, { target: { value: "2" } });

    // Resolve the first call
    resolveFn!();

    // Both should eventually be called
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    expect(onApply).toHaveBeenNthCalledWith(2, { type: "exposure", exposure: 2 });
  });
});
