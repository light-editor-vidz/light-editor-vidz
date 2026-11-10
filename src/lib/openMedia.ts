// « Fichier > Ouvrir un fichier… » : ce qu'un fichier ouvre selon son type.

import { invoke } from "@tauri-apps/api/core";
import { importAsset, newProject } from "./commands";
import { baseName } from "./audiotool/helpers";

export type MediaKind = "audio" | "video" | "image" | "unknown";

export interface PickedFile {
  path: string;
  kind: MediaKind;
}

/** Le dialogue natif « tous les médias » ; un fichier audio est autorisé en lecture au passage. */
export function pickMediaFile(): Promise<PickedFile | null> {
  return invoke("pick_media_file");
}

/** Le type d'un fichier déposé sur la fenêtre (déjà autorisé par l'événement de dépôt). */
export function mediaKind(path: string): Promise<MediaKind> {
  return invoke("media_kind", { path });
}

const dirName = (path: string) => path.slice(0, path.length - baseName(path).length).replace(/[\\/]$/, "") || "/";
const stem = (path: string) => baseName(path).replace(/\.[^./\\]+$/, "");

export interface CreatedProject {
  dir: string;
  media: { kind: "video" | "image"; src: string; name: string };
}

/** Crée un projet (1920×1080, 30 i/s) à côté du fichier et y importe la vidéo : le projet porte le
 * nom du fichier, et la vidéo est posée dans sa première scène à l'ouverture. */
export async function createProjectFromMedia(path: string, kind: "video" | "image"): Promise<CreatedProject> {
  const dir = await newProject({
    parent_dir: dirName(path),
    name: stem(path),
    width: 1920,
    height: 1080,
    fps: 30,
  });
  const src = await importAsset(dir, kind, path);
  return { dir, media: { kind, src, name: baseName(path) } };
}
