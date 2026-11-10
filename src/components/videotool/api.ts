// Le pont entre la vue Vidéo et le moteur Rust (`commands/video_tool.rs`). Il a la forme de l'API
// que LightCutVidz exposait depuis Electron : les composants n'ont pas à savoir qu'ils tournent
// dans Tauri. Les tests substituent une maquette via `window.electronAPI`.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import i18n from "i18next";
import { translations } from "./i18n";

export interface QueueJob {
  id: number;
  name: string;
  format: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  outputPath: string;
  error: string | null;
}

export interface RecentEntry {
  kind: "video";
  path: string;
  name: string;
  dir: string;
  openedAt: number;
}

export interface ExportRequest {
  inputPath: string;
  outputPath: string;
  segments: { start: number; end: number }[];
  speed: number;
  crop: { x: number; y: number; w: number; h: number } | null;
  filter: string;
  rotation?: number;
  straighten?: number;
  perspectiveH?: number;
  perspectiveV?: number;
  muted: boolean;
  format: string;
  quality?: "high" | "balanced" | "small";
  resolution?: number | null;
  reframe?: { aspect: string; mode: "blur" | "crop" } | null;
  stabilize?: "off" | "light" | "normal" | "strong";
  hardware?: string | null;
  gifWidth?: number;
  gifFps?: number;
  subtitles?: {
    cues: { id?: number; start: number; end: number; text: string }[];
    style: {
      fontFamily: string;
      fontSize: number;
      color: string;
      outlineColor: string;
      outlineWidth: number;
      backgroundColor: string;
      backgroundOpacity: number;
      position: "top" | "middle" | "bottom";
      accentColor: string;
    };
    animation: string;
  } | null;
}

export interface VideoApi {
  getPathForFile: (file: File) => string;
  toFileUrl: (filePath: string) => Promise<string>;
  openVideo: () => Promise<string | null>;
  saveVideo: (defaultName?: string, format?: string) => Promise<string | null>;
  cancelFfmpeg: () => Promise<void>;
  getCapabilities: () => Promise<{ hardware: string[]; stabilization: boolean }>;
  queueAdd: (options: unknown) => Promise<{ id: number }>;
  queueList: () => Promise<QueueJob[]>;
  queueCancel: (id: number) => Promise<boolean>;
  queueClearFinished: () => Promise<void>;
  queueReveal: (id: number) => Promise<void>;
  onQueueUpdate: (callback: (jobs: QueueJob[]) => void) => () => void;
  listRecent: () => Promise<RecentEntry[]>;
  removeRecent: (path: string) => Promise<void>;
  clearRecent: () => Promise<void>;
  previewVideo: (filePath: string) => Promise<string>;
  openSubtitleFile: () => Promise<{ filePath: string; content: string } | null>;
  onPreviewProgress: (callback: (progress: number) => void) => () => void;
  exportVideo: (options: ExportRequest) => Promise<{ success: boolean; outputPath: string }>;
  onProgress: (callback: (progress: number) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: Partial<VideoApi>;
  }
}

const subscribe = <T>(event: string, callback: (payload: T) => void): (() => void) => {
  let off: (() => void) | undefined;
  let cancelled = false;
  listen<T>(event, (e) => callback(e.payload))
    .then((fn) => (cancelled ? fn() : (off = fn)))
    .catch(() => {});
  return () => {
    cancelled = true;
    off?.();
  };
};

// Les exports lancés depuis la fenêtre d'export (qui les attend) : « Arrêter » les annule où
// qu'ils en soient dans la file.
const dialogJobs = new Set<number>();
const progressListeners = new Set<(pct: number) => void>();

/** Convertit un fichier local en URL lisible par `<video>` (protocole `asset:`), après l'avoir autorisé. */
async function fileUrl(path: string): Promise<string> {
  await invoke("audio_allow_asset", { path });
  return convertFileSrc(path);
}

const tauriApi: VideoApi = {
  getPathForFile: () => "",
  toFileUrl: fileUrl,
  openVideo: () => invoke<string | null>("video_pick_file"),
  saveVideo: async (defaultName, format) => {
    const choice = await invoke<{ path: string; confirm_overwrite: boolean } | null>("video_pick_output", {
      defaultName: defaultName ?? null,
      format: format ?? "",
    });
    if (!choice) return null;
    if (choice.confirm_overwrite) {
      const name = choice.path.split(/[\\/]/).pop() ?? choice.path;
      const lang = i18n.resolvedLanguage === "fr" ? "fr" : "en";
      const ok = await ask(translations[lang].overwrite_confirm(name), { kind: "warning" });
      if (!ok) return null;
    }
    return choice.path;
  },
  cancelFfmpeg: async () => {
    await Promise.all([...dialogJobs].map((id) => invoke("video_queue_cancel", { id })));
    await invoke("video_cancel_preview");
  },
  getCapabilities: () => invoke("video_capabilities"),
  queueAdd: async (options) => ({ id: await invoke<number>("video_queue_add", { options }) }),
  queueList: () => invoke("video_queue_list"),
  queueCancel: (id) => invoke("video_queue_cancel", { id }),
  queueClearFinished: () => invoke("video_queue_clear_finished"),
  queueReveal: async (id) => {
    const jobs = await invoke<QueueJob[]>("video_queue_list");
    const job = jobs.find((j) => j.id === id);
    if (job && job.status === "done") await revealItemInDir(job.outputPath);
  },
  onQueueUpdate: (callback) => subscribe<QueueJob[]>("video-queue", callback),
  listRecent: async () => {
    const items = await invoke<{ path: string; name: string; dir: string }[]>("video_recent_list");
    return items.map((i) => ({ kind: "video" as const, openedAt: 0, ...i }));
  },
  removeRecent: (path) => invoke("video_recent_forget", { path }),
  clearRecent: () => invoke("video_recent_forget", { path: null }),
  previewVideo: async (filePath) => {
    const preview = await invoke<{ path: string; transcoded: boolean }>("video_preview", {
      path: filePath,
      force: false,
    });
    return convertFileSrc(preview.path);
  },
  openSubtitleFile: async () => {
    const r = await invoke<{ path: string; content: string } | null>("video_pick_subtitles");
    return r && { filePath: r.path, content: r.content };
  },
  onPreviewProgress: (callback) => subscribe<number>("video-preview-progress", callback),
  // La fenêtre d'export attend la fin de son travail : il passe par la file, dont les
  // instantanés disent où il en est.
  exportVideo: async (options) => {
    const id = await invoke<number>("video_queue_add", { options });
    dialogJobs.add(id);
    return new Promise((resolve, reject) => {
      const done = () => {
        off();
        dialogJobs.delete(id);
      };
      const off = subscribe<QueueJob[]>("video-queue", (jobs) => {
        const job = jobs.find((j) => j.id === id);
        if (!job) return;
        progressListeners.forEach((l) => l(job.progress));
        if (job.status === "done") {
          done();
          resolve({ success: true, outputPath: job.outputPath });
        } else if (job.status === "error") {
          done();
          reject(new Error(job.error ?? "Export failed"));
        } else if (job.status === "cancelled") {
          done();
          reject(new Error("cancelled"));
        }
      });
    });
  },
  onProgress: (callback) => {
    progressListeners.add(callback);
    return () => progressListeners.delete(callback);
  },
};

/** L'API de la vue : la maquette des tests si elle existe, sinon le moteur Tauri. */
export function getApi(): VideoApi {
  return { ...tauriApi, ...(typeof window !== "undefined" ? (window.electronAPI ?? {}) : {}) } as VideoApi;
}
