import "./setup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getApi, type QueueJob } from "../api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);
const mockAsk = vi.mocked(ask);

let handlers: Record<string, (e: { payload: unknown }) => void>;

/** L'API réelle (Tauri), sans la maquette que les tests de composants installent. */
function realApi() {
  window.electronAPI = {};
  return getApi();
}

const job = (over: Partial<QueueJob> = {}): QueueJob => ({
  id: 7,
  name: "out.mp4",
  format: "mp4",
  status: "queued",
  progress: 0,
  outputPath: "/videos/out.mp4",
  error: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  mockListen.mockImplementation(((event: string, handler: (e: { payload: unknown }) => void) => {
    handlers[event] = handler;
    return Promise.resolve(() => {});
  }) as unknown as typeof listen);
});

describe("video API — files", () => {
  it("opens a video through the engine dialog", async () => {
    mockInvoke.mockResolvedValue("/v/a.mp4");
    expect(await realApi().openVideo()).toBe("/v/a.mp4");
    expect(mockInvoke).toHaveBeenCalledWith("video_pick_file");
  });

  it("a file URL is authorised first, then served through the asset protocol", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const url = await realApi().toFileUrl("/v/a b.mp4");
    expect(mockInvoke).toHaveBeenCalledWith("audio_allow_asset", { path: "/v/a b.mp4" });
    expect(url).toBe("asset://localhost/%2Fv%2Fa%20b.mp4");
  });

  it("previews through the engine and returns a playable URL", async () => {
    mockInvoke.mockResolvedValue({ path: "/tmp/p.webm", transcoded: true });
    expect(await realApi().previewVideo("/v/a.avi")).toBe("asset://localhost/%2Ftmp%2Fp.webm");
    expect(mockInvoke).toHaveBeenCalledWith("video_preview", { path: "/v/a.avi", force: false });
  });

  it("reads a subtitle file as a path and its decoded content", async () => {
    mockInvoke.mockResolvedValueOnce({ path: "/s/a.srt", content: "1\n..." }).mockResolvedValueOnce(null);
    expect(await realApi().openSubtitleFile()).toEqual({ filePath: "/s/a.srt", content: "1\n..." });
    expect(await realApi().openSubtitleFile()).toBeNull();
  });

  it("no file path can be read from a DOM drop (drops go through the window)", () => {
    expect(realApi().getPathForFile(new File([""], "a.mp4"))).toBe("");
  });
});

describe("video API — saving", () => {
  it("returns the chosen path, or null when the dialog is closed", async () => {
    mockInvoke.mockResolvedValueOnce({ path: "/o/a.mp4", confirm_overwrite: false }).mockResolvedValueOnce(null);
    expect(await realApi().saveVideo("a.mp4", "mp4")).toBe("/o/a.mp4");
    expect(mockInvoke).toHaveBeenCalledWith("video_pick_output", { defaultName: "a.mp4", format: "mp4" });
    expect(await realApi().saveVideo()).toBeNull();
  });

  it("asks before replacing a file the native dialog did not confirm", async () => {
    mockInvoke.mockResolvedValue({ path: "/o/a.mp4", confirm_overwrite: true });
    mockAsk.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await realApi().saveVideo("a", "mp4")).toBe("/o/a.mp4");
    expect(mockAsk.mock.calls[0][0]).toBe("a.mp4 already exists. Replace it?");
    expect(await realApi().saveVideo("a", "mp4")).toBeNull();
  });
});

