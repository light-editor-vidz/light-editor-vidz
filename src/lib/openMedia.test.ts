import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { mediaKind, pickMediaFile } from "./openMedia";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockInvoke = vi.mocked(invoke);

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
