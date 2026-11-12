import "./setup";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ask } from "@tauri-apps/plugin-dialog";
import ImageTool from "../ImageTool";
import { useImageEditor } from "../hooks/useImageEditor";
import { closeTab } from "../lib/tauri";
import { inertBridge, TabActiveProvider } from "../../../lib/menuBridge";
import { runBeforeExit } from "../../../lib/lifecycle";
import { editorStub } from "./editorStub";
import { busyWork } from "../../../lib/busyWork";
import type { Editor } from "./editorStub";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(), open: vi.fn(), save: vi.fn() }));
vi.mock("../hooks/useImageEditor");
vi.mock("../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../lib/tauri")>("../lib/tauri");
  return { ...actual, closeTab: vi.fn().mockResolvedValue(undefined) };
});

const mockUse = vi.mocked(useImageEditor);
const mockAsk = vi.mocked(ask);

function setup(over: Partial<Editor> = {}, props: Partial<Parameters<typeof ImageTool>[0]> = {}, active = true) {
  const editor = editorStub(over);
  mockUse.mockReturnValue(editor);
  const handlers = {
    onOpenFile: vi.fn(),
    onOpenPath: vi.fn(),
    onClose: vi.fn(),
    registerCloseGuard: vi.fn(() => () => {}),
  };
  const tree = (isActive: boolean) => (
    <TabActiveProvider value={isActive}>
      <ImageTool path="/tmp/photo.png" {...handlers} {...props} />
    </TabActiveProvider>
  );
  const view = render(tree(active));
  return { editor, ...handlers, ...view, tree };
}

beforeEach(() => {
  // Une boîte de dialogue laissée ouverte par un test précédent couperait les raccourcis.
  document.body.innerHTML = "";
  vi.clearAllMocks();
  localStorage.clear();
  inertBridge.actions.current = {};
  mockAsk.mockResolvedValue(true);
});

describe("ImageTool — ouverture", () => {
  it("ouvre l'image de l'onglet une seule fois", async () => {
    const { editor, rerender, tree } = setup();
    await act(async () => {});

    rerender(tree(true));
    await act(async () => {});

    expect(editor.handleOpenByPaths).toHaveBeenCalledTimes(1);
    expect(editor.handleOpenByPaths).toHaveBeenCalledWith(["/tmp/photo.png"]);
  });

  it("n'ouvre rien dans une vue vide, et montre la zone de dépôt", async () => {
    const { editor } = setup({ image: null, tabs: [], activeTabId: null }, { path: null });
    await act(async () => {});

    expect(editor.handleOpenByPaths).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: /image/i })).toBeInTheDocument();
  });

  it("« Ouvrir une image » passe par le choix de fichier de la fenêtre", async () => {
    const { onOpenFile } = setup();
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /open/i }));

    expect(onOpenFile).toHaveBeenCalled();
  });

  it("affiche le nom et les dimensions de l’image", async () => {
    setup();
    await act(async () => {});

    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(screen.getAllByText(/800 × 600/).length).toBeGreaterThan(0);
  });
});

