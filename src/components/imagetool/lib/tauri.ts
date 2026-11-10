import { invoke } from "@tauri-apps/api/core";
import type { Command, CropRect, ExportFormat, ImageMeta, MaskBox } from "../types";

/** Métadonnées telles que sérialisées par le backend (snake_case). */
interface RawMeta {
  width: number;
  height: number;
  format: string;
  preview: string;
  thumbnail?: string;
  can_undo?: boolean;
  can_redo?: boolean;
  history_len?: number;
  history_index?: number;
  tools?: string[];
  filename?: string;
  path?: string;
}

function mapMeta(raw: RawMeta): ImageMeta {
  return {
    width: raw.width,
    height: raw.height,
    format: raw.format,
    preview: raw.preview,
    thumbnail: raw.thumbnail ?? raw.preview,
    canUndo: raw.can_undo ?? false,
    canRedo: raw.can_redo ?? false,
    historyLen: raw.history_len ?? 1,
    historyIndex: raw.history_index ?? 0,
    tools: raw.tools ?? [],
    filename: raw.filename,
    path: raw.path,
  };
}

export interface OpenedImage {
  tabId: string;
  meta: ImageMeta;
}

export interface FailedOpen {
  path: string;
  error: string;
}

export interface OpenResult {
  opened: OpenedImage[];
  failed: FailedOpen[];
}

interface RawOpenResult {
  opened: Array<{ tab_id: string; meta: RawMeta }>;
  failed: FailedOpen[];
}

function mapOpenResult(raw: RawOpenResult): OpenResult {
  return {
    opened: raw.opened.map((r) => ({ tabId: r.tab_id, meta: mapMeta(r.meta) })),
    failed: raw.failed,
  };
}

export async function openImages(): Promise<OpenResult> {
  return mapOpenResult(await invoke<RawOpenResult>("open_images"));
}

export async function openImagesByPaths(paths: string[]): Promise<OpenResult> {
  return mapOpenResult(await invoke<RawOpenResult>("open_images_by_paths", { paths }));
}

export async function cropImage(tabId: string, rect: CropRect): Promise<ImageMeta> {
  const raw = await invoke<RawMeta>("crop_image", {
    tabId,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
  return mapMeta(raw);
}

export async function resizeImage(tabId: string, width: number, height: number): Promise<ImageMeta> {
  const raw = await invoke<RawMeta>("resize_image", { tabId, width, height });
  return mapMeta(raw);
}

export type Anchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export async function canvasResizeImage(
  tabId: string,
  width: number,
  height: number,
  anchor: Anchor,
  fill: [number, number, number, number],
): Promise<ImageMeta> {
  const raw = await invoke<RawMeta>("canvas_resize_image", {
    tabId,
    width,
    height,
    anchor,
    fill,
  });
  return mapMeta(raw);
}

export async function flipImage(tabId: string, direction: "horizontal" | "vertical"): Promise<ImageMeta> {
  const raw = await invoke<RawMeta>("flip_image", { tabId, direction });
  return mapMeta(raw);
}

export async function rotateImage(tabId: string, degrees: number): Promise<ImageMeta> {
  const raw = await invoke<RawMeta>("rotate_image", { tabId, degrees });
  return mapMeta(raw);
}

/** `true` si un fichier a été écrit, `false` si l'utilisateur a annulé la boîte d'enregistrement. */
export async function exportImage(tabId: string, format: ExportFormat, quality?: number): Promise<string | null> {
  return invoke<string | null>("export_image", { tabId, format, quality: quality ?? null });
}

export async function undoImage(tabId: string): Promise<ImageMeta> {
  const raw = await invoke<RawMeta>("undo_image", { tabId });
  return mapMeta(raw);
}

export async function redoImage(tabId: string): Promise<ImageMeta> {
  const raw = await invoke<RawMeta>("redo_image", { tabId });
  return mapMeta(raw);
}

export async function gotoHistory(tabId: string, index: number): Promise<ImageMeta> {
  return mapMeta(await invoke<RawMeta>("goto_history", { tabId, index }));
}

export async function resetToOriginal(tabId: string): Promise<ImageMeta> {
  const raw = await invoke<RawMeta>("reset_to_original", { tabId });
  return mapMeta(raw);
}

/** Les outils de géométrie qui ont leur propre réinitialisation. */
export type ResetTool = "crop" | "rotate" | "flip" | "resize" | "canvas";

/**
 * Retire les opérations d'un seul outil et rejoue les autres depuis l'original. `dropped`
 * compte les étapes suivantes qui n'ont pas pu être rejouées.
 */
export async function resetTool(tabId: string, tool: ResetTool): Promise<{ meta: ImageMeta; dropped: number }> {
  const raw = await invoke<{ meta: RawMeta; dropped: number }>("reset_tool", { tabId, tool });
  return { meta: mapMeta(raw.meta), dropped: raw.dropped };
}

export async function setMenuLanguage(lang: string): Promise<void> {
  return invoke<void>("set_menu_language", { lang });
}

/** Applique le thème à la fenêtre et le coche dans le menu. */
export async function setMenuTheme(theme: string): Promise<void> {
  return invoke<void>("set_theme", { theme });
}

/** Dit au menu si Annuler et Rétablir ont quelque chose à faire. */
export async function setMenuUndoRedo(canUndo: boolean, canRedo: boolean): Promise<void> {
  return invoke<void>("set_undo_redo", { canUndo, canRedo });
}

/** Dit au menu si une image est ouverte (l'historique n'a de sens que sur une image). */
export async function setMenuHasImage(hasImage: boolean): Promise<void> {
  return invoke<void>("set_has_image", { hasImage });
}

/** Dit au menu quelle taille de grille est choisie. */
export async function setMenuGridSize(size: number): Promise<void> {
  return invoke<void>("set_grid_size", { size });
}

/** Donne au menu la liste des fichiers récents. */
export async function setMenuRecentFiles(files: string[]): Promise<void> {
  return invoke<void>("set_recent_files", { files });
}

export async function closeTab(tabId: string): Promise<void> {
  return invoke<void>("close_tab", { tabId });
}

export async function closeAllTabs(): Promise<void> {
  return invoke<void>("close_all_tabs");
}

export async function closeOtherTabs(tabId: string): Promise<void> {
  return invoke<void>("close_other_tabs", { tabId });
}

export interface ExifField {
  tag: string;
  value: string;
}

export async function getExif(tabId: string): Promise<ExifField[]> {
  return invoke<ExifField[]>("get_exif", { tabId });
}

export async function stripExif(tabId: string): Promise<boolean> {
  return invoke<boolean>("strip_exif", { tabId });
}

export async function inpaintImage(tabId: string, mask: MaskBox): Promise<ImageMeta> {
  return mapMeta(
    await invoke<RawMeta>("inpaint_image", {
      tabId,
      maskB64: mask.b64,
      maskX: mask.x,
      maskY: mask.y,
      maskWidth: mask.width,
      maskHeight: mask.height,
    }),
  );
}

/** Applique un ajustement ou un filtre. `replace` remplace la dernière étape au lieu
 * d'en ajouter une (réglage en cours, repris depuis l'image de départ). */
export async function applyCommand(tabId: string, command: Command, replace = false): Promise<ImageMeta> {
  return mapMeta(await invoke<RawMeta>("apply_command", { tabId, command, replace }));
}

/** Aperçu (data URL) d'un réglage sur une version réduite, sans toucher à l'historique. */
export async function previewCommand(tabId: string, command: Command, maxSide: number): Promise<string> {
  return invoke<string>("preview_command", { tabId, command, maxSide });
}
