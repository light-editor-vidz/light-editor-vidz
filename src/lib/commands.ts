import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import i18n from "i18next";
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

/** Vrai (une seule fois) si le projet vient d'être rouvert depuis sa sauvegarde `project.json.bak`. */
export function takeProjectRecovery(projectDir: string): Promise<boolean> {
  return invoke("take_project_recovery", { projectDir });
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
  has_subtitles?: boolean;
}

/** Dialogue « Importer » : seul un fichier qu'il renvoie peut être importé (`importAsset`). */
export function pickAssetSource(kind: AssetKind): Promise<string | null> {
  return invoke("pick_asset_source", { kind });
}

/** Copie un fichier choisi par l'utilisateur dans `<project_dir>/assets/<kind>s/`. */
export function importAsset(projectDir: string, kind: AssetKind, sourcePath: string): Promise<string> {
  return invoke("import_asset", { projectDir, kind, sourcePath });
}

/** Autorise un média du projet à s'ouvrir dans un onglet d'édition ; renvoie son chemin absolu. */
export function approveProjectAsset(projectDir: string, relativeSrc: string): Promise<string> {
  return invoke("approve_project_asset", { projectDir, relativeSrc });
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

/** « Enregistrer sous » de l'export mp4 : seule la destination renvoyée peut être écrite. */
export async function pickVideoExportOutput(defaultName: string): Promise<string | null> {
  const choice = await invoke<{ path: string; confirm_overwrite: boolean } | null>("video_pick_output", {
    defaultName,
    format: "mp4",
  });
  if (!choice) return null;
  if (choice.confirm_overwrite) {
    // L'extension a été complétée après le dialogue natif : c'est à nous de demander.
    const name = choice.path.split(/[\\/]/).pop() ?? choice.path;
    if (!(await ask(i18n.t("audioTool.overwriteConfirm", { name }), { kind: "warning" }))) return null;
  }
  return choice.path;
}

/** Exporte le projet en mp4. Rejette avec `EXPORT_CANCELLED` si
 * l'export a été annulé. */
export function exportProject(
  projectDir: string,
  project: Project,
  outputPath: string,
  options: ExportOptions,
): Promise<ExportResult> {
  return invoke("export_project", { projectDir, project, outputPath, options });
}

/** Formats de l'export « audio seul » (valeurs attendues par la commande Rust). */
export type AudioExportFormat = "wav16" | "wav24" | "wav32f" | "mp3" | "flac" | "ogg" | "m4a";

/** Extension du fichier produit pour chaque format. */
export const AUDIO_FORMAT_EXTENSION: Record<AudioExportFormat, string> = {
  wav16: "wav",
  wav24: "wav",
  wav32f: "wav",
  mp3: "mp3",
  flac: "flac",
  ogg: "ogg",
  m4a: "m4a",
};

/** Exporte uniquement le son du projet (pistes audio + audio des vidéos) dans `format`. Rejette
 * avec `EXPORT_CANCELLED` si l'export a été annulé. */
export function exportProjectAudio(
  projectDir: string,
  project: Project,
  outputPath: string,
  format: AudioExportFormat,
): Promise<ExportResult> {
  return invoke("export_project_audio", { projectDir, project, outputPath, format });
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
