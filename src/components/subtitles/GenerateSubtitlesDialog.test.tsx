import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import GenerateSubtitlesDialog from "./GenerateSubtitlesDialog";
import * as subs from "../../lib/subs/commands";
import { busyWork } from "../../lib/busyWork";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve([])) }));
vi.mock("../../lib/subs/commands", async (orig) => ({
  ...(await orig<typeof import("../../lib/subs/commands")>()),
  getSubsSettings: vi.fn(),
  setSubsSettings: vi.fn(),
  listSubsLanguages: vi.fn(),
  hasApiKey: vi.fn(),
  setApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  cancelSubs: vi.fn(),
  audioTracksOfFile: vi.fn(),
  audioTracksOfMedia: vi.fn(),
  generateForFile: vi.fn(),
  generateForMedia: vi.fn(),
  generateForProject: vi.fn(),
  translateSubs: vi.fn(),
  updateSubs: vi.fn(),
  saveSubs: vi.fn(),
}));

const SRT = "1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n";
const settings: subs.SubsSettings = {
  stt_engine: "local",
  translation_engine: "local",
  azure_translator_region: "",
  language: "en",
  whisper_model: "small",
  stt_language: "auto",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(subs.getSubsSettings).mockResolvedValue({ ...settings });
  vi.mocked(subs.listSubsLanguages).mockResolvedValue([{ code: "fr", flores_code: "fra_Latn", name: "French" }]);
  vi.mocked(subs.hasApiKey).mockResolvedValue(false);
  vi.mocked(subs.audioTracksOfFile).mockResolvedValue([]);
  vi.mocked(subs.audioTracksOfMedia).mockResolvedValue([]);
  vi.mocked(subs.setSubsSettings).mockResolvedValue();
  vi.mocked(subs.generateForFile).mockResolvedValue({ srt_path: "/v/a.srt", srt_content: SRT, language: "en" });
  vi.mocked(listen).mockImplementation(() => Promise.resolve(() => {}));
});

async function generate() {
  fireEvent.click(await screen.findByRole("button", { name: "Generate" }));
}

