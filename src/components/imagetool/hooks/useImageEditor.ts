import { useCallback, useRef, useState } from "react";
import {
  applyCommand,
  canvasResizeImage,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  cropImage,
  exportImage,
  flipImage,
  getExif,
  gotoHistory,
  inpaintImage,
  openImages,
  openImagesByPaths,
  redoImage,
  resetToOriginal,
  resetTool,
  resizeImage,
  rotateImage,
  stripExif,
  undoImage,
} from "../lib/tauri";
import type { Anchor, ExifField, FailedOpen, OpenResult, ResetTool } from "../lib/tauri";
import type { Command, CropRect, EditorMode, ExportFormat, HistoryEntry, ImageMeta, MaskBox, Tab } from "../types";

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8.0;

function clampZoom(z: number) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Applique à un onglet le résultat d'une retouche. Le backend est la source de vérité
 * pour la position dans l'historique (`meta.historyLen`) : s'il a abandonné ses plus
 * anciennes étapes pour tenir son budget mémoire, les mêmes libellés sont retirés ici
 * (l'étape d'origine est toujours conservée).
 */
function commitEdit(tab: Tab, meta: ImageMeta, entry: HistoryEntry, replace = false): Tab {
  const replacing = replace && tab.historyIndex > 0;
  const kept = tab.history.slice(0, replacing ? tab.historyIndex : tab.historyIndex + 1);
  const dropped = Math.max(0, kept.length + 1 - meta.historyLen);
  const trimmed = dropped > 0 ? [kept[0], ...kept.slice(1 + dropped)] : kept;
  const history = [...trimmed, entry];
  return { ...tab, image: meta, history, historyIndex: history.length - 1 };
}

interface ImageEditorState {
  tabs: Tab[];
  activeTabId: string | null;
  image: ImageMeta | null;
  mode: EditorMode;
  zoom: number;
  history: HistoryEntry[];
  historyIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  isLoading: boolean;
  error: string | null;
  openFailures: FailedOpen[];
}

interface ImageEditorActions {
  loadExif: (tabId: string) => Promise<ExifField[]>;
  handleStripExif: (tabId: string) => Promise<void>;
  handleOpen: () => Promise<void>;
  handleOpenByPaths: (paths: string[]) => Promise<void>;
  handleCopyToClipboard: () => Promise<void>;
  enterEyedropperMode: () => void;
  exitEyedropperMode: () => void;
  handleCropApply: (rect: CropRect) => Promise<void>;
  handleFlip: (direction: "horizontal" | "vertical") => Promise<void>;
  handleResize: (width: number, height: number) => Promise<void>;
  handleCanvasResize: (
    width: number,
    height: number,
    anchor: Anchor,
    fill: [number, number, number, number],
  ) => Promise<void>;
  handleRotate: (degrees: number) => Promise<void>;
  handleExport: (format: ExportFormat, quality?: number) => Promise<void>;
  handleUndo: () => Promise<void>;
  handleRedo: () => Promise<void>;
  handleResetToOriginal: () => Promise<void>;
  /** Annule un seul outil en rejouant les autres ; renvoie le nombre d'étapes abandonnées. */
  handleResetTool: (tool: ResetTool) => Promise<number>;
  handleGotoHistory: (index: number) => Promise<void>;
  handleCloseTab: (id: string) => Promise<void>;
  handleCloseOtherTabs: () => Promise<void>;
  handleCloseAllTabs: () => Promise<void>;
  setActiveTab: (id: string) => void;
  enterCropMode: () => void;
  exitCropMode: () => void;
  enterRotateMode: () => void;
  exitRotateMode: () => void;
  setZoom: (z: number | ((prev: number) => number)) => void;
  clearError: () => void;
  clearOpenFailures: () => void;
  /**
   * Applique un ajustement ou un filtre. Avec `replace`, la dernière étape est remplacée
   * (réglage en cours repris depuis l'image de départ). Renvoie la nouvelle position dans
   * l'historique, ou `undefined` en cas d'échec.
   */
  handleCommand: (cmd: Command, opts?: { replace?: boolean }) => Promise<number | undefined>;
  enterInpaintingMode: () => void;
  exitInpaintingMode: () => void;
  handleInpaint: (mask: MaskBox) => Promise<void>;
}

