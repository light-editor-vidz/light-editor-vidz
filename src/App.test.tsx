import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import App from "./App";
import { inertBridge, useTabActive } from "./lib/menuBridge";
import { createProjectFromMedia, mediaKind, pickMediaFile } from "./lib/openMedia";

/** Compte les montages : un projet garde son éditeur tant que son onglet est ouvert. */
function Mounted() {
  useEffect(() => {
    editorMounts.count += 1;
  }, []);
  return null;
}

// Doubles légers : le routage entre les onglets est tout ce qui se joue ici, et chaque écran a
// déjà sa propre suite.
vi.mock("./components/Home", () => ({
  default: ({
    onOpenProject,
    onOpenTool,
    startNewProject,
  }: {
    onOpenProject: (dir: string) => void;
    onOpenTool: (tool: "audio") => void;
    startNewProject?: boolean;
  }) => (
    <div>
      <button type="button" onClick={() => onOpenProject("/projets/demo")}>
        home{startNewProject ? " (new)" : ""}
      </button>
      <button type="button" onClick={() => onOpenTool("audio")}>
        tool-audio
      </button>
    </div>
  ),
}));
vi.mock("./lib/closeGuard", () => ({ installCloseGuard: vi.fn(() => Promise.resolve(() => {})) }));
const dropHandler = vi.hoisted(() => ({ current: null as null | ((e: { payload: unknown }) => Promise<void>) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: (handler: (e: { payload: unknown }) => Promise<void>) => {
      dropHandler.current = handler;
      return Promise.resolve(() => {});
    },
  }),
}));
vi.mock("./lib/openMedia", () => ({
  pickMediaFile: vi.fn(),
  mediaKind: vi.fn(),
  createProjectFromMedia: vi.fn(),
}));
const editorMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("./components/Editor", () => ({
  default: function EditorMock({
    projectDir,
    initialMedia,
    onBack,
    onOpenProject,
  }: {
    projectDir: string;
    initialMedia?: { name: string } | null;
    onBack: (intent?: "new") => void;
    onOpenProject: (dir: string) => void;
  }) {
    const active = useTabActive();
    return (
      <div>
        <Mounted />
        <span>
          editor:{projectDir}
          {active ? "" : " (hidden)"}
          {initialMedia ? ` +${initialMedia.name}` : ""}
        </span>
        <button type="button" onClick={() => onBack()}>
          back
        </button>
        <button type="button" onClick={() => onBack("new")}>
          new
        </button>
        <button type="button" onClick={() => onOpenProject("/projets/autre")}>
          switch
        </button>
      </div>
    );
  },
}));
vi.mock("./components/audiotool/AudioTool", () => ({
  default: ({ path, onOpen, onClose }: { path: string | null; onOpen: (p: string) => void; onClose: () => void }) => (
    <div>
      <span>audio:{path ?? "empty"}</span>
      <button type="button" onClick={() => onOpen("/m/chosen.mp3")}>
        pick-audio
      </button>
      <button type="button" onClick={onClose}>
        close-audio
      </button>
    </div>
  ),
}));

const mockPick = vi.mocked(pickMediaFile);
const mockKind = vi.mocked(mediaKind);
const mockCreate = vi.mocked(createProjectFromMedia);

const tab = (name: RegExp | string) => screen.getByRole("tab", { name });

beforeEach(() => {
  vi.clearAllMocks();
  editorMounts.count = 0;
  inertBridge.actions.current = {};
});