describe("GenerateSubtitlesDialog", () => {
  it("generates from a file, then saves it as chosen", async () => {
    vi.mocked(subs.saveSubs).mockResolvedValue(["/v/a.vtt"]);
    const onClose = vi.fn();
    render(<GenerateSubtitlesDialog source={{ kind: "file", path: "/v/a.mp4" }} label="/v/a.mp4" onClose={onClose} />);
    await generate();
    expect(await screen.findByText("2 subtitles generated")).toBeInTheDocument();
    expect(subs.generateForFile).toHaveBeenCalledWith("/v/a.mp4", null);
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "vtt" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(subs.saveSubs).toHaveBeenCalledWith("/v/a.srt", "Subtitles", "vtt", SRT));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("hands the cues to the project when asked", async () => {
    vi.mocked(subs.generateForMedia).mockResolvedValue({ srt_path: "/p/a.srt", srt_content: SRT, language: "en" });
    const onPlace = vi.fn();
    render(
      <GenerateSubtitlesDialog
        source={{ kind: "media", projectDir: "/p", src: "media/a.mp4" }}
        label="a"
        onClose={vi.fn()}
        onPlace={onPlace}
      />,
    );
    await generate();
    await screen.findByText("2 subtitles generated");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onPlace).toHaveBeenCalledWith([
      { start: 1, end: 2.5, text: "Hello" },
      { start: 3, end: 4, text: "World" },
    ]);
  });

  it("translates the result when a target language is chosen", async () => {
    vi.mocked(subs.translateSubs).mockResolvedValue({ srt_path: "/v/a.fr.srt", srt_content: SRT, language: "fr" });
    render(<GenerateSubtitlesDialog source={{ kind: "file", path: "/v/a.mp4" }} label="a" onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Translate to"), { target: { value: "fr" } });
    await generate();
    await screen.findByText("2 subtitles generated");
    expect(subs.translateSubs).toHaveBeenCalledWith("/v/a.srt", SRT, "en", "fr");
  });

  it("asks for the API key of a cloud engine before generating", async () => {
    vi.mocked(subs.getSubsSettings).mockResolvedValue({ ...settings, stt_engine: "groq" });
    render(<GenerateSubtitlesDialog source={{ kind: "file", path: "/v/a.mp4" }} label="a" onClose={vi.fn()} />);
    const button = await screen.findByRole("button", { name: "Generate" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Groq API key"), { target: { value: "secret" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await screen.findByText("2 subtitles generated");
    expect(subs.setApiKey).toHaveBeenCalledWith("groq_api_key", "secret");
  });

  it("shows the failure and lets the user retry", async () => {
    vi.mocked(subs.generateForFile).mockRejectedValue({ code: "no_audio", message: "The file has no audio" });
    render(<GenerateSubtitlesDialog source={{ kind: "file", path: "/v/a.mp4" }} label="a" onClose={vi.fn()} />);
    await generate();
    expect(await screen.findByText(/no audio/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
  });

  it("associates the result as soon as it is generated, then after each correction", async () => {
    const corrected = SRT.replace("World", "Monde");
    vi.mocked(subs.updateSubs).mockResolvedValue({ srt_content: corrected });
    const onAssociate = vi.fn();
    render(
      <GenerateSubtitlesDialog
        source={{ kind: "file", path: "/v/a.mp4" }}
        label="a"
        onClose={vi.fn()}
        onAssociate={onAssociate}
      />,
    );
    await generate();
    await screen.findByText("2 subtitles generated");
    expect(onAssociate).toHaveBeenCalledTimes(1);
    expect(onAssociate.mock.calls[0][0]).toBe(SRT);
    expect(screen.queryByRole("checkbox", { name: /list/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit subtitles" }));
    fireEvent.change(screen.getByLabelText("Text of subtitle 2"), { target: { value: "Monde" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(onAssociate).toHaveBeenCalledTimes(2));
    expect(onAssociate.mock.calls[1]).toEqual([corrected, onAssociate.mock.calls[0][1]]);
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("does not add the subtitles twice when the save dialog is closed", async () => {
    vi.mocked(subs.generateForMedia).mockResolvedValue({ srt_path: "/p/a.srt", srt_content: SRT, language: "en" });
    vi.mocked(subs.saveSubs).mockResolvedValueOnce(null).mockResolvedValueOnce(["/p/a.srt"]);
    const onPlace = vi.fn();
    const onClose = vi.fn();
    render(
      <GenerateSubtitlesDialog
        source={{ kind: "media", projectDir: "/p", src: "a.mp4" }}
        label="a"
        onClose={onClose}
        onPlace={onPlace}
      />,
    );
    await generate();
    await screen.findByText("2 subtitles generated");
    fireEvent.click(screen.getByLabelText(/Save as a file/));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(subs.saveSubs).toHaveBeenCalledTimes(1));
    expect(onPlace).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onPlace).toHaveBeenCalledTimes(1);
  });

  it("asks for the Azure region before translating with Azure", async () => {
    vi.mocked(subs.getSubsSettings).mockResolvedValue({ ...settings, translation_engine: "azure" });
    vi.mocked(subs.hasApiKey).mockResolvedValue(true);
    render(<GenerateSubtitlesDialog source={{ kind: "file", path: "/v/a.mp4" }} label="a" onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Translate to"), { target: { value: "fr" } });
    const button = screen.getByRole("button", { name: "Generate" });
    await waitFor(() => expect(screen.getByLabelText("Azure Translator region")).toBeInTheDocument());
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Azure Translator region"), { target: { value: "westeurope" } });
    expect(button).toBeEnabled();
  });

  it("can forget a stored API key", async () => {
    vi.mocked(subs.getSubsSettings).mockResolvedValue({ ...settings, stt_engine: "groq" });
    vi.mocked(subs.hasApiKey).mockResolvedValue(true);
    render(<GenerateSubtitlesDialog source={{ kind: "file", path: "/v/a.mp4" }} label="a" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Forget this key" }));
    await waitFor(() => expect(subs.deleteApiKey).toHaveBeenCalledWith("groq_api_key"));
  });
});

const FR = SRT.replace("Hello", "Bonjour").replace("World", "Monde");
const french = { srt_path: "/v/a.fr.srt", srt_content: FR, language: "fr" };

describe("GenerateSubtitlesDialog — traduction", () => {
  it("keeps the original next to a translation asked before generating, and uses the chosen version", async () => {
    vi.mocked(subs.translateSubs).mockResolvedValue(french);
    vi.mocked(subs.saveSubs).mockResolvedValue(["/v/x.srt"]);
    const onAssociate = vi.fn();
    render(
      <GenerateSubtitlesDialog
        source={{ kind: "file", path: "/v/a.mp4" }}
        label="a"
        onClose={vi.fn()}
        onAssociate={onAssociate}
      />,
    );
    fireEvent.change(await screen.findByLabelText("Translate to"), { target: { value: "fr" } });
    await generate();
    const tabs = await screen.findByRole("tablist");
    expect(within(tabs).getByRole("tab", { name: "Translation (French)" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Bonjour")).toBeInTheDocument();
    expect(onAssociate).toHaveBeenLastCalledWith(FR, expect.any(String));

    fireEvent.click(within(tabs).getByRole("tab", { name: "Original (en)" }));
    expect(screen.getByText("Hello")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Version to use"), { target: { value: "original" } });
    expect(onAssociate).toHaveBeenLastCalledWith(SRT, expect.any(String));

    fireEvent.click(screen.getByLabelText(/Save as a file/));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(subs.saveSubs).toHaveBeenCalledWith("/v/a.srt", "Subtitles", "srt", SRT));
  });

  it("translates after generating, from the detected or a chosen language", async () => {
    vi.mocked(subs.listSubsLanguages).mockResolvedValue([
      { code: "en", flores_code: "eng_Latn", name: "English" },
      { code: "fr", flores_code: "fra_Latn", name: "French" },
      { code: "de", flores_code: "deu_Latn", name: "German" },
    ]);
    vi.mocked(subs.translateSubs).mockResolvedValue(french);
    render(<GenerateSubtitlesDialog source={{ kind: "file", path: "/v/a.mp4" }} label="a" onClose={vi.fn()} />);
    await generate();
    await screen.findByText("2 subtitles generated");
    expect(screen.queryByRole("tablist")).toBeNull();
    const run = screen.getByRole("button", { name: "Translate" });
    expect(run).toBeDisabled();
    expect(screen.getByLabelText("Source language")).toHaveDisplayValue("Detected: English");

    fireEvent.change(screen.getByLabelText("Target language"), { target: { value: "en" } });
    expect(screen.getByText("The source and target languages are the same.")).toBeInTheDocument();
    expect(run).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Target language"), { target: { value: "fr" } });
    fireEvent.click(run);
    await screen.findByRole("tablist");
    expect(subs.translateSubs).toHaveBeenCalledWith("/v/a.srt", SRT, "en", "fr");

    fireEvent.change(screen.getByLabelText("Source language"), { target: { value: "de" } });
    fireEvent.click(screen.getByRole("button", { name: "Translate again" }));
    await waitFor(() => expect(subs.translateSubs).toHaveBeenLastCalledWith("/v/a.srt", SRT, "de", "fr"));
  });

  it("corrects each version on its own, and saves the one shown", async () => {
    vi.mocked(subs.translateSubs).mockResolvedValue(french);
    vi.mocked(subs.updateSubs).mockResolvedValue({ srt_content: FR.replace("Monde", "Terre") });
    vi.mocked(subs.saveSubs).mockResolvedValue(["/v/x.srt"]);
    render(<GenerateSubtitlesDialog source={{ kind: "file", path: "/v/a.mp4" }} label="a" onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Translate to"), { target: { value: "fr" } });
    await generate();
    await screen.findByRole("tablist");
    fireEvent.click(screen.getByRole("button", { name: "Edit subtitles" }));
    fireEvent.change(screen.getByLabelText("Text of subtitle 2"), { target: { value: "Terre" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(screen.getByText("Terre")).toBeInTheDocument());
    expect(subs.updateSubs).toHaveBeenCalledWith(FR, ["Bonjour", "Terre"]);

    fireEvent.click(screen.getByRole("tab", { name: "Original (en)" }));
    expect(screen.getByText("World")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save this version…" }));
    await waitFor(() => expect(subs.saveSubs).toHaveBeenCalledWith("/v/a.srt", "Subtitles", "srt", SRT));
  });
});

describe("GenerateSubtitlesDialog — cloud, durée et fermeture", () => {
  it("warns that a cloud engine receives the audio or the text", async () => {
    vi.mocked(subs.getSubsSettings).mockResolvedValue({ ...settings, stt_engine: "groq" });
    vi.mocked(subs.hasApiKey).mockResolvedValue(true);
    render(<GenerateSubtitlesDialog source={{ kind: "file", path: "/v/a.mp4" }} label="a" onClose={vi.fn()} />);
    expect(await screen.findByText("Groq receives the audio of this media to transcribe it.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Translate to"), { target: { value: "fr" } });
    fireEvent.change(screen.getByLabelText("Translation engine"), { target: { value: "deep_l" } });
    expect(screen.getByText("DeepL receives the text of the subtitles to translate it.")).toBeInTheDocument();
  });

  it("says nothing of the cloud for the local engines", async () => {
    render(<GenerateSubtitlesDialog source={{ kind: "file", path: "/v/a.mp4" }} label="a" onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "Generate" });
    expect(screen.queryByText(/receives the/)).toBeNull();
  });

  it("shows the elapsed time, then the time left, and declares the work to the quit check", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let onProgress: (e: { payload: { stage: string; fraction: number } }) => void = () => {};
      vi.mocked(listen).mockImplementation(((_: string, h: typeof onProgress) => {
        onProgress = h;
        return Promise.resolve(() => {});
      }) as unknown as typeof listen);
      let finish: (v: subs.SubsOutput) => void = () => {};
      vi.mocked(subs.generateForFile).mockReturnValue(new Promise((r) => (finish = r)));
      render(<GenerateSubtitlesDialog source={{ kind: "file", path: "/v/a.mp4" }} label="a" onClose={vi.fn()} />);
      await generate();
      expect(await screen.findByText(/Elapsed 0:0/)).toBeInTheDocument();
      expect(await busyWork()).toContain("quit.subtitles");

      act(() => onProgress({ payload: { stage: "transcribe", fraction: 0 } }));
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      act(() => onProgress({ payload: { stage: "transcribe", fraction: 0.5 } }));
      expect(screen.getByText(/Elapsed 0:1\d · about 0:1\d left/)).toBeInTheDocument();

      await act(async () => finish({ srt_path: "/v/a.srt", srt_content: SRT, language: "en" }));
      await screen.findByText("2 subtitles generated");
      expect(await busyWork()).not.toContain("quit.subtitles");
    } finally {
      vi.useRealTimers();
    }
  });
});
