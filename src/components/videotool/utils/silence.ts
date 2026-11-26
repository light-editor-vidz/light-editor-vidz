// Which parts of the silences to cut. Pure: the detection runs once in Rust
// (`video_detect_silences`), the margins can then be tuned without running it again.
import type { SubtitleCue } from "./srt";

export interface Range {
  start: number;
  end: number;
}

/** A cut shorter than this (s) is not worth a jump in the picture. */
export const MIN_CUT = 0.2;
/** Two cues closer than this (s) to a silence border are its neighbours. */
const EDGE = 0.25;

const SENTENCE_END = /[.!?…。！？]["'»”’)\]]*$/;

/** Les intervalles où quelqu'un parle : les mots quand ils sont connus, sinon les répliques. */
function spoken(cues: SubtitleCue[]): Range[] {
  return cues.flatMap((c) => (c.words?.length ? c.words : [c]));
}

/** Whether the pause starting at `start` follows the end of a sentence (or all the speech). */
function afterSentence(start: number, cues: SubtitleCue[]): boolean {
  const said = cues
    .flatMap((c) => (c.words?.length ? c.words : [c]))
    .filter((w) => w.start < start - EDGE)
    .sort((a, b) => a.start - b.start);
  const last = said[said.length - 1];
  return !last || SENTENCE_END.test(last.text.trim());
}

/** `range` without the parts covered by `protect`. */
function subtract(range: Range, protect: Range[]): Range[] {
  let pieces = [range];
  for (const word of protect) {
    pieces = pieces.flatMap((p) => {
      if (word.end <= p.start || word.start >= p.end) return [p];
      return [
        { start: p.start, end: Math.max(p.start, word.start) },
        { start: Math.min(p.end, word.end), end: p.end },
      ].filter((r) => r.end > r.start);
    });
  }
  return pieces;
}

export interface CutSettings {
  /** Silence (s) kept on each side of the speech. */
  margin: number;
  /** Ne couper qu'après une fin de phrase (d'après les sous-titres générés). */
  sentencesOnly: boolean;
}

/** The ranges to remove from a video of `duration` seconds. `cues` (generated subtitles, in the
 * video's own time) protect the words: a cut never removes one. */
export function cutsFromSilences(
  silences: Range[],
  duration: number,
  { margin, sentencesOnly }: CutSettings,
  cues: SubtitleCue[] = [],
): Range[] {
  const words = spoken(cues);
  const protectedRanges = words.map((w) => ({ start: w.start - margin, end: w.end + margin }));
  const cuts = silences
    .filter((s) => !sentencesOnly || cues.length === 0 || afterSentence(s.start, cues))
    // At the very start and end of the file there is no speech to keep a margin around.
    .map((s) => ({
      start: s.start <= 0.05 ? 0 : s.start + margin,
      end: s.end >= duration - 0.05 ? duration : s.end - margin,
    }))
    .flatMap((r) => subtract(r, protectedRanges))
    .filter((r) => r.end - r.start >= MIN_CUT);
  const removed = cuts.reduce((sum, c) => sum + (c.end - c.start), 0);
  // A file that is silent from end to end: cutting everything would leave nothing to export.
  return removed >= duration - MIN_CUT ? [] : cuts;
}
