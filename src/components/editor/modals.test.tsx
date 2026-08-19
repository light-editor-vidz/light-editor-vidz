import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { loadApiKeys, saveApiKeys } from "../../lib/settings";
import ExportModal from "./ExportModal";
import SettingsModal from "./SettingsModal";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../lib/settings", () => ({ loadApiKeys: vi.fn(), saveApiKeys: vi.fn() }));

const mockOpenUrl = vi.mocked(openUrl);
const mockLoad = vi.mocked(loadApiKeys);
const mockSave = vi.mocked(saveApiKeys);

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockResolvedValue({});
  mockSave.mockResolvedValue(undefined);
});

describe("ExportModal", () => {
  function setup(props: Partial<Parameters<typeof ExportModal>[0]> = {}) {
    const onExport = vi.fn();
    const onClose = vi.fn();
    const view = render(
      <ExportModal
        projectWidth={1920}
        projectHeight={1080}
        projectFps={30}
        onExport={onExport}
        onClose={onClose}
        exporting={false}
        {...props}
      />,
    );
    return { onExport, onClose, ...view };
  }

  const exportButton = () => screen.getByRole("button", { name: /^Export$/ });

  it("recalls the project settings in the subtitle", () => {
    setup();
    expect(screen.getByText("Project settings: 1920×1080 · 30fps")).toBeInTheDocument();
  });

  it("starts on the original resolution, frame rate and medium quality", () => {
    const { container } = setup();
    const selected = [...container.querySelectorAll(".fps-option.selected")].map((b) => b.textContent);
    expect(selected).toEqual(["Original", "Original", "Medium"]);
  });

  it("exports untouched dimensions and frame rate by default", () => {
    const { onExport } = setup();

    fireEvent.click(exportButton());

    expect(onExport).toHaveBeenCalledWith({ width: null, height: null, fps: null, crf: 23 });
  });

  it.each([
    ["1080p", 1920, 1080],
    ["720p", 1280, 720],
    ["480p", 854, 480],
  ])("scales to %s keeping the aspect ratio", (label, width, height) => {
    const { onExport } = setup();

    fireEvent.click(screen.getByText(label));
    fireEvent.click(exportButton());

    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ width, height }));
  });

  it("never upscales past the project height", () => {
    const { onExport } = setup({ projectWidth: 1280, projectHeight: 720 });

    fireEvent.click(screen.getByText("1080p"));
    fireEvent.click(exportButton());

    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ width: 1280, height: 720 }));
  });

  it("rounds the scaled size to even numbers", () => {
    const { onExport } = setup({ projectWidth: 1001, projectHeight: 1000 });

    fireEvent.click(screen.getByText("720p"));
    fireEvent.click(exportButton());

    const call = onExport.mock.calls[0][0] as { width: number; height: number };
    expect(call.width % 2).toBe(0);
    expect(call.height % 2).toBe(0);
  });

  it.each([24, 30, 60])("exports at %i fps when chosen", (fps) => {
    const { onExport } = setup();

    fireEvent.click(screen.getByText(String(fps)));
    fireEvent.click(exportButton());

    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ fps }));
  });

  it.each([
    ["High", 18],
    ["Medium", 23],
    ["Low", 28],
  ])("maps %s quality to crf %i", (label, crf) => {
    const { onExport } = setup();

    fireEvent.click(screen.getByText(label));
    fireEvent.click(exportButton());

    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ crf }));
  });

  it("shows a busy label and locks the buttons while exporting", () => {
    setup({ exporting: true });
    expect(screen.getByRole("button", { name: /Exporting/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("closes from cancel and the backdrop, but not the panel", () => {
    const { onClose, container } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByText("Export video"));
    fireEvent.click(container.querySelector(".modal-backdrop")!);

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("SettingsModal", () => {
  const keyFields = () => screen.getAllByPlaceholderText("Paste API key…") as HTMLInputElement[];

  it("lists every provider", async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    expect(screen.getByText("Pexels")).toBeInTheDocument();
    expect(screen.getByText("Pixabay")).toBeInTheDocument();
    expect(screen.getByText("Freesound")).toBeInTheDocument();
    await act(async () => {});
  });

  it("locks the fields until the stored keys arrive", async () => {
    let resolve: (v: Record<string, string>) => void = () => {};
    mockLoad.mockReturnValue(
      new Promise((r) => {
        resolve = r as never;
      }) as never,
    );
    render(<SettingsModal onClose={vi.fn()} />);

    expect(keyFields()[0]).toBeDisabled();

    await act(async () => resolve({}));
    expect(keyFields()[0]).toBeEnabled();
  });

  it("prefills the stored keys", async () => {
    mockLoad.mockResolvedValue({ pexels: "abc", freesound: "xyz" });
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => expect(keyFields()[0]).toHaveValue("abc"));
    expect(keyFields()[2]).toHaveValue("xyz");
  });

  it("saves the edited keys and closes", async () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    await waitFor(() => expect(keyFields()[0]).toBeEnabled());

    fireEvent.change(keyFields()[1], { target: { value: "pixabay-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ pixabay: "pixabay-key" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the modal open and shows the reason when saving fails", async () => {
    const onClose = vi.fn();
    mockSave.mockRejectedValue(new Error("store locked"));
    render(<SettingsModal onClose={onClose} />);
    await waitFor(() => expect(keyFields()[0]).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/store locked/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the reason when the keys cannot be read", async () => {
    mockLoad.mockRejectedValue(new Error("store unreadable"));
    render(<SettingsModal onClose={vi.fn()} />);

    expect(await screen.findByText(/store unreadable/)).toBeInTheDocument();
  });

  it("opens a provider's website", async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    await act(async () => {});

    fireEvent.click(screen.getAllByRole("button", { name: /Open website/ })[0]);

    expect(mockOpenUrl).toHaveBeenCalledWith("https://www.pexels.com/api/");
  });

  it("closes from cancel and the backdrop, but not the panel", async () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal onClose={onClose} />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByText("Settings"));
    fireEvent.click(container.querySelector(".modal-backdrop")!);

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
