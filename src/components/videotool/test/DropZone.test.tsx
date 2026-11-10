import "./setup";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DropZone from "../components/DropZone";
import { LangProvider } from "../i18n";

function renderWithI18n(ui: React.ReactElement) {
  return render(<LangProvider>{ui}</LangProvider>);
}

describe("DropZone", () => {
  it("renders the browse button", () => {
    renderWithI18n(<DropZone onDrop={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /browse|parcourir/i })).toBeTruthy();
  });

  it("calls onOpen when the browse button is clicked", () => {
    const onOpen = vi.fn();
    renderWithI18n(<DropZone onDrop={vi.fn()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /browse|parcourir/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("adds the dragging class on drag over", () => {
    const { container } = renderWithI18n(<DropZone onDrop={vi.fn()} onOpen={vi.fn()} />);
    const zone = container.querySelector(".dropzone")!;
    fireEvent.dragOver(zone);
    expect(zone.classList.contains("dragging")).toBe(true);
  });

  it("removes the dragging class on drag leave", () => {
    const { container } = renderWithI18n(<DropZone onDrop={vi.fn()} onOpen={vi.fn()} />);
    const zone = container.querySelector(".dropzone")!;
    fireEvent.dragOver(zone);
    fireEvent.dragLeave(zone);
    expect(zone.classList.contains("dragging")).toBe(false);
  });

  // The real path comes from webUtils.getPathForFile in the preload — `File.path`
  // was removed in Electron 32, so the mock must be the preload API, never a
  // property planted on the File object.
  it("resolves the dropped file through the preload and reports its path", () => {
    const onDrop = vi.fn();
    const getPathForFile = vi.fn(() => "/home/user/videos/movie.mp4");
    window.electronAPI.getPathForFile = getPathForFile;
    const { container } = renderWithI18n(<DropZone onDrop={onDrop} onOpen={vi.fn()} />);
    const zone = container.querySelector(".dropzone")!;
    const file = new File(["x"], "movie.mp4", { type: "video/mp4" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(getPathForFile).toHaveBeenCalledWith(file);
    expect(onDrop).toHaveBeenCalledWith("/home/user/videos/movie.mp4");
  });

  it("does not report a drop the preload could not resolve to a path", () => {
    const onDrop = vi.fn();
    window.electronAPI.getPathForFile = vi.fn(() => "");
    const { container } = renderWithI18n(<DropZone onDrop={onDrop} onOpen={vi.fn()} />);
    const zone = container.querySelector(".dropzone")!;
    const file = new File(["x"], "noPath.mp4", { type: "video/mp4" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("never falls back to the bare file name", () => {
    const onDrop = vi.fn();
    window.electronAPI.getPathForFile = vi.fn(() => "");
    const { container } = renderWithI18n(<DropZone onDrop={onDrop} onOpen={vi.fn()} />);
    const zone = container.querySelector(".dropzone")!;
    fireEvent.drop(zone, { dataTransfer: { files: [new File(["x"], "movie.mp4", { type: "video/mp4" })] } });
    expect(onDrop).not.toHaveBeenCalledWith("movie.mp4");
  });

  it("ignores non-video files", () => {
    const onDrop = vi.fn();
    const { container } = renderWithI18n(<DropZone onDrop={onDrop} onOpen={vi.fn()} />);
    const zone = container.querySelector(".dropzone")!;
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("ignores drops with empty files list", () => {
    const onDrop = vi.fn();
    const { container } = renderWithI18n(<DropZone onDrop={onDrop} onOpen={vi.fn()} />);
    const zone = container.querySelector(".dropzone")!;
    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("clears dragging class after drop", () => {
    const { container } = renderWithI18n(<DropZone onDrop={vi.fn()} onOpen={vi.fn()} />);
    const zone = container.querySelector(".dropzone")!;
    fireEvent.dragOver(zone);
    expect(zone.classList.contains("dragging")).toBe(true);
    const file = new File(["x"], "a.mp4", { type: "video/mp4" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(zone.classList.contains("dragging")).toBe(false);
  });
});
