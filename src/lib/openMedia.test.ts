import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { importAsset, newProject } from "./commands";
import { createProjectFromMedia, mediaKind, pickMediaFile } from "./openMedia";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./commands", () => ({ newProject: vi.fn(), importAsset: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const mockNew = vi.mocked(newProject);
const mockImport = vi.mocked(importAsset);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pickMediaFile / mediaKind", () => {
  it("passent par les commandes du moteur", async () => {
    mockInvoke.mockResolvedValueOnce({ path: "/m/a.mp3", kind: "audio" }).mockResolvedValueOnce("video");

    expect(await pickMediaFile()).toEqual({ path: "/m/a.mp3", kind: "audio" });
    expect(await mediaKind("/m/b.mp4")).toBe("video");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "pick_media_file");
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "media_kind", { path: "/m/b.mp4" });
  });
});

describe("createProjectFromMedia", () => {
  it("crée un projet 1920×1080 à 30 i/s nommé d'après le fichier, à côté de lui", async () => {
    mockNew.mockResolvedValue("/home/me/clips/holiday.lvproj");
    mockImport.mockResolvedValue("assets/video/holiday.mp4");

    const created = await createProjectFromMedia("/home/me/clips/holiday.mp4", "video");

    expect(mockNew).toHaveBeenCalledWith({
      parent_dir: "/home/me/clips",
      name: "holiday",
      width: 1920,
      height: 1080,
      fps: 30,
    });
    expect(mockImport).toHaveBeenCalledWith("/home/me/clips/holiday.lvproj", "video", "/home/me/clips/holiday.mp4");
    expect(created).toEqual({
      dir: "/home/me/clips/holiday.lvproj",
      media: { kind: "video", src: "assets/video/holiday.mp4", name: "holiday.mp4" },
    });
  });

  it("garde les points d'un nom de fichier et retire seulement la dernière extension", async () => {
    mockNew.mockResolvedValue("/p/x");
    mockImport.mockResolvedValue("assets/image/a.png");

    await createProjectFromMedia("/pics/summer.2024.final.png", "image");

    expect(mockNew).toHaveBeenCalledWith(expect.objectContaining({ name: "summer.2024.final" }));
  });

  it("gère un fichier à la racine", async () => {
    mockNew.mockResolvedValue("/p/x");
    mockImport.mockResolvedValue("assets/image/a.png");

    await createProjectFromMedia("/a.png", "image");

    expect(mockNew).toHaveBeenCalledWith(expect.objectContaining({ parent_dir: "/", name: "a" }));
  });

  it("n'importe rien quand la création du projet échoue", async () => {
    mockNew.mockRejectedValue(new Error("exists"));

    await expect(createProjectFromMedia("/m/a.mp4", "video")).rejects.toThrow("exists");

    expect(mockImport).not.toHaveBeenCalled();
  });
});