describe("ImageTool — fermeture", () => {
  it("libère les images côté moteur quand l’onglet se ferme", async () => {
    const { unmount } = setup();
    await act(async () => {});

    unmount();

    expect(closeTab).toHaveBeenCalledWith("t1");
  });

  it("enregistre une garde : rien à perdre → on ferme sans demander", async () => {
    const { registerCloseGuard } = setup();
    await act(async () => {});

    const guard = (registerCloseGuard.mock.calls[0] as unknown as [() => Promise<boolean>])[0];

    expect(await guard()).toBe(true);
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it("une image modifiée demande confirmation, et on la garde si on renonce", async () => {
    const dirty = editorStub().tabs.map((t) => ({ ...t, historyIndex: 2, savedIndex: 0 }));
    const { registerCloseGuard } = setup({ tabs: dirty });
    await act(async () => {});
    const guard = (registerCloseGuard.mock.calls[0] as unknown as [() => Promise<boolean>])[0];

    mockAsk.mockResolvedValueOnce(false);
    expect(await guard()).toBe(false);
    mockAsk.mockResolvedValueOnce(true);
    expect(await guard()).toBe(true);
    expect(mockAsk).toHaveBeenCalledTimes(2);
  });

  it("la fermeture de la fenêtre demande aussi, et reste ouverte si on renonce", async () => {
    const dirty = editorStub().tabs.map((t) => ({ ...t, historyIndex: 1, savedIndex: 0 }));
    setup({ tabs: dirty });
    await act(async () => {});

    mockAsk.mockResolvedValueOnce(false);
    expect(await runBeforeExit()).toBe(false);
  });

  it("Fermer l’onglet du menu ferme quand il n’y a rien à perdre", async () => {
    const { onClose } = setup();
    await act(async () => {});

    await act(async () => inertBridge.actions.current.closeProject?.());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("Fermer l’onglet du menu ne ferme pas si on renonce", async () => {
    const dirty = editorStub().tabs.map((t) => ({ ...t, historyIndex: 1, savedIndex: 0 }));
    const { onClose } = setup({ tabs: dirty });
    await act(async () => {});
    mockAsk.mockResolvedValueOnce(false);

    await act(async () => inertBridge.actions.current.closeProject?.());

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ImageTool — historique et préférences", () => {
  it("Édition > Historique et le bouton de la barre affichent le panneau, qui ramène à une étape", async () => {
    const { editor } = setup({
      history: [{ key: "hist.open" }, { key: "hist.flip-h" }],
      historyIndex: 1,
      canUndo: true,
    } as Partial<Editor>);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /Flip horizontal/ })).not.toBeInTheDocument();

    act(() => inertBridge.actions.current.toggleHistory?.());
    fireEvent.click(screen.getByRole("button", { name: /^Open$/ }));
    expect(editor.handleGotoHistory).toHaveBeenCalledWith(0);

    act(() => inertBridge.actions.current.toggleHistory?.());
    expect(screen.queryByRole("button", { name: /Flip horizontal/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByRole("button", { name: /Flip horizontal/ })).toBeInTheDocument();
  });

  it("Réglages… ouvre les préférences : format et qualité d'export par défaut, gardés", async () => {
    setup();
    await act(async () => {});
    act(() => inertBridge.actions.current.openSettings?.());
    expect(screen.getByText("Image preferences", { selector: "h2" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("JPEG", { selector: "input[name=pref-format]" }));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const saved = JSON.parse(localStorage.getItem("lciz-prefs") ?? "{}");
    expect(saved).toMatchObject({ defaultExportFormat: "jpeg", defaultJpegQuality: 70 });
    expect(screen.queryByText("Image preferences", { selector: "h2" })).not.toBeInTheDocument();

    // L'export part de ces préférences.
    act(() => inertBridge.actions.current.openExport?.());
    expect(screen.getByRole("radio", { name: "JPEG" })).toBeChecked();
    expect(screen.getByText("Quality: 70%")).toBeInTheDocument();
  });

  it("déclare l'export d'image en cours, pour que quitter demande confirmation", async () => {
    let finish: (v: string | null) => void = () => {};
    const { editor } = setup();
    vi.mocked(editor.handleExport).mockReturnValue(new Promise((r) => (finish = r)));
    await act(async () => {});
    act(() => inertBridge.actions.current.openExport?.());
    await act(async () => {
      fireEvent.click(screen.getByTestId("export-button"));
    });
    expect(await busyWork()).toContain("quit.imageExport");
    await act(async () => finish("/out.png"));
    expect(await busyWork()).not.toContain("quit.imageExport");
  });

  it("les préférences peuvent vider les images récentes, et Annuler ne change rien", async () => {
    localStorage.setItem("lciz-recent", JSON.stringify(["/a.png"]));
    setup();
    await act(async () => {});
    act(() => inertBridge.actions.current.openSettings?.());
    fireEvent.click(screen.getByLabelText("JPEG", { selector: "input[name=pref-format]" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(localStorage.getItem("lciz-prefs")).toBeNull();

    act(() => inertBridge.actions.current.openSettings?.());
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(JSON.parse(localStorage.getItem("lciz-recent") ?? "[]")).toEqual([]);
  });
});

describe("ImageTool — menu et clavier", () => {
  it("Ctrl+Z annule et Ctrl+Maj+Z rétablit", async () => {
    const { editor } = setup();
    await act(async () => {});

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true });

    expect(editor.handleUndo).toHaveBeenCalledTimes(1);
    expect(editor.handleRedo).toHaveBeenCalledTimes(1);
  });

  it("un onglet masqué ne réagit ni au clavier ni au menu", async () => {
    const { editor } = setup({}, {}, false);
    await act(async () => {});

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });

    expect(editor.handleUndo).not.toHaveBeenCalled();
    expect(inertBridge.actions.current.undo).toBeUndefined();
  });

  // En dernier : ce test laisse la fenêtre d'export ouverte.
  it("Annuler / Rétablir / Exporter du menu agissent sur l’image", async () => {
    const { editor } = setup();
    await act(async () => {});

    act(() => inertBridge.actions.current.undo?.());
    act(() => inertBridge.actions.current.redo?.());
    act(() => inertBridge.actions.current.openExport?.());

    expect(editor.handleUndo).toHaveBeenCalled();
    expect(editor.handleRedo).toHaveBeenCalled();
    expect(screen.getAllByText("Export").length).toBeGreaterThan(1);
  });
});
