import "./setup";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import * as api from "../lib/tauri";
import { loadPrefs, savePrefs } from "../lib/prefs";
import { getRecentFiles, addRecentFile, clearRecentFiles } from "../lib/recentFiles";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockInvoke = vi.mocked(invoke);

/** What the Rust side actually sends back, in snake_case. */
const rawMeta = {
  width: 800,
  height: 600,
  format: "png",
  preview: "data:image/png;base64,AAA",
  thumbnail: "data:image/png;base64,TTT",
  can_undo: true,
  can_redo: false,
  history_len: 3,
  history_index: 2,
  tools: ["crop"],
  filename: "photo.png",
  path: "/tmp/photo.png",
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockInvoke.mockResolvedValue(rawMeta);
});

describe("tauri layer — meta mapping", () => {
  it("renames the snake_case undo flags", async () => {
    const meta = await api.rotateImage("t1", 90);
    expect(meta).toEqual({
      width: 800,
      height: 600,
      format: "png",
      preview: "data:image/png;base64,AAA",
      thumbnail: "data:image/png;base64,TTT",
      canUndo: true,
      canRedo: false,
      historyLen: 3,
      historyIndex: 2,
      tools: ["crop"],
      filename: "photo.png",
      path: "/tmp/photo.png",
    });
  });

  it("resets one tool and reports the steps that could not be replayed", async () => {
    mockInvoke.mockResolvedValue({ meta: rawMeta, dropped: 2 });
    const result = await api.resetTool("t1", "crop");
    expect(mockInvoke).toHaveBeenCalledWith("reset_tool", { tabId: "t1", tool: "crop" });
    expect(result.dropped).toBe(2);
    expect(result.meta.tools).toEqual(["crop"]);
  });

  it("defaults the undo flags to false when the backend omits them", async () => {
    mockInvoke.mockResolvedValue({ width: 1, height: 1, format: "png", preview: "" });
    const meta = await api.rotateImage("t1", 90);
    expect(meta.canUndo).toBe(false);
    expect(meta.canRedo).toBe(false);
  });

  it("falls back to the preview for the thumbnail and to a single history step", async () => {
    mockInvoke.mockResolvedValue({ width: 1, height: 1, format: "png", preview: "P" });
    const meta = await api.rotateImage("t1", 90);
    expect(meta.thumbnail).toBe("P");
    expect([meta.historyLen, meta.historyIndex]).toEqual([1, 0]);
  });
});

describe("tauri layer — opening", () => {
  it("maps the opened images and their tab ids", async () => {
    mockInvoke.mockResolvedValue({ opened: [{ tab_id: "a", meta: rawMeta }], failed: [] });

    await expect(api.openImages()).resolves.toEqual({
      opened: [{ tabId: "a", meta: expect.objectContaining({ canUndo: true }) }],
      failed: [],
    });
    expect(mockInvoke).toHaveBeenCalledWith("open_images");
  });

  it("reports the files that could not be opened", async () => {
    const failed = [{ path: "/tmp/x.png", error: "bad" }];
    mockInvoke.mockResolvedValue({ opened: [], failed });

    await expect(api.openImagesByPaths(["/tmp/x.png"])).resolves.toEqual({ opened: [], failed });
  });

  it("forwards the paths when opening by path", async () => {
    mockInvoke.mockResolvedValue({ opened: [{ tab_id: "a", meta: rawMeta }], failed: [] });

    await api.openImagesByPaths(["/tmp/a.png"]);

    expect(mockInvoke).toHaveBeenCalledWith("open_images_by_paths", { paths: ["/tmp/a.png"] });
  });
});

