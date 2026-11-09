import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import AudioTool from "./AudioTool";
import { inertBridge, TabActiveProvider } from "../../lib/menuBridge";
import * as commands from "../../lib/audiotool/commands";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../lib/audiotool/commands", () => ({
  audioAllowAsset: vi.fn(),
  audioLoad: vi.fn(),
  audioPickFile: vi.fn(),
  audioPickOutput: vi.fn(),
  audioProcess: vi.fn(),
  audioCancel: vi.fn(),
  audioRecentList: vi.fn(),
  audioRecentForget: vi.fn(),
  fetchAudioData: vi.fn(),
}));

/** Le moteur d'aperçu est remplacé par un double : Web Audio n'existe pas dans jsdom. */
const engineState = vi.hoisted(() => ({
  current: null as null | Record<string, ReturnType<typeof vi.fn> | unknown>,
}));
vi.mock("../../lib/audiotool/previewEngine", () => {
  class PreviewEngine {
    playing = false;
    hasPreview = true;
    analyserNode = null;
    time = 0;
    decode = vi.fn(async () => ({ duration: 60 }));
    load = vi.fn();
    setParams = vi.fn();
    setKept = vi.fn();
    setOnEnded = vi.fn();
    pause = vi.fn(() => {
      this.playing = false;
    });
    play = vi.fn(() => {
      this.playing = true;
    });
    seek = vi.fn((t: number) => {
      this.time = Math.max(0, t);
    });
    currentTime = vi.fn(() => this.time);
    dispose = vi.fn();
    constructor() {
      engineState.current = this as never;
    }
  }
  return { PreviewEngine };
});

const mocked = vi.mocked(commands);
const mockListen = vi.mocked(listen);

const INFO = { duration: 60, channels: 2, sample_rate: 44100, waveform: [0.2, 0.9, 0.4, 0.6] };

const engine = () =>
  engineState.current as unknown as {
    playing: boolean;
    hasPreview: boolean;
    time: number;
    decode: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    setParams: ReturnType<typeof vi.fn>;
    setKept: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
    seek: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };

let progressHandler: ((e: { payload: number }) => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  inertBridge.actions.current = {};
  progressHandler = null;
  mocked.audioAllowAsset.mockResolvedValue(undefined);
  mocked.fetchAudioData.mockResolvedValue(new ArrayBuffer(8));
  mocked.audioLoad.mockResolvedValue(INFO);
  mocked.audioRecentList.mockResolvedValue([]);
  mocked.audioProcess.mockResolvedValue(undefined);
  mocked.audioPickOutput.mockResolvedValue("/out/song-edit.wav");
  mockListen.mockImplementation((_event, handler) => {
    progressHandler = handler as never;
    return Promise.resolve(() => {});
  });
});

async function openFile(props: Partial<Parameters<typeof AudioTool>[0]> = {}) {
  const handlers = { onOpen: vi.fn(), onClose: vi.fn() };
  const view = render(<AudioTool path="/music/song.mp3" {...handlers} {...props} />);
  await screen.findByText("song.mp3");
  return { ...handlers, ...view };
}

const lastParams = () => {
  const calls = engine().setParams.mock.calls;
  return calls[calls.length - 1]?.[0];
};

