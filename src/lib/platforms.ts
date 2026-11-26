/**
 * Les destinations de publication. Les zones sûres et les limites viennent de `_platforms.py` du
 * dépôt kajisho5/ffmpeg-skill (MIT). Aucune plateforme ne publie de marges pour les publications
 * ordinaires, et les limites changent : tout est présenté comme indicatif, rien ne bloque.
 */

/** Part de l'image que l'interface de l'application couvre, sur chaque bord (0 à 1). */
export interface SafeZone {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const SAFE_ZONE_PLATFORMS = [
  { id: "tiktok", title: "TikTok", safe: { top: 0.1, bottom: 0.22, left: 0.05, right: 0.14 } },
  { id: "reels", title: "Instagram Reels", safe: { top: 0.08, bottom: 0.2, left: 0.05, right: 0.12 } },
  { id: "shorts", title: "YouTube Shorts", safe: { top: 0.06, bottom: 0.18, left: 0.05, right: 0.12 } },
] as const satisfies readonly { id: string; title: string; safe: SafeZone }[];

export type SafeZonePlatform = (typeof SAFE_ZONE_PLATFORMS)[number]["id"];

export const safeZoneOf = (id: SafeZonePlatform | null): SafeZone | null =>
  SAFE_ZONE_PLATFORMS.find((p) => p.id === id)?.safe ?? null;

/** Ces marges ne valent que pour une image verticale 9:16 (à l'arrondi des pixels près). */
export const isVertical916 = (width: number, height: number): boolean =>
  height > 0 && Math.abs(width / height - 9 / 16) < 0.01;

/** La date des limites ci-dessous : les plateformes les changent, elles restent indicatives. */
export const LIMITS_AS_OF = "2026-10-30";

export interface PlatformSpec {
  id: string;
  title: string;
  /** Réglages que le préréglage applique. */
  preset: { aspect: "9:16" | "16:9" | "1:1"; resolution: 720 | 1080; fps: number | null };
  maxDuration: number;
  aspects: string[];
  minHeight: number;
  maxFps: number;
  codecs: string[];
  maxBytes: number;
  /** Volume ressenti attendu (LUFS), sa tolérance, et la crête vraie maximale (dBTP). */
  loudness: number;
  tolerance: number;
  truePeak: number;
  sdrOnly: boolean;
}

const GIB = 1024 ** 3;
const base = { maxFps: 60, codecs: ["h264", "hevc"], loudness: -14, tolerance: 2, truePeak: -1 };
const vertical = { aspect: "9:16", resolution: 1080, fps: 30 } as const;
const feed = ["16:9", "1:1", "9:16", "4:5"];

export const PLATFORMS = [
  {
    ...base,
    id: "tiktok",
    title: "TikTok",
    preset: vertical,
    maxDuration: 600,
    aspects: ["9:16", "1:1"],
    minHeight: 1080,
    maxBytes: 4 * GIB,
    sdrOnly: true,
  },
  {
    ...base,
    id: "reels",
    title: "Instagram Reels",
    preset: vertical,
    maxDuration: 90,
    aspects: ["9:16", "4:5", "1:1"],
    minHeight: 1080,
    maxBytes: 4 * GIB,
    sdrOnly: true,
  },
  {
    ...base,
    id: "shorts",
    title: "YouTube Shorts",
    preset: vertical,
    maxDuration: 180,
    aspects: ["9:16", "1:1"],
    minHeight: 1080,
    maxBytes: 256 * GIB,
    sdrOnly: false,
  },
  {
    ...base,
    id: "youtube",
    title: "YouTube",
    preset: { aspect: "16:9", resolution: 1080, fps: null },
    maxDuration: 12 * 3600,
    aspects: ["16:9", "9:16", "1:1", "4:3"],
    minHeight: 720,
    codecs: ["h264", "hevc", "prores", "av1", "vp9"],
    maxBytes: 256 * GIB,
    sdrOnly: false,
  },
  {
    ...base,
    id: "x",
    title: "X (Twitter)",
    preset: { aspect: "16:9", resolution: 720, fps: 30 },
    maxDuration: 140,
    aspects: ["16:9", "1:1", "9:16"],
    minHeight: 720,
    codecs: ["h264"],
    maxBytes: GIB / 2,
    tolerance: 3,
    sdrOnly: true,
  },
  {
    ...base,
    id: "linkedin",
    title: "LinkedIn",
    preset: { aspect: "1:1", resolution: 1080, fps: 30 },
    maxDuration: 600,
    aspects: feed,
    minHeight: 720,
    codecs: ["h264"],
    maxBytes: 5 * GIB,
    tolerance: 3,
    sdrOnly: true,
  },
  {
    ...base,
    id: "facebook",
    title: "Facebook",
    preset: { aspect: "16:9", resolution: 1080, fps: 30 },
    maxDuration: 4 * 3600,
    aspects: feed,
    minHeight: 720,
    maxBytes: 4 * GIB,
    tolerance: 3,
    sdrOnly: true,
  },
] as const satisfies readonly Record<string, unknown>[];

export type PlatformId = (typeof PLATFORMS)[number]["id"];

export const platformOf = (id: unknown): PlatformSpec | null =>
  (PLATFORMS.find((p) => p.id === id) as PlatformSpec | undefined) ?? null;

export const parsePlatform = (id: unknown): PlatformId | null => PLATFORMS.find((p) => p.id === id)?.id ?? null;

/** Ce qu'on sait du fichier : tout avant l'export n'est pas connu, chaque valeur est facultative. */
export interface Delivery {
  duration?: number;
  /** Largeur / hauteur. */
  ratio?: number;
  height?: number | null;
  fps?: number | null;
  video_codec?: string | null;
  size_bytes?: number;
  hdr?: boolean;
  has_audio?: boolean;
  loudness?: number | null;
  true_peak?: number | null;
}

export interface CheckItem {
  id: "duration" | "aspect" | "height" | "fps" | "codec" | "size" | "hdr" | "audio" | "loudness" | "truePeak";
  ok: boolean;
  /** Ce que contient le fichier, et ce qui est attendu, prêts à être affichés. */
  value: string;
  expected: string;
}

const ratioOf = (aspect: string) => {
  const [w, h] = aspect.split(":").map(Number);
  return w / h;
};

const clock = (seconds: number) => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

const fileSize = (bytes: number) =>
  bytes < GIB ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / GIB).toFixed(2)} GiB`;

/** Compare ce qu'on sait du fichier aux attentes de la plateforme. Rien ne bloque : un point qui
 * n'est pas conforme est un avertissement. */
export function checkDelivery(platform: PlatformSpec, file: Delivery): CheckItem[] {
  const items: CheckItem[] = [];
  const add = (id: CheckItem["id"], ok: boolean, value: string, expected: string) =>
    items.push({ id, ok, value, expected });
  if (file.duration !== undefined) {
    add(
      "duration",
      file.duration <= platform.maxDuration + 0.5,
      clock(file.duration),
      `≤ ${clock(platform.maxDuration)}`,
    );
  }
  if (file.ratio !== undefined) {
    const named = platform.aspects.find((a) => Math.abs(file.ratio! / ratioOf(a) - 1) < 0.01);
    add("aspect", !!named, named ?? file.ratio.toFixed(2), platform.aspects.join(", "));
  }
  if (file.height != null)
    add("height", file.height >= platform.minHeight, `${file.height} px`, `≥ ${platform.minHeight} px`);
  if (file.fps != null)
    add("fps", file.fps <= platform.maxFps + 0.01, String(+file.fps.toFixed(2)), `≤ ${platform.maxFps}`);
  if (file.video_codec != null) {
    add("codec", platform.codecs.includes(file.video_codec), file.video_codec, platform.codecs.join(", "));
  }
  if (file.size_bytes !== undefined) {
    add("size", file.size_bytes <= platform.maxBytes, fileSize(file.size_bytes), `≤ ${fileSize(platform.maxBytes)}`);
  }
  if (file.hdr !== undefined && platform.sdrOnly) add("hdr", !file.hdr, file.hdr ? "HDR" : "SDR", "SDR");
  if (file.has_audio === false) add("audio", false, "—", "");
  if (file.has_audio) {
    const target = `${platform.loudness} ±${platform.tolerance} LUFS`;
    const measured = file.loudness ?? null;
    add(
      "loudness",
      measured !== null && Math.abs(measured - platform.loudness) <= platform.tolerance,
      measured === null ? "—" : `${measured.toFixed(1)} LUFS`,
      target,
    );
    if (file.true_peak != null) {
      // 0,1 dB de marge : deux mesures d'un même encodage s'écartent d'autant.
      add(
        "truePeak",
        file.true_peak <= platform.truePeak + 0.1,
        `${file.true_peak.toFixed(1)} dBTP`,
        `≤ ${platform.truePeak} dBTP`,
      );
    }
  }
  return items;
}
