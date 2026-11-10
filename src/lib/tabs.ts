// Les onglets de la fenêtre : l'accueil (toujours là), des projets, des fichiers audio.

export interface ProjectMedia {
  kind: "video" | "image";
  /** Chemin relatif au dossier du projet, tel que renvoyé par l'import. */
  src: string;
  name: string;
}

export type Tab =
  | {
      id: string;
      kind: "project";
      dir: string;
      /** Message à afficher à l'ouverture (ex : médias à ré-importer après un import legacy). */
      notice: string | null;
      /** Média à poser dans la première scène à l'ouverture (projet créé depuis une vidéo/image). */
      media: ProjectMedia | null;
    }
  | {
      id: string;
      kind: "audio" | "image";
      /** Fichier ouvert ; `null` = vue vide (zone de dépôt et fichiers récents). */
      path: string | null;
    };

export const HOME = "home";

export interface TabsState {
  tabs: Tab[];
  /** `HOME` ou l'identifiant d'un onglet. */
  active: string;
  /** Ouvre la fenêtre de création de projet dès l'arrivée sur l'accueil. */
  startNewProject: boolean;
}

export const initialTabs: TabsState = { tabs: [], active: HOME, startNewProject: false };

export type TabsAction =
  | { type: "openProject"; dir: string; notice?: string | null; media?: ProjectMedia | null }
  | { type: "openAudio"; path: string | null }
  | { type: "openImage"; path: string | null }
  | { type: "activate"; id: string }
  | { type: "close"; id: string; intent?: "new" }
  | { type: "setTabPath"; id: string; path: string }
  | { type: "clearNewProject" };

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
function openFileTab(state: TabsState, kind: "audio" | "image", path: string | null): TabsState {
  const existing = state.tabs.find((t) => t.kind === kind && t.path === path);
  if (existing) return { ...state, active: existing.id };
  const shown = state.tabs.find((t) => t.id === state.active);
  if (path !== null && shown && shown.kind === kind && shown.path === null) {
    return { ...state, tabs: state.tabs.map((t) => (t === shown ? { ...shown, path } : t)) };
  }
  const tab: Tab = { id: newId(kind), kind, path };
  return { ...state, tabs: [...state.tabs, tab], active: tab.id };
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "openProject": {
      // Un projet déjà ouvert est simplement remis au premier plan.
      const existing = state.tabs.find((t) => t.kind === "project" && t.dir === action.dir);
      if (existing) return { ...state, active: existing.id, startNewProject: false };
      const tab: Tab = {
        id: newId("project"),
        kind: "project",
        dir: action.dir,
        notice: action.notice ?? null,
        media: action.media ?? null,
      };
      return { tabs: [...state.tabs, tab], active: tab.id, startNewProject: false };
    }
    case "openAudio":
      return openFileTab(state, "audio", action.path);
    case "openImage":
      return openFileTab(state, "image", action.path);
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
        tabs: state.tabs.map((t) => (t.id === action.id && t.kind !== "project" ? { ...t, path: action.path } : t)),
      };
    case "clearNewProject":
      return state.startNewProject ? { ...state, startNewProject: false } : state;
  }
}