describe("App — onglets", () => {
  it("démarre sur l'accueil, sans autre onglet", () => {
    render(<App />);

    expect(screen.getByText("home")).toBeVisible();
    expect(screen.queryByText(/^editor:/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("ouvre un projet dans un nouvel onglet et l'affiche", () => {
    render(<App />);

    fireEvent.click(screen.getByText("home"));

    expect(screen.getByText("editor:/projets/demo")).toBeVisible();
    expect(tab("demo")).toHaveAttribute("aria-selected", "true");
  });

  it("l'accueil reste ouvert à côté et y ramène sans fermer le projet", () => {
    render(<App />);
    fireEvent.click(screen.getByText("home"));

    fireEvent.click(tab("Home"));

    expect(screen.getByText("home")).toBeVisible();
    // Le projet reste monté (son historique d'annulation est intact), mais masqué et inactif.
    expect(screen.getByText("editor:/projets/demo (hidden)")).toBeInTheDocument();
    expect(editorMounts.count).toBe(1);
  });

  it("Retour ferme l'onglet du projet et revient à l'accueil", () => {
    render(<App />);
    fireEvent.click(screen.getByText("home"));

    fireEvent.click(screen.getByText("back"));

    expect(screen.getByText("home")).toBeVisible();
    expect(screen.queryByText(/^editor:/)).not.toBeInTheDocument();
  });

  it("ouvrir un autre projet depuis l'éditeur lui donne son propre onglet", () => {
    render(<App />);
    fireEvent.click(screen.getByText("home"));

    fireEvent.click(screen.getByText("switch"));

    expect(screen.getByText("editor:/projets/autre")).toBeVisible();
    expect(screen.getByText("editor:/projets/demo (hidden)")).toBeInTheDocument();
    expect(editorMounts.count).toBe(2);
  });

  it("Nouveau projet ferme l'onglet et ramène à l'accueil avec la création ouverte", () => {
    render(<App />);
    fireEvent.click(screen.getByText("home"));

    fireEvent.click(screen.getByText("new"));

    expect(screen.getByText("home (new)")).toBeVisible();
  });

  it("le bouton Audio de l'accueil ouvre un onglet audio vide", () => {
    render(<App />);

    fireEvent.click(screen.getByText("tool-audio"));

    expect(screen.getByText("audio:empty")).toBeVisible();
    expect(tab("Audio")).toHaveAttribute("aria-selected", "true");
  });

  it("choisir un fichier dans l'onglet audio le nomme d'après ce fichier", () => {
    render(<App />);
    fireEvent.click(screen.getByText("tool-audio"));

    fireEvent.click(screen.getByText("pick-audio"));

    expect(screen.getByText("audio:/m/chosen.mp3")).toBeVisible();
    expect(tab("chosen.mp3")).toBeInTheDocument();
  });

  it("la croix d'un onglet le ferme et passe à son voisin", () => {
    render(<App />);
    fireEvent.click(screen.getByText("home"));
    fireEvent.click(tab("Home"));
    fireEvent.click(screen.getByText("tool-audio"));

    fireEvent.click(screen.getByRole("button", { name: "Close Audio" }));

    expect(screen.queryByText(/^audio:/)).not.toBeInTheDocument();
    // Le voisin de droite n'existe plus : on passe à l'onglet de gauche, le projet.
    expect(screen.getByText("editor:/projets/demo")).toBeVisible();
  });
});

describe("App — ouvrir un fichier", () => {
  async function openFileFromMenu() {
    await act(async () => {
      inertBridge.actions.current.openFile?.();
    });
  }

  it("Fichier > Ouvrir un fichier audio ouvre un onglet audio sur ce fichier", async () => {
    mockPick.mockResolvedValue({ path: "/m/song.flac", kind: "audio" });
    render(<App />);

    await openFileFromMenu();

    expect(screen.getByText("audio:/m/song.flac")).toBeVisible();
    expect(tab("song.flac")).toHaveAttribute("aria-selected", "true");
  });

  it("rouvre l'onglet d'un fichier déjà ouvert au lieu d'en créer un second", async () => {
    mockPick.mockResolvedValue({ path: "/m/song.flac", kind: "audio" });
    render(<App />);
    await openFileFromMenu();
    fireEvent.click(tab("Home"));

    await openFileFromMenu();

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(tab("song.flac")).toHaveAttribute("aria-selected", "true");
  });

  it("ne fait rien quand le dialogue est annulé", async () => {
    mockPick.mockResolvedValue(null);
    render(<App />);

    await openFileFromMenu();

    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it.each([
    ["video", "/m/clip.mp4"],
    ["image", "/m/photo.png"],
  ] as const)("une %s crée un projet qui la contient et l'ouvre", async (kind, path) => {
    mockPick.mockResolvedValue({ path, kind });
    mockCreate.mockResolvedValue({
      dir: "/m/proj.lvproj",
      media: { kind, src: "assets/x", name: path.split("/").pop() as string },
    });
    render(<App />);

    await openFileFromMenu();

    expect(mockCreate).toHaveBeenCalledWith(path, kind);
    expect(screen.getByText(`editor:/m/proj.lvproj +${path.split("/").pop()}`)).toBeVisible();
  });

  it("signale un type de fichier que l'application ne sait pas ouvrir", async () => {
    mockPick.mockResolvedValue({ path: "/m/notes.txt", kind: "unknown" });
    render(<App />);

    await openFileFromMenu();

    expect(screen.getByRole("alert")).toHaveTextContent("This file type cannot be opened.");
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("signale l'échec de création du projet, et le message se ferme", async () => {
    mockPick.mockResolvedValue({ path: "/m/clip.mp4", kind: "video" });
    mockCreate.mockRejectedValue(new Error("disk full"));
    render(<App />);

    await openFileFromMenu();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("disk full");
    fireEvent.click(within(alert).getByRole("button"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ouvre comme un fichier choisi ce qui est déposé sur la fenêtre", async () => {
    mockKind.mockResolvedValueOnce("audio").mockResolvedValueOnce("unknown");
    render(<App />);
    await waitFor(() => expect(dropHandler.current).not.toBeNull());

    await act(async () => {
      await dropHandler.current?.({ payload: { type: "drop", paths: ["/m/a.wav", "/m/b.xyz"] } });
    });

    expect(screen.getByText("audio:/m/a.wav")).toBeVisible();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("ignore les autres événements de glisser-déposer", async () => {
    render(<App />);
    await waitFor(() => expect(dropHandler.current).not.toBeNull());

    await act(async () => {
      await dropHandler.current?.({ payload: { type: "enter", paths: ["/m/a.wav"] } });
    });

    expect(mockKind).not.toHaveBeenCalled();
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });
});
