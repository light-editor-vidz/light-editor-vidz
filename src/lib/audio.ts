import type { Project } from "../bindings/Project";
import type { AudioTrack } from "../bindings/AudioTrack";
import type { AudioFilter } from "../bindings/AudioFilter";
import type { AudioFilterKind } from "../bindings/AudioFilterKind";
import type { FadeCurve } from "../bindings/FadeCurve";
import i18n from "i18next";

/**
 * Les pistes audio sont globales au projet : contrairement aux éléments, elles ne sont pas
 * rattachées à une scène — `start_time` est absolu sur la timeline et une piste peut couvrir
 * plusieurs scènes ou toute la vidéo (`duration: null` = jusqu'à la fin du projet).
 */

export function createAudioTrack(relativeSrc: string, name: string, startTime = 0): AudioTrack {
  return {
    id: crypto.randomUUID(),
    name,
    src: relativeSrc,
    start_time: startTime,
    duration: null,
    volume: 1,
    audio_offset: 0,
    fade_in: 0,
    fade_out: 0,
    muted: false,
    solo: false,
    speed: 1,
    fade_curve: "linear",
    filter: null,
    subtitles: null,
  };
}

/** Plage de vitesse acceptée pour une piste. */
export const AUDIO_SPEED_MIN = 0.25;
export const AUDIO_SPEED_MAX = 4;

/** Filtre proposé quand on en active un : réglages neutres et audibles (12 dB/oct, Q de Butterworth). */
export function defaultAudioFilter(kind: AudioFilterKind): AudioFilter {
  const frequency = kind === "low-pass" ? 4000 : kind === "high-pass" ? 200 : 1000;
  return { kind, frequency, slope: 12, q: 0.707 };
}

/** Position (secondes) dans le fichier source à l'instant global `globalTime` : la vitesse
 * accélère la consommation de la source, `audio_offset` est le point d'entrée. */
export function audioSourceTime(track: AudioTrack, globalTime: number): number {
  return (globalTime - track.start_time) * track.speed + track.audio_offset;
}

export function addAudioTrackToProject(project: Project, track: AudioTrack): Project {
  return { ...project, audio_tracks: [...project.audio_tracks, track] };
}

export function updateAudioTrackInProject(project: Project, trackId: string, patch: Partial<AudioTrack>): Project {
  return {
    ...project,
    audio_tracks: project.audio_tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
  };
}

export function removeAudioTrackFromProject(project: Project, trackId: string): Project {
  return { ...project, audio_tracks: project.audio_tracks.filter((t) => t.id !== trackId) };
}

export function duplicateAudioTrackInProject(
  project: Project,
  trackId: string,
): { project: Project; newId: string | null } {
  const idx = project.audio_tracks.findIndex((t) => t.id === trackId);
  if (idx === -1) return { project, newId: null };
  const copy = {
    ...project.audio_tracks[idx],
    id: crypto.randomUUID(),
    name: i18n.t("defaults.copyOf", { name: project.audio_tracks[idx].name }),
  };
  const audio_tracks = [...project.audio_tracks];
  audio_tracks.splice(idx + 1, 0, copy);
  return { project: { ...project, audio_tracks }, newId: copy.id };
}

export function findAudioTrack(project: Project, trackId: string | null): AudioTrack | null {
  if (!trackId) return null;
  return project.audio_tracks.find((t) => t.id === trackId) ?? null;
}

export function isAudioTrackActive(startTime: number, duration: number | null, globalTime: number): boolean {
  if (globalTime < startTime) return false;
  if (duration === null) return true;
  return globalTime < startTime + duration;
}

/**
 * Audibilité effective d'une piste : mute individuel toujours prioritaire ; si au moins une
 * piste du projet est en solo, seules les pistes solo (et non mute) sont audibles.
 */
export function isTrackAudible(track: AudioTrack, allTracks: AudioTrack[]): boolean {
  if (track.muted) return false;
  const anySolo = allTracks.some((t) => t.solo);
  return anySolo ? track.solo : true;
}

/** Gain d'un fondu à la fraction `x` (0..1) de sa durée : linéaire, ou quart de sinus
 * (« equal-power »), comme le filtre `afade` de l'export. */
export function fadeGain(curve: FadeCurve, x: number): number {
  const clamped = Math.min(1, Math.max(0, x));
  return curve === "equal-power" ? Math.sin((clamped * Math.PI) / 2) : clamped;
}

/**
 * Gain (0..1) dû aux fondus d'entrée/sortie d'une piste à l'instant global `globalTime`, selon la
 * courbe de la piste. Deux fondus qui se chevauchent se multiplient, comme les deux `afade` en
 * série de l'export. `duration` null = jusqu'à la fin du projet.
 */
export function audioFadeGain(track: AudioTrack, globalTime: number, projectDuration: number): number {
  const duration = track.duration ?? projectDuration - track.start_time;
  const local = globalTime - track.start_time;
  let gain = 1;
  if (track.fade_in > 0 && local < track.fade_in) gain *= fadeGain(track.fade_curve, local / track.fade_in);
  const remaining = duration - local;
  if (track.fade_out > 0 && remaining < track.fade_out) gain *= fadeGain(track.fade_curve, remaining / track.fade_out);
  return Math.min(1, Math.max(0, gain));
}
