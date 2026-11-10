import type { StabilizeLevel } from "./hooks/useHistory";
import type { SubtitleCue } from "./utils/srt";

export interface TrimSegment {
  id: string;
  start: number;
  end: number;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SubtitleAnimation =
  "word-pop" | "word-bounce" | "word-highlight" | "rainbow" | "sentence-fade" | "sentence-slide" | "typewriter";

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number; // relative unit (~% of video height), consistent between CSS preview and ASS export
  color: string;
  outlineColor: string;
  outlineWidth: number;
  backgroundColor: string;
  backgroundOpacity: number; // 0-1
  position: "top" | "middle" | "bottom";
  accentColor: string; // word-highlight active-word color
}

export interface SubtitlesState {
  fileName: string;
  cues: SubtitleCue[];
  style: SubtitleStyle;
  animation: SubtitleAnimation;
}

// Trendy 2026 default: bold white captions, black outline, no box, word-by-word pop-in.
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: "Arial",
  fontSize: 5,
  color: "#ffffff",
  outlineColor: "#000000",
  outlineWidth: 2,
  backgroundColor: "#000000",
  backgroundOpacity: 0,
  position: "bottom",
  accentColor: "#22d3ee",
};

export interface EditorState {
  videoPath: string | null;
  videoUrl: string | null;
  duration: number;
  speed: number;
  muted: boolean;
  cutSegments: TrimSegment[];
  crop: CropRect | null;
  filter: string;
  rotation: number;
  straighten: number;
  perspectiveHorizontal: number;
  perspectiveVertical: number;
  subtitles: SubtitlesState | null;
  stabilize: StabilizeLevel;
}
