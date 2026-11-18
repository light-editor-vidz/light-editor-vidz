import { useEffect, useRef } from "react";
import type { AudioTrack } from "../../bindings/AudioTrack";
import type { Project } from "../../bindings/Project";
import { useMediaSource } from "../../lib/useMediaSource";
import { audioFadeGain, audioSourceTime, isAudioTrackActive, isTrackAudible } from "../../lib/audio";
import { syncMedia } from "../../lib/mediaSync";
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
  // Seuls l'état « actif » et le volume (qui ne varie que pendant un fondu) font re-rendre la piste :
  // la position, elle, change à chaque image et est suivie hors de React (abonnement ci-dessous).
  const active = useClockValue(clock, (t) => isAudioTrackActive(track.start_time, track.duration, t));
  const gain = useClockValue(clock, (t) => (audible ? audioFadeGain(track, t, projectDuration) : 0));
  const volume = Math.min(1, Math.max(0, track.volume)) * gain;

  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);

  // Vitesse : la hauteur du son est conservée, comme le filtre `atempo` de l'export.
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.playbackRate = track.speed;
    audio.preservesPitch = true;
  }, [track.speed, mediaSrc]);

  // Lecture / pause : seulement quand l'état change (pas à chaque image).
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    if (active && playing) audio.play().catch(() => {});
    else audio.pause();
  }, [active, playing, mediaSrc]);

  // Position : recalée sur l'horloge à chaque changement de celle-ci, sans re-rendu (voir
  // `syncMedia` : saut, ajustement de vitesse ou rien).
  useEffect(() => {
    if (!active) return;
    const sync = () => {
      const audio = ref.current;
      if (!audio) return;
      // `track.start_time` est absolu sur la timeline globale (pistes non rattachées aux scènes).
      syncMedia(audio, audioSourceTime(track, clock.get()), playing, track.speed);
    };
    sync();
    return clock.subscribe(sync);
  }, [active, playing, clock, track, mediaSrc]);

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
