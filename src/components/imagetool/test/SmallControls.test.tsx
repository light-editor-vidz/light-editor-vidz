import "./setup";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CropControls } from "../CropControls";
import { InpaintingControls } from "../InpaintingControls";
import i18n from "i18next";

describe("CropControls", () => {
  function setup(props: Partial<Parameters<typeof CropControls>[0]> = {}) {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <CropControls
        cropRect={{ x: 0, y: 0, width: 320, height: 200 }}
        isLoading={false}
        onApply={onApply}
        onCancel={onCancel}
        {...props}
      />,
    );
    return { onApply, onCancel };
  }

  it("applies and cancels", async () => {
    const { onApply, onCancel } = setup();

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("blocks apply for a degenerate rectangle", () => {
    setup({ cropRect: { x: 0, y: 0, width: 0, height: 200 } });
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("blocks apply for a zero-height rectangle", () => {
    setup({ cropRect: { x: 0, y: 0, width: 320, height: 0 } });
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("disables both buttons while busy", () => {
    setup({ isLoading: true });
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("honours the French locale", async () => {
    await i18n.changeLanguage("fr");
    try {
      render(
        <CropControls
          cropRect={{ x: 0, y: 0, width: 10, height: 10 }}
          isLoading={false}
          onApply={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: "Appliquer" })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("InpaintingControls", () => {
  function setup(props: Partial<Parameters<typeof InpaintingControls>[0]> = {}) {
    const handlers = {
      onBrushSizeChange: vi.fn(),
      onClear: vi.fn(),
      onCancel: vi.fn(),
      onApply: vi.fn(),
    };
    render(<InpaintingControls brushSize={40} isLoading={false} {...handlers} {...props} />);
    return handlers;
  }

  it("shows the current brush size", () => {
    setup();
    expect(screen.getByRole("slider")).toHaveValue("40");
    expect(screen.getByText("40")).toBeInTheDocument();
  });

  it("reports a new brush size as a number", () => {
    const { onBrushSizeChange } = setup();

    fireEvent.change(screen.getByRole("slider"), { target: { value: "120" } });

    expect(onBrushSizeChange).toHaveBeenCalledWith(120);
  });

  it("wires up clear, cancel and apply", async () => {
    const { onClear, onCancel, onApply } = setup();

    await userEvent.click(screen.getByRole("button", { name: "Clear mask" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("shows a busy label and disables everything while filling", () => {
    setup({ isLoading: true });

    expect(screen.getByRole("button", { name: "Filling…" })).toBeDisabled();
    expect(screen.getByRole("slider")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear mask" })).toBeDisabled();
  });
});