export function useImageEditor(): ImageEditorState & ImageEditorActions {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("idle");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFailures, setOpenFailures] = useState<FailedOpen[]>([]);

  // Les gestionnaires lisent l'état courant par ces références : ils restent stables d'un
  // rendu à l'autre au lieu d'être recréés (et de désinscrire les écouteurs) à chaque action.
  // La référence est la source de vérité, mise à jour **tout de suite** : deux actions
  // enchaînées avant le prochain rendu (touches répétées) voient chacune l'état de la précédente.
  const tabsRef = useRef<Tab[]>([]);
  const activeRef = useRef<string | null>(null);

  const commitTabs = useCallback((fn: (prev: Tab[]) => Tab[]) => {
    tabsRef.current = fn(tabsRef.current);
    setTabs(tabsRef.current);
  }, []);

  const commitActive = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveTabId(id);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const image = activeTab?.image ?? null;
  const zoom = activeTab?.zoom ?? 1;
  const history = activeTab?.history ?? [];
  const historyIndex = activeTab?.historyIndex ?? -1;
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const updateTab = useCallback(
    (id: string, updater: (tab: Tab) => Tab) => commitTabs((prev) => prev.map((t) => (t.id === id ? updater(t) : t))),
    [commitTabs],
  );

  const withLoading = useCallback(async (fn: () => Promise<void>) => {
    setIsLoading(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createTabsFromOpened = useCallback(
    ({ opened, failed }: OpenResult) => {
      setOpenFailures(failed);
      if (opened.length === 0) return;
      const newTabs: Tab[] = opened.map(({ tabId, meta }) => ({
        id: tabId,
        label: meta.filename ?? "Image",
        image: meta,
        history: [{ key: "hist.open" }],
        historyIndex: 0,
        savedIndex: 0,
        zoom: 1,
      }));
      commitTabs((prev) => [...prev, ...newTabs]);
      commitActive(newTabs[newTabs.length - 1].id);
      setMode("idle");
    },
    [commitTabs, commitActive],
  );

  const handleOpen = useCallback(async () => {
    await withLoading(async () => {
      createTabsFromOpened(await openImages());
    });
  }, [withLoading, createTabsFromOpened]);

  const handleOpenByPaths = useCallback(
    async (paths: string[]) => {
      await withLoading(async () => {
        createTabsFromOpened(await openImagesByPaths(paths));
      });
    },
    [withLoading, createTabsFromOpened],
  );

  const handleCopyToClipboard = useCallback(async () => {
    const tab = tabsRef.current.find((t) => t.id === activeRef.current);
    if (!tab?.image?.preview) return;
    await withLoading(async () => {
      const response = await fetch(tab.image.preview);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    });
  }, [withLoading]);

  /** Exécute une retouche géométrique sur l'onglet actif et l'inscrit à l'historique. */
  const runEdit = useCallback(
    async (fn: (id: string) => Promise<ImageMeta>, entry: HistoryEntry, after?: () => void): Promise<void> => {
      const id = activeRef.current;
      if (!id) return;
      await withLoading(async () => {
        const result = await fn(id);
        updateTab(id, (tab) => commitEdit(tab, result, entry));
        after?.();
      });
    },
    [withLoading, updateTab],
  );

  const handleCropApply = useCallback(
    (rect: CropRect) =>
      runEdit(
        (id) => cropImage(id, rect),
        { key: "hist.crop", params: { w: String(rect.width), h: String(rect.height) } },
        () => setMode("idle"),
      ),
    [runEdit],
  );

  const handleFlip = useCallback(
    (direction: "horizontal" | "vertical") =>
      runEdit((id) => flipImage(id, direction), {
        key: direction === "horizontal" ? "hist.flip-h" : "hist.flip-v",
      }),
    [runEdit],
  );

  const handleResize = useCallback(
    (width: number, height: number) =>
      runEdit((id) => resizeImage(id, width, height), {
        key: "hist.resize",
        params: { w: String(width), h: String(height) },
      }),
    [runEdit],
  );

  const handleCanvasResize = useCallback(
    (width: number, height: number, anchor: Anchor, fill: [number, number, number, number]) =>
      runEdit((id) => canvasResizeImage(id, width, height, anchor, fill), {
        key: "hist.canvas",
        params: { w: String(width), h: String(height) },
      }),
    [runEdit],
  );

  const handleRotate = useCallback(
    (degrees: number) => {
      const deg = degrees < 0 ? `−${Math.abs(degrees)}` : degrees === 90 ? "+90" : String(degrees);
      return runEdit((id) => rotateImage(id, degrees), { key: "hist.rotate", params: { deg } });
    },
    [runEdit],
  );

  const handleExport = useCallback(
    async (format: ExportFormat, quality?: number) => {
      const id = activeRef.current;
      if (!id) return;
      await withLoading(async () => {
        if (await exportImage(id, format, quality)) {
          updateTab(id, (tab) => ({ ...tab, savedIndex: tab.historyIndex }));
        }
      });
    },
    [withLoading, updateTab],
  );

  /** Déplace le curseur d'historique d'un onglet sur la position renvoyée par le backend. */
  const navigate = useCallback(
    async (fn: (id: string) => Promise<ImageMeta>, allowed: (tab: Tab) => boolean) => {
      const id = activeRef.current;
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!id || !tab || !allowed(tab)) return;
      await withLoading(async () => {
        const result = await fn(id);
        updateTab(id, (t) => ({ ...t, image: result, historyIndex: result.historyIndex }));
        setMode("idle");
      });
    },
    [withLoading, updateTab],
  );

  const handleUndo = useCallback(() => navigate(undoImage, (t) => t.historyIndex > 0), [navigate]);
  const handleRedo = useCallback(() => navigate(redoImage, (t) => t.historyIndex < t.history.length - 1), [navigate]);
  const handleGotoHistory = useCallback(
    (index: number) =>
      navigate(
        (id) => gotoHistory(id, index),
        (t) => index !== t.historyIndex && index >= 0 && index < t.history.length,
      ),
    [navigate],
  );
  const handleResetToOriginal = useCallback(() => navigate(resetToOriginal, (t) => t.historyIndex > 0), [navigate]);

  const handleResetTool = useCallback(
    async (tool: ResetTool) => {
      const id = activeRef.current;
      if (!id) return 0;
      let dropped = 0;
      await withLoading(async () => {
        const result = await resetTool(id, tool);
        dropped = result.dropped;
        updateTab(id, (tab) =>
          result.meta.historyIndex === tab.historyIndex && result.meta.historyLen === tab.history.length
            ? { ...tab, image: result.meta }
            : commitEdit(tab, result.meta, { key: `hist.reset.${tool}` }),
        );
      });
      return dropped;
    },
    [withLoading, updateTab],
  );

  const handleCloseTab = useCallback(
    async (id: string) => {
      try {
        await closeTab(id);
      } catch (err) {
        setError(errorText(err));
        return;
      }
      const prev = tabsRef.current;
      const idx = prev.findIndex((t) => t.id === id);
      const remaining = prev.filter((t) => t.id !== id);
      commitTabs((p) => p.filter((t) => t.id !== id));
      if (activeRef.current === id) {
        commitActive(remaining[Math.max(0, idx - 1)]?.id ?? remaining[0]?.id ?? null);
        setMode("idle");
      }
    },
    [commitTabs, commitActive],
  );

  const handleCloseOtherTabs = useCallback(async () => {
    const keep = activeRef.current;
    if (!keep) return;
    try {
      await closeOtherTabs(keep);
    } catch (err) {
      setError(errorText(err));
      return;
    }
    commitTabs((prev) => prev.filter((t) => t.id === keep));
  }, [commitTabs]);

  const handleCloseAllTabs = useCallback(async () => {
    try {
      await closeAllTabs();
    } catch (err) {
      setError(errorText(err));
      return;
    }
    commitTabs(() => []);
    commitActive(null);
    setMode("idle");
  }, [commitTabs, commitActive]);

  const setActiveTab = useCallback(
    (id: string) => {
      commitActive(id);
      setMode("idle");
    },
    [commitActive],
  );

  const setZoom = useCallback(
    (z: number | ((prev: number) => number)) => {
      const id = activeRef.current;
      if (!id) return;
      updateTab(id, (tab) => {
        const next = typeof z === "function" ? z(tab.zoom) : z;
        return { ...tab, zoom: clampZoom(next) };
      });
    },
    [updateTab],
  );

  const loadExif = useCallback(async (tabId: string): Promise<ExifField[]> => {
    try {
      return await getExif(tabId);
    } catch {
      return [];
    }
  }, []);

  const handleStripExif = useCallback(
    async (tabId: string) => {
      await withLoading(async () => {
        if (await stripExif(tabId)) {
          updateTab(tabId, (tab) => ({ ...tab, savedIndex: tab.historyIndex }));
        }
      });
    },
    [withLoading, updateTab],
  );

  const handleCommand = useCallback(
    async (cmd: Command, opts?: { replace?: boolean }) => {
      const id = activeRef.current;
      if (!id) return undefined;
      const replace = !!opts?.replace;
      let position: number | undefined;
      await withLoading(async () => {
        const result = await applyCommand(id, cmd, replace);
        updateTab(id, (tab) => commitEdit(tab, result, { key: `hist.cmd.${cmd.type}` }, replace));
        position = result.historyIndex;
      });
      return position;
    },
    [withLoading, updateTab],
  );

  const handleInpaint = useCallback(
    (mask: MaskBox) => runEdit((id) => inpaintImage(id, mask), { key: "hist.inpaint" }),
    [runEdit],
  );

  const enterCropMode = useCallback(() => setMode("cropping"), []);
  const exitCropMode = useCallback(() => setMode("idle"), []);
  const enterRotateMode = useCallback(() => setMode("rotating"), []);
  const exitRotateMode = useCallback(() => setMode("idle"), []);
  const enterEyedropperMode = useCallback(() => setMode("eyedropper"), []);
  const exitEyedropperMode = useCallback(() => setMode("idle"), []);
  const enterInpaintingMode = useCallback(() => setMode("inpainting"), []);
  const exitInpaintingMode = useCallback(() => setMode("idle"), []);
  const clearError = useCallback(() => setError(null), []);
  const clearOpenFailures = useCallback(() => setOpenFailures([]), []);

  return {
    loadExif,
    handleStripExif,
    handleOpenByPaths,
    handleCopyToClipboard,
    enterEyedropperMode,
    exitEyedropperMode,
    tabs,
    activeTabId,
    image,
    mode,
    zoom,
    history,
    historyIndex,
    canUndo,
    canRedo,
    isLoading,
    error,
    openFailures,
    handleOpen,
    handleCropApply,
    handleFlip,
    handleResize,
    handleCanvasResize,
    handleRotate,
    handleExport,
    handleUndo,
    handleRedo,
    handleResetToOriginal,
    handleResetTool,
    handleGotoHistory,
    handleCloseTab,
    handleCloseOtherTabs,
    handleCloseAllTabs,
    setActiveTab,
    enterCropMode,
    exitCropMode,
    enterRotateMode,
    exitRotateMode,
    enterInpaintingMode,
    exitInpaintingMode,
    handleInpaint,
    setZoom,
    clearError,
    clearOpenFailures,
    handleCommand,
  };
}
