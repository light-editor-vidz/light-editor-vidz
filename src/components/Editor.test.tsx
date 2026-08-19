import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { listAssets, loadProject, newProject, readTextFile, saveProject } from "../lib/commands";
import { createTitleElement } from "../lib/elements";
import type { Project } from "../bindings/Project";
import type { Composition } from "../bindings/Composition";
import type { Element } from "../bindings/Element";
import type { AudioTrack } from "../bindings/AudioTrack";
import Editor from "./Editor";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(() => Promise.resolve("1.2.3")) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../lib/commands", () => ({
  loadProject: vi.fn(),
  saveProject: vi.fn(),
  newProject: vi.fn(),
  readTextFile: vi.fn(),
  exportProject: vi.fn(),
  listAssets: vi.fn(),
  importAsset: vi.fn(),
  searchStockAssets: vi.fn(() => Promise.resolve({ results: [], errors: [], providers: [] })),
  importStockAsset: vi.fn(),
}));
vi.mock("../lib/settings", () => ({
  loadApiKeys: vi.fn(() => Promise.resolve({})),
  saveApiKeys: vi.fn(() => Promise.resolve()),
}));
vi.mock("../lib/mediaCache", () => ({
  acquireMediaObjectUrl: () => ({ promise: Promise.resolve("blob:a"), release: () => {} }),
}));
vi.mock("../lib/assetUrl", () => ({ assetUrl: (dir: string, path: string) => `asset://${dir}/${path}` }));

const mockOpen = vi.mocked(open);
const mockLoad = vi.mocked(loadProject);
const mockSave = vi.mocked(saveProject);
const mockNewProject = vi.mocked(newProject);
const mockReadText = vi.mocked(readTextFile);
const mockListAssets = vi.mocked(listAssets);

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Élément texte aux valeurs par défaut (x:10, y:40, 80×20), avec un id stable. */
const el = (id: string, over: Partial<Element> = {}): Element =>
  ({ ...createTitleElement(), id, name: id, ...over }) as Element;

const comp = (over: Partial<Composition> = {}): Composition => ({
  id: "c1",
  name: "Scene 1",
  start_time: 0,
  duration: 10,
  elements: [],
  transition_in: null,
  transition_out: null,
  overlap_next: 0,
  ...over,
});

const track = (over: Partial<AudioTrack> = {}): AudioTrack => ({
  id: "a1",
  name: "Music",
  src: "assets/audio/a.mp3",
  start_time: 0,
  duration: 8,
  volume: 1,
  audio_offset: 0,
  fade_in: 0,
  fade_out: 0,
  muted: false,
  solo: false,
  ...over,
});

