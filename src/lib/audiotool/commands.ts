// Les commandes Tauri de la vue Audio (`commands/audio_tool.rs`).

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { ProcessOptions } from "./helpers";

/** Ce que renvoie `audio_load` : le fichier décodé côté Rust, avec sa forme d'onde. */
export interface AudioInfo {
  duration: number;
  channels: number;
  sample_rate: number;
  waveform: number[];
}

export interface RecentAudio {
  path: string;
  name: string;
  dir: string;
}

/** Le sélecteur natif de fichier audio : seul un fichier qu'il renvoie peut être ouvert. */
export const audioPickFile = (): Promise<string | null> => invoke("audio_pick_file");

/** « Enregistrer sous » : l'extension du format est ajoutée si l'utilisateur l'a omise. */
export const audioPickOutput = (defaultPath: string, ext: string): Promise<string | null> =>
  invoke("audio_pick_output", { defaultPath, ext });

export const audioAllowAsset = (path: string): Promise<void> => invoke("audio_allow_asset", { path });

export const audioLoad = (path: string, points: number): Promise<AudioInfo> => invoke("audio_load", { path, points });

export const audioProcess = (opts: ProcessOptions): Promise<void> => invoke("audio_process", { opts });

export const audioCancel = (): Promise<void> => invoke("audio_cancel");

export const audioRecentList = (): Promise<RecentAudio[]> => invoke("audio_recent_list");

/** Retire une entrée des fichiers récents, ou toutes si `path` est `null`. */
export const audioRecentForget = (path: string | null): Promise<void> => invoke("audio_recent_forget", { path });

/** Le fichier lu par le WebView pour l'aperçu, via le protocole `asset:` (autorisé au préalable
 * par `audioAllowAsset`). */
export async function fetchAudioData(path: string): Promise<ArrayBuffer> {
  const response = await fetch(convertFileSrc(path));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
}
