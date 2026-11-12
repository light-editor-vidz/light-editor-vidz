import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { cancelExport, exportProject, exportProjectAudio } from "../../lib/commands";
import TopBar from "./TopBar";
import { busyWork } from "../../lib/busyWork";
import { inertBridge } from "../../lib/menuBridge";
import type { Project } from "../../bindings/Project";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("../../lib/commands", () => ({
  exportProject: vi.fn(),
  exportProjectAudio: vi.fn(),
  cancelExport: vi.fn(),
  EXPORT_CANCELLED: "export-cancelled",
  AUDIO_FORMAT_EXTENSION: {
    wav16: "wav",
    wav24: "wav",
    wav32f: "wav",
    mp3: "mp3",
    flac: "flac",
    ogg: "ogg",
    m4a: "m4a",
  },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn(() => Promise.resolve()) }));

const mockListen = vi.mocked(listen);
const mockSave = vi.mocked(save);
const mockExport = vi.mocked(exportProject);
const mockExportAudio = vi.mocked(exportProjectAudio);

/** Progress handlers the bar registered, keyed by event name. */
let handlers: Record<string, (e: { payload: unknown }) => void>;

const project = {
  name: "My clip",
  width: 1920,
  height: 1080,
  fps: 30,
  compositions: [],
  audio_tracks: [],
} as unknown as Project;

function setup(props: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const handlersProps = { onNotice: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn() };
  const view = render(
    <TopBar
      project={project}
      projectDir="/p"
      saving={false}
      dirty={false}
      canUndo
      canRedo
      {...handlersProps}
      {...props}
    />,
  );
  return { ...handlersProps, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  mockListen.mockImplementation(((event: string, handler: unknown) => {
    handlers[event] = handler as (e: { payload: unknown }) => void;
    return Promise.resolve(() => {});
  }) as typeof listen);
  mockSave.mockResolvedValue(null);
  mockExport.mockResolvedValue({ missing_media: [] });
  mockExportAudio.mockResolvedValue({ missing_media: [] });
});

describe("TopBar — chrome", () => {
  it("shows the project name and its details on the left, like the other apps", async () => {
    setup();
    expect(screen.getByText("My clip")).toBeInTheDocument();
    expect(screen.getByText(/1920 × 1080 · 30fps/)).toBeInTheDocument();
    await act(async () => {});
  });

  it("has Undo, Redo and Export on the right, and no Save, brand or menu of its own", async () => {
    setup();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "File" })).toBeNull();
    await act(async () => {});
  });

  it("undoes and redoes from its buttons", async () => {
    const { onUndo, onRedo } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(onUndo).toHaveBeenCalled();
    expect(onRedo).toHaveBeenCalled();
    await act(async () => {});
  });

  it("greys out Undo and Redo when there is nothing to do", async () => {
    setup({ canUndo: false, canRedo: false });
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    await act(async () => {});
  });

  it("says when it is saving, and marks unsaved changes", async () => {
    const { rerender } = setup({ dirty: true });
    expect(screen.getByLabelText("Unsaved changes (autosave pending)")).toBeInTheDocument();
    rerender(
      <TopBar
        project={project}
        projectDir="/p"
        saving
        dirty
        canUndo
        canRedo
        onNotice={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Unsaved changes (autosave pending)")).not.toBeInTheDocument();
    expect(screen.getByText(/Saving/)).toBeInTheDocument();
    await act(async () => {});
  });

  it("lets the File menu open the export window", async () => {
    setup();
    await act(async () => {});

    act(() => inertBridge.actions.current.openExport?.());

    expect(await screen.findByText("Export video")).toBeInTheDocument();
  });
});

