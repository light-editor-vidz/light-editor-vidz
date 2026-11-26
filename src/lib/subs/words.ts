import type { SubtitleCue } from "../../components/videotool/utils/srt";
import type { SubsWord } from "./commands";

/** Marge (s) autour d'une réplique : ses bords sont parfois ajustés après la transcription. */
const SLACK = 0.25;

const tokens = (text: string) => text.split(/\s+/).filter(Boolean);

/** Donne à chaque réplique le temps de ses mots, quand la transcription les connaît et qu'ils
 * écrivent exactement son texte. Les autres (texte corrigé, traduit, écriture sans espaces)
 * restent sans : leur découpage est alors estimé d'après la longueur des mots. */
export function attachWords(cues: SubtitleCue[], words: SubsWord[]): SubtitleCue[] {
  if (words.length === 0) return cues;
  return cues.map((cue) => {
    const expected = tokens(cue.text);
    const near = words.filter((w) => {
      const middle = (w.start + w.end) / 2;
      return middle >= cue.start - SLACK && middle <= cue.end + SLACK;
    });
    // La marge peut prendre un mot du voisin : la suite exacte est cherchée parmi les proches.
    const from = near.findIndex((_, i) => expected.every((t, j) => near[i + j]?.text === t));
    if (expected.length === 0 || from === -1) return cue;
    return { ...cue, words: near.slice(from, from + expected.length) };
  });
}
