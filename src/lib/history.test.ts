import { describe, expect, it } from "vitest";
import type { Project } from "../bindings/Project";
import {
  COALESCE_WINDOW_MS,
  HISTORY_LIMIT,
  historyReducer,
  initialHistory,
  shouldCoalesce,
  type HistoryState,
} from "./history";

describe("shouldCoalesce", () => {
  it("fusionne deux mutations rapprochées portant la même clé", () => {
    expect(shouldCoalesce({ key: "el:1:x,y", time: 1000 }, "el:1:x,y", 1200)).toBe(true);
  });

  it("ne fusionne pas quand la clé diffère", () => {
    expect(shouldCoalesce({ key: "el:1:x,y", time: 1000 }, "el:2:x,y", 1200)).toBe(false);
    expect(shouldCoalesce({ key: "el:1:x,y", time: 1000 }, "el:1:volume", 1200)).toBe(false);
  });

  it("ne fusionne pas une mutation sans clé (action discrète)", () => {
    expect(shouldCoalesce({ key: "el:1:x,y", time: 1000 }, undefined, 1200)).toBe(false);
    // Une action discrète ne doit pas non plus servir de base de fusion à la suivante.
    expect(shouldCoalesce({ key: null, time: 1000 }, undefined, 1200)).toBe(false);
  });

  it("ne fusionne plus au-delà de la fenêtre temporelle", () => {
    expect(shouldCoalesce({ key: "a", time: 1000 }, "a", 1000 + COALESCE_WINDOW_MS + 1)).toBe(false);
  });
});

const project = (name: string): Project => ({
  name,
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 5,
  compositions: [],
  audio_tracks: [],
});

const rename =
  (name: string) =>
  (p: Project): Project => ({ ...p, name });

function loaded(name = "A"): HistoryState {
  const p = project(name);
  return historyReducer(initialHistory, { type: "load", project: p, saved: p });
}

describe("historyReducer", () => {
  it("charge un projet avec un historique vide", () => {
    const state = loaded();
    expect(state.present?.name).toBe("A");
    expect(state.saved).toBe(state.present);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
  });

  it("recharger un autre projet oublie l'historique du précédent", () => {
    let state = loaded("A");
    state = historyReducer(state, { type: "mutate", fn: rename("A2"), now: 0 });
    state = historyReducer(state, { type: "load", project: project("B"), saved: null });
    expect(state.past).toEqual([]);
    expect(state.saved).toBeNull();
    // Annuler n'a plus rien à restaurer : l'ancien projet ne peut pas écraser le nouveau.
    expect(historyReducer(state, { type: "undo" }).present?.name).toBe("B");
  });

  it("une mutation empile l'état précédent et vide le futur", () => {
    let state = loaded("A");
    state = historyReducer(state, { type: "mutate", fn: rename("B"), now: 0 });
    state = historyReducer(state, { type: "undo" });
    expect(state.future).toHaveLength(1);
    state = historyReducer(state, { type: "mutate", fn: rename("C"), now: 5000 });
    expect(state.future).toEqual([]);
    expect(state.past.map((p) => p.name)).toEqual(["A"]);
  });

  it("ignore une mutation qui ne change rien", () => {
    const state = loaded();
    expect(historyReducer(state, { type: "mutate", fn: (p) => p, now: 0 })).toBe(state);
    expect(state.past).toEqual([]);
  });

  it("fusionne les mutations rapprochées de même clé en une seule entrée", () => {
    let state = loaded("A");
    state = historyReducer(state, { type: "mutate", fn: rename("B"), key: "k", now: 100 });
    state = historyReducer(state, { type: "mutate", fn: rename("C"), key: "k", now: 200 });
    expect(state.past.map((p) => p.name)).toEqual(["A"]);
    expect(state.present?.name).toBe("C");
  });

  it("est pur : l'appliquer deux fois (mode strict) donne le même résultat", () => {
    const state = loaded("A");
    const action = { type: "mutate" as const, fn: rename("B"), key: "k", now: 100 };
    const once = historyReducer(state, action);
    const twice = historyReducer(state, action);
    expect(twice.past).toEqual(once.past);
    expect(twice.present).toEqual(once.present);
    expect(twice.past).toHaveLength(1);
  });

  it("annule puis rétablit", () => {
    let state = loaded("A");
    state = historyReducer(state, { type: "mutate", fn: rename("B"), now: 0 });
    state = historyReducer(state, { type: "undo" });
    expect(state.present?.name).toBe("A");
    state = historyReducer(state, { type: "redo" });
    expect(state.present?.name).toBe("B");
    expect(state.future).toEqual([]);
  });

  it("annuler ou rétablir sans historique ne change rien", () => {
    const state = loaded();
    expect(historyReducer(state, { type: "undo" })).toBe(state);
    expect(historyReducer(state, { type: "redo" })).toBe(state);
  });

  it("une modification juste après une annulation ne fusionne pas avec une entrée antérieure", () => {
    let state = loaded("A");
    state = historyReducer(state, { type: "mutate", fn: rename("B"), key: "k", now: 100 });
    state = historyReducer(state, { type: "undo" });
    state = historyReducer(state, { type: "mutate", fn: rename("C"), key: "k", now: 150 });
    expect(state.past.map((p) => p.name)).toEqual(["A"]);
  });

  it("borne l'historique à HISTORY_LIMIT entrées", () => {
    let state = loaded("0");
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) {
      state = historyReducer(state, { type: "mutate", fn: rename(String(i)), now: i * 10_000 });
    }
    expect(state.past).toHaveLength(HISTORY_LIMIT);
    expect(state.past[0].name).toBe("10");
  });

  it("enregistre la version écrite sans toucher à l'historique", () => {
    let state = loaded("A");
    state = historyReducer(state, { type: "mutate", fn: rename("B"), now: 0 });
    const written = state.present as Project;
    state = historyReducer(state, { type: "saved", project: written });
    expect(state.saved).toBe(written);
    expect(state.past).toHaveLength(1);
  });

  it("ignore les mutations tant qu'aucun projet n'est chargé", () => {
    expect(historyReducer(initialHistory, { type: "mutate", fn: rename("X"), now: 0 })).toBe(initialHistory);
  });
});
