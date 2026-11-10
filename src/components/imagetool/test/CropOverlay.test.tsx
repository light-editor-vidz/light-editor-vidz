import "./setup";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CropOverlay } from "../CropOverlay";
import { useCrop } from "../hooks/useCrop";

// jsdom canvas stub
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe("CropOverlay", () => {
  it("renders a canvas element", () => {
    render(<CropOverlay imageWidth={800} imageHeight={600} onApply={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/crop selection/i)).toBeInTheDocument();
  });

  it("notifies parent of initial crop rect via onCropRectChange", () => {
    const onCropRectChange = vi.fn();
    render(
      <CropOverlay
        imageWidth={800}
        imageHeight={600}
        onApply={vi.fn()}
        onCancel={vi.fn()}
        onCropRectChange={onCropRectChange}
      />,
    );
    expect(onCropRectChange).toHaveBeenCalledWith(
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number),
      }),
    );
  });

  it("Enter key calls onApply with the current crop rect", async () => {
    const onApply = vi.fn();
    render(<CropOverlay imageWidth={800} imageHeight={600} onApply={onApply} onCancel={vi.fn()} />);
    await userEvent.keyboard("{Enter}");
    expect(onApply).toHaveBeenCalledOnce();
    const rect = onApply.mock.calls[0][0];
    expect(rect).toHaveProperty("x");
    expect(rect).toHaveProperty("y");
    expect(rect).toHaveProperty("width");
    expect(rect).toHaveProperty("height");
  });

  it("Escape key calls onCancel", async () => {
    const onCancel = vi.fn();
    render(<CropOverlay imageWidth={800} imageHeight={600} onApply={vi.fn()} onCancel={onCancel} />);
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("useCrop hook", () => {
  it("initializes with a default crop rect covering 80% of the image", () => {
    const { result } = renderHook(() => useCrop(800, 600));
    expect(result.current.cropRect.x).toBeGreaterThan(0);
    expect(result.current.cropRect.y).toBeGreaterThan(0);
    expect(result.current.cropRect.width).toBeLessThanOrEqual(800);
    expect(result.current.cropRect.height).toBeLessThanOrEqual(600);
  });

  it("setCropRect updates the crop rect", () => {
    const { result } = renderHook(() => useCrop(800, 600));
    const newRect = { x: 10, y: 20, width: 100, height: 80 };
    act(() => {
      result.current.setCropRect(newRect);
    });
    expect(result.current.cropRect).toEqual(newRect);
  });
});

describe("CropOverlay — keyboard safety", () => {
  const key = (init: KeyboardEventInit, target: EventTarget = window) =>
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    });

  it("does not start a second crop with Enter while one is running", () => {
    const onApply = vi.fn();
    render(<CropOverlay imageWidth={800} imageHeight={600} disabled onApply={onApply} onCancel={vi.fn()} />);

    key({ key: "Enter" });

    expect(onApply).not.toHaveBeenCalled();
  });

  it("leaves Enter to a text field, such as the width box of the crop bar", () => {
    const onApply = vi.fn();
    render(
      <>
        <input aria-label="w" type="number" />
        <CropOverlay imageWidth={800} imageHeight={600} onApply={onApply} onCancel={vi.fn()} />
      </>,
    );

    key({ key: "Enter" }, screen.getByLabelText("w"));

    expect(onApply).not.toHaveBeenCalled();
  });

  it("ignores Enter and Escape while a dialog is open", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <>
        <div role="dialog" />
        <CropOverlay imageWidth={800} imageHeight={600} onApply={onApply} onCancel={onCancel} />
      </>,
    );

    key({ key: "Enter" });
    key({ key: "Escape" });

    expect(onApply).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("moves the selection with the arrow keys, ten pixels with Shift", () => {
    const onCropRectChange = vi.fn();
    render(
      <CropOverlay
        imageWidth={800}
        imageHeight={600}
        onApply={vi.fn()}
        onCancel={vi.fn()}
        onCropRectChange={onCropRectChange}
      />,
    );

    key({ key: "ArrowRight" });
    expect(onCropRectChange).toHaveBeenLastCalledWith(expect.objectContaining({ x: 81 }));
    key({ key: "ArrowDown", shiftKey: true });
    expect(onCropRectChange).toHaveBeenLastCalledWith(expect.objectContaining({ y: 70 }));
  });

  it("exposes its commands to the crop bar and withdraws them on unmount", () => {
    const apiRef = { current: null } as { current: import("../hooks/useCrop").CropApi | null };
    const { unmount } = render(
      <CropOverlay imageWidth={800} imageHeight={600} apiRef={apiRef} onApply={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(apiRef.current).not.toBeNull();

    unmount();

    expect(apiRef.current).toBeNull();
  });
});
