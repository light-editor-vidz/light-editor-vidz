// Les commandes de génération de sous-titres (`commands/subs_tool.rs` et le moteur `subz`).

import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../../bindings/Project";

export type SttEngine = "local" | "groq" | "open_ai" | "deepgram" | "assembly_ai";
export type TranslationEngine = "local" | "deep_l" | "open_ai" | "google" | "azure";

export interface SubsSettings {
  stt_engine: SttEngine;
  translation_engine: TranslationEngine;
  azure_translator_region: string;
  language: "en" | "fr";
  whisper_model: string;
  /** Langue parlée forcée, ou `auto`. */
  stt_language: string;
}

export interface SubsLanguage {
  code: string;
  flores_code: string;
  name: string;
}

export interface SubsAudioTrack {
  position: number;
  language: string | null;
  title: string | null;
  codec: string | null;
  channels: number | null;
}

export interface SubsOutput {
  srt_path: string;
  srt_content: string;
  language: string;
}

/** Les clés d'API qu'un moteur demande : `[nom dans le trousseau, libellé]`, ou `null` (local). */
export const STT_KEYS: Record<SttEngine, [string, string] | null> = {
  local: null,
  groq: ["groq_api_key", "Groq"],
  open_ai: ["openai_api_key", "OpenAI"],
  deepgram: ["deepgram_api_key", "Deepgram"],
  assembly_ai: ["assemblyai_api_key", "AssemblyAI"],
};

export const TRANSLATION_KEYS: Record<TranslationEngine, [string, string] | null> = {
  local: null,
  deep_l: ["deepl_api_key", "DeepL"],
  open_ai: ["openai_api_key", "OpenAI"],
  google: ["google_translate_api_key", "Google Translate"],
  azure: ["azure_translator_key", "Azure Translator"],
};

export const STT_ENGINES: { value: SttEngine; label: string }[] = [
  { value: "local", label: "Local (whisper.cpp)" },
  { value: "groq", label: "Groq" },
  { value: "open_ai", label: "OpenAI" },
  { value: "deepgram", label: "Deepgram" },
  { value: "assembly_ai", label: "AssemblyAI" },
];

export const TRANSLATION_ENGINES: { value: TranslationEngine; label: string }[] = [
  { value: "local", label: "Local (NLLB-200)" },
  { value: "deep_l", label: "DeepL" },
  { value: "open_ai", label: "OpenAI" },
  { value: "google", label: "Google Translate" },
  { value: "azure", label: "Azure Translator" },
];

export const WHISPER_MODELS = ["base", "small", "medium"];

export const getSubsSettings = (): Promise<SubsSettings> => invoke("get_settings");
export const setSubsSettings = (settings: SubsSettings): Promise<void> => invoke("set_settings", { settings });
export const listSubsLanguages = (): Promise<SubsLanguage[]> => invoke("list_languages");
export const hasApiKey = (keyName: string): Promise<boolean> => invoke("has_api_key", { keyName });
export const setApiKey = (keyName: string, value: string): Promise<void> => invoke("set_api_key", { keyName, value });
export const deleteApiKey = (keyName: string): Promise<void> => invoke("delete_api_key", { keyName });
export const cancelSubs = (): Promise<void> => invoke("cancel_pipeline");

export const audioTracksOfFile = (path: string): Promise<SubsAudioTrack[]> => invoke("subs_audio_tracks", { path });
export const audioTracksOfMedia = (projectDir: string, src: string): Promise<SubsAudioTrack[]> =>
  invoke("subs_media_tracks", { projectDir, src });

export const generateForFile = (path: string, audioTrack: number | null): Promise<SubsOutput> =>
  invoke("subs_generate_file", { path, audioTrack });
export const generateForMedia = (projectDir: string, src: string, audioTrack: number | null): Promise<SubsOutput> =>
  invoke("subs_generate_media", { projectDir, src, audioTrack });
export const generateForProject = (projectDir: string, project: Project): Promise<SubsOutput> =>
  invoke("subs_generate_project", { projectDir, project });

export const translateSubs = (
  srtPath: string,
  srtContent: string,
  sourceLang: string | null,
  targetLang: string,
): Promise<SubsOutput> => invoke("translate_subtitles", { srtPath, srtContent, sourceLang, targetLang });

/** Remet les textes corrigés sur les répliques ; les temps ne changent pas, rien n'est écrit. */
export const updateSubs = (srtContent: string, texts: string[]): Promise<{ srt_content: string }> =>
  invoke("update_subtitles", { srtContent, texts });

export interface MediaSubEntry {
  id: string;
  label: string;
  srt: string;
}

/** Les sous-titres associés à un fichier ouvert hors projet. */
export const listMediaSubs = (path: string): Promise<MediaSubEntry[]> => invoke("media_subs_list", { path });
export const saveMediaSub = (path: string, entry: MediaSubEntry): Promise<void> =>
  invoke("media_subs_save", { path, entry });
export const removeMediaSub = (path: string, id: string): Promise<void> => invoke("media_subs_remove", { path, id });

/** Le sous-titre d'un média de projet (le `.srt` à côté de lui). */
export async function projectMediaSubtitle(projectDir: string, src: string): Promise<string | null> {
  return (await invoke<string | null | undefined>("project_media_subtitle", { projectDir, src })) ?? null;
}
export const setProjectMediaSubtitle = (projectDir: string, src: string, srt: string): Promise<void> =>
  invoke("set_project_media_subtitle", { projectDir, src, srt });

export interface AddReport {
  added: number;
  errors: string[];
}

/** Après un export : le fichier écrit rejoint la médiathèque de ces projets. */
export const addOutputToProjects = (outputPath: string, projects: string[], srt: string | null): Promise<AddReport> =>
  invoke("add_output_to_projects", { outputPath, projects, srt });

export type SubsFormat = "srt" | "vtt" | "ass";

/** « Enregistrer sous » : renvoie les chemins écrits, ou `null` si le dialogue est fermé. */
export const saveSubs = (
  defaultPath: string,
  filterName: string,
  format: SubsFormat,
  srtContent: string,
): Promise<string[] | null> =>
  invoke("save_subtitle_as", { defaultPath, filterName, format, srtContent, extras: null });

/** Ce que renvoie un échec : `{ code, message }`. */
export interface SubsError {
  code: string | null;
  message: string;
}
