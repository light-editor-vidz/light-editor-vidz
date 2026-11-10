// Remet les répliques générées sur la timeline d'un projet, et les crée en éléments texte.

import type { Project } from "../../bindings/Project";
import type { Element } from "../../bindings/Element";
import type { AudioTrack } from "../../bindings/AudioTrack";
import type { SubtitleCue } from "../../components/videotool/utils/srt";
import { addElementToComposition, createSubtitleElement } from "../elements";

export interface TimedCue {
  start: number;
  end: number;
  text: string;
}

type VideoElement = Extract<Element, { type: "video" }>;

/** Garde la partie d'une réplique qui tombe dans [from, to] (temps de la source) et la ramène sur la
 * timeline : `place(t)` convertit un temps de source en temps de timeline. */
function clipAndMap(cues: TimedCue[], from: number, to: number, place: (t: number) => number): TimedCue[] {
  const out: TimedCue[] = [];
  for (const cue of cues) {
    const start = Math.max(cue.start, from);
    const end = Math.min(cue.end, to);
    if (end - start > 0.05) out.push({ start: place(start), end: place(end), text: cue.text });
  }
  return out;
}

/** Répliques d'un élément vidéo, sur la timeline du projet : la vidéo démarre à `video_offset`,
 * va à `playback_speed` et dure `duration` (ou jusqu'à la fin de sa scène). */
export function cuesOfVideoElement(
  cues: TimedCue[],
  element: VideoElement,
  sceneStart: number,
  sceneDuration: number,
): TimedCue[] {
  const speed = element.playback_speed > 0.01 ? element.playback_speed : 1;
  const duration = element.duration ?? sceneDuration - element.start_time;
  const origin = sceneStart + element.start_time;
  return clipAndMap(
    cues,
    element.video_offset,
    element.video_offset + duration * speed,
    (t) => origin + (t - element.video_offset) / speed,
  );
}

/** Répliques d'une piste audio, sur la timeline du projet : `start_time` est absolu, `audio_offset`
 * est le point d'entrée dans le fichier ; sans durée, la piste joue jusqu'à la fin du projet. */
export function cuesOfAudioTrack(cues: TimedCue[], track: AudioTrack, projectDuration: number): TimedCue[] {
  const speed = track.speed > 0.01 ? track.speed : 1;
  const duration = track.duration ?? projectDuration - track.start_time;
  return clipAndMap(
    cues,
    track.audio_offset,
    track.audio_offset + duration * speed,
    (t) => track.start_time + (t - track.audio_offset) / speed,
  );
}

/** Répliques sous forme d'éléments texte : une par scène traversée (une réplique qui enjambe deux
 * scènes est coupée à la frontière), placées à leur instant relatif à la scène. Les répliques
 * hors du projet sont ignorées. */
export function addCuesToProject(project: Project, cues: TimedCue[]): { project: Project; added: number } {
  let next = project;
  let added = 0;
  for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
    for (const composition of project.compositions) {
      const from = Math.max(cue.start, composition.start_time);
      const to = Math.min(cue.end, composition.start_time + composition.duration);
      if (to - from <= 0.05) continue;
      const element = createSubtitleElement();
      if (element.type !== "text") continue;
      const named = {
        ...element,
        name: cue.text.length > 28 ? `${cue.text.slice(0, 27)}…` : cue.text,
        content: cue.text,
        start_time: from - composition.start_time,
        duration: to - from,
      } as Element;
      next = addElementToComposition(next, composition.id, named);
      added += 1;
    }
  }
  return { project: next, added };
}

export const toTimedCues = (cues: SubtitleCue[]): TimedCue[] =>
  cues.map(({ start, end, text }) => ({ start, end, text }));