describe("AudioTool — sans fichier", () => {
  it("montre la zone de dépôt et ses fichiers récents", async () => {
    render(<AudioTool path={null} onOpen={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText("Drop an audio file here")).toBeInTheDocument();
    await waitFor(() => expect(mocked.audioRecentList).toHaveBeenCalled());
    expect(mocked.audioLoad).not.toHaveBeenCalled();
  });

  it("ouvre le fichier choisi dans la zone de dépôt", async () => {
    mocked.audioPickFile.mockResolvedValue("/music/a.mp3");
    const onOpen = vi.fn();
    render(<AudioTool path={null} onOpen={onOpen} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse files" }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("/music/a.mp3"));
  });
});

describe("AudioTool — chargement", () => {
  it("autorise le fichier, le décode des deux côtés et affiche ses caractéristiques", async () => {
    await openFile();

    expect(mocked.audioAllowAsset).toHaveBeenCalledWith("/music/song.mp3");
    expect(mocked.fetchAudioData).toHaveBeenCalledWith("/music/song.mp3");
    expect(mocked.audioLoad).toHaveBeenCalledWith("/music/song.mp3", 900);
    expect(screen.getByText("2ch · 44100Hz · 1:00")).toBeInTheDocument();
    expect(engine().load).toHaveBeenCalledWith({ duration: 60 }, 60, INFO.waveform);
  });

  it("affiche les réglages et l'export une fois le fichier ouvert", async () => {
    await openFile();

    expect(screen.getByText("Fade")).toBeInTheDocument();
    expect(screen.getByText("Speed", { selector: ".at-section-title" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Seek" })).toBeInTheDocument();
  });

  it("signale un fichier illisible et reste sur la zone de dépôt", async () => {
    mocked.audioLoad.mockRejectedValue({ code: "unsupported_format", params: {}, message: "x" });
    render(<AudioTool path="/music/bad.xyz" onOpen={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Error: This audio format is not supported");
    expect(screen.getByText("Drop an audio file here")).toBeInTheDocument();
  });

  it("ouvre le fichier même sans aperçu, et prévient que l'export marche", async () => {
    engineState.current = null;
    mocked.fetchAudioData.mockRejectedValue(new Error("HTTP 404"));
    await openFile();

    expect(await screen.findByRole("status")).toHaveTextContent("Preview unavailable for this format");
    expect(engine().load).toHaveBeenCalledWith(null, 60, INFO.waveform);
  });

  it("recharge quand l'onglet reçoit un autre fichier, sans garder les anciens réglages", async () => {
    const { rerender } = await openFile();
    fireEvent.click(screen.getByLabelText("Normalise (peak −1 dBFS)"));
    expect(lastParams().normalize).toBe(true);
    mocked.audioLoad.mockResolvedValue({ ...INFO, duration: 30 });

    rerender(<AudioTool path="/music/other.mp3" onOpen={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText("other.mp3");
    expect(lastParams().normalize).toBe(false);
    expect(screen.getByLabelText("Normalise (peak −1 dBFS)")).not.toBeChecked();
  });
});

describe("AudioTool — lecture", () => {
  it("le bouton lance puis arrête la lecture", async () => {
    await openFile();

    const play = screen.getByRole("button", { name: "Space to play/pause" });
    fireEvent.click(play);
    expect(engine().play).toHaveBeenCalled();
    fireEvent.click(play);
    expect(engine().pause).toHaveBeenCalled();
  });

  it("l'espace lance et met en pause, sauf dans un champ de saisie", async () => {
    await openFile();

    fireEvent.keyDown(window, { code: "Space", key: " " });
    expect(engine().play).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Low-pass" }));
    const freq = screen.getByLabelText("Cutoff");
    freq.focus();
    const pauses = engine().pause.mock.calls.length;
    fireEvent.keyDown(freq, { code: "Space", key: " " });
    expect(engine().pause.mock.calls.length).toBe(pauses);
    expect(engine().play).toHaveBeenCalledTimes(1);
  });

  it("n'est pas lisible sans aperçu", async () => {
    engineState.current = null;
    mocked.fetchAudioData.mockRejectedValue(new Error("nope"));
    await openFile();

    expect(screen.getByRole("button", { name: "Space to play/pause" })).toBeDisabled();
  });

  it("cliquer sur la barre de lecture déplace la tête", async () => {
    await openFile();
    const seek = screen.getByRole("slider", { name: "Seek" });
    const track = seek.querySelector(".at-seek-track") as HTMLElement;
    track.getBoundingClientRect = () => ({ left: 0, width: 600 }) as DOMRect;

    fireEvent.pointerDown(seek, { clientX: 300, button: 0 });

    expect(engine().seek).toHaveBeenCalledWith(30);
  });

  it("les flèches de la barre avancent de 1 s, de 5 s avec Maj, sans passer sous zéro", async () => {
    await openFile();
    const seek = screen.getByRole("slider", { name: "Seek" });

    fireEvent.keyDown(seek, { key: "ArrowRight" });
    expect(engine().time).toBe(1);
    fireEvent.keyDown(seek, { key: "ArrowRight", shiftKey: true });
    expect(engine().time).toBe(6);
    fireEvent.keyDown(seek, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(seek, { key: "ArrowLeft", shiftKey: true });
    expect(engine().time).toBe(0);
  });

  it("met en pause quand l'onglet passe en arrière-plan", async () => {
    const handlers = { onOpen: vi.fn(), onClose: vi.fn() };
    const tree = (active: boolean) => (
      <TabActiveProvider value={active}>
        <AudioTool path="/music/song.mp3" {...handlers} />
      </TabActiveProvider>
    );
    const { rerender } = render(tree(true));
    await screen.findByText("song.mp3");
    engine().pause.mockClear();

    rerender(tree(false));

    expect(engine().pause).toHaveBeenCalled();
  });

  it("libère le contexte audio quand l'onglet se ferme", async () => {
    const { unmount } = await openFile();

    unmount();

    expect(engine().dispose).toHaveBeenCalled();
  });
});

describe("AudioTool — réglages et historique", () => {
  it("transmet les réglages à l'aperçu", async () => {
    await openFile();

    fireEvent.click(screen.getByRole("button", { name: "Equal power" }));
    fireEvent.click(screen.getByRole("button", { name: "2x" }));
    fireEvent.click(screen.getByRole("button", { name: "Low-pass" }));

    expect(lastParams()).toMatchObject({
      curve: "equal-power",
      speed: 2,
      filter: { type: "lowpass", freq: 1000, slope: 12 },
    });
  });

  it("annule et rétablit un réglage, les boutons suivant l'historique", async () => {
    await openFile();
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Normalise (peak −1 dBFS)"));
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    expect(screen.getByLabelText("Normalise (peak −1 dBFS)")).not.toBeChecked();
    expect(lastParams().normalize).toBe(false);
    expect(redo).toBeEnabled();

    fireEvent.click(redo);
    expect(screen.getByLabelText("Normalise (peak −1 dBFS)")).toBeChecked();
  });

  it("un glissé de curseur ne fait qu'un pas d'annulation", async () => {
    await openFile();
    const fadeIn = screen.getByLabelText("Fade in");

    fireEvent.change(fadeIn, { target: { value: "1" } });
    fireEvent.change(fadeIn, { target: { value: "2" } });
    fireEvent.change(fadeIn, { target: { value: "3" } });
    fireEvent.pointerUp(fadeIn);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByLabelText("Fade in")).toHaveValue("0");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("Ctrl+Z annule et Ctrl+Maj+Z rétablit, sauf pendant une saisie", async () => {
    await openFile();
    fireEvent.click(screen.getByLabelText("Normalise (peak −1 dBFS)"));

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByLabelText("Normalise (peak −1 dBFS)")).not.toBeChecked();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByLabelText("Normalise (peak −1 dBFS)")).toBeChecked();
  });

  it("enregistre les actions Annuler / Rétablir du menu", async () => {
    await openFile();
    fireEvent.click(screen.getByRole("button", { name: "Equal power" }));

    act(() => inertBridge.actions.current.undo?.());
    expect(screen.getByRole("button", { name: "Linear" })).toHaveAttribute("aria-pressed", "true");
    act(() => inertBridge.actions.current.redo?.());
    expect(screen.getByRole("button", { name: "Equal power" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("AudioTool — coupes", () => {
  /** Pose I puis O sur la forme d'onde à deux positions de la tête de lecture. */
  function markCut(from: number, to: number) {
    const wave = screen.getByRole("img");
    engine().time = from;
    fireEvent.keyDown(wave, { key: "i" });
    engine().time = to;
    fireEvent.keyDown(wave, { key: "o" });
  }

  it("I puis O marquent une coupe, qui retire ce passage de ce qui joue", async () => {
    await openFile();

    markCut(10, 20);

    expect(screen.getByText("1 cut", { selector: ".at-danger-chip" })).toBeInTheDocument();
    expect(engine().setKept).toHaveBeenLastCalledWith([
      { start: 0, end: 10 },
      { start: 20, end: 60 },
    ]);
  });

  it("une coupe plus courte que le minimum n'est pas créée", async () => {
    await openFile();

    markCut(10, 10.01);

    expect(screen.queryByText("1 cut", { selector: ".at-danger-chip" })).not.toBeInTheDocument();
  });

  it("supprime la coupe sélectionnée avec Suppr", async () => {
    await openFile();
    markCut(10, 20);
    expect(screen.getByDisplayValue("0:10.0")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Delete" });

    expect(screen.queryByText("1 cut", { selector: ".at-danger-chip" })).not.toBeInTheDocument();
  });

  it("annule la création d'une coupe", async () => {
    await openFile();
    markCut(10, 20);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.queryByText("1 cut", { selector: ".at-danger-chip" })).not.toBeInTheDocument();
  });

  it("refuse l'export quand tout est coupé", async () => {
    await openFile();
    markCut(0, 60);

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    expect(await screen.findByText("Everything is cut: there would be no audio to export")).toBeInTheDocument();
    expect(
      within(document.querySelector(".modal") as HTMLElement).getByRole("button", { name: "Export" }),
    ).toBeDisabled();
  });
});

describe("AudioTool — export", () => {
  const openDialog = () => {
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    return document.querySelector(".modal") as HTMLElement;
  };
  const confirm = (modal: HTMLElement) => within(modal).getByRole("button", { name: /^Export$/ });

  it("le bouton du menu et celui de l'en-tête ouvrent la même fenêtre", async () => {
    await openFile();

    act(() => inertBridge.actions.current.openExport?.());

    expect(document.querySelector(".modal")).not.toBeNull();
  });

  it("arrête la lecture avant d'ouvrir l'export", async () => {
    await openFile();
    fireEvent.click(screen.getByRole("button", { name: "Space to play/pause" }));
    engine().pause.mockClear();

    openDialog();

    expect(engine().pause).toHaveBeenCalled();
  });

  it("demande le fichier de sortie, puis traite avec les réglages choisis", async () => {
    await openFile();
    fireEvent.click(screen.getByLabelText("Normalise (peak −1 dBFS)"));
    fireEvent.click(screen.getByRole("button", { name: "1.5x" }));
    fireEvent.change(screen.getByLabelText("Fade out"), { target: { value: "2" } });
    const modal = openDialog();
    fireEvent.click(within(modal).getByRole("button", { name: "MP3" }));

    await act(async () => {
      fireEvent.click(confirm(modal));
    });

    expect(mocked.audioPickOutput).toHaveBeenCalledWith("/music/song-edit.mp3", "mp3");
    expect(mocked.audioProcess).toHaveBeenCalledWith({
      input: "/music/song.mp3",
      output: "/out/song-edit.wav",
      format: "mp3",
      cuts: [],
      fade_in: null,
      fade_out: 2,
      fade_curve: "linear",
      wav_depth: null,
      normalize: true,
      speed: 1.5,
      filters: [],
    });
    expect(document.querySelector(".modal")).toBeNull();
    expect(screen.getByText("Exported: song-edit.wav", { selector: ".at-toast" })).toBeInTheDocument();
  });

  it("envoie les coupes et le format des échantillons WAV", async () => {
    await openFile();
    const wave = screen.getByRole("img");
    engine().time = 10;
    fireEvent.keyDown(wave, { key: "i" });
    engine().time = 20;
    fireEvent.keyDown(wave, { key: "o" });
    const modal = openDialog();
    fireEvent.change(within(modal).getByLabelText("WAV sample format"), { target: { value: "pcm24" } });

    await act(async () => {
      fireEvent.click(confirm(modal));
    });

    expect(mocked.audioProcess).toHaveBeenCalledWith(
      expect.objectContaining({ format: "wav", wav_depth: "pcm24", cuts: [[10, 20]] }),
    );
  });

  it("n'exporte rien quand le dialogue d'enregistrement est fermé", async () => {
    mocked.audioPickOutput.mockResolvedValue(null);
    await openFile();
    const modal = openDialog();

    await act(async () => {
      fireEvent.click(confirm(modal));
    });

    expect(mocked.audioProcess).not.toHaveBeenCalled();
    expect(document.querySelector(".modal")).not.toBeNull();
  });

  it("montre l'avancement envoyé par le moteur, puis la fin", async () => {
    let finish: () => void = () => {};
    mocked.audioProcess.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    await openFile();
    const modal = openDialog();

    await act(async () => {
      fireEvent.click(confirm(modal));
    });
    await waitFor(() => expect(progressHandler).not.toBeNull());
    act(() => progressHandler?.({ payload: 42 }));

    expect(within(modal).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");

    await act(async () => finish());
    expect(document.querySelector(".modal")).toBeNull();
  });

  it("Annuler pendant l'export le demande au moteur, et le signale", async () => {
    let fail: (e: unknown) => void = () => {};
    mocked.audioProcess.mockReturnValue(new Promise<void>((_, reject) => (fail = reject)));
    mocked.audioCancel.mockResolvedValue(undefined);
    await openFile();
    const modal = openDialog();
    await act(async () => {
      fireEvent.click(confirm(modal));
    });

    fireEvent.click(within(modal).getByRole("button", { name: "Cancel" }));
    expect(mocked.audioCancel).toHaveBeenCalled();
    await act(async () => fail({ code: "cancelled", params: {}, message: "Export cancelled" }));

    expect(screen.getByText("Export cancelled", { selector: ".at-toast" })).toBeInTheDocument();
  });

  it("affiche l'erreur d'un export raté et laisse la fenêtre ouverte", async () => {
    mocked.audioProcess.mockRejectedValue({
      code: "ffmpeg_failed",
      params: { format: "mp3", detail: "no space" },
      message: "x",
    });
    await openFile();
    const modal = openDialog();

    await act(async () => {
      fireEvent.click(confirm(modal));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("ffmpeg could not encode mp3: no space");
    expect(document.querySelector(".modal")).not.toBeNull();
  });

  it("signale une erreur du dialogue d'enregistrement", async () => {
    mocked.audioPickOutput.mockRejectedValue({ code: "generic", params: {}, message: "dialog broke" });
    await openFile();
    const modal = openDialog();

    await act(async () => {
      fireEvent.click(confirm(modal));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Error: dialog broke");
  });

  it("refuse un fondu plus long que le son conservé", async () => {
    mocked.audioLoad.mockResolvedValue({ ...INFO, duration: 5 });
    await openFile();
    fireEvent.change(screen.getByLabelText("Fade in"), { target: { value: "8" } });

    const modal = openDialog();

    expect(within(modal).getByRole("status")).toHaveTextContent("The fade in (8.00 s) is longer than the audio kept");
    expect(confirm(modal)).toBeDisabled();
    expect(screen.getByLabelText("Fade in")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("AudioTool — en-tête et menu", () => {
  it("Open another file remplace le fichier de l'onglet", async () => {
    mocked.audioPickFile.mockResolvedValue("/music/next.mp3");
    const { onOpen } = await openFile();

    fireEvent.click(screen.getByRole("button", { name: "Open an audio file" }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("/music/next.mp3"));
  });

  it("« Fermer l'onglet » du menu ferme l'onglet", async () => {
    const { onClose } = await openFile();

    act(() => inertBridge.actions.current.closeProject?.());

    expect(onClose).toHaveBeenCalled();
  });

  it("ne réagit plus au clavier quand l'onglet est masqué", async () => {
    const handlers = { onOpen: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(
      <TabActiveProvider value={true}>
        <AudioTool path="/music/song.mp3" {...handlers} />
      </TabActiveProvider>,
    );
    await screen.findByText("song.mp3");
    rerender(
      <TabActiveProvider value={false}>
        <AudioTool path="/music/song.mp3" {...handlers} />
      </TabActiveProvider>,
    );
    engine().play.mockClear();

    fireEvent.keyDown(window, { code: "Space", key: " " });

    expect(engine().play).not.toHaveBeenCalled();
  });
});
