import "./setup";
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as tauri from "../lib/tauri";
import { useImageEditor } from "../hooks/useImageEditor";
import type { ImageMeta } from "../types";

vi.mock("../lib/tauri");

/**
 * Faux backend qui tient l'historique comme le Rust (empilement, troncature du « refaire »,
 * remplacement de la dernière étape, plafond) : le hook est testé contre son comportement,
 * pas contre des valeurs figées.
 */
class FakeBackend {
  tabs = new Map<string, { len: number; index: number }>();
  /** Nombre maximal d'étapes conservées (la première est toujours gardée). */
  cap = Infinity;

  meta(id: string, over: Partial<ImageMeta> = {}): ImageMeta {
    const t = this.tabs.get(id) ?? { len: 1, index: 0 };
    return {
      width: 800,
      height: 600,
      format: "png",
      preview: "data:image/png;base64,AAA",
      thumbnail: "data:image/png;base64,TTT",
      canUndo: t.index > 0,
      canRedo: t.index < t.len - 1,
      historyLen: t.len,
      historyIndex: t.index,
      filename: "photo.png",
      ...over,
    };
  }

  open(id: string, filename = "photo.png") {
    this.tabs.set(id, { len: 1, index: 0 });
    return { tabId: id, meta: this.meta(id, { filename }) };
  }

  push(id: string, replace = false) {
    const t = this.tabs.get(id)!;
    if (replace && t.index > 0) t.index--;
    t.len = t.index + 2;
    t.index = t.len - 1;
    if (t.len > this.cap) {
      t.len = this.cap;
      t.index = t.len - 1;
    }
    return this.meta(id);
  }

  move(id: string, to: number) {
    this.tabs.get(id)!.index = to;
    return this.meta(id);
  }
}

let backend: FakeBackend;

function installBackend() {
  backend = new FakeBackend();
  const edit = (id: string) => Promise.resolve(backend.push(id));
  vi.mocked(tauri.cropImage).mockImplementation(edit);
  vi.mocked(tauri.flipImage).mockImplementation(edit);
  vi.mocked(tauri.resizeImage).mockImplementation(edit);
  vi.mocked(tauri.canvasResizeImage).mockImplementation(edit);
  vi.mocked(tauri.rotateImage).mockImplementation(edit);
  vi.mocked(tauri.inpaintImage).mockImplementation(edit);
  vi.mocked(tauri.applyCommand).mockImplementation((id, _cmd, replace) => Promise.resolve(backend.push(id, replace)));
  vi.mocked(tauri.undoImage).mockImplementation((id) =>
    Promise.resolve(backend.move(id, backend.tabs.get(id)!.index - 1)),
  );
  vi.mocked(tauri.redoImage).mockImplementation((id) =>
    Promise.resolve(backend.move(id, backend.tabs.get(id)!.index + 1)),
  );
  vi.mocked(tauri.resetToOriginal).mockImplementation((id) => Promise.resolve(backend.move(id, 0)));
  vi.mocked(tauri.gotoHistory).mockImplementation((id, i) => Promise.resolve(backend.move(id, i)));
  vi.mocked(tauri.exportImage).mockResolvedValue(true);
  vi.mocked(tauri.stripExif).mockResolvedValue(true);
  vi.mocked(tauri.getExif).mockResolvedValue([]);
  vi.mocked(tauri.closeTab).mockResolvedValue(undefined);
  vi.mocked(tauri.closeOtherTabs).mockResolvedValue(undefined);
  vi.mocked(tauri.closeAllTabs).mockResolvedValue(undefined);
  vi.mocked(tauri.openImages).mockResolvedValue({ opened: [], failed: [] });
  vi.mocked(tauri.openImagesByPaths).mockResolvedValue({ opened: [], failed: [] });
}

/** Mounts the hook with one image already open. */
async function withOpenImage(id = "t1") {
  vi.mocked(tauri.openImages).mockResolvedValue({ opened: [backend.open(id)], failed: [] });
  const view = renderHook(() => useImageEditor());
  await act(async () => {
    await view.result.current.handleOpen();
  });
  return view;
}

