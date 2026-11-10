// Preview-side (real-time) helpers for animated subtitle display.
// Word/char timing windows are split proportionally to word/char length
// within the cue's [start,end] window, since SRT only gives phrase-level
// timestamps. Mirrors the same split formula used for export in
// src/main/lib/subtitles.js — keep both in sync.
import type { SubtitleCue } from "./srt";

import constants from "../shared/constants.json";

export const RAINBOW_PALETTE: string[] = constants.rainbowPalette;

export interface TimedWord {
  start: number;
  end: number;
  text: string;
}
export interface TimedText {
  start: number;
  end: number;
  text: string;
}

export function getWordWindows(cue: SubtitleCue): TimedWord[] {
  const words = cue.text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const totalChars = words.reduce((sum, w) => sum + w.length, 0);
  const duration = cue.end - cue.start;
  let t = cue.start;
  const out: TimedWord[] = [];

  for (const word of words) {
    const share = totalChars > 0 ? word.length / totalChars : 1 / words.length;
    const wDur = duration * share;
    out.push({ start: t, end: t + wDur, text: word });
    t += wDur;
  }

  out[out.length - 1].end = cue.end; // snap to avoid float drift
  return out;
}

export function getCharWindows(cue: SubtitleCue): TimedText[] {
  const chars = Array.from(cue.text);
  if (chars.length === 0) return [];

  const duration = cue.end - cue.start;
  const charDur = duration / chars.length;
  let t = cue.start;
  let cumulative = "";
  const out: TimedText[] = [];

  for (const char of chars) {
    cumulative += char;
    out.push({ start: t, end: t + charDur, text: cumulative });
    t += charDur;
  }

  out[out.length - 1].end = cue.end;
  return out;
}

/** Every cue showing at `time` (SRT files may overlap them). */
export function getActiveCues(cues: SubtitleCue[], time: number): SubtitleCue[] {
  return cues.filter((c) => time >= c.start && time < c.end);
}

export function getActiveCue(cues: SubtitleCue[], time: number): SubtitleCue | null {
  return cues.find((c) => time >= c.start && time < c.end) || null;
}

/** Index of the word that should be visible/active at `time`, for word-pop/word-highlight modes. */
export function getActiveWordIndex(cue: SubtitleCue, time: number): number {
  const windows = getWordWindows(cue);
  if (windows.length === 0) return -1;
  const idx = windows.findIndex((w) => time >= w.start && time < w.end);
  if (idx !== -1) return idx;
  return time >= cue.end ? windows.length - 1 : 0;
}

/** Number of leading characters that should be revealed at `time`, for typewriter mode. */
export function getActiveCharCount(cue: SubtitleCue, time: number): number {
  const windows = getCharWindows(cue);
  if (windows.length === 0) return 0;
  const idx = windows.findIndex((w) => time >= w.start && time < w.end);
  if (idx !== -1) return idx + 1;
  return time >= cue.end ? windows.length : 0;
}
