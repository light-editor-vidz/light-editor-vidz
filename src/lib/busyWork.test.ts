import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { busyWork, confirmQuitWithBusyWork, markBusy } from "./busyWork";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const mockAsk = vi.mocked(ask);

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue([]);
});

describe("busyWork", () => {
  it("lists the declared work until it is withdrawn, without duplicates", async () => {
    const a = markBusy("quit.audioExport");
    const b = markBusy("quit.audioExport");
    const c = markBusy("quit.subtitles");
    expect(await busyWork()).toEqual(["quit.audioExport", "quit.subtitles"]);
    a();
    c();
    expect(await busyWork()).toEqual(["quit.audioExport"]);
    b();
    expect(await busyWork()).toEqual([]);
  });

  it("counts the video queue while a job waits or runs, not once they are finished", async () => {
    mockInvoke.mockResolvedValue([{ status: "done" }, { status: "running" }]);
    expect(await busyWork()).toEqual(["quit.videoExports"]);
    mockInvoke.mockResolvedValue([{ status: "queued" }]);
    expect(await busyWork()).toEqual(["quit.videoExports"]);
    mockInvoke.mockResolvedValue([{ status: "done" }, { status: "cancelled" }, { status: "error" }]);
    expect(await busyWork()).toEqual([]);
    expect(mockInvoke).toHaveBeenCalledWith("video_queue_list");
  });

  it("works without the queue (outside Tauri)", async () => {
    mockInvoke.mockRejectedValue(new Error("no tauri"));
    const done = markBusy("quit.imageExport");
    expect(await busyWork()).toEqual(["quit.imageExport"]);
    done();
  });
});

describe("confirmQuitWithBusyWork", () => {
  it("lets the app quit without asking when nothing runs", async () => {
    expect(await confirmQuitWithBusyWork()).toBe(true);
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it("asks, listing what would stop, and follows the answer", async () => {
    const done = markBusy("quit.projectExport");
    mockInvoke.mockResolvedValue([{ status: "running" }]);
    mockAsk.mockResolvedValue(false);
    expect(await confirmQuitWithBusyWork()).toBe(false);
    const [message, options] = mockAsk.mock.calls[0];
    expect(message).toContain("the project export");
    expect(message).toContain("the video exports in the queue");
    expect(options).toMatchObject({ kind: "warning", okLabel: "Quit anyway", cancelLabel: "Keep working" });
    mockAsk.mockResolvedValue(true);
    expect(await confirmQuitWithBusyWork()).toBe(true);
    done();
  });
});
