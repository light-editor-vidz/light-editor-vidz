import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { exportProject } from "../../lib/commands";
import TopBar from "./TopBar";
import type { Project } from "../../bindings/Project";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("../../lib/commands", () => ({ exportProject: vi.fn() }));

const mockListen = vi.mocked(listen);
const mockSave = vi.mocked(save);
const mockVersion = vi.mocked(getVersion);
const mockExport = vi.mocked(exportProject);

/** Progress handlers the bar registered, keyed by event name. */
let handlers: Record<string, (e: { payload: unknown }) => void>;

const project = {
  name: "My clip",
  width: 1920,
  height: 1080,
  fps: 30,
  compositions: [],
} as unknown as Project;

function setup(props: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const handlersProps = {
    onBack: vi.fn(),
    onSave: vi.fn(),
    onOpenProject: vi.fn(),
    onImportLegacy: vi.fn(),
    onOpenSettings: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onDeleteSelected: vi.fn(),
    onDuplicateSelected: vi.fn(),
  };
  const view = render(
    <TopBar
      project={project}
      projectDir="/p"
      saving={false}
      dirty={false}
      canUndo
      canRedo
      hasSelection
      {...handlersProps}
      {...props}
    />,
  );
  return { ...handlersProps, ...view };
}

const openMenu = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  mockListen.mockImplementation(((event: string, handler: unknown) => {
    handlers[event] = handler as (e: { payload: unknown }) => void;
    return Promise.resolve(() => {});
  }) as typeof listen);
  mockVersion.mockResolvedValue("0.2.1");
  mockSave.mockResolvedValue(null);
  mockExport.mockResolvedValue(undefined);
});

describe("TopBar — chrome", () => {
  it("offers the save and export buttons", async () => {
    setup();
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    await act(async () => {});
  });

  it("goes back from the brand button", async () => {
    const { onBack } = setup();
    fireEvent.click(screen.getByRole("button", { name: /My clip|light/i }));
    expect(onBack).toHaveBeenCalled();
    await act(async () => {});
  });

  it("saves on demand", async () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(onSave).toHaveBeenCalled();
    await act(async () => {});
  });

  it("shows a busy label and blocks saving while it runs", async () => {
    setup({ saving: true });
    const button = screen.getByRole("button", { name: /Saving/ });
    expect(button).toBeDisabled();
    await act(async () => {});
  });

  it("marks unsaved changes", async () => {
    setup({ dirty: true });
    expect(screen.getByLabelText("Unsaved changes (autosave pending)")).toBeInTheDocument();
    await act(async () => {});
  });

  it("hides the dirty marker while saving", async () => {
    setup({ dirty: true, saving: true });
    expect(screen.queryByLabelText("Unsaved changes (autosave pending)")).not.toBeInTheDocument();
    await act(async () => {});
  });
});

describe("TopBar — menus", () => {
  it("wires the File menu", async () => {
    const { onBack, onOpenProject, onImportLegacy, onOpenSettings } = setup();
    await act(async () => {});

    openMenu("File");
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    openMenu("File");
    fireEvent.click(screen.getByRole("button", { name: "Open project…" }));
    openMenu("File");
    fireEvent.click(screen.getByRole("button", { name: "Import legacy JSON…" }));
    openMenu("File");
    fireEvent.click(screen.getByRole("button", { name: "Settings…" }));

    expect(onBack).toHaveBeenCalled();
    expect(onOpenProject).toHaveBeenCalled();
    expect(onImportLegacy).toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("wires the Edit menu", async () => {
    const { onUndo, onRedo, onDeleteSelected, onDuplicateSelected } = setup();
    await act(async () => {});

    openMenu("Edit");
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    openMenu("Edit");
    fireEvent.click(screen.getByRole("button", { name: /Redo/ }));
    openMenu("Edit");
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    openMenu("Edit");
    fireEvent.click(screen.getByRole("button", { name: /Duplicate/ }));

    expect(onUndo).toHaveBeenCalled();
    expect(onRedo).toHaveBeenCalled();
    expect(onDeleteSelected).toHaveBeenCalled();
    expect(onDuplicateSelected).toHaveBeenCalled();
  });

  it("greys out what is unavailable", async () => {
    setup({ canUndo: false, canRedo: false, hasSelection: false });
    await act(async () => {});

    openMenu("Edit");

    expect(screen.getByRole("button", { name: /Undo/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Redo/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Delete/ })).toBeDisabled();
  });

  it("shows the app version in the help menu", async () => {
    setup();
    await waitFor(() => expect(mockVersion).toHaveBeenCalled());

    openMenu("?");

    expect(await screen.findByText(/0\.2\.1/)).toBeInTheDocument();
  });

  it("switches the interface language", async () => {
    setup();
    await act(async () => {});
    openMenu("?");

    fireEvent.click(screen.getByRole("button", { name: "FR" }));

    expect(await screen.findByRole("button", { name: "Enregistrer" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
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
    return { ...view, confirm };
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
      new Promise<void>((r) => {
        release = r;
      }),
    );
    const { confirm } = await openExportModal();

    await act(async () => {
      fireEvent.click(confirm());
    });

    await waitFor(() => expect(mockExport).toHaveBeenCalled());
    act(() => handlers["export-progress"]?.({ payload: 0.5 }));
    expect(await screen.findByRole("button", { name: /Exporting.*50%/ })).toBeInTheDocument();

    await act(async () => {
      release();
    });
  });

  it("reports a failed export", async () => {
    mockSave.mockResolvedValue("/out.mp4");
    mockExport.mockRejectedValue(new Error("ffmpeg missing"));
    const { confirm } = await openExportModal();

    await act(async () => {
      fireEvent.click(confirm());
    });

    // The banner stays short; the reason is only in its tooltip.
    const banner = await screen.findByText("Export failed");
    expect(banner).toHaveAttribute("title", expect.stringContaining("ffmpeg missing"));
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
        hasSelection
        onBack={vi.fn()}
        onSave={vi.fn()}
        onOpenProject={vi.fn()}
        onImportLegacy={vi.fn()}
        onOpenSettings={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDeleteSelected={vi.fn()}
        onDuplicateSelected={vi.fn()}
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
