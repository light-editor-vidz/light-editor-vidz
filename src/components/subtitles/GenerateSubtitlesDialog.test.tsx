import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GenerateSubtitlesDialog from "./GenerateSubtitlesDialog";
import * as subs from "../../lib/subs/commands";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
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

  it("offers to use the result in the video", async () => {
    const onUse = vi.fn();
    render(
      <GenerateSubtitlesDialog source={{ kind: "file", path: "/v/a.mp4" }} label="a" onClose={vi.fn()} onUse={onUse} />,
    );
    await generate();
    await screen.findByText("2 subtitles generated");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onUse).toHaveBeenCalledWith(SRT);
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

  it("lets the subtitles be corrected before they are used", async () => {
    const corrected = SRT.replace("World", "Monde");
    vi.mocked(subs.updateSubs).mockResolvedValue({ srt_content: corrected });
    const onUse = vi.fn();
    render(
      <GenerateSubtitlesDialog source={{ kind: "file", path: "/v/a.mp4" }} label="a" onClose={vi.fn()} onUse={onUse} />,
    );
    await generate();
    await screen.findByText("2 subtitles generated");
    fireEvent.click(screen.getByRole("button", { name: "Edit subtitles" }));
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Text of subtitle 2"), { target: { value: "Monde" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(subs.updateSubs).toHaveBeenCalledWith(SRT, ["Hello", "Monde"]));
    expect(await screen.findByText("Monde")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onUse).toHaveBeenCalledWith(corrected));
  });
});