async function withTwoTabs() {
  vi.mocked(tauri.openImages).mockResolvedValue({
    opened: [backend.open("a", "a.png"), backend.open("b", "b.png")],
    failed: [],
  });
  const view = renderHook(() => useImageEditor());
  await act(async () => {
    await view.result.current.handleOpen();
  });
  return view;
}

const keys = (history: { key: string }[]) => history.map((h) => h.key);

beforeEach(() => {
  vi.clearAllMocks();
  installBackend();
});

describe("useImageEditor — initial state", () => {
  it("starts with no tab and nothing to undo", () => {
    const { result } = renderHook(() => useImageEditor());

    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBeNull();
    expect(result.current.image).toBeNull();
    expect(result.current.mode).toBe("idle");
    expect(result.current.zoom).toBe(1);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.openFailures).toEqual([]);
  });
});

describe("useImageEditor — opening images", () => {
  it("creates a tab and makes it active", async () => {
    const { result } = await withOpenImage();

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe("t1");
    expect(result.current.tabs[0].label).toBe("photo.png");
    expect(result.current.history).toEqual([{ key: "hist.open" }]);
    expect(result.current.historyIndex).toBe(0);
    expect(result.current.tabs[0].savedIndex).toBe(0);
  });

  it("falls back to a generic label when the file name is unknown", async () => {
    vi.mocked(tauri.openImages).mockResolvedValue({
      opened: [{ tabId: "t1", meta: { ...backend.open("t1").meta, filename: undefined } }],
      failed: [],
    });
    const { result } = renderHook(() => useImageEditor());

    await act(async () => {
      await result.current.handleOpen();
    });

    expect(result.current.tabs[0].label).toBe("Image");
  });

  it("opens several images and activates the last one", async () => {
    const { result } = await withTwoTabs();

    expect(result.current.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(result.current.activeTabId).toBe("b");
  });

  it("does nothing when the dialog is cancelled", async () => {
    const { result } = renderHook(() => useImageEditor());

    await act(async () => {
      await result.current.handleOpen();
    });

    expect(result.current.tabs).toEqual([]);
  });

  it("opens dropped files by path", async () => {
    vi.mocked(tauri.openImagesByPaths).mockResolvedValue({
      opened: [backend.open("d1", "drop.png")],
      failed: [],
    });
    const { result } = renderHook(() => useImageEditor());

    await act(async () => {
      await result.current.handleOpenByPaths(["/tmp/drop.png"]);
    });

    expect(tauri.openImagesByPaths).toHaveBeenCalledWith(["/tmp/drop.png"]);
    expect(result.current.tabs[0].label).toBe("drop.png");
  });

  it("keeps the files that failed to open instead of dropping them silently", async () => {
    const failed = [{ path: "/tmp/broken.png", error: "bad data" }];
    vi.mocked(tauri.openImagesByPaths).mockResolvedValue({
      opened: [backend.open("ok")],
      failed,
    });
    const { result } = renderHook(() => useImageEditor());

    await act(async () => {
      await result.current.handleOpenByPaths(["/tmp/broken.png", "/tmp/ok.png"]);
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.openFailures).toEqual(failed);

    act(() => result.current.clearOpenFailures());
    expect(result.current.openFailures).toEqual([]);
  });

  it("reports the failures even when nothing could be opened", async () => {
    const failed = [{ path: "/tmp/x.png", error: "nope" }];
    vi.mocked(tauri.openImagesByPaths).mockResolvedValue({ opened: [], failed });
    const { result } = renderHook(() => useImageEditor());

    await act(async () => {
      await result.current.handleOpenByPaths(["/tmp/x.png"]);
    });

    expect(result.current.tabs).toEqual([]);
    expect(result.current.openFailures).toEqual(failed);
  });

  it("surfaces a backend error and recovers", async () => {
    vi.mocked(tauri.openImages).mockRejectedValue("disk on fire");
    const { result } = renderHook(() => useImageEditor());

    await act(async () => {
      await result.current.handleOpen();
    });

    expect(result.current.error).toBe("disk on fire");
    expect(result.current.isLoading).toBe(false);
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("unwraps the message of an Error", async () => {
    vi.mocked(tauri.openImages).mockRejectedValue(new Error("Tab not found"));
    const { result } = renderHook(() => useImageEditor());

    await act(async () => {
      await result.current.handleOpen();
    });

    expect(result.current.error).toBe("Tab not found");
  });
});

describe("useImageEditor — edits and history", () => {
  it("records each geometric edit with its translation key and parameters", async () => {
    const { result } = await withOpenImage();

    await act(async () => {
      await result.current.handleCropApply({ x: 0, y: 0, width: 100, height: 50 });
      await result.current.handleFlip("horizontal");
      await result.current.handleFlip("vertical");
      await result.current.handleResize(400, 300);
      await result.current.handleCanvasResize(500, 400, "center", [0, 0, 0, 255]);
      await result.current.handleRotate(90);
      await result.current.handleRotate(-90);
      await result.current.handleRotate(45);
    });

    expect(result.current.history).toEqual([
      { key: "hist.open" },
      { key: "hist.crop", params: { w: "100", h: "50" } },
      { key: "hist.flip-h" },
      { key: "hist.flip-v" },
      { key: "hist.resize", params: { w: "400", h: "300" } },
      { key: "hist.canvas", params: { w: "500", h: "400" } },
      { key: "hist.rotate", params: { deg: "+90" } },
      { key: "hist.rotate", params: { deg: "−90" } },
      { key: "hist.rotate", params: { deg: "45" } },
    ]);
    expect(result.current.historyIndex).toBe(8);
    expect(result.current.canUndo).toBe(true);
  });

  it("leaves crop mode after a crop", async () => {
    const { result } = await withOpenImage();
    act(() => result.current.enterCropMode());

    await act(async () => {
      await result.current.handleCropApply({ x: 0, y: 0, width: 10, height: 10 });
    });

    expect(result.current.mode).toBe("idle");
  });

  it("shows the image returned by the backend", async () => {
    const { result } = await withOpenImage();
    vi.mocked(tauri.rotateImage).mockResolvedValue({
      ...backend.push("t1"),
      width: 600,
      height: 800,
    });

    await act(async () => {
      await result.current.handleRotate(90);
    });

    expect(result.current.image).toMatchObject({ width: 600, height: 800 });
  });

  it("does nothing without an active tab", async () => {
    const { result } = renderHook(() => useImageEditor());

    await act(async () => {
      await result.current.handleFlip("horizontal");
      await result.current.handleRotate(90);
      await result.current.handleExport("png");
    });

    expect(tauri.flipImage).not.toHaveBeenCalled();
    expect(tauri.rotateImage).not.toHaveBeenCalled();
    expect(tauri.exportImage).not.toHaveBeenCalled();
  });

  it("reports a failed edit without touching the history", async () => {
    const { result } = await withOpenImage();
    vi.mocked(tauri.flipImage).mockRejectedValue("boom");

    await act(async () => {
      await result.current.handleFlip("horizontal");
    });

    expect(result.current.error).toBe("boom");
    expect(result.current.history).toHaveLength(1);
  });

  it("drops the redo steps when a new edit is made after an undo", async () => {
    const { result } = await withOpenImage();
    await act(async () => {
      await result.current.handleFlip("horizontal");
      await result.current.handleFlip("vertical");
      await result.current.handleUndo();
    });
    expect(result.current.canRedo).toBe(true);

    await act(async () => {
      await result.current.handleResize(10, 10);
    });

    expect(keys(result.current.history)).toEqual(["hist.open", "hist.flip-h", "hist.resize"]);
    expect(result.current.canRedo).toBe(false);
  });

  it("follows the backend when it drops its oldest steps to stay within its budget", async () => {
    const { result } = await withOpenImage();
    backend.cap = 3;

    await act(async () => {
      await result.current.handleFlip("horizontal");
      await result.current.handleFlip("vertical");
      await result.current.handleResize(10, 10);
      await result.current.handleRotate(90);
    });

    // L'original est conservé ; les deux plus anciennes retouches ont disparu des deux côtés.
    expect(keys(result.current.history)).toEqual(["hist.open", "hist.resize", "hist.rotate"]);
    expect(result.current.historyIndex).toBe(2);
    expect(result.current.historyIndex).toBe(backend.tabs.get("t1")!.index);
  });

  it("exports and reports the format and quality", async () => {
    const { result } = await withOpenImage();

    await act(async () => {
      await result.current.handleExport("jpeg", 80);
    });

    expect(tauri.exportImage).toHaveBeenCalledWith("t1", "jpeg", 80);
  });

  it("marks the tab as saved after an export, and as modified by the next edit", async () => {
    const { result } = await withOpenImage();
    await act(async () => {
      await result.current.handleFlip("horizontal");
      await result.current.handleExport("png");
    });
    expect(result.current.tabs[0].savedIndex).toBe(1);

    await act(async () => {
      await result.current.handleFlip("vertical");
    });

    expect(result.current.tabs[0].savedIndex).toBe(1);
    expect(result.current.historyIndex).toBe(2);
  });

  it("does not mark the tab as saved when the save dialog is cancelled", async () => {
    vi.mocked(tauri.exportImage).mockResolvedValue(false);
    const { result } = await withOpenImage();
    await act(async () => {
      await result.current.handleFlip("horizontal");
      await result.current.handleExport("png");
    });

    expect(result.current.tabs[0].savedIndex).toBe(0);
  });
});

describe("useImageEditor — undo, redo and reset", () => {
  async function withThreeSteps() {
    const view = await withOpenImage();
    await act(async () => {
      await view.result.current.handleFlip("horizontal");
      await view.result.current.handleFlip("vertical");
    });
    return view;
  }

  it("undoes one step on the position given by the backend", async () => {
    const { result } = await withThreeSteps();

    await act(async () => {
      await result.current.handleUndo();
    });

    expect(tauri.undoImage).toHaveBeenCalledWith("t1");
    expect(result.current.historyIndex).toBe(1);
    expect(result.current.canRedo).toBe(true);
  });

  it("redoes a step", async () => {
    const { result } = await withThreeSteps();
    await act(async () => {
      await result.current.handleUndo();
      await result.current.handleRedo();
    });

    expect(result.current.historyIndex).toBe(2);
    expect(result.current.canRedo).toBe(false);
  });

  it("ignores undo at the start and redo at the end", async () => {
    const { result } = await withOpenImage();

    await act(async () => {
      await result.current.handleUndo();
      await result.current.handleRedo();
    });

    expect(tauri.undoImage).not.toHaveBeenCalled();
    expect(tauri.redoImage).not.toHaveBeenCalled();
  });

  it("goes back to the original and keeps the later steps redoable", async () => {
    const { result } = await withThreeSteps();

    await act(async () => {
      await result.current.handleResetToOriginal();
    });

    expect(result.current.historyIndex).toBe(0);
    expect(result.current.history).toHaveLength(3);
    expect(result.current.canRedo).toBe(true);
  });

  it("does not reset when already at the original", async () => {
    const { result } = await withOpenImage();

    await act(async () => {
      await result.current.handleResetToOriginal();
    });

    expect(tauri.resetToOriginal).not.toHaveBeenCalled();
  });

  it("jumps to any step of the history", async () => {
    const { result } = await withThreeSteps();

    await act(async () => {
      await result.current.handleGotoHistory(0);
    });
    expect(tauri.gotoHistory).toHaveBeenCalledWith("t1", 0);
    expect(result.current.historyIndex).toBe(0);

    await act(async () => {
      await result.current.handleGotoHistory(2);
    });
    expect(result.current.historyIndex).toBe(2);
  });

  it("ignores a jump to the current step or outside the history", async () => {
    const { result } = await withThreeSteps();

    await act(async () => {
      await result.current.handleGotoHistory(2);
      await result.current.handleGotoHistory(9);
      await result.current.handleGotoHistory(-1);
    });

    expect(tauri.gotoHistory).not.toHaveBeenCalled();
  });

  it("leaves any editing mode on undo", async () => {
    const { result } = await withThreeSteps();
    act(() => result.current.enterCropMode());

    await act(async () => {
      await result.current.handleUndo();
    });

    expect(result.current.mode).toBe("idle");
  });
});

describe("useImageEditor — tabs", () => {
  it("switches the active tab and leaves any mode", async () => {
    const { result } = await withTwoTabs();
    act(() => result.current.enterCropMode());

    act(() => result.current.setActiveTab("a"));

    expect(result.current.activeTabId).toBe("a");
    expect(result.current.mode).toBe("idle");
  });

  it("closes a tab and falls back to its neighbour", async () => {
    const { result } = await withTwoTabs();

    await act(async () => {
      await result.current.handleCloseTab("b");
    });

    expect(tauri.closeTab).toHaveBeenCalledWith("b");
    expect(result.current.tabs.map((t) => t.id)).toEqual(["a"]);
    await waitFor(() => expect(result.current.activeTabId).toBe("a"));
  });

  it("keeps the active tab when a background one is closed", async () => {
    const { result } = await withTwoTabs();

    await act(async () => {
      await result.current.handleCloseTab("a");
    });

    expect(result.current.tabs.map((t) => t.id)).toEqual(["b"]);
    expect(result.current.activeTabId).toBe("b");
  });

  it("clears the active tab when the last one closes", async () => {
    const { result } = await withOpenImage();

    await act(async () => {
      await result.current.handleCloseTab("t1");
    });

    await waitFor(() => expect(result.current.activeTabId).toBeNull());
    expect(result.current.tabs).toEqual([]);
  });

  it("keeps the tab and reports the error when the backend refuses to close it", async () => {
    vi.mocked(tauri.closeTab).mockRejectedValue("cannot close");
    const { result } = await withOpenImage();

    await act(async () => {
      await result.current.handleCloseTab("t1");
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.error).toBe("cannot close");
  });

  it("closes the other tabs", async () => {
    const { result } = await withTwoTabs();

    await act(async () => {
      await result.current.handleCloseOtherTabs();
    });

    expect(tauri.closeOtherTabs).toHaveBeenCalledWith("b");
    expect(result.current.tabs.map((t) => t.id)).toEqual(["b"]);
  });

  it("does nothing when asked to close others with no tab open", async () => {
    const { result } = renderHook(() => useImageEditor());

    await act(async () => {
      await result.current.handleCloseOtherTabs();
    });

    expect(tauri.closeOtherTabs).not.toHaveBeenCalled();
  });

  it("closes every tab", async () => {
    const { result } = await withTwoTabs();

    await act(async () => {
      await result.current.handleCloseAllTabs();
    });

    expect(tauri.closeAllTabs).toHaveBeenCalled();
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBeNull();
  });

  it("reports an error when closing everything fails", async () => {
    vi.mocked(tauri.closeAllTabs).mockRejectedValue("nope");
    const { result } = await withTwoTabs();

    await act(async () => {
      await result.current.handleCloseAllTabs();
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.error).toBe("nope");
  });

  it("keeps each tab history independent", async () => {
    const { result } = await withTwoTabs();
    await act(async () => {
      await result.current.handleFlip("horizontal");
    });

    act(() => result.current.setActiveTab("a"));

    expect(result.current.history).toHaveLength(1);
    expect(result.current.tabs.find((t) => t.id === "b")!.history).toHaveLength(2);
  });
});

describe("useImageEditor — zoom", () => {
  it("sets an absolute zoom", async () => {
    const { result } = await withOpenImage();

    act(() => result.current.setZoom(2));

    expect(result.current.zoom).toBe(2);
  });

  it("accepts an updater function", async () => {
    const { result } = await withOpenImage();

    act(() => result.current.setZoom((z) => z * 2));

    expect(result.current.zoom).toBe(2);
  });

  it("clamps to the supported range", async () => {
    const { result } = await withOpenImage();

    act(() => result.current.setZoom(100));
    expect(result.current.zoom).toBe(8);

    act(() => result.current.setZoom(0.0001));
    expect(result.current.zoom).toBe(0.05);
  });

  it("keeps a zoom level per tab", async () => {
    const { result } = await withTwoTabs();
    act(() => result.current.setZoom(3));

    act(() => result.current.setActiveTab("a"));

    expect(result.current.zoom).toBe(1);
  });

  it("does nothing without a tab", () => {
    const { result } = renderHook(() => useImageEditor());

    act(() => result.current.setZoom(3));

    expect(result.current.zoom).toBe(1);
  });
});

describe("useImageEditor — modes", () => {
  it.each([
    ["enterCropMode", "exitCropMode", "cropping"],
    ["enterRotateMode", "exitRotateMode", "rotating"],
    ["enterEyedropperMode", "exitEyedropperMode", "eyedropper"],
    ["enterInpaintingMode", "exitInpaintingMode", "inpainting"],
  ] as const)("%s / %s toggle the %s mode", (enter, exit, mode) => {
    const { result } = renderHook(() => useImageEditor());

    act(() => result.current[enter]());
    expect(result.current.mode).toBe(mode);

    act(() => result.current[exit]());
    expect(result.current.mode).toBe("idle");
  });
});

describe("useImageEditor — EXIF", () => {
  it("reads the fields of a tab", async () => {
    const fields = [{ tag: "Make", value: "Canon" }];
    vi.mocked(tauri.getExif).mockResolvedValue(fields);
    const { result } = await withOpenImage();

    let got;
    await act(async () => {
      got = await result.current.loadExif("t1");
    });

    expect(got).toEqual(fields);
  });

  it("returns an empty list when reading fails", async () => {
    vi.mocked(tauri.getExif).mockRejectedValue(new Error("no exif"));
    const { result } = await withOpenImage();

    let got;
    await act(async () => {
      got = await result.current.loadExif("t1");
    });

    expect(got).toEqual([]);
  });

  it("strips the metadata and marks the tab as saved", async () => {
    const { result } = await withOpenImage();
    await act(async () => {
      await result.current.handleFlip("horizontal");
      await result.current.handleStripExif("t1");
    });

    expect(tauri.stripExif).toHaveBeenCalledWith("t1");
    expect(result.current.tabs[0].savedIndex).toBe(1);
  });
});

describe("useImageEditor — inpainting", () => {
  const mask = { b64: "bWFzaw==", x: 3, y: 4, width: 10, height: 5 };

  it("sends the mask box and records the step", async () => {
    const { result } = await withOpenImage();

    await act(async () => {
      await result.current.handleInpaint(mask);
    });

    expect(tauri.inpaintImage).toHaveBeenCalledWith("t1", mask);
    expect(result.current.history).toEqual([{ key: "hist.open" }, { key: "hist.inpaint" }]);
  });

  it("does nothing with no tab open", async () => {
    const { result } = renderHook(() => useImageEditor());

    await act(async () => {
      await result.current.handleInpaint(mask);
    });

    expect(tauri.inpaintImage).not.toHaveBeenCalled();
  });

  it("leaves the history alone when the backend refuses an empty mask", async () => {
    vi.mocked(tauri.inpaintImage).mockRejectedValue("Mask is empty");
    const { result } = await withOpenImage();

    await act(async () => {
      await result.current.handleInpaint(mask);
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.error).toBe("Mask is empty");
  });
});

describe("useImageEditor — adjustments and filters", () => {
  it("applies a command and records it under its type", async () => {
    const { result } = await withOpenImage();

    let position;
    await act(async () => {
      position = await result.current.handleCommand({ type: "exposure", exposure: 1 });
    });

    expect(tauri.applyCommand).toHaveBeenCalledWith("t1", { type: "exposure", exposure: 1 }, false);
    expect(result.current.history).toEqual([{ key: "hist.open" }, { key: "hist.cmd.exposure" }]);
    expect(position).toBe(1);
  });

  it("stacks successive commands", async () => {
    const { result } = await withOpenImage();

    await act(async () => {
      await result.current.handleCommand({ type: "exposure", exposure: 1 });
      await result.current.handleCommand({ type: "sepia", intensity: 1 });
    });

    expect(keys(result.current.history)).toEqual(["hist.open", "hist.cmd.exposure", "hist.cmd.sepia"]);
    expect(result.current.historyIndex).toBe(2);
  });

  it("replaces the last step instead of adding one when asked to", async () => {
    const { result } = await withOpenImage();
    await act(async () => {
      await result.current.handleCommand({ type: "exposure", exposure: 1 });
    });

    let position;
    await act(async () => {
      position = await result.current.handleCommand({ type: "exposure", exposure: 2 }, { replace: true });
    });

    expect(tauri.applyCommand).toHaveBeenLastCalledWith("t1", { type: "exposure", exposure: 2 }, true);
    expect(keys(result.current.history)).toEqual(["hist.open", "hist.cmd.exposure"]);
    expect(result.current.historyIndex).toBe(1);
    expect(position).toBe(1);
  });

  it("adds a step when asked to replace on the original image", async () => {
    const { result } = await withOpenImage();

    await act(async () => {
      await result.current.handleCommand({ type: "invert" }, { replace: true });
    });

    expect(keys(result.current.history)).toEqual(["hist.open", "hist.cmd.invert"]);
  });

  it("replaces correctly after an undo has truncated nothing", async () => {
    const { result } = await withOpenImage();
    await act(async () => {
      await result.current.handleFlip("horizontal");
      await result.current.handleCommand({ type: "vibrance", vibrance: 10 });
      await result.current.handleCommand({ type: "vibrance", vibrance: 20 }, { replace: true });
      await result.current.handleCommand({ type: "vibrance", vibrance: 30 }, { replace: true });
    });

    expect(keys(result.current.history)).toEqual(["hist.open", "hist.flip-h", "hist.cmd.vibrance"]);
    expect(result.current.historyIndex).toBe(backend.tabs.get("t1")!.index);
  });

  it("reports a failed command and returns undefined", async () => {
    vi.mocked(tauri.applyCommand).mockRejectedValue("bad command");
    const { result } = await withOpenImage();

    let position;
    await act(async () => {
      position = await result.current.handleCommand({ type: "invert" });
    });

    expect(position).toBeUndefined();
    expect(result.current.error).toBe("bad command");
    expect(result.current.history).toHaveLength(1);
  });

  it("does nothing without an active tab", async () => {
    const { result } = renderHook(() => useImageEditor());

    let position;
    await act(async () => {
      position = await result.current.handleCommand({ type: "invert" });
    });

    expect(position).toBeUndefined();
    expect(tauri.applyCommand).not.toHaveBeenCalled();
  });

  it("shows the loading state while a command runs", async () => {
    let finish: (m: ImageMeta) => void = () => {};
    vi.mocked(tauri.applyCommand).mockReturnValue(new Promise((r) => (finish = r)));
    const { result } = await withOpenImage();

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.handleCommand({ type: "invert" });
    });
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      finish(backend.push("t1"));
      await pending;
    });
    expect(result.current.isLoading).toBe(false);
  });
});

describe("useImageEditor — clipboard", () => {
  it("copies the preview as a PNG blob", async () => {
    const blob = new Blob(["x"], { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) }));
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(public data: unknown) {}
      },
    );
    const { result } = await withOpenImage();

    await act(async () => {
      await result.current.handleCopyToClipboard();
    });

    expect(write).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does nothing with no tab open", async () => {
    const write = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    const { result } = renderHook(() => useImageEditor());

    await act(async () => {
      await result.current.handleCopyToClipboard();
    });

    expect(write).not.toHaveBeenCalled();
  });
});
