import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acquireMediaObjectUrl } from "./mediaCache";
import { useMediaSource } from "./useMediaSource";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./assetUrl", () => ({ streamUrl: () => "lvmedia://v" }));
vi.mock("./mediaCache", () => ({ acquireMediaObjectUrl: vi.fn() }));

describe("repli d'une vidéo dont on lit les pixels", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue("http://127.0.0.1:1/token");
    vi.mocked(acquireMediaObjectUrl).mockReturnValue({ promise: Promise.resolve("blob:v"), release: () => {} });
  });

  async function fallenBack(readablePixels: boolean) {
    const { result } = renderHook(() => useMediaSource("/p", "v.mp4", { readablePixels }));
    act(() => result.current.fallBack());
    await waitFor(() => expect(result.current.usingBlob && result.current.src).toBeTruthy());
    return result.current.src;
  }

  it("prend le flux HTTP local pour une lecture ordinaire", async () => {
    expect(await fallenBack(false)).toBe("http://127.0.0.1:1/token");
  });

  // WebKitGTK interdit à un canvas de lire les pixels d'une vidéo servie par ce flux.
  it("prend l'URL blob quand un canvas doit lire les pixels (fond vert)", async () => {
    expect(await fallenBack(true)).toBe("blob:v");
    expect(invoke).not.toHaveBeenCalled();
  });
});
