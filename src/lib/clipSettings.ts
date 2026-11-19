// Les réglages d'un clip que l'onglet d'édition de son média reprend à l'ouverture, et ce qu'il
// faut remettre à zéro sur le clip une fois ces réglages « cuits » dans la nouvelle version.

import type { AudioFilter } from "../bindings/AudioFilter";
import type { AudioTrack } from "../bindings/AudioTrack";
import type { Element } from "../bindings/Element";
import type { VideoCrop } from "../bindings/VideoCrop";
import { SPEEDS, type AudioSettings } from "./audiotool/settings";
import type { Cut } from "./audiotool/cuts";

type VideoElement = Extract<Element, { type: "video" }>;

export type ClipSettings =
  | {
      kind: "video";
      /** Point d'entrée dans le fichier, en secondes. */
      offset: number;
      /** Durée de source jouée (secondes de fichier), ou `null` : jusqu'à la fin. */
      length: number | null;
      speed: number;
      muted: boolean;
      crop: VideoCrop | null;
      filter: string | null;
    }
  | {
      kind: "audio";
      offset: number;
      length: number | null;
      speed: number;
      fadeIn: number;
      fadeOut: number;
      fadeCurve: AudioTrack["fade_curve"];
      filter: AudioFilter | null;
    };

/** Les réglages d'un clip vidéo. `timelineDuration` : sa durée sur la timeline (résolue). */
export function videoClipSettings(el: VideoElement, timelineDuration: number): ClipSettings {
  return {
    kind: "video",
    offset: el.video_offset,
    length: Math.max(0.1, timelineDuration) * el.playback_speed,
    speed: el.playback_speed,
    muted: el.muted,
    crop: el.crop ?? null,
    filter: el.color_filter ?? null,
  };
}

export function audioClipSettings(track: AudioTrack): ClipSettings {
  return {
    kind: "audio",
    offset: track.audio_offset,
    length: track.duration === null ? null : track.duration * track.speed,
    speed: track.speed,
    fadeIn: track.fade_in,
    fadeOut: track.fade_out,
    fadeCurve: track.fade_curve,
    filter: track.filter ?? null,
  };
}

const EPS = 0.01;

/** Le rognage d'un clip en coupes : tout ce qui est avant son entrée et après sa sortie. */
export function trimToCuts(offset: number, length: number | null, duration: number): Cut[] {
  const cuts: Cut[] = [];
  const start = Math.min(Math.max(0, offset), duration);
  if (start > EPS) cuts.push({ id: "clip-head", start: 0, end: start });
  if (length !== null) {
    const end = Math.min(duration, start + length);
    if (end < duration - EPS) cuts.push({ id: "clip-tail", start: end, end: duration });
  }
  return cuts;
}

/** Ce que la vue Vidéo reprend d'un clip (le recadrage passe de fractions à pixels). */
export function videoEditableFromClip(
  clip: Extract<ClipSettings, { kind: "video" }>,
  duration: number,
  size: { w: number; h: number } | null,
) {
  const crop =
    clip.crop && size
      ? {
          x: Math.round(clip.crop.x * size.w),
          y: Math.round(clip.crop.y * size.h),
          w: Math.round(clip.crop.w * size.w),
          h: Math.round(clip.crop.h * size.h),
        }
      : null;
  return {
    cutSegments: trimToCuts(clip.offset, clip.length, duration),
    speed: clip.speed,
    muted: clip.muted,
    crop,
    filter: clip.filter ?? "none",
  };
}

const FILTER_KIND: Record<NonNullable<AudioTrack["filter"]>["kind"], AudioSettings["filterType"]> = {
  "low-pass": "lowpass",
  "high-pass": "highpass",
  "band-pass": "bandpass",
};

/** Les réglages de la vue Audio qui reprennent ceux d'une piste. */
export function audioSettingsFromClip(
  clip: Extract<ClipSettings, { kind: "audio" }>,
  duration: number,
  base: AudioSettings,
): AudioSettings {
  let step = 0;
  SPEEDS.forEach((s, i) => {
    if (Math.abs(s - clip.speed) < Math.abs(SPEEDS[step] - clip.speed)) step = i;
  });
  return {
    ...base,
    cuts: trimToCuts(clip.offset, clip.length, duration),
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    fadeCurve: clip.fadeCurve === "equal-power" ? "equal-power" : "linear",
    speedStep: step,
    ...(clip.filter
      ? {
          filterType: FILTER_KIND[clip.filter.kind],
          filterFreq: clip.filter.frequency,
          filterSlope: clip.filter.slope,
          filterQ: clip.filter.q,
        }
      : {}),
  };
}

/** Une fois ces réglages cuits dans la nouvelle version du média, le clip repart de zéro : sinon
 * le rognage, la vitesse, le recadrage, le filtre et les fondus s'appliqueraient deux fois. */
export function neutralizeBaked<T extends Element | AudioTrack>(clip: T): T {
  if ("audio_offset" in clip) {
    return { ...clip, audio_offset: 0, fade_in: 0, fade_out: 0, speed: 1, filter: null };
  }
  if (clip.type === "video") {
    return { ...clip, video_offset: 0, playback_speed: 1, crop: null, color_filter: null };
  }
  return clip;
}
