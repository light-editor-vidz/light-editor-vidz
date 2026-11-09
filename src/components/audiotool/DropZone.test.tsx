import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DropZone from "./DropZone";
import { audioPickFile, audioRecentForget, audioRecentList } from "../../lib/audiotool/commands";

vi.mock("../../lib/audiotool/commands", () => ({
  audioPickFile: vi.fn(),
  audioRecentList: vi.fn(),
  audioRecentForget: vi.fn(),
}));

const mockPick = vi.mocked(audioPickFile);
const mockList = vi.mocked(audioRecentList);
const mockForget = vi.mocked(audioRecentForget);

const recent = (name: string) => ({ path: `/music/${name}`, name, dir: "/music" });

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([]);
  mockForget.mockResolvedValue(undefined);
});

describe("DropZone", () => {
  it("invite à déposer un fichier audio et rappelle les formats lus", async () => {
    render(<DropZone onOpen={vi.fn()} onError={vi.fn()} />);

    expect(screen.getByText("Drop an audio file here")).toBeInTheDocument();
    expect(screen.getByText(/MP3 · WAV · FLAC/)).toBeInTheDocument();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
  });

  it("ouvre le fichier choisi dans le sélecteur", async () => {
    mockPick.mockResolvedValue("/music/a.mp3");
    const onOpen = vi.fn();
    render(<DropZone onOpen={onOpen} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse files" }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("/music/a.mp3"));
  });

  it("ne fait rien quand le sélecteur est fermé", async () => {
    mockPick.mockResolvedValue(null);
    const onOpen = vi.fn();
    render(<DropZone onOpen={onOpen} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse files" }));

    await waitFor(() => expect(mockPick).toHaveBeenCalled());
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("traduit une erreur du moteur", async () => {
    mockPick.mockRejectedValue({ code: "cannot_open", params: { path: "/x.mp3" }, message: "en" });
    const onError = vi.fn();
    render(<DropZone onOpen={vi.fn()} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse files" }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Cannot open “/x.mp3”"));
  });

  it("liste les fichiers récents (cinq au plus) et les ouvre d'un clic", async () => {
    mockList.mockResolvedValue(["a", "b", "c", "d", "e", "f"].map((n) => recent(`${n}.wav`)));
    const onOpen = vi.fn();
    render(<DropZone onOpen={onOpen} onError={vi.fn()} />);

    expect(await screen.findByText("a.wav")).toBeInTheDocument();
    expect(screen.queryByText("f.wav")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("c.wav"));

    expect(onOpen).toHaveBeenCalledWith("/music/c.wav");
  });

  it("ne montre pas de liste quand il n'y a rien de récent", async () => {
    render(<DropZone onOpen={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
  });

  it("retire un fichier de la liste, puis la relit", async () => {
    mockList.mockResolvedValueOnce([recent("a.wav")]).mockResolvedValueOnce([]);
    render(<DropZone onOpen={vi.fn()} onError={vi.fn()} />);
    await screen.findByText("a.wav");

    fireEvent.click(screen.getByRole("button", { name: "Remove from the list" }));

    await waitFor(() => expect(mockForget).toHaveBeenCalledWith("/music/a.wav"));
    await waitFor(() => expect(screen.queryByText("a.wav")).not.toBeInTheDocument());
  });

  it("efface toute la liste", async () => {
    mockList.mockResolvedValueOnce([recent("a.wav")]).mockResolvedValueOnce([]);
    render(<DropZone onOpen={vi.fn()} onError={vi.fn()} />);
    await screen.findByText("a.wav");

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(mockForget).toHaveBeenCalledWith(null));
  });

  it("vit sans liste quand les fichiers récents sont indisponibles", async () => {
    mockList.mockRejectedValue(new Error("nope"));
    render(<DropZone onOpen={vi.fn()} onError={vi.fn()} />);

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Browse files" })).toBeInTheDocument();
  });
});
