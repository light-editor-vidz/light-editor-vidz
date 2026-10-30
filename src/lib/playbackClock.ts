import { useSyncExternalStore } from "react";

/**
 * Horloge de lecture de l'éditeur, hors de l'état React : pendant la lecture elle change à
 * chaque image (60 fois par seconde). Stockée dans `useState`, elle re-rendrait tout l'éditeur
 * (timeline, panneaux, bibliothèque…) à chaque image ; ici seuls les composants qui la lisent
 * via `useClockValue` se mettent à jour.
 */
export interface PlaybackClock {
  /** Position courante (secondes sur la timeline globale). */
  get: () => number;
  set: (time: number) => void;
  /** Abonnement aux changements ; retourne la fonction de désabonnement. */
  subscribe: (listener: () => void) => () => void;
}

export function createPlaybackClock(initial = 0): PlaybackClock {
  let time = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => time,
    set: (next) => {
      if (next === time) return;
      time = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Valeur dérivée de l'horloge. Le composant n'est re-rendu que si `select` retourne une valeur
 * différente (comparaison `Object.is`) : retourner une primitive (identifiant de scène, temps
 * local…) et non un nouvel objet à chaque appel.
 */
export function useClockValue<T>(clock: PlaybackClock, select: (time: number) => T): T {
  return useSyncExternalStore(clock.subscribe, () => select(clock.get()));
}
