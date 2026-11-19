import { useSyncExternalStore } from "react";

// Les durées des médias, connues dès qu'un lecteur en a lu les métadonnées : la timeline s'en sert
// pour signaler un clip qui réclame plus que ce que son média contient.

let durations: ReadonlyMap<string, number> = new Map();
const listeners = new Set<() => void>();
const keyOf = (projectDir: string, src: string) => `${projectDir}\n${src}`;

export function reportMediaDuration(projectDir: string, src: string, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return;
  const key = keyOf(projectDir, src);
  if (durations.get(key) === duration) return;
  durations = new Map(durations).set(key, duration);
  listeners.forEach((notify) => notify());
}

/** La durée connue d'un média du projet (`undefined` tant qu'aucun lecteur ne l'a lue). */
export function useMediaDuration(projectDir: string): (src: string) => number | undefined {
  const snapshot = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => void listeners.delete(notify);
    },
    () => durations,
  );
  return (src) => snapshot.get(keyOf(projectDir, src));
}

/** Le clip joue-t-il plus de source que le média n'en contient ? (tolérance : une image) */
export function exceedsMedia(
  offset: number,
  timelineDuration: number,
  speed: number,
  mediaDuration: number | undefined,
): boolean {
  return mediaDuration !== undefined && offset + timelineDuration * speed > mediaDuration + 0.05;
}
