import "./setup";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ask } from "@tauri-apps/plugin-dialog";
import VideoTool from "../VideoTool";
import { inertBridge, TabActiveProvider } from "../../../lib/menuBridge";
import { runBeforeExit } from "../../../lib/lifecycle";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(), open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const mockAsk = vi.mocked(ask);

function setup(props: Partial<Parameters<typeof VideoTool>[0]> = {}, active = true) {
  const handlers = {
    onOpenFile: vi.fn(),
    onOpenPath: vi.fn(),
    onClose: vi.fn(),
    registerCloseGuard: vi.fn(() => () => {}),
  };
  const previewVideo = vi.fn(async (p: string) => `url:${p}`);
  window.electronAPI = { ...window.electronAPI, previewVideo, listRecent: vi.fn(async () => []) };
  const tree = (isActive: boolean) => (
    <TabActiveProvider value={isActive}>
      <VideoTool path={null} {...handlers} {...props} />
    </TabActiveProvider>
  );
  const view = render(tree(active));
  return { ...handlers, previewVideo, ...view, tree };
}

beforeEach(() => {
  vi.clearAllMocks();
  inertBridge.actions.current = {};
  mockAsk.mockResolvedValue(true);
});

describe("VideoTool — empty view", () => {
  it("shows the drop zone and the recent list, and opens files through the window", async () => {
    const { onOpenFile } = setup();
    await act(async () => {});

    expect(screen.getByText("Drop a video file here")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Browse files" }));

    expect(onOpenFile).toHaveBeenCalled();
  });

  it("does not prepare anything without a path", async () => {
    const { previewVideo } = setup();
    await act(async () => {});
    expect(previewVideo).not.toHaveBeenCalled();
  });
});

describe("VideoTool — opening a video", () => {
  it("prepares the preview of the path once", async () => {
    const { previewVideo, rerender, tree } = setup({ path: "/v/a.mp4" });
    await act(async () => {});

    rerender(tree(true));
    await act(async () => {});

    expect(previewVideo).toHaveBeenCalledTimes(1);
    expect(previewVideo).toHaveBeenCalledWith("/v/a.mp4");
  });

  it("shows the video editor once the preview is ready", async () => {
    setup({ path: "/v/a.mp4" });

    expect(await screen.findByText("a.mp4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it('"Open a video" goes through the window file choice', async () => {
    const { onOpenFile } = setup({ path: "/v/a.mp4" });
    await screen.findByText("a.mp4");

    fireEvent.click(screen.getByRole("button", { name: /open/i }));

    expect(onOpenFile).toHaveBeenCalled();
  });
});

describe("VideoTool — closing and menu", () => {
  it("registers a guard that lets a clean video go without asking", async () => {
    const { registerCloseGuard } = setup({ path: "/v/a.mp4" });
    await screen.findByText("a.mp4");
    const guard = (
      registerCloseGuard.mock.calls[registerCloseGuard.mock.calls.length - 1] as unknown as [() => Promise<boolean>]
    )[0];

    expect(await guard()).toBe(true);
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it("the window close also waits for the same confirmation", async () => {
    setup({ path: "/v/a.mp4" });
    await screen.findByText("a.mp4");

    expect(await runBeforeExit()).toBe(true);
  });

  it("Close tab of the menu closes a clean video", async () => {
    const { onClose } = setup({ path: "/v/a.mp4" });
    await screen.findByText("a.mp4");

    await act(async () => inertBridge.actions.current.closeProject?.());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("the menu opens the export window once a video is open", async () => {
    setup({ path: "/v/a.mp4" });
    await screen.findByText("a.mp4");

    act(() => inertBridge.actions.current.openExport?.());

    expect(await screen.findAllByText("Export")).not.toHaveLength(0);
  });

  it("a hidden tab registers nothing in the menu and ignores the keyboard", async () => {
    setup({ path: "/v/a.mp4" }, false);
    await act(async () => {});

    expect(inertBridge.actions.current.undo).toBeUndefined();
    expect(inertBridge.actions.current.openExport).toBeUndefined();
  });
});
