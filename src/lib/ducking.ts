/** Baisse d'une musique sous la voix, dans l'aperçu : mêmes réglages que l'export
 * (`scene_core::ducking`), appliqués aux passages voisés mesurés par `project_voice_ranges`. */

import type { Project } from "../bindings/Project";

export const DUCK_ATTACK = 0.02;
export const DUCK_RELEASE = 0.4;

/** Les baisses proposées (dB) ; 0 = la piste ne baisse jamais. */
export const DUCK_AMOUNTS = [0, 6, 12, 18] as const;

export interface VoiceRange {
  start: number;
  end: number;
}

/** Gain (0..1) d'une piste réglée pour baisser de `db` décibels, à l'instant `time`. */
export function duckGain(ranges: VoiceRange[], time: number, db: number): number {
  if (!(db > 0)) return 1;
  // Part de la baisse en cours : 1 pendant la voix, puis la rampe de retour.
  let share = 0;
  for (const { start, end } of ranges) {
    if (time < start) continue;
    const entering = Math.min(1, (time - start) / DUCK_ATTACK);
    const leaving = time <= end ? 1 : Math.max(0, 1 - (time - end) / DUCK_RELEASE);
    share = Math.max(share, Math.min(entering, leaving));
  }
  return 1 - share * (1 - 10 ** (-db / 20));
}

/** Ce dont dépend la voix : l'analyse n'est refaite que quand cela change (déplacer un titre ne
 * la relance pas). `null` si aucune piste n'est réglée pour baisser. */
export function voiceSignature(project: Project): string | null {
  if (!project.audio_tracks.some((track) => track.duck_db > 0)) return null;
  const tracks = project.audio_tracks.map((track) => ({ ...track, name: "", subtitles: null }));
  const videos = project.compositions.flatMap((scene) =>
    scene.elements.flatMap((el) =>
      el.type === "video"
        ? [
            [
              el.src,
              scene.start_time + el.start_time,
              el.duration ?? scene.duration - el.start_time,
              el.muted,
              el.volume,
              el.video_offset,
              el.playback_speed,
              el.loop_video,
            ],
          ]
        : [],
    ),
  );
  return JSON.stringify([project.duration, tracks, videos]);
}
