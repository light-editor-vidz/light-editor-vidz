import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { assetUrl, mediaMimeType } from "./assetUrl";
import * as commands from "./commands";
import { startHorizontalDrag } from "./pointerDrag";
import { loadApiKeys, saveApiKeys } from "./settings";
import type { Project } from "../bindings/Project";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURIComponent(p)}`),
}));
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const mockLoad = vi.mocked(load);

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined);
});

describe("assetUrl", () => {
  it("joins the project directory and the relative path", () => {
    assetUrl("/home/me/p.lvproj", "assets/images/a.png");
    expect(convertFileSrc).toHaveBeenCalledWith("/home/me/p.lvproj/assets/images/a.png");
  });

  it("does not double the separator when the directory already ends with one", () => {
    assetUrl("/home/me/p.lvproj/", "assets/a.png");
    expect(convertFileSrc).toHaveBeenCalledWith("/home/me/p.lvproj/assets/a.png");
  });

  it("returns whatever Tauri produced", () => {
    expect(assetUrl("/p", "a.png")).toContain("asset://localhost/");
  });
});

describe("mediaMimeType", () => {
  it.each([
    ["clip.mp4", "video/mp4"],
    ["clip.m4v", "video/mp4"],
    ["clip.mov", "video/quicktime"],
    ["clip.webm", "video/webm"],
    ["clip.mkv", "video/x-matroska"],
    ["clip.avi", "video/x-msvideo"],
    ["song.mp3", "audio/mpeg"],
    ["song.wav", "audio/wav"],
    ["song.ogg", "audio/ogg"],
    ["song.oga", "audio/ogg"],
    ["song.opus", "audio/ogg"],
    ["song.m4a", "audio/mp4"],
    ["song.aac", "audio/aac"],
    ["song.flac", "audio/flac"],
  ])("maps %s to %s", (path, expected) => {
    expect(mediaMimeType(path)).toBe(expected);
  });

  it("ignores the case of the extension", () => {
    expect(mediaMimeType("CLIP.MP4")).toBe("video/mp4");
  });

  it("falls back to mp4 for an unknown extension", () => {
    expect(mediaMimeType("file.xyz")).toBe("video/mp4");
  });

  it("falls back to mp4 when there is no extension at all", () => {
    expect(mediaMimeType("noextension")).toBe("video/mp4");
  });

  it("uses the last extension of a multi-dotted name", () => {
    expect(mediaMimeType("my.song.flac")).toBe("audio/flac");
  });
});

describe("commands", () => {
  const project = { scenes: [] } as unknown as Project;

  it("creates a project from its arguments", async () => {
    const args = { parent_dir: "/home/me", name: "clip", width: 1920, height: 1080, fps: 30 };
    await commands.newProject(args);
    expect(mockInvoke).toHaveBeenCalledWith("new_project", { args });
  });

  it.each([
    ["loadProject", () => commands.loadProject("/p"), "load_project", { projectDir: "/p" }],
    ["readTextFile", () => commands.readTextFile("/f.txt"), "read_text_file", { path: "/f.txt" }],
    [
      "readMediaFile",
      () => commands.readMediaFile("/p", "a.mp4"),
      "read_media_file",
      { projectDir: "/p", relativeSrc: "a.mp4" },
    ],
    [
      "importAsset",
      () => commands.importAsset("/p", "image", "/tmp/a.png"),
      "import_asset",
      { projectDir: "/p", kind: "image", sourcePath: "/tmp/a.png" },
    ],
    ["listAssets", () => commands.listAssets("/p", "audio"), "list_assets", { projectDir: "/p", kind: "audio" }],
    [
      "searchStockAssets",
      () => commands.searchStockAssets("video", "cats"),
      "search_stock_assets",
      { kind: "video", query: "cats" },
    ],
    [
      "importStockAsset",
      () => commands.importStockAsset("/p", "image", "https://x/a.png", "a.png"),
      "import_stock_asset",
      { projectDir: "/p", kind: "image", url: "https://x/a.png", filename: "a.png" },
    ],
  ])("%s forwards its payload", async (_name, call, command, payload) => {
    await call();
    expect(mockInvoke).toHaveBeenCalledWith(command, payload);
  });

  it("lists recent projects without a payload", async () => {
    await commands.listRecentProjects();
    expect(mockInvoke).toHaveBeenCalledWith("list_recent_projects");
  });

  it("saves a project", async () => {
    await commands.saveProject("/p", project);
    expect(mockInvoke).toHaveBeenCalledWith("save_project", { projectDir: "/p", project });
  });

  it("exports a project with its options", async () => {
    const options = { width: 1280, height: 720, fps: 30, crf: 23 };
    await commands.exportProject("/p", project, "/out.mp4", options);
    expect(mockInvoke).toHaveBeenCalledWith("export_project", {
      projectDir: "/p",
      project,
      outputPath: "/out.mp4",
      options,
    });
  });

  it("returns what the backend resolved with", async () => {
    mockInvoke.mockResolvedValueOnce([{ path: "/a", name: "a", width: 1, height: 1, duration: 0 }]);
    await expect(commands.listRecentProjects()).resolves.toHaveLength(1);
  });

  it("propagates a backend failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("ffmpeg missing"));
    await expect(
      commands.exportProject("/p", project, "/out.mp4", {
        width: null,
        height: null,
        fps: null,
        crf: null,
      }),
    ).rejects.toThrow("ffmpeg missing");
  });
});

describe("startHorizontalDrag", () => {
  function pointerEvent(clientX: number) {
    return {
      clientX,
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as React.PointerEvent;
  }

  it("swallows the originating event", () => {
    const e = pointerEvent(100);
    startHorizontalDrag(e, vi.fn());
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("reports the horizontal delta from the starting point", () => {
    const onMove = vi.fn();
    startHorizontalDrag(pointerEvent(100), onMove);

    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 150 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 60 }));

    expect(onMove).toHaveBeenNthCalledWith(1, 50);
    expect(onMove).toHaveBeenNthCalledWith(2, -40);
    window.dispatchEvent(new PointerEvent("pointerup"));
  });

  it("stops listening once the pointer is released", () => {
    const onMove = vi.fn();
    startHorizontalDrag(pointerEvent(0), onMove);

    window.dispatchEvent(new PointerEvent("pointerup"));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 999 }));

    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("settings", () => {
  it("returns the stored API keys", async () => {
    const get = vi.fn().mockResolvedValue({ pexels: "abc" });
    mockLoad.mockResolvedValue({ get } as never);

    await expect(loadApiKeys()).resolves.toEqual({ pexels: "abc" });
    expect(mockLoad).toHaveBeenCalledWith("settings.json");
    expect(get).toHaveBeenCalledWith("apiKeys");
  });

  it("returns an empty object when nothing is stored yet", async () => {
    mockLoad.mockResolvedValue({ get: vi.fn().mockResolvedValue(undefined) } as never);
    await expect(loadApiKeys()).resolves.toEqual({});
  });

  it("writes the keys and flushes the store", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn().mockResolvedValue(undefined);
    mockLoad.mockResolvedValue({ set, save } as never);

    await saveApiKeys({ pixabay: "xyz" });

    expect(set).toHaveBeenCalledWith("apiKeys", { pixabay: "xyz" });
    expect(save).toHaveBeenCalled();
  });
});