describe("video API — queue and capabilities", () => {
  it("forwards the queue commands", async () => {
    mockInvoke.mockResolvedValue(3);
    const api = realApi();
    expect(await api.queueAdd({ a: 1 })).toEqual({ id: 3 });
    expect(mockInvoke).toHaveBeenCalledWith("video_queue_add", { options: { a: 1 } });
    await api.queueCancel(3);
    await api.queueClearFinished();
    await api.getCapabilities();
    expect(mockInvoke).toHaveBeenCalledWith("video_queue_cancel", { id: 3 });
    expect(mockInvoke).toHaveBeenCalledWith("video_queue_clear_finished");
    expect(mockInvoke).toHaveBeenCalledWith("video_capabilities");
  });

  it("reveals only a finished job", async () => {
    mockInvoke.mockResolvedValue([job({ id: 1, status: "done" }), job({ id: 2, status: "running" })]);
    const api = realApi();
    await api.queueReveal(1);
    await api.queueReveal(2);
    await api.queueReveal(99);
    expect(revealItemInDir).toHaveBeenCalledTimes(1);
    expect(revealItemInDir).toHaveBeenCalledWith("/videos/out.mp4");
  });

  it("lists recents with the fields the list needs", async () => {
    mockInvoke.mockResolvedValue([{ path: "/v/a.mp4", name: "a.mp4", dir: "/v" }]);
    expect(await realApi().listRecent()).toEqual([
      { kind: "video", openedAt: 0, path: "/v/a.mp4", name: "a.mp4", dir: "/v" },
    ]);
    await realApi().removeRecent("/v/a.mp4");
    await realApi().clearRecent();
    expect(mockInvoke).toHaveBeenCalledWith("video_recent_forget", { path: "/v/a.mp4" });
    expect(mockInvoke).toHaveBeenCalledWith("video_recent_forget", { path: null });
  });

  it("subscribes to the queue and to the preview progress", async () => {
    const seen: QueueJob[][] = [];
    const off = realApi().onQueueUpdate((jobs) => seen.push(jobs));
    await Promise.resolve();
    handlers["video-queue"]({ payload: [job()] });
    expect(seen).toEqual([[job()]]);
    off();
    const progress: number[] = [];
    realApi().onPreviewProgress((p) => progress.push(p));
    await Promise.resolve();
    handlers["video-preview-progress"]({ payload: 40 });
    expect(progress).toEqual([40]);
  });
});

describe("video API — a dialog export waits for its job", () => {
  async function start() {
    mockInvoke.mockResolvedValue(7);
    const api = realApi();
    const progress: number[] = [];
    api.onProgress((p) => progress.push(p));
    const done = api.exportVideo({ inputPath: "/i", outputPath: "/videos/out.mp4" } as never);
    await vi.waitFor(() => expect(handlers["video-queue"]).toBeDefined());
    return { api, done, progress };
  }

  it("resolves when the job is done, reporting its progress on the way", async () => {
    const { done, progress } = await start();
    handlers["video-queue"]({ payload: [job({ status: "running", progress: 30 })] });
    handlers["video-queue"]({ payload: [job({ id: 99, status: "done" })] });
    handlers["video-queue"]({ payload: [job({ status: "done", progress: 100 })] });
    await expect(done).resolves.toEqual({ success: true, outputPath: "/videos/out.mp4" });
    expect(progress).toEqual([30, 100]);
  });

  it("rejects with the job error", async () => {
    const { done } = await start();
    handlers["video-queue"]({ payload: [job({ status: "error", error: "disk full" })] });
    await expect(done).rejects.toThrow("disk full");
  });

  it('rejects with "cancelled" when the job is cancelled, and Stop cancels it', async () => {
    const { api, done } = await start();
    await api.cancelFfmpeg();
    expect(mockInvoke).toHaveBeenCalledWith("video_queue_cancel", { id: 7 });
    expect(mockInvoke).toHaveBeenCalledWith("video_cancel_preview");
    handlers["video-queue"]({ payload: [job({ status: "cancelled" })] });
    await expect(done).rejects.toThrow("cancelled");
  });
});

describe("getApi", () => {
  it("lets a test double override single functions", async () => {
    window.electronAPI = { openVideo: async () => "/double.mp4" };
    expect(await getApi().openVideo()).toBe("/double.mp4");
  });
});