describe("tauri layer — geometry commands", () => {
  it("flattens the crop rectangle into the payload", async () => {
    await api.cropImage("t1", { x: 1, y: 2, width: 3, height: 4 });
    expect(mockInvoke).toHaveBeenCalledWith(
      "crop_image",
      expect.objectContaining({ tabId: "t1", x: 1, y: 2, width: 3, height: 4 }),
    );
  });

  it("sends a resize", async () => {
    await api.resizeImage("t1", 100, 50);
    expect(mockInvoke).toHaveBeenCalledWith(
      "resize_image",
      expect.objectContaining({ tabId: "t1", width: 100, height: 50 }),
    );
  });

  it("sends a canvas resize with its anchor and fill", async () => {
    await api.canvasResizeImage("t1", 100, 50, "top-left", [1, 2, 3, 4]);
    expect(mockInvoke).toHaveBeenCalledWith(
      "canvas_resize_image",
      expect.objectContaining({
        tabId: "t1",
        width: 100,
        height: 50,
      }),
    );
  });

  it.each(["horizontal", "vertical"] as const)("sends a %s flip", async (direction) => {
    await api.flipImage("t1", direction);
    expect(mockInvoke).toHaveBeenCalledWith("flip_image", expect.objectContaining({ tabId: "t1" }));
  });

  it("sends a rotation", async () => {
    await api.rotateImage("t1", 270);
    expect(mockInvoke).toHaveBeenCalledWith("rotate_image", expect.objectContaining({ tabId: "t1", degrees: 270 }));
  });
});

describe("tauri layer — history and tabs", () => {
  it.each([
    ["undoImage", "undo_image"],
    ["redoImage", "redo_image"],
    ["resetToOriginal", "reset_to_original"],
  ] as const)("%s calls %s", async (fn, command) => {
    await (api[fn] as (id: string) => Promise<unknown>)("t1");
    expect(mockInvoke).toHaveBeenCalledWith(command, expect.objectContaining({ tabId: "t1" }));
  });

  it("closes a single tab", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await api.closeTab("t1");
    expect(mockInvoke).toHaveBeenCalledWith("close_tab", { tabId: "t1" });
  });

  it("closes every tab", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await api.closeAllTabs();
    expect(mockInvoke).toHaveBeenCalledWith("close_all_tabs");
  });

  it("closes the other tabs", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await api.closeOtherTabs("t1");
    expect(mockInvoke).toHaveBeenCalledWith("close_other_tabs", { tabId: "t1" });
  });

  it("jumps to a history step", async () => {
    await api.gotoHistory("t1", 2);
    expect(mockInvoke).toHaveBeenCalledWith("goto_history", { tabId: "t1", index: 2 });
  });

  it("exports with a format and quality and reports whether a file was written", async () => {
    mockInvoke.mockResolvedValue(true);
    await expect(api.exportImage("t1", "jpeg", 80)).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith(
      "export_image",
      expect.objectContaining({ tabId: "t1", format: "jpeg", quality: 80 }),
    );
  });

  it("tells the backend which language is active", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await api.setMenuLanguage("fr");
    expect(mockInvoke).toHaveBeenCalledWith("set_menu_language", { lang: "fr" });
  });
});

describe("tauri layer — EXIF", () => {
  it("reads the fields", async () => {
    const fields = [{ tag: "Make", value: "Canon" }];
    mockInvoke.mockResolvedValue(fields);
    await expect(api.getExif("t1")).resolves.toEqual(fields);
    expect(mockInvoke).toHaveBeenCalledWith("get_exif", { tabId: "t1" });
  });

  it("strips them", async () => {
    mockInvoke.mockResolvedValue(true);
    await expect(api.stripExif("t1")).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("strip_exif", { tabId: "t1" });
  });
});

