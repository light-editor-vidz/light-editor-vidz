import constants from "../shared/constants.json";

export type Aspect = (typeof constants.aspects)[number];
export type ReframeMode = "blur" | "crop";

export const ASPECTS = constants.aspects as Aspect[];

/** One-click export settings for a social network. All are MP4, 1080 on the shorter side. */
export const SOCIAL_PRESETS = [
  { id: "vertical", aspect: "9:16" },
  { id: "portrait", aspect: "4:5" },
  { id: "square", aspect: "1:1" },
  { id: "wide", aspect: "16:9" },
] as const satisfies readonly { id: string; aspect: Aspect }[];

export type PresetId = (typeof SOCIAL_PRESETS)[number]["id"];

export const PRESET_SETTINGS = { format: "mp4", mode: "blur", resolution: 1080, quality: "balanced" } as const;
