import "./setup";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RotationControls } from "../RotationControls";

function renderControls(props: Partial<Parameters<typeof RotationControls>[0]> = {}) {
  const defaults = {
    onRotate: vi.fn(),
    isLoading: false,
  };
  return render(<RotationControls {...defaults} {...props} />);
}

describe("RotationControls", () => {
  it("CCW button calls onRotate with -90", async () => {
    const onRotate = vi.fn();
    renderControls({ onRotate });
    await userEvent.click(screen.getByRole("button", { name: /counter-clockwise/i }));
    expect(onRotate).toHaveBeenCalledWith(-90);
  });

  it("CW button calls onRotate with +90", async () => {
    const onRotate = vi.fn();
    renderControls({ onRotate });
    await userEvent.click(screen.getByRole("button", { name: /rotate 90° clockwise$/i }));
    expect(onRotate).toHaveBeenCalledWith(90);
  });

  it("Degree input and slider stay in sync", async () => {
    renderControls();
    const input = screen.getByRole("spinbutton", { name: /rotation degrees/i });
    await userEvent.clear(input);
    await userEvent.type(input, "45");
    const slider = screen.getByRole("slider", { name: /rotation angle slider/i });
    expect(slider).toHaveValue("45");
  });

  it("previews the slider live but only applies when it is released", () => {
    const onApplyAngle = vi.fn().mockResolvedValue(1);
    const onPreviewAngle = vi.fn();
    renderControls({ onApplyAngle, onPreviewAngle });
    const slider = screen.getByRole("slider", { name: /rotation angle slider/i });

    fireEvent.change(slider, { target: { value: "30" } });
    expect(onPreviewAngle).toHaveBeenLastCalledWith(30);
    expect(onApplyAngle).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider);
    expect(onApplyAngle).toHaveBeenCalledWith(30, false);
  });

  it("replaces the previous free rotation instead of stacking another one", async () => {
    const onApplyAngle = vi.fn().mockResolvedValue(1);
    renderControls({ onApplyAngle });
    const slider = screen.getByRole("slider", { name: /rotation angle slider/i });

    fireEvent.change(slider, { target: { value: "30" } });
    await act(async () => fireEvent.pointerUp(slider));
    fireEvent.change(slider, { target: { value: "45" } });
    await act(async () => fireEvent.pointerUp(slider));

    expect(onApplyAngle).toHaveBeenNthCalledWith(1, 30, false);
    expect(onApplyAngle).toHaveBeenNthCalledWith(2, 45, true);
  });

  it("applies a typed angle on Enter", async () => {
    const onApplyAngle = vi.fn().mockResolvedValue(1);
    renderControls({ onApplyAngle });
    const input = screen.getByRole("spinbutton", { name: /rotation degrees/i });

    await userEvent.clear(input);
    await userEvent.type(input, "30{Enter}");

    expect(onApplyAngle).toHaveBeenCalledWith(30, false);
  });

  it("does nothing when the angle is released where it was applied", async () => {
    const onApplyAngle = vi.fn().mockResolvedValue(1);
    renderControls({ onApplyAngle });
    fireEvent.pointerUp(screen.getByRole("slider", { name: /rotation angle slider/i }));
    expect(onApplyAngle).not.toHaveBeenCalled();
  });

  it("starts over when the history changes under it", async () => {
    const onApplyAngle = vi.fn().mockResolvedValue(1);
    const { rerender } = renderControls({ onApplyAngle, historyIndex: 0 });
    const slider = screen.getByRole("slider", { name: /rotation angle slider/i });

    fireEvent.change(slider, { target: { value: "30" } });
    await act(async () => fireEvent.pointerUp(slider));
    rerender(<RotationControls onRotate={vi.fn()} isLoading={false} historyIndex={5} />);

    expect(slider).toHaveValue("0");
  });

  it("All buttons are disabled while loading", () => {
    renderControls({ isLoading: true });
    const buttons = screen.getAllByRole("button");
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });
});
