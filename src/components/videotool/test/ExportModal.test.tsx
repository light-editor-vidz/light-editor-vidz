import "./setup";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor, act, cleanup } from "@testing-library/react";
import ExportModal from "../components/ExportModal";
import { LangProvider } from "../i18n";
import type { EditorState } from "../types";

const baseState: EditorState = {
  videoPath: "/tmp/clip.mp4",
  videoUrl: "file:///tmp/clip.mp4",
  duration: 100,
  speed: 1,
  muted: false,
  cutSegments: [],
  crop: null,
  filter: "none",
  rotation: 0,
  straighten: 0,
  perspectiveHorizontal: 0,
  perspectiveVertical: 0,
  subtitles: null,
  stabilize: "off",
};

function r(state: Partial<EditorState> = {}, onClose = vi.fn()) {
  return render(
    <LangProvider>
      <ExportModal state={{ ...baseState, ...state }} onClose={onClose} />
    </LangProvider>,
  );
}

describe("ExportModal", () => {
  beforeEach(() => {
    window.electronAPI = {
      ...window.electronAPI,
      onProgress: () => () => {},
      saveVideo: vi.fn().mockResolvedValue("/tmp/out.mp4"),
      exportVideo: vi.fn().mockResolvedValue({ success: true, outputPath: "/tmp/out.mp4" }),
    };
  });

  it("renders the modal with all format cards", () => {
    const { container } = r();
    expect(container.querySelectorAll(".format-card")).toHaveLength(5);
  });

  it("starts with MP4 selected by default", () => {
    const { container } = r();
    const selected = container.querySelector(".format-card.selected")!;
    expect(selected.textContent).toContain("MP4");
  });

  it("selects a different format when clicked", () => {
    const { container } = r();
    const webm = Array.from(container.querySelectorAll(".format-card")).find((c) => c.textContent?.includes("WebM"))!;
    fireEvent.click(webm);
    expect(webm.className).toContain("selected");
  });

  it("shows the kept duration in summary", () => {
    const { container } = r({ duration: 60 });
    expect(container.textContent).toMatch(/1:00/);
  });

  it("shows the audio status in summary (sound on)", () => {
    const { container } = r({ muted: false });
    expect(container.textContent).toMatch(/sound on|son activé|on|activé/i);
  });

  it("shows the audio status in summary (muted)", () => {
    const { container } = r({ muted: true });
    expect(container.textContent).toMatch(/muted|muet/i);
  });

  it("shows crop dimensions in summary", () => {
    const { container } = r({ crop: { x: 0, y: 0, w: 400, h: 200 } });
    expect(container.textContent).toMatch(/400×200/);
  });

  it('shows "None" when no crop is set', () => {
    const { container } = r({ crop: null });
    expect(container.textContent).toMatch(/none|aucun/i);
  });

  it("shows cut count when segments exist", () => {
    const { container } = r({
      cutSegments: [
        { id: "a", start: 0, end: 10 },
        { id: "b", start: 20, end: 30 },
      ],
    });
    expect(container.textContent).toMatch(/2 segment/i);
  });

  it("shows current speed in summary", () => {
    const { container } = r({ speed: 1.5 });
    expect(container.textContent).toMatch(/1\.5x/);
  });

  it("shows current filter name in summary", () => {
    const { container } = r({ filter: "grayscale" });
    expect(container.textContent).toMatch(/grayscale|gris/i);
  });

  it("shows the geometry summary line", () => {
    const { container } = r({ rotation: 90, straighten: 5, perspectiveHorizontal: 10, perspectiveVertical: -5 });
    // 90 + 5 = 95° / H: 10 / V: -5
    expect(container.textContent).toMatch(/95°.*10.*-5/);
  });

  it("closes when the close button is clicked", () => {
    const onClose = vi.fn();
    const { container } = r({}, onClose);
    fireEvent.click(container.querySelector(".modal-close")!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when the cancel button is clicked", () => {
    const onClose = vi.fn();
    r({}, onClose);
    fireEvent.click(screen.getByText(/cancel|annuler/i));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when clicking the modal backdrop", () => {
    const onClose = vi.fn();
    const { container } = r({}, onClose);
    fireEvent.click(container.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close when clicking inside the modal body", () => {
    const onClose = vi.fn();
    const { container } = r({}, onClose);
    fireEvent.click(container.querySelector(".modal")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("invokes saveVideo + exportVideo when export is clicked", async () => {
    const saveVideo = vi.fn().mockResolvedValue("/tmp/out.mp4");
    const exportVideo = vi.fn().mockResolvedValue({ success: true, outputPath: "/tmp/out.mp4" });
    window.electronAPI = { ...window.electronAPI, saveVideo, exportVideo };
    r();
    fireEvent.click(screen.getByRole("button", { name: /^export(er)?$/i }));
    await waitFor(() => expect(saveVideo).toHaveBeenCalled());
    await waitFor(() => expect(exportVideo).toHaveBeenCalled());
  });

  it("does not call exportVideo when the save dialog is cancelled", async () => {
    const exportVideo = vi.fn().mockResolvedValue({ success: true, outputPath: "" });
    window.electronAPI = {
      ...window.electronAPI,
      saveVideo: vi.fn().mockResolvedValue(null),
      exportVideo,
    };
    r();
    fireEvent.click(screen.getByRole("button", { name: /^export(er)?$/i }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(exportVideo).not.toHaveBeenCalled();
  });
});

describe("ExportModal — fixes", () => {
  beforeEach(() => {
    window.electronAPI = {
      ...window.electronAPI,
      onProgress: () => () => {},
      saveVideo: vi.fn().mockResolvedValue("/tmp/out.mp4"),
      cancelFfmpeg: vi.fn().mockResolvedValue(undefined),
      exportVideo: vi.fn().mockResolvedValue({ success: true, outputPath: "/tmp/out.mp4" }),
    };
  });

  const exportBtn = () => screen.getByRole("button", { name: /^export(er)?$/i });

  it("asks for a file name with the chosen format, so the dialog filters on it", async () => {
    r();
    fireEvent.click(
      Array.from(document.querySelectorAll(".format-card")).find((c) => c.textContent?.includes("WebM"))!,
    );
    fireEvent.click(exportBtn());
    await waitFor(() => expect(window.electronAPI.saveVideo).toHaveBeenCalledWith("clip_edit.webm", "webm"));
  });

  it("derives the suggested name from a Windows-style path too", async () => {
    r({ videoPath: "C:\\Users\\me\\Videos\\holiday.mov" });
    fireEvent.click(exportBtn());
    await waitFor(() => expect(window.electronAPI.saveVideo).toHaveBeenCalledWith("holiday_edit.mp4", "mp4"));
  });

  it("no longer sends a duration the main process ignores", async () => {
    r();
    fireEvent.click(exportBtn());
    await waitFor(() => expect(window.electronAPI.exportVideo).toHaveBeenCalled());
    expect(vi.mocked(window.electronAPI.exportVideo!).mock.calls[0][0]).not.toHaveProperty("duration");
  });

  // The exported clip plays the kept parts at `speed`.
  it("shows the real output duration at 2x speed", () => {
    const { container } = r({ duration: 60, speed: 2 });
    expect(container.querySelector(".summary-value")?.textContent).toBe("0:30");
  });

  describe("when every part is cut", () => {
    const allCut = { cutSegments: [{ id: "a", start: 0, end: 100 }] };

    it("explains why there is nothing to export and disables the button", () => {
      const { container } = r(allCut);
      expect(container.querySelector(".export-error")).toBeTruthy();
      expect(exportBtn()).toBeDisabled();
    });

    it("never opens the save dialog", () => {
      r(allCut);
      fireEvent.click(exportBtn());
      expect(window.electronAPI.saveVideo).not.toHaveBeenCalled();
    });
  });

  describe("while an export runs", () => {
    let finish: (() => void) | null = null;
    let reject: ((e: Error) => void) | null = null;
    beforeEach(() => {
      window.electronAPI.exportVideo = vi.fn(
        () =>
          new Promise<{ success: boolean; outputPath: string }>((res, rej) => {
            finish = () => res({ success: true, outputPath: "/tmp/out.mp4" });
            reject = rej;
          }),
      );
    });

    async function running(onClose = vi.fn()) {
      const view = r({}, onClose);
      fireEvent.click(exportBtn());
      await waitFor(() => expect(window.electronAPI.exportVideo).toHaveBeenCalled());
      return { ...view, onClose };
    }

    it("offers to stop it instead of closing, and stops ffmpeg", async () => {
      await running();
      fireEvent.click(screen.getByRole("button", { name: /stop export|arrêter/i }));
      expect(window.electronAPI.cancelFfmpeg).toHaveBeenCalled();
    });

    it("ignores the backdrop and the × so the export cannot be orphaned", async () => {
      const { container, onClose } = await running();
      fireEvent.click(container.querySelector(".modal-backdrop")!);
      fireEvent.click(container.querySelector(".modal-close")!);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("locks the format picker", async () => {
      const { container } = await running();
      expect(container.querySelector(".format-card")).toBeDisabled();
    });

    it("reports a user cancellation as such, not as an error dump", async () => {
      const { container } = await running();
      await act(async () => {
        reject!(new Error("Error invoking remote method 'ffmpeg:export': Error: cancelled"));
      });
      expect(container.querySelector(".export-error")?.textContent).toMatch(/cancelled|annulé/i);
      expect(container.querySelector(".export-error")?.textContent).not.toMatch(/invoking/);
    });

    it("strips the Electron IPC prefix from a real failure", async () => {
      const { container } = await running();
      await act(async () => {
        reject!(new Error("Error invoking remote method 'ffmpeg:export': Error: Invalid argument"));
      });
      expect(container.querySelector(".export-error")?.textContent).toContain("Invalid argument");
      expect(container.querySelector(".export-error")?.textContent).not.toMatch(/invoking/);
    });

    it("shows the success state when it finishes", async () => {
      const { container } = await running();
      await act(async () => {
        finish!();
      });
      expect(container.querySelector(".export-done")?.textContent).toContain("/tmp/out.mp4");
    });
  });
});

// ── Quality, resolution, GIF, hardware, queue ───────────────────────────────

describe("ExportModal — export options", () => {
  let storage: Record<string, string>;
  beforeEach(() => {
    storage = {};
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => storage[k] ?? null,
        setItem: (k: string, v: string) => {
          storage[k] = v;
        },
        removeItem: () => {},
        clear: () => {},
        length: 0,
        key: () => null,
      },
    });
    window.electronAPI = {
      ...window.electronAPI,
      onProgress: () => () => {},
      getCapabilities: vi.fn().mockResolvedValue({ hardware: [], stabilization: true }),
      saveVideo: vi.fn().mockResolvedValue("/tmp/out.mp4"),
      exportVideo: vi.fn().mockResolvedValue({ success: true, outputPath: "/tmp/out.mp4" }),
      queueAdd: vi.fn().mockResolvedValue({ id: 1 }),
    };
  });

  const exportBtn = () => screen.getByRole("button", { name: /^export(er)?$/i });
  const payload = async () => {
    fireEvent.click(exportBtn());
    await waitFor(() => expect(window.electronAPI.exportVideo).toHaveBeenCalled());
    return vi.mocked(window.electronAPI.exportVideo!).mock.calls[0][0];
  };
  const pickFormat = (label: string) =>
    fireEvent.click(Array.from(document.querySelectorAll(".format-card")).find((c) => c.textContent?.includes(label))!);

  it("exports with balanced quality, original size and no hardware by default", async () => {
    r();
    expect(await payload()).toMatchObject({
      quality: "balanced",
      resolution: null,
      hardware: null,
      stabilize: "off",
      gifWidth: 480,
      gifFps: 15,
    });
  });

  it("sends the chosen quality", async () => {
    r();
    fireEvent.click(screen.getByRole("button", { name: /^small file$|^petit fichier$/i }));
    expect((await payload()).quality).toBe("small");
  });

  it("shows the quality choice with the current one pressed", () => {
    r();
    expect(screen.getByRole("button", { name: /^balanced$|^équilibrée$/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^high$|^haute$/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("sends the chosen resolution as a height", async () => {
    r();
    fireEvent.change(document.getElementById("opt-resolution")!, { target: { value: "720" } });
    expect((await payload()).resolution).toBe(720);
  });

  it('offers "original" and never sends a resolution for it', async () => {
    r();
    fireEvent.change(document.getElementById("opt-resolution")!, { target: { value: "1080" } });
    fireEvent.change(document.getElementById("opt-resolution")!, { target: { value: "" } });
    expect((await payload()).resolution).toBeNull();
  });

  describe("GIF", () => {
    it("replaces the resolution by a width and a frame rate", () => {
      r();
      pickFormat("GIF");
      expect(document.getElementById("opt-resolution")).toBeNull();
      expect(document.getElementById("opt-gif-width")).toBeTruthy();
      expect(document.getElementById("opt-gif-fps")).toBeTruthy();
    });

    it("sends them, and no resolution", async () => {
      r();
      pickFormat("GIF");
      fireEvent.change(document.getElementById("opt-gif-width")!, { target: { value: "320" } });
      fireEvent.change(document.getElementById("opt-gif-fps")!, { target: { value: "10" } });
      expect(await payload()).toMatchObject({ format: "gif", gifWidth: 320, gifFps: 10, resolution: null });
    });

    it("keeps the resolution choice for video when switching back", async () => {
      r();
      fireEvent.change(document.getElementById("opt-resolution")!, { target: { value: "480" } });
      pickFormat("GIF");
      pickFormat("WebM");
      expect((document.getElementById("opt-resolution") as HTMLSelectElement).value).toBe("480");
    });
  });

  describe("hardware acceleration", () => {
    it("is not offered when this machine has none", async () => {
      r();
      await waitFor(() => expect(window.electronAPI.getCapabilities).toHaveBeenCalled());
      expect(document.getElementById("opt-hardware")).toBeNull();
    });

    it("is offered, named after the encoder, and on by default when one works", async () => {
      window.electronAPI.getCapabilities = vi
        .fn()
        .mockResolvedValue({ hardware: ["videotoolbox"], stabilization: true });
      r();
      const box = await waitFor(() => {
        const el = document.getElementById("opt-hardware") as HTMLInputElement;
        expect(el).toBeTruthy();
        return el;
      });
      expect(box.checked).toBe(true);
      expect(document.querySelector(".opt-check")?.textContent).toContain("VideoToolbox");
    });

    it("sends the encoder when enabled and null when the user turns it off", async () => {
      window.electronAPI.getCapabilities = vi.fn().mockResolvedValue({ hardware: ["nvenc"], stabilization: true });
      r();
      const box = await waitFor(() => {
        const el = document.getElementById("opt-hardware") as HTMLInputElement;
        expect(el).toBeTruthy();
        return el;
      });
      fireEvent.click(box);
      expect((await payload()).hardware).toBeNull();
    });

    it("uses the encoder by default", async () => {
      window.electronAPI.getCapabilities = vi.fn().mockResolvedValue({ hardware: ["nvenc"], stabilization: true });
      r();
      await waitFor(() => expect(document.getElementById("opt-hardware")).toBeTruthy());
      expect((await payload()).hardware).toBe("nvenc");
    });

    it("is hidden for formats it cannot encode (WebM, GIF)", async () => {
      window.electronAPI.getCapabilities = vi.fn().mockResolvedValue({ hardware: ["nvenc"], stabilization: true });
      r();
      await waitFor(() => expect(document.getElementById("opt-hardware")).toBeTruthy());
      pickFormat("WebM");
      expect(document.getElementById("opt-hardware")).toBeNull();
      pickFormat("GIF");
      expect(document.getElementById("opt-hardware")).toBeNull();
    });

    it("copes with the capability probe failing", async () => {
      window.electronAPI.getCapabilities = vi.fn().mockRejectedValue(new Error("x"));
      r();
      await waitFor(() => expect(window.electronAPI.getCapabilities).toHaveBeenCalled());
      expect(document.getElementById("opt-hardware")).toBeNull();
    });
  });

  it("passes the stabilisation level of the editor", async () => {
    r({ stabilize: "strong" });
    expect((await payload()).stabilize).toBe("strong");
  });

  it("shows the stabilisation level in the summary, only when it is on", () => {
    const off = r({ stabilize: "off" }).container.textContent;
    expect(off).not.toMatch(/stabili[sz]ation/i);
    const on = r({ stabilize: "normal" }).container.textContent;
    expect(on).toMatch(/stabili[sz]ation/i);
  });

  describe("social formats", () => {
    it("exports with the original proportions by default", async () => {
      r();
      expect((await payload()).reframe).toBeNull();
    });

    it("sends the chosen ratio with the blurred background by default", async () => {
      r();
      fireEvent.change(document.getElementById("opt-aspect")!, { target: { value: "9:16" } });
      expect((await payload()).reframe).toEqual({ aspect: "9:16", mode: "blur" });
    });

    it("only offers the fit mode once a ratio is chosen, and sends it", async () => {
      r();
      expect(screen.queryByRole("group", { name: /^fit$|^cadrage$/i })).toBeNull();
      fireEvent.change(document.getElementById("opt-aspect")!, { target: { value: "1:1" } });
      fireEvent.click(screen.getByRole("button", { name: /crop to fit|rogner au centre/i }));
      expect((await payload()).reframe).toEqual({ aspect: "1:1", mode: "crop" });
    });

    it("goes back to the original proportions", async () => {
      r();
      fireEvent.change(document.getElementById("opt-aspect")!, { target: { value: "4:5" } });
      fireEvent.change(document.getElementById("opt-aspect")!, { target: { value: "" } });
      expect((await payload()).reframe).toBeNull();
    });

    it("a preset sets ratio, MP4, blurred background, 1080 and balanced quality in one go", async () => {
      r();
      pickFormat("WebM");
      fireEvent.click(screen.getByRole("button", { name: /^small file$|^petit fichier$/i }));
      fireEvent.change(document.getElementById("opt-preset")!, { target: { value: "vertical" } });
      expect(await payload()).toMatchObject({
        format: "mp4",
        quality: "balanced",
        resolution: 1080,
        reframe: { aspect: "9:16", mode: "blur" },
      });
    });

    it('shows which preset is active, and "custom" as soon as a choice drifts from it', () => {
      r();
      const preset = () => (document.getElementById("opt-preset") as HTMLSelectElement).value;
      expect(preset()).toBe("custom");
      fireEvent.change(document.getElementById("opt-preset")!, { target: { value: "portrait" } });
      expect(preset()).toBe("portrait");
      fireEvent.change(document.getElementById("opt-resolution")!, { target: { value: "720" } });
      expect(preset()).toBe("custom");
    });

    it("lists the summary line only when a ratio is set", () => {
      const summary = () => document.querySelector(".export-summary")!.textContent;
      expect(r() && summary()).not.toMatch(/9:16/);
      cleanup();
      storage.lcv_export_prefs = JSON.stringify({ aspect: "9:16", reframeMode: "crop" });
      r();
      expect(summary()).toMatch(/9:16 · (crop to fit|rogner au centre)/i);
    });

    it("remembers the ratio and mode, and ignores a stale one", () => {
      r();
      fireEvent.change(document.getElementById("opt-aspect")!, { target: { value: "16:9" } });
      expect(JSON.parse(storage.lcv_export_prefs)).toMatchObject({ aspect: "16:9", reframeMode: "blur" });
      cleanup();
      storage.lcv_export_prefs = JSON.stringify({ aspect: "21:9", reframeMode: "stretch" });
      r();
      expect((document.getElementById("opt-aspect") as HTMLSelectElement).value).toBe("");
    });

    it("also applies to a GIF", async () => {
      r();
      pickFormat("GIF");
      fireEvent.change(document.getElementById("opt-aspect")!, { target: { value: "1:1" } });
      expect(await payload()).toMatchObject({ format: "gif", reframe: { aspect: "1:1", mode: "blur" } });
    });
  });

  describe("remembered choices", () => {
    it("saves quality, format and size for next time", () => {
      r();
      fireEvent.click(screen.getByRole("button", { name: /^high$|^haute$/i }));
      pickFormat("WebM");
      fireEvent.change(document.getElementById("opt-resolution")!, { target: { value: "720" } });
      expect(JSON.parse(storage.lcv_export_prefs)).toMatchObject({ quality: "high", format: "webm", resolution: 720 });
    });

    it("restores them when the dialog opens again", () => {
      storage.lcv_export_prefs = JSON.stringify({
        format: "mov",
        quality: "small",
        resolution: 480,
        gifWidth: 320,
        gifFps: 10,
        hardware: false,
      });
      const { container } = r();
      expect(container.querySelector(".format-card.selected")?.textContent).toContain("MOV");
      expect(screen.getByRole("button", { name: /^small file$|^petit fichier$/i }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect((document.getElementById("opt-resolution") as HTMLSelectElement).value).toBe("480");
    });

    it.each([
      ["corrupt JSON", "{{{"],
      ["wrong types", JSON.stringify({ format: "exe", quality: 3, resolution: "x", gifWidth: 1, gifFps: -1 })],
    ])("falls back to the defaults for %s", (_n, value) => {
      storage.lcv_export_prefs = value;
      const { container } = r();
      expect(container.querySelector(".format-card.selected")?.textContent).toContain("MP4");
      expect(screen.getByRole("button", { name: /^balanced$|^équilibrée$/i }).getAttribute("aria-pressed")).toBe(
        "true",
      );
    });

    it("survives unavailable storage", () => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new Error("denied");
        },
      });
      expect(() => r()).not.toThrow();
    });
  });

  describe("add to queue", () => {
    it("asks for a file, queues the export and closes the dialog without waiting for it", async () => {
      const onClose = vi.fn();
      const onQueued = vi.fn();
      render(
        <LangProvider>
          <ExportModal state={baseState} onClose={onClose} onQueued={onQueued} />
        </LangProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: /add to queue|ajouter à la file/i }));
      await waitFor(() => expect(window.electronAPI.queueAdd).toHaveBeenCalled());
      expect(window.electronAPI.exportVideo).not.toHaveBeenCalled();
      expect(vi.mocked(window.electronAPI.queueAdd!).mock.calls[0][0]).toMatchObject({
        outputPath: "/tmp/out.mp4",
        format: "mp4",
        quality: "balanced",
      });
      expect(onQueued).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it("does nothing when the save dialog is cancelled", async () => {
      window.electronAPI.saveVideo = vi.fn().mockResolvedValue(null);
      const onClose = vi.fn();
      render(
        <LangProvider>
          <ExportModal state={baseState} onClose={onClose} />
        </LangProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: /add to queue|ajouter à la file/i }));
      await new Promise((res) => setTimeout(res, 10));
      expect(window.electronAPI.queueAdd).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("shows the reason and stays open when the job is refused", async () => {
      window.electronAPI.queueAdd = vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Error invoking remote method 'queue:add': Error: Another queued export already writes to that file",
          ),
        );
      const onClose = vi.fn();
      const { container } = render(
        <LangProvider>
          <ExportModal state={baseState} onClose={onClose} />
        </LangProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: /add to queue|ajouter à la file/i }));
      await waitFor(() =>
        expect(container.querySelector(".export-error")?.textContent).toContain("already writes to that file"),
      );
      expect(container.querySelector(".export-error")?.textContent).not.toMatch(/invoking/);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("is disabled when every part is cut", () => {
      r({ cutSegments: [{ id: "a", start: 0, end: 100 }] });
      expect(screen.getByRole("button", { name: /add to queue|ajouter à la file/i })).toBeDisabled();
    });
  });
});
