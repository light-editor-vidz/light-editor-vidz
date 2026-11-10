// Le sous-titre lié à un média : il vit sur l'élément vidéo ou la piste audio, en temps du média.
// Pour l'aperçu et l'export, il devient de simples éléments texte, calculés et jamais enregistrés.

import type { AudioTrack } from "../../bindings/AudioTrack";
import type { Element } from "../../bindings/Element";
import type { LinkedCue } from "../../bindings/LinkedCue";
import type { LinkedSubtitles } from "../../bindings/LinkedSubtitles";
import type { Project } from "../../bindings/Project";
import { parseSrt } from "../../components/videotool/utils/srt";
import { createSubtitleElement } from "../elements";
import { cuesOfAudioTrack, cuesOfVideoElement, splitAcrossScenes, type TimedCue } from "./place";

const LINKED_PREFIX = "linked:";
export const isLinkedElementId = (id: string) => id.startsWith(LINKED_PREFIX);

const POSITION_Y: Record<string, number> = { top: 6, middle: 45, bottom: 82 };

/** `00:01:02,500`, comme dans un fichier SRT. */
export function cueTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function cuesToSrt(cues: TimedCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${cueTime(c.start)} --> ${cueTime(c.end)}\n${c.text}\n`).join("\n");
}

/** Un sous-titre prêt à poser sur un média, ou `null` si le SRT est vide. */
export function srtToLinked(srt: string, enabled: boolean): LinkedSubtitles | null {
  const cues = parseSrt(srt).map(({ start, end, text }) => ({ start, end, text }));
  return cues.length > 0 ? { enabled, cues, font_size: 2.7, color: "rgba(255,255,255,1)", position: "bottom" } : null;
}

/** Les répliques d'un média une fois ses coupes retirées et sa vitesse appliquée. Une réplique à
 * cheval sur une coupe garde ses deux morceaux. */
export function remapCues(cues: TimedCue[], kept: { start: number; end: number }[], speed: number): TimedCue[] {
  const rate = speed > 0.01 ? speed : 1;
  const out: TimedCue[] = [];
  let offset = 0;
  for (const segment of kept) {
    for (const cue of cues) {
      const start = Math.max(cue.start, segment.start);
      const end = Math.min(cue.end, segment.end);
      if (end - start > 0.05) {
        out.push({
          start: (offset + start - segment.start) / rate,
          end: (offset + end - segment.start) / rate,
          text: cue.text,
        });
      }
    }
    offset += segment.end - segment.start;
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Le projet tel qu'il s'affiche et s'exporte : chaque sous-titre activé devient des éléments texte,
 * au-dessus de leur scène, qui suivent le média (position, coupe, vitesse). */
export function expandLinkedSubtitles(project: Project): Project {
  const sources: { owner: string; subs: LinkedSubtitles; cues: TimedCue[] }[] = [];
  for (const comp of project.compositions) {
    for (const el of comp.elements) {
      if (el.type === "video" && el.subtitles?.enabled) {
        sources.push({
          owner: el.id,
          subs: el.subtitles,
          cues: cuesOfVideoElement(el.subtitles.cues, el, comp.start_time, comp.duration),
        });
      }
    }
  }
  for (const track of project.audio_tracks) {
    if (track.subtitles?.enabled) {
      sources.push({
        owner: track.id,
        subs: track.subtitles,
        cues: cuesOfAudioTrack(track.subtitles.cues, track, project.duration),
      });
    }
  }
  if (sources.length === 0) return project;

  const template = createSubtitleElement();
  if (template.type !== "text") return project;
  const added = new Map<string, Element[]>();
  for (const { owner, subs, cues } of sources) {
    cues.forEach((cue, index) => {
      for (const { composition, start, duration } of splitAcrossScenes(project, cue)) {
        const element: Element = {
          ...template,
          id: `${LINKED_PREFIX}${owner}:${index}:${composition.id}`,
          name: cue.text,
          content: cue.text,
          start_time: start,
          duration,
          y: POSITION_Y[subs.position] ?? POSITION_Y.bottom,
          font_size: subs.font_size,
          color: subs.color,
        };
        added.set(composition.id, [...(added.get(composition.id) ?? []), element]);
      }
    });
  }
  return {
    ...project,
    compositions: project.compositions.map((c) => {
      const extra = added.get(c.id);
      return extra ? { ...c, elements: [...c.elements, ...extra] } : c;
    }),
  };
}

type Owner = Extract<Element, { type: "video" }> | AudioTrack;

function mapOwners(project: Project, fn: (owner: Owner) => Owner): Project {
  return {
    ...project,
    compositions: project.compositions.map((c) => ({
      ...c,
      elements: c.elements.map((el) => (el.type === "video" ? (fn(el) as Element) : el)),
    })),
    audio_tracks: project.audio_tracks.map((t) => fn(t) as AudioTrack),
  };
}

/** Le sous-titre d'un média a changé : tous ses usages dans le projet reçoivent les mêmes textes. */
export function syncLinkedCues(project: Project, src: string, cues: LinkedCue[]): Project {
  return mapOwners(project, (o) => (o.src === src && o.subtitles ? { ...o, subtitles: { ...o.subtitles, cues } } : o));
}

/** Associe un sous-titre généré : il s'active sur le média d'origine, et remplace les textes des
 * autres usages du même fichier. */
export function attachLinked(project: Project, ownerId: string, src: string, linked: LinkedSubtitles): Project {
  return mapOwners(project, (o) => {
    if (o.src !== src) return o;
    if (o.id === ownerId) return { ...o, subtitles: { ...(o.subtitles ?? linked), cues: linked.cues, enabled: true } };
    return o.subtitles ? { ...o, subtitles: { ...o.subtitles, cues: linked.cues } } : o;
  });
}
