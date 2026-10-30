import { useEffect, useRef } from "react";
import type { AudioTrack } from "../../bindings/AudioTrack";
import type { Project } from "../../bindings/Project";
import { useMediaSource } from "../../lib/useMediaSource";
import { audioFadeGain, isAudioTrackActive, isTrackAudible } from "../../lib/audio";
import { useClockValue, type PlaybackClock } from "../../lib/playbackClock";

interface TrackProps {
  track: AudioTrack;
  projectDir: string;
  projectDuration: number;
  clock: PlaybackClock;
  playing: boolean;
  audible: boolean;
}

function SingleAudio({ track, projectDir, projectDuration, clock, playing, audible }: TrackProps) {
  const ref = useRef<HTMLAudioElement>(null);
  const { src: mediaSrc, usingBlob, fallBack } = useMediaSource(projectDir, track.src);
  const currentTime = useClockValue(clock, (t) => t);
  const active = isAudioTrackActive(track.start_time, track.duration, currentTime);
  // Fondus d'entrée/sortie : le volume suit la position dans la piste (comme à l'export).
  const gain = audible ? audioFadeGain(track, currentTime, projectDuration) : 0;
  const volume = Math.min(1, Math.max(0, track.volume)) * gain;

  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);

  // Lecture / pause : seulement quand l'état change (pas à chaque image).
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    if (active && playing) audio.play().catch(() => {});
    else audio.pause();
  }, [active, playing, mediaSrc]);

  // Position : recalée seulement si la dérive dépasse 0,25 s.
  useEffect(() => {
    const audio = ref.current;
    if (!audio || !active) return;
    // `track.start_time` est absolu sur la timeline globale (pistes non rattachées aux scènes).
    const targetTime = currentTime - track.start_time + track.audio_offset;
    if (Math.abs(audio.currentTime - targetTime) > 0.25) {
      audio.currentTime = Math.max(0, targetTime);
    }
  }, [active, currentTime, track.start_time, track.audio_offset, mediaSrc]);

  return <audio ref={ref} src={mediaSrc ?? undefined} preload="auto" onError={() => !usingBlob && fallBack()} />;
}

/** Lecture des pistes audio globales du projet, synchronisée sur l'horloge de l'éditeur
 * (invisible). */
export default function AudioPlayer({
  project,
  projectDir,
  clock,
  playing,
}: {
  project: Project;
  projectDir: string;
  clock: PlaybackClock;
  playing: boolean;
}) {
  return (
    <>
      {project.audio_tracks.map((track) => (
        <SingleAudio
          key={track.id}
          track={track}
          projectDir={projectDir}
          projectDuration={project.duration}
          clock={clock}
          playing={playing}
          audible={isTrackAudible(track, project.audio_tracks)}
        />
      ))}
    </>
  );
}