/** Deux scènes (10 s + 5 s) ; la première porte deux éléments texte. */
function makeProject(over: Partial<Project> = {}): Project {
  return {
    name: "Demo",
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 15,
    compositions: [
      comp({ elements: [el("one"), el("two")] }),
      comp({ id: "c2", name: "Scene 2", start_time: 10, duration: 5 }),
    ],
    audio_tracks: [],
    ...over,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function renderEditor(project: Project = makeProject()) {
  mockLoad.mockResolvedValue(project);
  const onBack = vi.fn();
  const onOpenProject = vi.fn();
  const view = render(<Editor projectDir="/p" onBack={onBack} onOpenProject={onOpenProject} />);
  await act(async () => {});
  return { ...view, onBack, onOpenProject };
}

const key = (k: string, mods: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(window, { key: k, ...mods });

/** Force une sauvegarde (Ctrl+S) et renvoie le projet effectivement écrit — l'état interne
 * de l'éditeur n'est observable que par ce qu'il persiste. */
async function savedProject(): Promise<Project> {
  mockSave.mockClear();
  key("s", { ctrlKey: true });
  await act(async () => {});
  expect(mockSave).toHaveBeenCalledTimes(1);
  return mockSave.mock.calls[0][1] as Project;
}

const elementsOf = (p: Project, compId = "c1") => p.compositions.find((c) => c.id === compId)!.elements;

const timecode = () => document.querySelector(".playback-timecode")?.textContent;

const layerRow = (name: string) =>
  [...document.querySelectorAll(".layers-row")].find((row) => row.textContent?.includes(name))!;

/** Les scènes et les clips de la timeline réagissent au pointerdown, pas au click. */
const selectScene = (name: string) => fireEvent.pointerDown(screen.getByText(name));

beforeEach(() => {
  vi.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
  mockOpen.mockResolvedValue(null);
  mockListAssets.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Chargement ──────────────────────────────────────────────────────────────

describe("Editor — chargement du projet", () => {
  it("affiche le loader tant que le projet n'est pas arrivé", async () => {
    mockLoad.mockReturnValue(new Promise(() => {}));
    render(<Editor projectDir="/p" onBack={vi.fn()} onOpenProject={vi.fn()} />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("affiche l'erreur de chargement et permet de revenir en arrière", async () => {
    mockLoad.mockRejectedValue(new Error("disque illisible"));
    const onBack = vi.fn();
    render(<Editor projectDir="/p" onBack={onBack} onOpenProject={vi.fn()} />);

    expect(await screen.findByText(/disque illisible/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("répare silencieusement un projet sans aucune scène", async () => {
    await renderEditor(makeProject({ compositions: [], duration: 0 }));

    // Sans réparation, `resolveActiveComposition` renverrait null et l'éditeur
    // resterait bloqué sur « Loading… ».
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(elementsOf(await savedProject(), (await savedProject()).compositions[0].id)).toEqual([]);
    expect((await savedProject()).compositions).toHaveLength(1);
  });

  it("marque un projet réparé comme non enregistré", async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(makeProject({ compositions: [], duration: 0 }));
    render(<Editor projectDir="/p" onBack={vi.fn()} onOpenProject={vi.fn()} />);
    await act(async () => {});

    // La réparation seule doit déclencher la sauvegarde automatique.
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it("recharge quand le dossier de projet change", async () => {
    const { rerender } = await renderEditor();
    expect(mockLoad).toHaveBeenCalledWith("/p");

    mockLoad.mockResolvedValue(makeProject({ name: "Autre" }));
    rerender(<Editor projectDir="/autre" onBack={vi.fn()} onOpenProject={vi.fn()} />);
    await act(async () => {});

    expect(mockLoad).toHaveBeenLastCalledWith("/autre");
    expect(screen.getByText("Autre")).toBeInTheDocument();
  });
});

// ── Sauvegarde ──────────────────────────────────────────────────────────────

describe("Editor — sauvegarde", () => {
  it("écrit le projet sur Ctrl+S", async () => {
    await renderEditor();

    key("s", { ctrlKey: true });
    await act(async () => {});

    expect(mockSave).toHaveBeenCalledWith("/p", expect.objectContaining({ name: "Demo" }));
  });

  it("accepte aussi Cmd+S", async () => {
    await renderEditor();

    key("S", { metaKey: true });
    await act(async () => {});

    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it("sauvegarde depuis le bouton de la top bar", async () => {
    await renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await act(async () => {});

    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it("signale les modifications non enregistrées puis efface le témoin", async () => {
    await renderEditor();
    expect(screen.queryByLabelText("Unsaved changes (autosave pending)")).not.toBeInTheDocument();

    key("g", { ctrlKey: true }); // pas de sélection : aucune mutation
    expect(screen.queryByLabelText("Unsaved changes (autosave pending)")).not.toBeInTheDocument();

    key("a", { ctrlKey: true });
    key("g", { ctrlKey: true });
    expect(screen.getByLabelText("Unsaved changes (autosave pending)")).toBeInTheDocument();

    key("s", { ctrlKey: true });
    await act(async () => {});
    expect(screen.queryByLabelText("Unsaved changes (autosave pending)")).not.toBeInTheDocument();
  });

  it("remonte l'échec d'une sauvegarde manuelle", async () => {
    await renderEditor();
    mockSave.mockRejectedValue(new Error("disque plein"));

    key("s", { ctrlKey: true });

    expect(await screen.findByText(/disque plein/)).toBeInTheDocument();
  });

  it("sauvegarde automatiquement 2,5 s après la dernière modification", async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(makeProject());
    render(<Editor projectDir="/p" onBack={vi.fn()} onOpenProject={vi.fn()} />);
    await act(async () => {});

    key("a", { ctrlKey: true });
    key("g", { ctrlKey: true });

    await act(async () => {
      vi.advanceTimersByTime(2400);
    });
    expect(mockSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it("repousse l'échéance à chaque nouvelle modification", async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(makeProject());
    render(<Editor projectDir="/p" onBack={vi.fn()} onOpenProject={vi.fn()} />);
    await act(async () => {});

    key("a", { ctrlKey: true });
    key("g", { ctrlKey: true });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    key("g", { ctrlKey: true, shiftKey: true }); // dégroupe : nouvelle mutation
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it("remonte l'échec de la sauvegarde automatique", async () => {
    vi.useFakeTimers();
    mockSave.mockRejectedValue(new Error("écriture refusée"));
    mockLoad.mockResolvedValue(makeProject());
    render(<Editor projectDir="/p" onBack={vi.fn()} onOpenProject={vi.fn()} />);
    await act(async () => {});

    key("a", { ctrlKey: true });
    key("g", { ctrlKey: true });
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(screen.getByText(/écriture refusée/)).toBeInTheDocument();
  });
});

// ── Lecture ─────────────────────────────────────────────────────────────────

describe("Editor — lecture", () => {
  it("avance l'horloge en temps réel pendant la lecture", async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(makeProject());
    render(<Editor projectDir="/p" onBack={vi.fn()} onOpenProject={vi.fn()} />);
    await act(async () => {});
    expect(timecode()).toBe("00:00:00 / 00:15:00");

    key(" ");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(timecode()).toBe("00:01:00 / 00:15:00");
  });

  it("ignore la répétition clavier de la barre d'espace", async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(makeProject());
    render(<Editor projectDir="/p" onBack={vi.fn()} onOpenProject={vi.fn()} />);
    await act(async () => {});

    key(" ");
    key(" ", { repeat: true }); // auto-repeat : ne doit pas mettre en pause
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(timecode()).toBe("00:01:00 / 00:15:00");
  });

  it("met en pause sur une seconde pression", async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(makeProject());
    render(<Editor projectDir="/p" onBack={vi.fn()} onOpenProject={vi.fn()} />);
    await act(async () => {});

    key(" ");
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    key(" ");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(timecode()).toBe("00:00:15 / 00:15:00");
  });

  it("s'arrête et se cale sur la fin quand la lecture atteint la durée du projet", async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(makeProject());
    render(<Editor projectDir="/p" onBack={vi.fn()} onOpenProject={vi.fn()} />);
    await act(async () => {});

    key("End");
    key(" ");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    // Arrêté net sur la durée, sans la dépasser.
    expect(timecode()).toBe("00:15:00 / 00:15:00");

    // Et la lecture est bien coupée : le temps ne bouge plus.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(timecode()).toBe("00:15:00 / 00:15:00");
  });

  it("bascule la lecture depuis le bouton du canvas", async () => {
    vi.useFakeTimers();
    mockLoad.mockResolvedValue(makeProject());
    render(<Editor projectDir="/p" onBack={vi.fn()} onOpenProject={vi.fn()} />);
    await act(async () => {});

    fireEvent.click(document.querySelector(".play-btn")!);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(timecode()).toBe("00:01:00 / 00:15:00");
  });
});

// ── Navigation temporelle ───────────────────────────────────────────────────

describe("Editor — navigation dans le temps", () => {
  it("Home et End vont aux bornes du projet", async () => {
    await renderEditor();

    key("End");
    expect(timecode()).toBe("00:15:00 / 00:15:00");

    key("Home");
    expect(timecode()).toBe("00:00:00 / 00:15:00");
  });

  it("les flèches avancent image par image sans sélection", async () => {
    await renderEditor();

    key("ArrowRight");
    expect(timecode()).toBe("00:00:01 / 00:15:00");

    key("ArrowLeft");
    expect(timecode()).toBe("00:00:00 / 00:15:00");
  });

  it("Maj + flèche saute d'une seconde", async () => {
    await renderEditor();

    key("ArrowRight", { shiftKey: true });
    expect(timecode()).toBe("00:01:00 / 00:15:00");
  });

  it("ne recule pas avant le début du projet", async () => {
    await renderEditor();

    key("ArrowLeft", { shiftKey: true });
    expect(timecode()).toBe("00:00:00 / 00:15:00");
  });

  it("retombe sur 30 fps quand le projet n'en déclare pas", async () => {
    await renderEditor(makeProject({ fps: 0 }));

    key("ArrowRight");
    expect(timecode()).toBe("00:00:01 / 00:15:00");
  });

  it("le bouton « retour au début » recale sur le début de la scène active", async () => {
    await renderEditor();
    key("End"); // scène 2, temps local 5
    expect(timecode()).toBe("00:15:00 / 00:15:00");

    fireEvent.click(screen.getByTitle("Back to start"));
    expect(timecode()).toBe("00:10:00 / 00:15:00");
  });

  it("le bouton « suivant » saute à la scène suivante puis à la fin", async () => {
    await renderEditor();

    fireEvent.click(screen.getByTitle("Next"));
    expect(timecode()).toBe("00:10:00 / 00:15:00");

    // Depuis la dernière scène, il n'y a plus de suivante : on va à la fin du projet.
    fireEvent.click(screen.getByTitle("Next"));
    expect(timecode()).toBe("00:15:00 / 00:15:00");
  });

  it("cliquer une scène de la timeline y positionne la tête de lecture", async () => {
    await renderEditor();

    selectScene("Scene 2");
    expect(timecode()).toBe("00:10:00 / 00:15:00");
  });
});

// ── Sélection ───────────────────────────────────────────────────────────────

describe("Editor — sélection", () => {
  it("Ctrl+A sélectionne tous les éléments de la scène active", async () => {
    await renderEditor();

    key("a", { ctrlKey: true });

    expect(screen.getByText("2 elements selected")).toBeInTheDocument();
  });

  it("Échap vide la sélection", async () => {
    await renderEditor();
    key("a", { ctrlKey: true });

    key("Escape");

    expect(screen.getByText("No element selected")).toBeInTheDocument();
  });

  it("sélectionne un calque depuis le panneau des calques", async () => {
    await renderEditor();

    fireEvent.click(layerRow("one"));

    expect(screen.getByText("Text properties")).toBeInTheDocument();
    expect(layerRow("one").className).toContain("selected");
  });

  it("le clic additif ajoute puis retire de la sélection", async () => {
    await renderEditor();

    fireEvent.click(layerRow("one"));
    fireEvent.click(layerRow("two"), { shiftKey: true });
    expect(screen.getByText("2 elements selected")).toBeInTheDocument();

    fireEvent.click(layerRow("two"), { shiftKey: true });
    expect(screen.getByText("Text properties")).toBeInTheDocument();
  });

  it("sélectionner un membre d'un groupe sélectionne tout le groupe", async () => {
    await renderEditor();
    key("a", { ctrlKey: true });
    key("g", { ctrlKey: true });
    key("Escape");
    expect(screen.getByText("No element selected")).toBeInTheDocument();

    fireEvent.click(layerRow("one"));

    expect(screen.getByText("2 elements selected")).toBeInTheDocument();
  });

  it("Ctrl+A ne sélectionne rien dans une scène vide", async () => {
    await renderEditor();
    selectScene("Scene 2");

    key("a", { ctrlKey: true });

    expect(screen.getByText("No element selected")).toBeInTheDocument();
  });
});

// ── Déplacement au clavier ──────────────────────────────────────────────────

describe("Editor — déplacement au clavier", () => {
  it("les flèches déplacent la sélection de 1 % du canvas", async () => {
    await renderEditor();
    key("a", { ctrlKey: true });

    key("ArrowRight");
    key("ArrowDown");

    const els = elementsOf(await savedProject());
    expect(els.map((e) => [e.x, e.y])).toEqual([
      [11, 41],
      [11, 41],
    ]);
  });

  it("Maj accélère le déplacement à 5 %", async () => {
    await renderEditor();
    key("a", { ctrlKey: true });

    key("ArrowUp", { shiftKey: true });

    expect(elementsOf(await savedProject())[0].y).toBe(35);
  });

  it("borne le déplacement au canvas", async () => {
    await renderEditor(makeProject({ compositions: [comp({ elements: [el("one", { x: 19.5, y: 0 })] })] }));
    key("a", { ctrlKey: true });

    key("ArrowRight");
    key("ArrowUp");

    // x plafonne à 100 - width (80) = 20, y ne descend pas sous 0.
    expect(elementsOf(await savedProject())[0]).toMatchObject({ x: 20, y: 0 });
  });

  it("ignore les flèches verticales sans sélection", async () => {
    await renderEditor();

    key("ArrowDown");

    expect(elementsOf(await savedProject())[0].y).toBe(40);
    expect(timecode()).toBe("00:00:00 / 00:15:00");
  });
});

// ── Édition ─────────────────────────────────────────────────────────────────

describe("Editor — édition des éléments", () => {
  it("supprime la sélection avec Suppr", async () => {
    await renderEditor();
    key("a", { ctrlKey: true });

    key("Delete");

    expect(elementsOf(await savedProject())).toHaveLength(0);
    expect(screen.getByText("No element selected")).toBeInTheDocument();
  });

  it("supprime aussi avec Retour arrière", async () => {
    await renderEditor();
    fireEvent.click(layerRow("one"));

    key("Backspace");

    expect(elementsOf(await savedProject()).map((e) => e.id)).toEqual(["two"]);
  });

  it("duplique la sélection avec Ctrl+D", async () => {
    await renderEditor();
    fireEvent.click(layerRow("one"));

    key("d", { ctrlKey: true });

    const els = elementsOf(await savedProject());
    expect(els).toHaveLength(3);
    expect(screen.getByText("Text properties")).toBeInTheDocument();
  });

  it("copie puis colle avec un décalage de 3 %", async () => {
    await renderEditor();
    fireEvent.click(layerRow("one"));

    key("c", { ctrlKey: true });
    key("v", { ctrlKey: true });

    const els = elementsOf(await savedProject());
    expect(els).toHaveLength(3);
    expect(els[2]).toMatchObject({ x: 13, y: 43 });
    expect(els[2].id).not.toBe("one");
  });

  it("ne colle rien tant que rien n'a été copié", async () => {
    await renderEditor();

    key("v", { ctrlKey: true });

    expect(elementsOf(await savedProject())).toHaveLength(2);
  });

  it("ne copie rien sans sélection", async () => {
    await renderEditor();

    key("c", { ctrlKey: true });
    key("v", { ctrlKey: true });

    expect(elementsOf(await savedProject())).toHaveLength(2);
  });

  it("groupe et dégroupe la sélection", async () => {
    await renderEditor();
    key("a", { ctrlKey: true });

    key("g", { ctrlKey: true });
    let els = elementsOf(await savedProject());
    expect(els[0].group_id).toBeTruthy();
    expect(els[0].group_id).toBe(els[1].group_id);

    key("g", { ctrlKey: true, shiftKey: true });
    els = elementsOf(await savedProject());
    expect(els.map((e) => e.group_id)).toEqual([null, null]);
  });

  it("refuse de grouper un seul élément", async () => {
    await renderEditor();
    fireEvent.click(layerRow("one"));

    key("g", { ctrlKey: true });

    expect(elementsOf(await savedProject())[0].group_id).toBeNull();
  });

  it("déplace les autres membres du groupe avec l'élément déplacé", async () => {
    await renderEditor();
    key("a", { ctrlKey: true });
    key("g", { ctrlKey: true });
    // Retire « two » de la sélection pour éditer « one » seul, groupe toujours actif.
    fireEvent.click(layerRow("two"), { ctrlKey: true });

    fireEvent.change(screen.getByLabelText("X"), { target: { value: "30" } });

    const els = elementsOf(await savedProject());
    expect(els.find((e) => e.id === "one")!.x).toBe(30);
    expect(els.find((e) => e.id === "two")!.x).toBe(30); // même delta (+20)
  });

  it("ne propage rien au groupe pour une propriété non spatiale", async () => {
    await renderEditor();
    key("a", { ctrlKey: true });
    key("g", { ctrlKey: true });
    fireEvent.click(layerRow("two"), { ctrlKey: true });

    fireEvent.change(screen.getByLabelText("W"), { target: { value: "50" } });

    const els = elementsOf(await savedProject());
    expect(els.find((e) => e.id === "one")!.width).toBe(50);
    expect(els.find((e) => e.id === "two")!.width).toBe(80);
  });

  it("supprime un calque depuis le panneau des calques", async () => {
    await renderEditor();
    fireEvent.click(layerRow("one"));

    fireEvent.click(within(layerRow("one") as HTMLElement).getByRole("button"));

    expect(elementsOf(await savedProject()).map((e) => e.id)).toEqual(["two"]);
    expect(screen.getByText("No element selected")).toBeInTheDocument();
  });

  it("réordonne un calque par glisser-déposer", async () => {
    await renderEditor();
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? "",
    };

    fireEvent.dragStart(layerRow("two"), { dataTransfer });
    fireEvent.drop(layerRow("one"), { dataTransfer });

    expect(elementsOf(await savedProject()).map((e) => e.id)).toEqual(["two", "one"]);
  });
});

// ── Historique ──────────────────────────────────────────────────────────────

describe("Editor — annuler / rétablir", () => {
  it("annule puis rétablit une modification", async () => {
    await renderEditor();
    key("a", { ctrlKey: true });
    key("g", { ctrlKey: true });
    expect(elementsOf(await savedProject())[0].group_id).toBeTruthy();

    key("z", { ctrlKey: true });
    expect(elementsOf(await savedProject())[0].group_id).toBeNull();

    key("z", { ctrlKey: true, shiftKey: true });
    expect(elementsOf(await savedProject())[0].group_id).toBeTruthy();
  });

  it("accepte Ctrl+Y comme rétablir", async () => {
    await renderEditor();
    key("a", { ctrlKey: true });
    key("g", { ctrlKey: true });
    key("z", { ctrlKey: true });

    key("y", { ctrlKey: true });

    expect(elementsOf(await savedProject())[0].group_id).toBeTruthy();
  });

  it("ne fait rien quand l'historique est vide", async () => {
    await renderEditor();

    key("z", { ctrlKey: true });
    key("y", { ctrlKey: true });

    expect(elementsOf(await savedProject())).toHaveLength(2);
  });

  it("fusionne les déplacements successifs en une seule entrée d'annulation", async () => {
    await renderEditor();
    key("a", { ctrlKey: true });

    key("ArrowRight");
    key("ArrowRight");
    key("ArrowRight");
    expect(elementsOf(await savedProject())[0].x).toBe(13);

    // Un seul undo doit ramener à la position d'origine, pas reculer d'un pas.
    key("z", { ctrlKey: true });
    expect(elementsOf(await savedProject())[0].x).toBe(10);
  });

  it("ne fusionne pas deux réglages différents", async () => {
    await renderEditor();
    key("a", { ctrlKey: true });

    key("ArrowRight"); // clé « nudge » sur x
    key("g", { ctrlKey: true }); // mutation sans clé de fusion

    key("z", { ctrlKey: true });
    expect(elementsOf(await savedProject())[0].group_id).toBeNull();
    expect(elementsOf(await savedProject())[0].x).toBe(11);
  });

  it("pilote aussi l'annulation depuis les boutons du canvas", async () => {
    await renderEditor();
    const undo = screen.getByTitle("Undo");
    const redo = screen.getByTitle("Redo");
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    key("a", { ctrlKey: true });
    key("g", { ctrlKey: true });
    expect(undo).toBeEnabled();

    fireEvent.click(undo);
    expect(elementsOf(await savedProject())[0].group_id).toBeNull();
    expect(redo).toBeEnabled();

    fireEvent.click(redo);
    expect(elementsOf(await savedProject())[0].group_id).toBeTruthy();
  });
});

// ── Champs de saisie ────────────────────────────────────────────────────────

describe("Editor — raccourcis pendant la saisie", () => {
  it("neutralise les raccourcis quand le focus est dans un champ", async () => {
    await renderEditor();
    fireEvent.click(layerRow("one"));
    const x = screen.getByLabelText("X") as HTMLInputElement;
    x.focus();

    key("Delete");
    key(" ");
    key("ArrowRight");

    const els = elementsOf(await savedProject());
    expect(els).toHaveLength(2);
    expect(els[0].x).toBe(10);
    expect(timecode()).toBe("00:00:00 / 00:15:00");
  });

  it("laisse toutefois passer Ctrl+S depuis un champ", async () => {
    await renderEditor();
    fireEvent.click(layerRow("one"));
    (screen.getByLabelText("X") as HTMLInputElement).focus();

    key("s", { ctrlKey: true });
    await act(async () => {});

    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});

// ── Pistes audio ────────────────────────────────────────────────────────────

describe("Editor — pistes audio", () => {
  const withAudio = () => makeProject({ audio_tracks: [track()] });
  /** Les clips d'éléments viennent en premier ; la piste audio est la dernière voie. */
  const audioClip = () => {
    const clips = document.querySelectorAll(".timeline-clip");
    return clips[clips.length - 1] as HTMLElement;
  };

  it("sélectionne une piste et affiche ses propriétés", async () => {
    await renderEditor(withAudio());

    fireEvent.pointerDown(audioClip());

    expect(screen.getByDisplayValue("Music")).toBeInTheDocument();
  });

  it("met à jour une piste audio", async () => {
    await renderEditor(withAudio());
    fireEvent.pointerDown(audioClip());

    fireEvent.change(screen.getByDisplayValue("Music"), { target: { value: "Thème" } });

    expect((await savedProject()).audio_tracks[0].name).toBe("Thème");
  });

  it("supprime la piste sélectionnée", async () => {
    await renderEditor(withAudio());
    fireEvent.pointerDown(audioClip());

    key("Delete");

    expect((await savedProject()).audio_tracks).toHaveLength(0);
  });

  it("duplique la piste sélectionnée", async () => {
    await renderEditor(withAudio());
    fireEvent.pointerDown(audioClip());

    key("d", { ctrlKey: true });

    const tracks = (await savedProject()).audio_tracks;
    expect(tracks).toHaveLength(2);
    expect(tracks[1].id).not.toBe(tracks[0].id);
  });

  it("ne découpe pas une piste audio", async () => {
    await renderEditor(withAudio());
    fireEvent.pointerDown(audioClip());

    fireEvent.click(
      within(document.querySelector(".timeline-toolbar-left") as HTMLElement).getByRole("button", { name: "Split" }),
    );

    expect((await savedProject()).audio_tracks).toHaveLength(1);
  });
});

// ── Timeline ────────────────────────────────────────────────────────────────

describe("Editor — timeline", () => {
  it("ajoute une scène", async () => {
    await renderEditor();

    fireEvent.pointerDown(screen.getByTitle("Add a scene"));

    expect((await savedProject()).compositions).toHaveLength(3);
  });

  it("duplique une scène et s'y positionne", async () => {
    await renderEditor();

    fireEvent.click(screen.getByTitle("Duplicate scene"));

    const p = await savedProject();
    expect(p.compositions).toHaveLength(3);
    expect(timecode()).toBe("00:10:00 / 00:25:00");
  });

  it("supprime une scène", async () => {
    await renderEditor();

    selectScene("Scene 2");
    fireEvent.click(screen.getByTitle("Delete scene"));

    expect((await savedProject()).compositions.map((c) => c.id)).toEqual(["c1"]);
  });

  it("réordonne les scènes", async () => {
    await renderEditor();

    fireEvent.click(screen.getByTitle("Move scene later"));

    expect((await savedProject()).compositions.map((c) => c.id)).toEqual(["c2", "c1"]);
  });

  it("découpe l'élément sélectionné au temps courant", async () => {
    await renderEditor(
      makeProject({
        compositions: [comp({ elements: [el("one", { start_time: 0, duration: 8 })] })],
        duration: 10,
      }),
    );
    key("ArrowRight", { shiftKey: true }); // t = 1 s, aucune sélection : la tête avance
    fireEvent.click(layerRow("one"));

    fireEvent.click(
      within(document.querySelector(".timeline-toolbar-left") as HTMLElement).getByRole("button", { name: "Split" }),
    );

    const els = elementsOf(await savedProject());
    expect(els).toHaveLength(2);
    expect(els.map((e) => [e.start_time, e.duration])).toEqual([
      [0, 1],
      [1, 7],
    ]);
  });

  it("supprime et duplique depuis la barre d'outils de la timeline", async () => {
    await renderEditor();
    fireEvent.click(layerRow("one"));

    const toolbar = within(document.querySelector(".timeline-toolbar-left") as HTMLElement);
    fireEvent.click(toolbar.getByRole("button", { name: "Duplicate" }));
    expect(elementsOf(await savedProject())).toHaveLength(3);

    fireEvent.click(toolbar.getByRole("button", { name: "Delete" }));
    expect(elementsOf(await savedProject())).toHaveLength(2);
  });
});

// ── Bibliothèque ────────────────────────────────────────────────────────────

describe("Editor — ajout depuis la bibliothèque", () => {
  /** Bascule la bibliothèque sur une catégorie du rail latéral. */
  const openTab = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));

  it("ajoute un titre et le sélectionne", async () => {
    await renderEditor();

    fireEvent.click(screen.getByText("Add a title"));

    const els = elementsOf(await savedProject());
    expect(els).toHaveLength(3);
    expect(screen.getByText("Text properties")).toBeInTheDocument();
  });

  it("ajoute un sous-titre", async () => {
    await renderEditor();

    fireEvent.click(screen.getByText("Default subtitle"));

    const els = elementsOf(await savedProject());
    expect(els).toHaveLength(3);
    // Le sous-titre est posé en bas du cadre, contrairement au titre.
    expect(els[2].y).toBe(62);
  });

  it("ajoute un texte stylisé", async () => {
    await renderEditor();

    fireEvent.click(screen.getByText("Neon"));

    expect(elementsOf(await savedProject())).toHaveLength(3);
  });

  it("ajoute une forme", async () => {
    await renderEditor();
    openTab("Shapes");

    fireEvent.click(screen.getByTitle("Ellipse"));

    const els = elementsOf(await savedProject());
    expect(els[2]).toMatchObject({ type: "shape", shape_type: "ellipse" });
  });

  it("ajoute une image importée dans le projet", async () => {
    mockListAssets.mockResolvedValue([{ filename: "photo.png", relative_path: "assets/images/photo.png" }]);
    await renderEditor();
    openTab("Images");
    await act(async () => {});

    fireEvent.click(screen.getByText("photo.png"));

    const els = elementsOf(await savedProject());
    expect(els[2]).toMatchObject({ type: "image", src: "assets/images/photo.png", name: "photo.png" });
  });

  it("ajoute une vidéo importée dans le projet", async () => {
    mockListAssets.mockResolvedValue([{ filename: "clip.mp4", relative_path: "assets/videos/clip.mp4" }]);
    await renderEditor();
    openTab("Videos");
    await act(async () => {});

    fireEvent.click(screen.getByText("clip.mp4"));

    const els = elementsOf(await savedProject());
    expect(els[2]).toMatchObject({ type: "video", src: "assets/videos/clip.mp4" });
  });

  it("ajoute une piste audio globale au projet", async () => {
    mockListAssets.mockResolvedValue([{ filename: "theme.mp3", relative_path: "assets/audio/theme.mp3" }]);
    await renderEditor();
    openTab("Audio");
    await act(async () => {});

    fireEvent.click(screen.getByText("theme.mp3"));

    const p = await savedProject();
    // Une piste audio n'appartient à aucune scène.
    expect(elementsOf(p)).toHaveLength(2);
    expect(p.audio_tracks[0]).toMatchObject({ src: "assets/audio/theme.mp3", name: "theme.mp3" });
    expect(screen.getByDisplayValue("theme.mp3")).toBeInTheDocument();
  });
});

describe("Editor — ordre, alignement et répartition", () => {
  it("avance et recule un élément dans la pile", async () => {
    await renderEditor();
    fireEvent.click(layerRow("one"));

    fireEvent.click(screen.getByTitle("Bring forward"));
    expect(elementsOf(await savedProject()).map((e) => e.id)).toEqual(["two", "one"]);

    fireEvent.click(screen.getByTitle("Bring forward"));
    expect(elementsOf(await savedProject()).map((e) => e.id)).toEqual(["two", "one"]);

    fireEvent.click(screen.getByTitle("Send backward"));
    expect(elementsOf(await savedProject()).map((e) => e.id)).toEqual(["one", "two"]);
  });

  it("aligne la sélection sur un bord", async () => {
    await renderEditor(
      makeProject({
        compositions: [comp({ elements: [el("one", { x: 10 }), el("two", { x: 40, width: 20 })] })],
      }),
    );
    key("a", { ctrlKey: true });

    fireEvent.click(screen.getByTitle("Align left"));

    const els = elementsOf(await savedProject());
    expect(els.map((e) => e.x)).toEqual([10, 10]);
  });

  it("aligne aussi verticalement", async () => {
    await renderEditor(
      makeProject({
        compositions: [comp({ elements: [el("one", { y: 10 }), el("two", { y: 40 })] })],
      }),
    );
    key("a", { ctrlKey: true });

    fireEvent.click(screen.getByTitle("Align top"));

    expect(elementsOf(await savedProject()).map((e) => e.y)).toEqual([10, 10]);
  });

  it("répartit trois éléments horizontalement", async () => {
    await renderEditor(
      makeProject({
        compositions: [
          comp({
            elements: [
              el("one", { x: 0, width: 10 }),
              el("two", { x: 5, width: 10 }),
              el("three", { x: 60, width: 10 }),
            ],
          }),
        ],
      }),
    );
    key("a", { ctrlKey: true });

    fireEvent.click(screen.getByTitle("Distribute horizontally"));

    const xs = elementsOf(await savedProject()).map((e) => e.x);
    // Les extrêmes ne bougent pas, celui du milieu est recentré.
    expect(xs[0]).toBe(0);
    expect(xs[2]).toBe(60);
    expect(xs[1]).toBeGreaterThan(5);
  });

  it("répartit aussi verticalement", async () => {
    await renderEditor(
      makeProject({
        compositions: [
          comp({
            elements: [
              el("one", { y: 0, height: 10 }),
              el("two", { y: 5, height: 10 }),
              el("three", { y: 60, height: 10 }),
            ],
          }),
        ],
      }),
    );
    key("a", { ctrlKey: true });

    fireEvent.click(screen.getByTitle("Distribute vertically"));

    expect(elementsOf(await savedProject())[1].y).toBeGreaterThan(5);
  });

  it("ne répartit rien avec moins de trois éléments", async () => {
    await renderEditor();
    key("a", { ctrlKey: true });

    fireEvent.click(screen.getByTitle("Distribute horizontally"));

    expect(elementsOf(await savedProject()).map((e) => e.x)).toEqual([10, 10]);
  });
});

describe("Editor — transitions de scène", () => {
  it("pose une transition d'entrée", async () => {
    await renderEditor();

    fireEvent.change(screen.getByTitle("Scene entrance transition"), { target: { value: "fade" } });

    const p = await savedProject();
    expect(p.compositions[0].transition_in).toMatchObject({ transition_type: "fade" });
  });

  it("pose une transition de sortie", async () => {
    await renderEditor();

    fireEvent.change(screen.getByTitle("Scene exit transition"), { target: { value: "zoom" } });

    expect((await savedProject()).compositions[0].transition_out).toMatchObject({
      transition_type: "zoom",
    });
  });

  it("retire une transition", async () => {
    await renderEditor();
    fireEvent.change(screen.getByTitle("Scene entrance transition"), { target: { value: "fade" } });

    fireEvent.change(screen.getByTitle("Scene entrance transition"), { target: { value: "" } });

    expect((await savedProject()).compositions[0].transition_in).toBeNull();
  });
});

describe("Editor — glissers sur la timeline", () => {
  /** Simule un glisser horizontal de `deltaPx` à partir de `handle`.
   * (`Element` désigne un élément de projet dans ce fichier — d'où `HTMLElement` ici.) */
  function dragBy(handle: HTMLElement, deltaPx: number) {
    fireEvent.pointerDown(handle, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: deltaPx });
    fireEvent.pointerUp(window, { clientX: deltaPx });
  }

  it("redimensionne une scène au glisser", async () => {
    await renderEditor();
    const handle = document.querySelector(".timeline-scene-resize") as HTMLElement;

    // 40 px/s par défaut : +80 px = +2 s.
    dragBy(handle, 80);

    expect((await savedProject()).compositions[0].duration).toBeCloseTo(12, 5);
  });

  it("ne laisse pas une scène descendre sous la durée minimale", async () => {
    await renderEditor();
    const handle = document.querySelector(".timeline-scene-resize") as HTMLElement;

    dragBy(handle, -10_000);

    expect((await savedProject()).compositions[0].duration).toBeGreaterThan(0);
  });

  it("règle le chevauchement entre deux scènes", async () => {
    await renderEditor();

    fireEvent.change(screen.getByTitle(/Crossfade overlap/), { target: { value: "1.5" } });

    const p = await savedProject();
    expect(p.compositions[0].overlap_next).toBeCloseTo(1.5, 5);
    expect(p.compositions[1].start_time).toBeCloseTo(8.5, 5);
  });

  it("déplace un clip d'élément dans la scène", async () => {
    await renderEditor();
    const clip = document.querySelector(".timeline-clip") as HTMLElement;

    dragBy(clip, 80);

    const els = elementsOf(await savedProject());
    expect(els[0].start_time).toBeCloseTo(2, 5);
  });

  it("redimensionne un clip d'élément", async () => {
    await renderEditor();
    const handle = document.querySelector(".timeline-clip .timeline-clip-resize") as HTMLElement;

    dragBy(handle, -80);

    const els = elementsOf(await savedProject());
    expect(els[0].duration).toBeCloseTo(8, 5);
  });

  it("déplace une piste audio sur la timeline entière", async () => {
    await renderEditor(makeProject({ audio_tracks: [track()] }));
    const clips = document.querySelectorAll(".timeline-clip");
    const clip = clips[clips.length - 1] as HTMLElement;

    dragBy(clip, 120);

    expect((await savedProject()).audio_tracks[0].start_time).toBeCloseTo(3, 5);
  });

  it("redimensionne une piste audio", async () => {
    await renderEditor(makeProject({ audio_tracks: [track()] }));
    const handles = document.querySelectorAll(".timeline-clip-resize");

    dragBy(handles[handles.length - 1] as HTMLElement, 80);

    expect((await savedProject()).audio_tracks[0].duration).toBeCloseTo(10, 5);
  });

  it("déplace la tête de lecture en cliquant la règle", async () => {
    await renderEditor();
    const ruler = document.querySelector(".timeline-ruler") as HTMLElement;
    ruler.getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect;
    const lanes = document.querySelector(".timeline-lanes") as HTMLElement;
    lanes.getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect;

    fireEvent.pointerDown(ruler, { clientX: 200 });

    // 200 px à 40 px/s = 5 s.
    expect(timecode()).toBe("00:05:00 / 00:15:00");
  });
});

// ── Boîtes de dialogue ──────────────────────────────────────────────────────

describe("Editor — menus et dialogues", () => {
  const openFileMenu = () => fireEvent.click(screen.getByRole("button", { name: "File" }));

  it("ouvre un autre projet", async () => {
    const { onOpenProject } = await renderEditor();
    mockOpen.mockResolvedValue("/autre/projet");

    openFileMenu();
    fireEvent.click(screen.getByRole("button", { name: "Open project…" }));
    await act(async () => {});

    expect(onOpenProject).toHaveBeenCalledWith("/autre/projet");
  });

  it("ne fait rien si la sélection de dossier est annulée", async () => {
    const { onOpenProject } = await renderEditor();
    mockOpen.mockResolvedValue(null);

    openFileMenu();
    fireEvent.click(screen.getByRole("button", { name: "Open project…" }));
    await act(async () => {});

    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it("importe un projet JSON hérité", async () => {
    const { onOpenProject } = await renderEditor();
    mockOpen.mockResolvedValueOnce("/old/projet.json").mockResolvedValueOnce("/dest");
    mockReadText.mockResolvedValue(JSON.stringify({ name: "Ancien", width: 1280, height: 720, duration: 7 }));
    mockNewProject.mockResolvedValue("/dest/Ancien.lvproj");

    openFileMenu();
    fireEvent.click(screen.getByRole("button", { name: "Import legacy JSON…" }));
    await act(async () => {});

    expect(mockNewProject).toHaveBeenCalledWith(
      expect.objectContaining({ parent_dir: "/dest", name: "Ancien", width: 1280, height: 720, fps: 30 }),
    );
    expect(mockSave).toHaveBeenCalledWith("/dest/Ancien.lvproj", expect.objectContaining({ name: "Ancien" }));
    expect(onOpenProject).toHaveBeenCalledWith("/dest/Ancien.lvproj");
  });

  it("abandonne l'import si le JSON n'est pas choisi", async () => {
    await renderEditor();
    mockOpen.mockResolvedValue(null);

    openFileMenu();
    fireEvent.click(screen.getByRole("button", { name: "Import legacy JSON…" }));
    await act(async () => {});

    expect(mockNewProject).not.toHaveBeenCalled();
  });

  it("abandonne l'import si le dossier de destination n'est pas choisi", async () => {
    await renderEditor();
    mockOpen.mockResolvedValueOnce("/old/projet.json").mockResolvedValueOnce(null);

    openFileMenu();
    fireEvent.click(screen.getByRole("button", { name: "Import legacy JSON…" }));
    await act(async () => {});

    expect(mockReadText).not.toHaveBeenCalled();
  });

  it("remonte une erreur d'import", async () => {
    await renderEditor();
    mockOpen.mockResolvedValueOnce("/old/projet.json").mockResolvedValueOnce("/dest");
    mockReadText.mockRejectedValue(new Error("JSON illisible"));

    openFileMenu();
    fireEvent.click(screen.getByRole("button", { name: "Import legacy JSON…" }));

    expect(await screen.findByText(/JSON illisible/)).toBeInTheDocument();
  });

  it("ouvre puis referme les réglages", async () => {
    await renderEditor();

    openFileMenu();
    fireEvent.click(screen.getByRole("button", { name: "Settings…" }));
    await act(async () => {});
    expect(screen.getByText("Pexels")).toBeInTheDocument();

    fireEvent.click(document.querySelector(".modal-close")!);
    await waitFor(() => expect(screen.queryByText("Pexels")).not.toBeInTheDocument());
  });
});
