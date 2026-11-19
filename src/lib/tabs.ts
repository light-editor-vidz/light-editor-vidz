import type { ClipSettings } from "./clipSettings";

// Les onglets de la fenêtre : l'accueil (toujours là), des projets, des fichiers audio.

/** D'où vient un onglet de média : le projet et le média (`src`, relatif) qu'il édite. */
export interface MediaOrigin {
  projectDir: string;
  src: string;
  /** Le clip depuis lequel l'édition a été demandée ; absent depuis la médiathèque. */
  elementId?: string;
  /** Les réglages du clip, que l'onglet reprend à l'ouverture. */
  clip?: ClipSettings;
}

export type Tab =
  | {
      id: string;
      kind: "project";
      dir: string;
      /** Message à afficher à l'ouverture (ex : médias à ré-importer après un import legacy). */
      notice: string | null;
    }
  | {
      id: string;
      kind: "audio" | "image" | "video";
      /** Fichier ouvert ; `null` = vue vide (zone de dépôt et fichiers récents). */
      path: string | null;
      /** Renseigné quand l'onglet édite un média d'un projet. */
      origin?: MediaOrigin;
    };

export const HOME = "home";

/** Le même chemin écrit autrement (séparateurs, `/` final, `./`) : un projet n'a pas deux onglets,
 * donc pas deux sauvegardes automatiques qui s'écrasent. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) =>
    p
      .replace(/\\/g, "/")
      .replace(/\/(\.\/)+/g, "/")
      .replace(/\/{2,}/g, "/")
      .replace(/\/$/, "");
  return norm(a) === norm(b);
}

export interface TabsState {
  tabs: Tab[];
  /** `HOME` ou l'identifiant d'un onglet. */
  active: string;
  /** Ouvre la fenêtre de création de projet dès l'arrivée sur l'accueil. */
  startNewProject: boolean;
}

export const initialTabs: TabsState = { tabs: [], active: HOME, startNewProject: false };

export type TabsAction =
  | { type: "openProject"; dir: string; notice?: string | null }
  | { type: "openAudio"; path: string | null; origin?: MediaOrigin }
  | { type: "openImage"; path: string | null; origin?: MediaOrigin }
  | { type: "openVideo"; path: string | null; origin?: MediaOrigin }
  | { type: "activate"; id: string }
  | { type: "close"; id: string; intent?: "new" }
  | { type: "setTabPath"; id: string; path: string }
  | { type: "clearNewProject" }
  /** « Nouveau projet » : l'accueil et sa fenêtre de création, sans fermer l'onglet affiché. */
  | { type: "newProject" };

let counter = 0;
const newId = (kind: Tab["kind"]) => `${kind}-${++counter}`;

/** L'onglet voisin de celui qui se ferme : celui de droite, sinon celui de gauche, sinon l'accueil. */
function neighbour(tabs: Tab[], closing: string): string {
  const index = tabs.findIndex((t) => t.id === closing);
  const next = tabs[index + 1] ?? tabs[index - 1];
  return next ? next.id : HOME;
}

/** Ouvre un fichier dans un onglet de ce type : un onglet qui l'a déjà est remis au premier plan,
 * un onglet vide affiché est rempli, sinon un nouvel onglet est créé. La vue vide n'existe
 * qu'une fois. */
function openFileTab(
  state: TabsState,
  kind: "audio" | "image" | "video",
  path: string | null,
  origin?: MediaOrigin,
): TabsState {
  const existing = state.tabs.find((t) => t.kind === kind && t.path === path);
  if (existing) {
    // Le même fichier rouvert depuis un projet reprend son origine (le clip demandé).
    const tabs = origin
      ? state.tabs.map((t) => (t === existing && t.kind !== "project" ? { ...t, origin } : t))
      : state.tabs;
    return { ...state, tabs, active: existing.id };
  }
  const shown = state.tabs.find((t) => t.id === state.active);
  if (path !== null && shown && shown.kind === kind && shown.path === null) {
    return { ...state, tabs: state.tabs.map((t) => (t === shown ? { ...shown, path } : t)) };
  }
  const tab: Tab = { id: newId(kind), kind, path, ...(origin ? { origin } : {}) };
  return { ...state, tabs: [...state.tabs, tab], active: tab.id };
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "openProject": {
      // Un projet déjà ouvert est simplement remis au premier plan.
      const existing = state.tabs.find((t) => t.kind === "project" && samePath(t.dir, action.dir));
      if (existing) return { ...state, active: existing.id, startNewProject: false };
      const tab: Tab = {
        id: newId("project"),
        kind: "project",
        dir: action.dir,
        notice: action.notice ?? null,
      };
      return { tabs: [...state.tabs, tab], active: tab.id, startNewProject: false };
    }
    case "openAudio":
      return openFileTab(state, "audio", action.path, action.origin);
    case "openImage":
      return openFileTab(state, "image", action.path, action.origin);
    case "openVideo":
      return openFileTab(state, "video", action.path, action.origin);
    case "activate":
      return state.active === action.id || (action.id !== HOME && !state.tabs.some((t) => t.id === action.id))
        ? state
        : { ...state, active: action.id };
    case "close": {
      if (!state.tabs.some((t) => t.id === action.id)) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      // Fermer l'onglet affiché passe à son voisin ; « nouveau projet » ramène à l'accueil.
      const active =
        action.intent === "new" ? HOME : state.active === action.id ? neighbour(state.tabs, action.id) : state.active;
      return { tabs, active, startNewProject: action.intent === "new" };
    }
    case "setTabPath":
      return {
        ...state,
        tabs: state.tabs.map((t) => {
          if (t.id !== action.id || t.kind === "project") return t;
          // Un autre fichier ouvert dans l'onglet n'est plus le média du projet.
          return { id: t.id, kind: t.kind, path: action.path };
        }),
      };
    case "newProject":
      return { ...state, active: HOME, startNewProject: true };
    case "clearNewProject":
      return state.startNewProject ? { ...state, startNewProject: false } : state;
  }
}
