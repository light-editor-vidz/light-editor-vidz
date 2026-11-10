import "./setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Toolbar } from "../Toolbar";

function renderToolbar(props: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  const defaults = {
    hasImage: false,
    mode: "idle" as const,
    isLoading: false,
    onCropMode: vi.fn(),
    onRotateMode: vi.fn(),
    onFlipOpen: vi.fn(),
    onResizeOpen: vi.fn(),
    onCanvasResizeOpen: vi.fn(),
    showExif: false,
    onToggleExif: vi.fn(),
  };
  return render(<Toolbar {...defaults} {...props} />);
}

describe("Toolbar", () => {
  it("has no Prefs button: the sidebar only holds image tools", () => {
    renderToolbar({ hasImage: true });
    expect(screen.queryByRole("button", { name: /pref/i })).not.toBeInTheDocument();
  });

  it("has no logo and no Export button: the top bar has it", () => {
    const { container } = renderToolbar({ hasImage: true });
    expect(screen.queryByRole("button", { name: /export/i })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/^Z/);
    expect(screen.queryByText("Z")).not.toBeInTheDocument();
  });

  it("Crop and Rotate are disabled when no image is loaded", () => {
    renderToolbar({ hasImage: false });
    expect(screen.getByRole("button", { name: /^crop$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^rotate$/i })).toBeDisabled();
  });

  it("Crop and Rotate are enabled when an image is loaded", () => {
    renderToolbar({ hasImage: true });
    expect(screen.getByRole("button", { name: /^crop$/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /^rotate$/i })).not.toBeDisabled();
  });

  it("All action buttons are disabled while loading", () => {
    renderToolbar({ hasImage: true, isLoading: true });
    expect(screen.getByRole("button", { name: /^crop$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^rotate$/i })).toBeDisabled();
  });

  it("Clicking Crop fires onCropMode when image is loaded", async () => {
    const onCropMode = vi.fn();
    renderToolbar({ hasImage: true, onCropMode });
    await userEvent.click(screen.getByRole("button", { name: /^crop$/i }));
    expect(onCropMode).toHaveBeenCalledOnce();
  });

  it("Crop button shows active state when mode is cropping", () => {
    renderToolbar({ hasImage: true, mode: "cropping" });
    const btn = screen.getByRole("button", { name: /^crop$/i });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("Rotate button shows active state when mode is rotating", () => {
    renderToolbar({ hasImage: true, mode: "rotating" });
    const btn = screen.getByRole("button", { name: /^rotate$/i });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("EXIF toggle button shows active state when showExif is true", () => {
    renderToolbar({ hasImage: true, showExif: true });
    const btn = screen.getByRole("button", { name: /exif metadata/i });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("Clicking EXIF toggle fires onToggleExif", async () => {
    const onToggleExif = vi.fn();
    renderToolbar({ hasImage: true, onToggleExif });
    await userEvent.click(screen.getByRole("button", { name: /exif metadata/i }));
    expect(onToggleExif).toHaveBeenCalledOnce();
  });

  it("Grid toggle button shows active state when showGrid is true", () => {
    renderToolbar({ hasImage: true, showGrid: true });
    const btn = screen.getByRole("button", { name: /toggle grid/i });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });
});