describe("TopBar — exporting", () => {
  async function openExportModal() {
    const view = setup();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await screen.findByText("Export video");
    // The toolbar also has an "Export" button, so confirm inside the modal only.
    const modal = screen.getByText("Export video").closest(".modal") as HTMLElement;
    const confirm = () => within(modal).getByRole("button", { name: /^Export$/ });
    return { ...view, confirm, onNotice: view.onNotice };
  }

  it("opens the export modal from the toolbar", async () => {
    await openExportModal();
    expect(screen.getByText("Export video")).toBeInTheDocument();
  });

  it("suggests a file name built from the project", async () => {
    const { confirm } = await openExportModal();

    await act(async () => {
      fireEvent.click(confirm());
    });

    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "My clip.mp4" }));
  });

  it("exports nothing when the save dialog is dismissed", async () => {
    const { confirm } = await openExportModal();

    await act(async () => {
      fireEvent.click(confirm());
    });

    expect(mockExport).not.toHaveBeenCalled();
  });

  it("runs the export and tracks its progress", async () => {
    mockSave.mockResolvedValue("/out.mp4");
    let release: () => void = () => {};
    mockExport.mockReturnValue(
      new Promise<{ missing_media: string[] }>((r) => {
        release = () => r({ missing_media: [] });
      }),
    );
    const { confirm } = await openExportModal();

    await act(async () => {
      fireEvent.click(confirm());
    });

    await waitFor(() => expect(mockExport).toHaveBeenCalled());
    act(() => handlers["export-progress"]?.({ payload: 0.5 }));
    expect(await screen.findByRole("button", { name: /Exporting.*50%/ })).toBeInTheDocument();
    // Quitter pendant l'export demande confirmation.
    expect(await busyWork()).toContain("quit.projectExport");

    await act(async () => {
      release();
    });
    expect(await busyWork()).not.toContain("quit.projectExport");
  });

  it("reports a failed export through a notice, with the reason", async () => {
    mockSave.mockResolvedValue("/out.mp4");
    mockExport.mockRejectedValue(new Error("ffmpeg missing"));
    const { confirm, onNotice } = await openExportModal();

    await act(async () => {
      fireEvent.click(confirm());
    });

    expect(onNotice).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "error", message: expect.stringContaining("ffmpeg missing") }),
    );
  });

  it("confirms a finished export and offers to show the file", async () => {
    mockSave.mockResolvedValue("/out.mp4");
    const { confirm, onNotice } = await openExportModal();

    await act(async () => {
      fireEvent.click(confirm());
    });

    const notice = onNotice.mock.calls[onNotice.mock.calls.length - 1]?.[0];
    expect(notice).toMatchObject({ kind: "info", message: "Export finished." });
    expect(notice.action.label).toBe("Show file");
  });

  it("warns about media that could not be read", async () => {
    mockSave.mockResolvedValue("/out.mp4");
    mockExport.mockResolvedValue({ missing_media: ["a.png", "b.mp4"] });
    const { confirm, onNotice } = await openExportModal();

    await act(async () => {
      fireEvent.click(confirm());
    });

    expect(onNotice).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "warning", details: ["a.png", "b.mp4"] }),
    );
  });

  it("treats a cancelled export as a simple notice, not an error", async () => {
    mockSave.mockResolvedValue("/out.mp4");
    mockExport.mockRejectedValue("export-cancelled");
    const { confirm, onNotice } = await openExportModal();

    await act(async () => {
      fireEvent.click(confirm());
    });

    expect(onNotice).toHaveBeenLastCalledWith({ kind: "info", message: "Export cancelled." });
  });

  it("lets the user cancel a running export", async () => {
    mockSave.mockResolvedValue("/out.mp4");
    mockExport.mockReturnValue(new Promise(() => {}));
    const { confirm } = await openExportModal();
    await act(async () => {
      fireEvent.click(confirm());
    });

    fireEvent.click(await screen.findByRole("button", { name: "Cancel export" }));

    expect(vi.mocked(cancelExport)).toHaveBeenCalled();
  });

  async function chooseAudioFormat(format: string) {
    const { confirm, onNotice } = await openExportModal();
    fireEvent.click(screen.getByRole("button", { name: "Audio only" }));
    fireEvent.click(screen.getByRole("button", { name: format }));
    return { confirm, onNotice };
  }

  it("exports the audio mix in the chosen format, under an extension-matching name", async () => {
    mockSave.mockResolvedValue("/out.flac");
    const { confirm, onNotice } = await chooseAudioFormat("FLAC");

    await act(async () => {
      fireEvent.click(confirm());
    });

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "My clip.flac",
        filters: [{ name: "FLAC audio file", extensions: ["flac"] }],
      }),
    );
    expect(mockExportAudio).toHaveBeenCalledWith("/p", expect.anything(), "/out.flac", "flac");
    expect(mockExport).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "info", message: "Export finished." }));
  });

  it("exports no audio when the save dialog is dismissed", async () => {
    mockSave.mockResolvedValue(null);
    const { confirm } = await chooseAudioFormat("MP3");

    await act(async () => {
      fireEvent.click(confirm());
    });

    expect(mockExportAudio).not.toHaveBeenCalled();
  });

  it("reports a failed audio export through a notice, with the reason", async () => {
    mockSave.mockResolvedValue("/out.wav");
    mockExportAudio.mockRejectedValue(new Error("The project has no audio to export."));
    const { confirm, onNotice } = await chooseAudioFormat("WAV 16-bit");

    await act(async () => {
      fireEvent.click(confirm());
    });

    expect(onNotice).toHaveBeenLastCalledWith({
      kind: "error",
      message: "Export failed: This project has no sound to transcribe or export.",
    });
  });

  it("falls back to a generic file name for an unnamed project", async () => {
    mockSave.mockResolvedValue(null);
    const view = render(
      <TopBar
        project={{ ...(project as object), name: "  " } as unknown as Project}
        projectDir="/p"
        saving={false}
        dirty={false}
        canUndo
        canRedo
        onNotice={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
      />,
    );
    await act(async () => {});
    fireEvent.click(view.getByRole("button", { name: "Export" }));
    const modal = (await view.findByText("Export video")).closest(".modal") as HTMLElement;

    await act(async () => {
      fireEvent.click(within(modal).getByRole("button", { name: /^Export$/ }));
    });

    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "video.mp4" }));
  });
});

describe("TopBar — subtitles", () => {
  it("offers the subtitles of the whole project", () => {
    const onGenerateSubtitles = vi.fn();
    setup({ onGenerateSubtitles });
    fireEvent.click(screen.getByRole("button", { name: "Generate subtitles…" }));
    expect(onGenerateSubtitles).toHaveBeenCalledTimes(1);
  });
});
