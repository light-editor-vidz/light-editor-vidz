import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../bindings/Project";

export interface NewProjectArgs {
  parent_dir: string;
  name: string;
  width: number;
  height: number;
  fps: number;
}

export interface RecentProject {
  path: string;
  name: string;
  width: number;
  height: number;
  duration: number;
}

/** Crée un nouveau dossier de projet `.lvproj/`, retourne son chemin. */
export function newProject(args: NewProjectArgs): Promise<string> {
  return invoke("new_project", { args });
}

export function loadProject(projectDir: string): Promise<Project> {
  return invoke("load_project", { projectDir });
}

export function saveProject(projectDir: string, project: Project): Promise<void> {
  return invoke("save_project", { projectDir, project });
}

export function listRecentProjects(): Promise<RecentProject[]> {
  return invoke("list_recent_projects");
}

/** Retire un projet de la liste des récents (le dossier du projet n'est pas touché). */
export function removeRecentProject(path: string): Promise<void> {
  return invoke("remove_recent_project", { path });
}

export type AssetKind = "image" | "video" | "audio";

export interface AssetInfo {
  filename: string;
  relative_path: string;
}

/** Copie un fichier choisi par l'utilisateur dans `<project_dir>/assets/<kind>s/`. */
export function importAsset(projectDir: string, kind: AssetKind, sourcePath: string): Promise<string> {
  return invoke("import_asset", { projectDir, kind, sourcePath });
}

export function listAssets(projectDir: string, kind: AssetKind): Promise<AssetInfo[]> {
  return invoke("list_assets", { projectDir, kind });
}

/** Supprime un média importé (`assets/<type>/<fichier>`). */
export function deleteAsset(projectDir: string, kind: AssetKind, filename: string): Promise<void> {
  return invoke("delete_asset", { projectDir, kind, filename });
}

export interface ExportOptions {
  width: number | null;
  height: number | null;
  fps: number | null;
  crf: number | null;
}

/** Résultat d'un export réussi. */
export interface ExportResult {
  /** Médias (images, vidéos, sons) introuvables ou illisibles : absents du fichier produit. */
  missing_media: string[];
}

/** Message d'erreur renvoyé par `export_project` quand l'utilisateur a annulé l'export. */
export const EXPORT_CANCELLED = "export-cancelled";

/** Exporte le projet en mp4 (ffmpeg doit être installé). Rejette avec `EXPORT_CANCELLED` si
 * l'export a été annulé. */
export function exportProject(
  projectDir: string,
  project: Project,
  outputPath: string,
  options: ExportOptions,
): Promise<ExportResult> {
  return invoke("export_project", { projectDir, project, outputPath, options });
}

/** Demande l'arrêt de l'export en cours. */
export function cancelExport(): Promise<void> {
  return invoke("cancel_export");
}

export interface PickedTextFile {
  name: string;
  content: string;
}

/** Ouvre le sélecteur de fichiers et lit le fichier texte choisi (`null` si fermé). */
export function pickTextFile(title: string, filterName: string, extensions: string[]): Promise<PickedTextFile | null> {
  return invoke("pick_text_file", { title, filterName, extensions });
}

/** Lit un média en octets bruts (contournement `asset://` pour la vidéo, voir CanvasStage). */
export function readMediaFile(projectDir: string, relativeSrc: string): Promise<ArrayBuffer> {
  return invoke("read_media_file", { projectDir, relativeSrc });
}

/** Résultat normalisé d'une recherche d'assets libres de droit (voir `stock.rs` côté Rust). */
export interface StockResult {
  provider: string;
  kind: string;
  thumbnail_url: string | null;
  download_url: string;
  page_url: string | null;
  author: string | null;
  license: string | null;
  duration: number | null;
  filename: string;
}

export interface StockSearchResponse {
  results: StockResult[];
  /** Erreurs par moteur (clé invalide, réseau…), non bloquantes. */
  errors: string[];
  /** Moteurs interrogés — vide = aucun moteur configuré pour ce type de média. */
  providers: string[];
}

/** Recherche en parallèle sur tous les moteurs d'assets libres configurés. */
export function searchStockAssets(kind: AssetKind, query: string, page = 1): Promise<StockSearchResponse> {
  return invoke("search_stock_assets", { kind, query, page });
}

/** Télécharge un asset choisi dans `assets/` du projet, retourne son chemin relatif. */
export function importStockAsset(projectDir: string, kind: AssetKind, url: string, filename: string): Promise<string> {
  return invoke("import_stock_asset", { projectDir, kind, url, filename });
}

/** The app's changelog at a release tag, in `lang` (the update banner shows what is new). */
export const releaseNotes = (lang: string, version: string): Promise<string> =>
  invoke<string>("release_notes", { lang, version });
