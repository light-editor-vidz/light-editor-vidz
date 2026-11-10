// « Fichier > Ouvrir un fichier… » : ce qu'un fichier ouvre selon son type.

import { invoke } from "@tauri-apps/api/core";

export type MediaKind = "audio" | "video" | "image" | "unknown";

export interface PickedFile {
  path: string;
  kind: MediaKind;
}

/** Le dialogue natif « tous les médias » ; un fichier audio est autorisé en lecture au passage. */
export function pickMediaFile(): Promise<PickedFile | null> {
  return invoke("pick_media_file");
}

/** Les fichiers nommés au lancement de l'application, une seule fois. */
export function takePendingFiles(): Promise<string[]> {
  return invoke("take_pending_files");
}

/** Le type d'un fichier déposé sur la fenêtre (déjà autorisé par l'événement de dépôt). */
export function mediaKind(path: string): Promise<MediaKind> {
  return invoke("media_kind", { path });
}