describe("tauri layer — adjustments and filters", () => {
  it("applies a command by sending its description as-is", async () => {
    const cmd = { type: "hue-saturation", hue: 10, saturation: 20, lightness: 30 } as const;

    const meta = await api.applyCommand("t1", cmd);

    expect(mockInvoke).toHaveBeenCalledWith("apply_command", {
      tabId: "t1",
      command: cmd,
      replace: false,
    });
    expect(meta.canUndo).toBe(true);
  });

  it("can ask the backend to replace the last step", async () => {
    await api.applyCommand("t1", { type: "exposure", exposure: 1 }, true);
    expect(mockInvoke).toHaveBeenCalledWith("apply_command", expect.objectContaining({ replace: true }));
  });

  it("sends curve points and unit commands untouched", async () => {
    const points: [number, number][] = [
      [0, 0],
      [0.5, 0.8],
    ];
    await api.applyCommand("t1", { type: "curves", points });
    await api.applyCommand("t1", { type: "invert" });
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "apply_command", {
      tabId: "t1",
      command: { type: "curves", points },
      replace: false,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "apply_command", {
      tabId: "t1",
      command: { type: "invert" },
      replace: false,
    });
  });

  it("requests a preview at a given size", async () => {
    mockInvoke.mockResolvedValue("data:image/png;base64,PPP");

    await expect(api.previewCommand("t1", { type: "sketch" }, 512)).resolves.toBe("data:image/png;base64,PPP");
    expect(mockInvoke).toHaveBeenCalledWith("preview_command", {
      tabId: "t1",
      command: { type: "sketch" },
      maxSide: 512,
    });
  });

  it("sends the inpainting mask with its bounding box", async () => {
    await api.inpaintImage("t1", { b64: "bWFzaw==", x: 3, y: 4, width: 10, height: 5 });
    expect(mockInvoke).toHaveBeenCalledWith("inpaint_image", {
      tabId: "t1",
      maskB64: "bWFzaw==",
      maskX: 3,
      maskY: 4,
      maskWidth: 10,
      maskHeight: 5,
    });
  });
});

describe("tauri layer — failures", () => {
  it("propagates a backend rejection", async () => {
    mockInvoke.mockRejectedValue(new Error("backend exploded"));
    await expect(api.rotateImage("t1", 90)).rejects.toThrow("backend exploded");
  });
});

describe("prefs", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadPrefs()).toEqual({
      defaultExportFormat: "png",
      defaultJpegQuality: 90,
      gridSize: 50,
      language: "en",
      theme: "system",
    });
  });

  it("merges what is stored over the defaults", () => {
    localStorage.setItem("lciz-prefs", JSON.stringify({ gridSize: 25 }));
    expect(loadPrefs()).toMatchObject({ gridSize: 25, defaultJpegQuality: 90 });
  });

  it("falls back to the defaults on corrupted JSON", () => {
    localStorage.setItem("lciz-prefs", "{ not json");
    expect(loadPrefs().gridSize).toBe(50);
  });

  it("round-trips through save", () => {
    savePrefs({ defaultExportFormat: "webp", defaultJpegQuality: 70, gridSize: 10 });
    expect(loadPrefs()).toMatchObject({ defaultExportFormat: "webp", gridSize: 10 });
  });
});

describe("recent files", () => {
  it("starts empty", () => {
    expect(getRecentFiles()).toEqual([]);
  });

  it("recovers from corrupted storage", () => {
    localStorage.setItem("lciz-recent", "not json");
    expect(getRecentFiles()).toEqual([]);
  });

  it("puts the newest path first", () => {
    addRecentFile("/a.png");
    addRecentFile("/b.png");
    expect(getRecentFiles()).toEqual(["/b.png", "/a.png"]);
  });

  it("moves an existing path back to the front instead of duplicating it", () => {
    addRecentFile("/a.png");
    addRecentFile("/b.png");
    addRecentFile("/a.png");
    expect(getRecentFiles()).toEqual(["/a.png", "/b.png"]);
  });

  it("keeps at most ten entries", () => {
    for (let i = 0; i < 12; i += 1) addRecentFile(`/f${i}.png`);
    const list = getRecentFiles();
    expect(list).toHaveLength(10);
    expect(list[0]).toBe("/f11.png");
  });

  it("clears the list", () => {
    addRecentFile("/a.png");
    clearRecentFiles();
    expect(getRecentFiles()).toEqual([]);
  });
});
