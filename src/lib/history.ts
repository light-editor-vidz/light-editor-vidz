import type { Project } from "../bindings/Project";

/** Fenêtre (ms) pendant laquelle deux mutations portant la même clé fusionnent en une seule
 * entrée d'historique. Assez long pour couvrir un drag ou une frappe continue, assez court pour
 * que deux gestes distincts restent deux entrées d'annulation. */
export const COALESCE_WINDOW_MS = 1000;

/** Nombre maximal d'états conservés pour l'annulation. */
export const HISTORY_LIMIT = 50;

export interface LastMutation {
  key: string | null;
  time: number;
}

/**
 * Décide si une mutation doit fusionner avec la précédente dans l'historique d'annulation,
 * plutôt que de créer une nouvelle entrée. Sans coalescence, un drag d'élément (une mutation
 * par `pointermove`) ou la frappe dans un champ texte crée des dizaines d'entrées : annuler
 * reviendrait alors pixel par pixel / caractère par caractère.
 */
export function shouldCoalesce(last: LastMutation, key: string | undefined, now: number): boolean {
  return key !== undefined && last.key === key && now - last.time < COALESCE_WINDOW_MS;
}

/** État du projet édité avec son historique d'annulation. */
export interface HistoryState {
  present: Project | null;
  /** Dernière version écrite sur le disque (comparaison par référence) : `present !== saved`
   * = modifications non enregistrées. */
  saved: Project | null;
  past: Project[];
  future: Project[];
  last: LastMutation;
}

export const initialHistory: HistoryState = {
  present: null,
  saved: null,
  past: [],
  future: [],
  last: { key: null, time: 0 },
};

export type HistoryAction =
  /** Charge un projet (historique remis à zéro). `saved` = version du disque, `null` si le projet
   * chargé a été réparé et doit donc être enregistré. */
  | { type: "load"; project: Project; saved: Project | null }
  /** `fn` doit être pure : React peut appeler un réducteur plusieurs fois. `now` est fourni par
   * l'appelant (le réducteur ne lit pas l'horloge). */
  | { type: "mutate"; fn: (project: Project) => Project; key?: string; now: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "saved"; project: Project };

const NO_MUTATION: LastMutation = { key: null, time: 0 };

/** Réducteur pur de l'historique (aucun effet de bord, contrairement à des mises à jour d'état
 * imbriquées qui ne résistent pas à l'exécution double de React en mode strict). */
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "load":
      return { ...initialHistory, present: action.project, saved: action.saved };
    case "mutate": {
      if (!state.present) return state;
      const next = action.fn(state.present);
      if (next === state.present) return state;
      const last = { key: action.key ?? null, time: action.now };
      if (shouldCoalesce(state.last, action.key, action.now)) {
        return { ...state, present: next, last };
      }
      return {
        ...state,
        present: next,
        past: [...state.past.slice(-(HISTORY_LIMIT - 1)), state.present],
        future: [],
        last,
      };
    }
    case "undo": {
      if (state.past.length === 0 || !state.present) return state;
      return {
        ...state,
        present: state.past[state.past.length - 1],
        past: state.past.slice(0, -1),
        future: [state.present, ...state.future],
        // Une modification qui suit une annulation ne fusionne jamais avec une entrée antérieure.
        last: NO_MUTATION,
      };
    }
    case "redo": {
      if (state.future.length === 0 || !state.present) return state;
      const [next, ...rest] = state.future;
      return { ...state, present: next, past: [...state.past, state.present], future: rest, last: NO_MUTATION };
    }
    case "saved":
      return { ...state, saved: action.project };
  }
}
