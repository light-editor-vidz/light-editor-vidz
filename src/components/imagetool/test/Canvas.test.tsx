import "./setup";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Canvas } from "../Canvas";
import type { ImageMeta } from "../types";

const mockImage: ImageMeta = {
  width: 800,
  height: 600,
  format: "png",
  preview: "data:image/png;base64,abc123",
  thumbnail: "data:image/png;base64,TTT",
  canUndo: false,
  canRedo: false,
  historyLen: 1,
  historyIndex: 0,
};

function renderCanvas(props: Partial<Parameters<typeof Canvas>[0]> = {}) {
  const defaults = {
    image: null as ImageMeta | null,
    mode: "idle" as const,
    zoom: 1,
    onCropApply: vi.fn(),
    onCropCancel: vi.fn(),
    onZoomChange: vi.fn(),
    onOpen: vi.fn(),
  };
  return render(<Canvas {...defaults} {...props} />);
}

describe("Canvas", () => {
  it("shows empty state when no image is loaded", () => {
    renderCanvas();
    // The name is written in two colours: white, then the app's primary colour.
    expect(document.querySelector(".home-name")?.textContent).toBe("LightCutImgz");
    expect(document.querySelector(".home-name-accent")?.textContent).toBe("Imgz");
    expect(screen.getByText("Drop an image here")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-image")).not.toBeInTheDocument();
  });

  it("renders the image preview when an image is loaded", () => {
    renderCanvas({ image: mockImage });
    const img = screen.getByTestId("canvas-image");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", mockImage.preview);
  });

  it("applies zoom to the image dimensions", () => {
    renderCanvas({ image: mockImage, zoom: 2 });
    const img = screen.getByTestId("canvas-image");
    expect(img).toHaveAttribute("width", "1600");
    expect(img).toHaveAttribute("height", "1200");
  });

  it("does not show CropOverlay when mode is idle", () => {
    renderCanvas({ image: mockImage });
    expect(screen.queryByLabelText(/crop selection/i)).not.toBeInTheDocument();
  });

  it("shows CropOverlay when mode is cropping", () => {
    renderCanvas({ image: mockImage, mode: "cropping" });
    expect(screen.getByLabelText(/crop selection/i)).toBeInTheDocument();
  });

  it("shows recent files in empty state", () => {
    renderCanvas({ recentFiles: ["/home/user/photo.jpg", "/home/user/other.png"] });
    expect(screen.getByText("photo.jpg")).toBeInTheDocument();
    expect(screen.getByText("other.png")).toBeInTheDocument();
  });

  it("clicking a recent file calls onOpenByPaths and shows spinner", () => {
    const onOpenByPaths = vi.fn();
    renderCanvas({ recentFiles: ["/home/user/photo.jpg"], onOpenByPaths, isLoading: false });
    const btn = screen.getByTitle("/home/user/photo.jpg");
    fireEvent.click(btn);
    expect(onOpenByPaths).toHaveBeenCalledWith(["/home/user/photo.jpg"]);
    expect(btn.querySelector(".animate-spin")).toBeTruthy();
  });

  it("recent file buttons are disabled while isLoading", () => {
    renderCanvas({ recentFiles: ["/home/user/photo.jpg"], isLoading: true });
    expect(screen.getByTitle("/home/user/photo.jpg")).toBeDisabled();
  });

  it("the × button removes one recent file and Clear empties the list", () => {
    const onRecentRemove = vi.fn();
    const onRecentClear = vi.fn();
    renderCanvas({
      recentFiles: ["/home/user/photo.jpg", "/home/user/other.png"],
      onRecentRemove,
      onRecentClear,
    });
    fireEvent.click(screen.getAllByRole("button", { name: /remove from list|retirer de la liste/i })[0]);
    expect(onRecentRemove).toHaveBeenCalledWith("/home/user/photo.jpg");
    fireEvent.click(screen.getByRole("button", { name: /^(clear|effacer)$/i }));
    expect(onRecentClear).toHaveBeenCalled();
  });

  it("rotates the image live while the angle slider moves, and only for the image it was asked on", () => {
    const { rerender } = renderCanvas({
      image: mockImage,
      mode: "rotating",
      rotatePreview: { degrees: 30, src: mockImage.preview },
    });
    expect(screen.getByTestId("canvas-image").style.transform).toBe("rotate(30deg)");

    rerender(
      <Canvas
        image={{ ...mockImage, preview: "data:image/png;base64,NEW" }}
        mode="rotating"
        zoom={1}
        rotatePreview={{ degrees: 30, src: mockImage.preview }}
        onCropApply={vi.fn()}
        onCropCancel={vi.fn()}
        onZoomChange={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByTestId("canvas-image").style.transform).toBe("");
  });

  it("shows a processing overlay while loading, unless the panel has its own indicator", () => {
    const { rerender } = renderCanvas({ image: mockImage, isLoading: true });
    expect(screen.getByRole("status")).toHaveTextContent(/processing/i);

    rerender(
      <Canvas
        image={mockImage}
        mode="idle"
        zoom={1}
        isLoading
        showBusy={false}
        onCropApply={vi.fn()}
        onCropCancel={vi.fn()}
        onZoomChange={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
