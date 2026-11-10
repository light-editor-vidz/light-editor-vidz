import "./setup";
import { vi } from "vitest";
import type { useImageEditor } from "../hooks/useImageEditor";
import type { EditorMode, ImageMeta } from "../types";

export type Editor = ReturnType<typeof useImageEditor>;

export const meta = (over: Partial<ImageMeta> = {}): ImageMeta => ({
  width: 800,
  height: 600,
  format: "png",
  preview: "data:image/png;base64,AAA",
  thumbnail: "data:image/png;base64,TTT",
  canUndo: true,
  canRedo: false,
  historyLen: 1,
  historyIndex: 0,
  filename: "photo.png",
  path: "/tmp/photo.png",
  ...over,
});

/** Éditeur factice : chaque action est un espion, l'état est celui d'un onglet ouvert. */
export function editorStub(over: Partial<Editor> = {}): Editor {
  const noop = () => vi.fn();
  const asyncNoop = () => vi.fn().mockResolvedValue(undefined);
  return {
    loadExif: vi.fn().mockResolvedValue([{ tag: "Make", value: "Canon" }]),
    handleStripExif: asyncNoop(),
    handleOpenByPaths: asyncNoop(),
    handleCopyToClipboard: asyncNoop(),
    enterEyedropperMode: noop(),
    exitEyedropperMode: noop(),
    enterInpaintingMode: noop(),
    exitInpaintingMode: noop(),
    handleInpaint: asyncNoop(),
    tabs: [
      {
        id: "t1",
        label: "photo.png",
        image: meta(),
        history: [{ key: "hist.open" }],
        historyIndex: 0,
        savedIndex: 0,
        zoom: 1,
      },
    ],
    activeTabId: "t1",
    image: meta(),
    mode: "idle" as EditorMode,
    isLoading: false,
    error: null,
    openFailures: [],
    zoom: 1,
    history: [{ key: "hist.open" }],
    historyIndex: 0,
    canUndo: true,
    canRedo: false,
    handleOpen: asyncNoop(),
    handleCropApply: asyncNoop(),
    handleFlip: asyncNoop(),
    handleResize: asyncNoop(),
    handleCanvasResize: asyncNoop(),
    handleRotate: asyncNoop(),
    handleExport: asyncNoop(),
    handleUndo: asyncNoop(),
    handleRedo: asyncNoop(),
    handleGotoHistory: asyncNoop(),
    handleResetToOriginal: asyncNoop(),
    handleResetTool: vi.fn().mockResolvedValue(0),
    handleCloseTab: asyncNoop(),
    handleCloseOtherTabs: asyncNoop(),
    handleCloseAllTabs: asyncNoop(),
    handleCommand: vi.fn().mockResolvedValue(1),
    setActiveTab: noop(),
    enterCropMode: noop(),
    exitCropMode: noop(),
    enterRotateMode: noop(),
    exitRotateMode: noop(),
    setZoom: noop(),
    clearError: noop(),
    clearOpenFailures: noop(),
    ...over,
  } as unknown as Editor;
}
