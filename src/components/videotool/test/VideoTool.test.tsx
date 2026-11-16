import "./setup";
import { drop } from "./dndCapture";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import VideoTool from "../VideoTool";
import { inertBridge, TabActiveProvider } from "../../../lib/menuBridge";
import { runBeforeExit } from "../../../lib/lifecycle";

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  const { dnd } = await import("./dndCapture");
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      dnd.onDragEnd = props.onDragEnd;
      return <actual.DndContext {...props} />;
    },
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(), open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const mockAsk = vi.mocked(ask);

function setup(props: Partial<Parameters<typeof VideoTool>[0]> = {}, active = true) {
  const handlers = {
    onOpenFile: vi.fn(),
    onOpenPath: vi.fn(),
    onOpenAudio: vi.fn(),
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
    expect(previewVideo).toHaveBeenCalledWith("/v/a.mp4", false);
  });

  it("falls back to local streaming, then to a transcoded preview, when the video cannot be played", async () => {
    const { previewVideo, container } = setup({ path: "/v/a.mp4" });
    await screen.findByText("a.mp4");
    const fail = () =>
      act(async () => {
        fireEvent.error(container.querySelector("video")!);
      });
    const src = () => container.querySelector("video")!.getAttribute("src");

    await fail();
    expect(src()).toBe("stream:url:/v/a.mp4");
    expect(previewVideo).toHaveBeenCalledTimes(1);

    await fail();
    expect(previewVideo).toHaveBeenLastCalledWith("/v/a.mp4", true);
    await screen.findByText("a.mp4");
    expect(src()).toBe("url:/v/a.mp4");

    await fail();
    expect(src()).toBe("stream:url:/v/a.mp4");

    await fail();
    expect(previewVideo).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/cannot be played/)).toBeInTheDocument();
  });

  it("opens the subtitle window from the button next to Export", async () => {
    vi.mocked(invoke).mockImplementation((async (cmd: string) =>
      cmd === "get_settings"
        ? {
            stt_engine: "local",
            translation_engine: "local",
            azure_translator_region: "",
            language: "en",
            whisper_model: "base",
            stt_language: "auto",
          }
        : cmd === "has_api_key"
          ? false
          : []) as never);
    setup({ path: "/v/a.mp4" });
    await screen.findByText("a.mp4");
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles…" }));
    expect(await screen.findByRole("dialog", { name: "Generate subtitles" })).toBeInTheDocument();
  });

  it("undoes and redoes from the keyboard, the suite menu has no accelerator for it", async () => {
    setup({ path: "/v/a.mp4" });
    await screen.findByText("a.mp4");
    const undo = () => screen.getAllByRole("button").find((b) => b.title.startsWith("Undo"))!;
    expect(undo()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "2x" }));
    await waitFor(() => expect(undo()).toBeEnabled());

    fireEvent.keyDown(window, { key: "z", code: "KeyZ", ctrlKey: true });
    await waitFor(() => expect(undo()).toBeDisabled());

    fireEvent.keyDown(window, { key: "y", code: "KeyY", ctrlKey: true });
    await waitFor(() => expect(undo()).toBeEnabled());
  });

  it("the history lists the steps and jumps back to the clicked one", async () => {
    setup({ path: "/v/a.mp4" });
    await screen.findByText("a.mp4");
    const undo = () => screen.getAllByRole("button").find((b) => b.title.startsWith("Undo"))!;
    fireEvent.click(screen.getByRole("button", { name: "2x" }));
    fireEvent.click(screen.getByRole("button", { name: /Sound On/ }));
    await waitFor(() => expect(undo()).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    const panel = screen.getByRole("complementary", { name: "History" });
    const steps = within(panel).getByRole("list");
    expect(
      within(steps)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Opened", "Speed", "Sound off"]);

    fireEvent.click(within(steps).getByRole("button", { name: "Opened" }));
    await waitFor(() => expect(undo()).toBeDisabled());
    expect(screen.getByRole("button", { name: /Sound On/ })).toBeInTheDocument();
    act(() => inertBridge.actions.current.toggleHistory?.());
    expect(screen.queryByRole("complementary", { name: "History" })).not.toBeInTheDocument();
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

describe("VideoTool — sequences", () => {
  const scenes = [
    { start: 0, end: 4 },
    { start: 4, end: 9 },
  ];

  it("merges the chosen sequences into one video that becomes the source", async () => {
    const detectScenes = vi.fn(async () => scenes);
    const mergeSequences = vi.fn(async () => "/tmp/lev_merge_1.mp4");
    const { previewVideo } = setup({ path: "/v/a.mp4" });
    window.electronAPI = { ...window.electronAPI, detectScenes, mergeSequences };
    await screen.findByText("a.mp4");

    fireEvent.click(screen.getByRole("button", { name: "Split into sequences" }));
    const dialog = await screen.findByRole("dialog", { name: "Split into sequences" });
    await within(dialog).findByText("Sequence 1");
    act(() => drop(0, 1)); // Sequence 1 dropped on Sequence 2
    fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));

    await screen.findByText("lev_merge_1.mp4");
    expect(mergeSequences).toHaveBeenCalledWith("/v/a.mp4", [
      { start: 4, end: 9 },
      { start: 0, end: 4 },
    ]);
    expect(previewVideo).toHaveBeenLastCalledWith("/tmp/lev_merge_1.mp4", false);
    expect(screen.queryByRole("dialog", { name: "Split into sequences" })).toBeNull();
  });

  it("keeps the opened video and tells when the merge fails", async () => {
    const mergeSequences = vi.fn(async () => {
      throw new Error("ffmpeg");
    });
    const { previewVideo } = setup({ path: "/v/a.mp4" });
    window.electronAPI = { ...window.electronAPI, detectScenes: async () => scenes, mergeSequences };
    await screen.findByText("a.mp4");

    fireEvent.click(screen.getByRole("button", { name: "Split into sequences" }));
    const dialog = await screen.findByRole("dialog", { name: "Split into sequences" });
    await within(dialog).findByText("Sequence 1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));

    expect(await screen.findByText("Could not merge the sequences.")).toBeInTheDocument();
    expect(previewVideo).toHaveBeenCalledTimes(1);
    expect(screen.getByText("a.mp4")).toBeInTheDocument();
  });
});

describe("VideoTool — audio track", () => {
  it("separates the audio track and opens it in the Audio tool", async () => {
    const extractAudio = vi.fn(async () => "/v/a (audio).m4a");
    const { onOpenAudio } = setup({ path: "/v/a.mp4" });
    window.electronAPI = { ...window.electronAPI, extractAudio };
    await screen.findByText("a.mp4");

    fireEvent.click(screen.getByRole("button", { name: "Separate the audio track" }));

    await waitFor(() => expect(onOpenAudio).toHaveBeenCalledWith("/v/a (audio).m4a"));
    expect(extractAudio).toHaveBeenCalledWith("/v/a.mp4");
    expect(screen.getByText("a.mp4")).toBeInTheDocument(); // the video stays open
  });

  it("tells when the video has no audio track, and opens nothing", async () => {
    const { onOpenAudio } = setup({ path: "/v/a.mp4" });
    window.electronAPI = { ...window.electronAPI, extractAudio: async () => null };
    await screen.findByText("a.mp4");

    fireEvent.click(screen.getByRole("button", { name: "Separate the audio track" }));

    expect(await screen.findByText("This video has no audio track.")).toBeInTheDocument();
    expect(onOpenAudio).not.toHaveBeenCalled();
  });

  it("tells when the separation fails", async () => {
    const { onOpenAudio } = setup({ path: "/v/a.mp4" });
    window.electronAPI = {
      ...window.electronAPI,
      extractAudio: async () => {
        throw new Error("ffmpeg");
      },
    };
    await screen.findByText("a.mp4");

    fireEvent.click(screen.getByRole("button", { name: "Separate the audio track" }));

    expect(await screen.findByText("Could not separate the audio track.")).toBeInTheDocument();
    expect(onOpenAudio).not.toHaveBeenCalled();
  });
});
