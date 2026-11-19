import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { emit, listen } from "@tauri-apps/api/event";
import { approveProjectAsset, importAsset } from "./lib/commands";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import Home from "./components/Home";
import Editor from "./components/Editor";

import TabBar from "./components/TabBar";
import { installCloseGuard } from "./lib/closeGuard";
import { describeError } from "./lib/errors";
import { TabActiveProvider, useRegisterMenuActions } from "./lib/menuBridge";
import { mediaKind, pickMediaFile, takePendingFiles, type PickedFile } from "./lib/openMedia";
import { HOME, initialTabs, tabsReducer, type MediaOrigin, type TabsAction } from "./lib/tabs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

// Les trois outils sont chargés à la demande : le premier écran (l'accueil, un projet) n'embarque
// pas leur code (éditeurs d'image, d'audio et de vidéo).
const AudioTool = lazy(() => import("./components/audiotool/AudioTool"));
const ImageTool = lazy(() => import("./components/imagetool/ImageTool"));
const VideoTool = lazy(() => import("./components/videotool/VideoTool"));

function TabPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className="tab-panel" hidden={!active}>
      <TabActiveProvider value={active}>
        <Suspense fallback={null}>{children}</Suspense>
      </TabActiveProvider>
    </div>
  );
}

/** Actions du menu Fichier pour un onglet qui n'est ni l'accueil ni un projet. */
function ToolTabMenuActions({
  dispatch,
  onError,
}: {
  dispatch: React.Dispatch<TabsAction>;
  onError: (message: string) => void;
}) {
  useRegisterMenuActions({
    newProject: () => dispatch({ type: "newProject" }),
    openProject: () => {
      void openDialog({ directory: true, multiple: false })
        .then((dir) => {
          if (dir && !Array.isArray(dir)) dispatch({ type: "openProject", dir });
        })
        .catch((e) => onError(describeError(e)));
    },
    openRecent: (dir: string) => dispatch({ type: "openProject", dir }),
  });
  return null;
}

function App() {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(tabsReducer, initialTabs);
  const [error, setError] = useState<string | null>(null);
  const activeIsTool = state.tabs.some((t) => t.id === state.active && t.kind !== "project");

  // Fermer la fenêtre termine d'abord l'enregistrement des modifications en attente.
  useEffect(() => {
    const installed = installCloseGuard();
    return () => {
      void installed.then((remove) => remove());
    };
  }, []);

  /** Ce qu'un fichier ouvre : un onglet audio, ou un projet neuf contenant la vidéo / l'image. */
  const openPicked = useCallback(
    async ({ path, kind }: PickedFile) => {
      setError(null);
      try {
        if (kind === "audio") {
          dispatch({ type: "openAudio", path });
        } else if (kind === "image") {
          dispatch({ type: "openImage", path });
        } else if (kind === "video") {
          dispatch({ type: "openVideo", path });
        } else {
          setError(t("tabs.unsupportedFile"));
        }
      } catch (e) {
        setError(describeError(e));
      }
    },
    [t],
  );

  /** Ouvre un média d'un projet dans l'onglet d'édition de son type. */
  const editMedia = useCallback(async (kind: "audio" | "image" | "video", origin: MediaOrigin) => {
    setError(null);
    try {
      const path = await approveProjectAsset(origin.projectDir, origin.src);
      dispatch({ type: kind === "audio" ? "openAudio" : kind === "image" ? "openImage" : "openVideo", path, origin });
    } catch (e) {
      setError(describeError(e));
    }
  }, []);

  // L'onglet affiché, lu par les gestionnaires qui ne se réabonnent pas à chaque rendu.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /** Un fichier déposé sur la fenêtre : un dossier de projet s'ouvre ; un média déposé sur un
   * projet s'importe dans sa médiathèque (au lieu d'ouvrir un outil à côté) ; sinon, comme un
   * fichier choisi. */
  const openDropped = useCallback(
    async (path: string) => {
      if (/\.lvproj[\\/]?$/i.test(path)) {
        dispatch({ type: "openProject", dir: path.replace(/[\\/]$/, "") });
        return;
      }
      const kind = await mediaKind(path);
      const shown = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.active);
      if (shown?.kind === "project" && (kind === "audio" || kind === "video" || kind === "image")) {
        try {
          setError(null);
          await importAsset(shown.dir, kind, path);
          await emit("project-assets-changed");
        } catch (e) {
          setError(describeError(e));
        }
        return;
      }
      await openPicked({ path, kind });
    },
    [openPicked],
  );

  // Ce que chaque onglet demande avant de se fermer (images modifiées et non exportées).
  const closeGuards = useRef(new Map<string, () => Promise<boolean>>());
  const closeTab = useCallback(async (id: string, intent?: "new") => {
    const guard = closeGuards.current.get(id);
    if (guard && !(await guard())) return;
    dispatch({ type: "close", id, intent });
  }, []);

  const openFile = useCallback(async () => {
    try {
      const picked = await pickMediaFile();
      if (picked) await openPicked(picked);
    } catch (e) {
      setError(describeError(e));
    }
  }, [openPicked]);

  // « Fichier > Ouvrir un fichier… » est à l'écoute quel que soit l'onglet affiché.
  useRegisterMenuActions({ openFile: () => void openFile() });

  // Un fichier passé au lancement (« Ouvrir avec… ») s'ouvre comme s'il avait été choisi.
  useEffect(() => {
    const openAll = async (paths: string[]) => {
      for (const path of paths) await openPicked({ path, kind: await mediaKind(path) });
    };
    takePendingFiles()
      .then(openAll)
      .catch(() => {});
    const un = listen<string[]>("open-files", (e) => void openAll(e.payload)).catch(() => undefined);
    return () => {
      void un.then((off) => off?.());
    };
  }, [openPicked]);

  // Un fichier déposé sur la fenêtre s'ouvre comme s'il avait été choisi dans le dialogue.
  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    getCurrentWindow()
      .onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        for (const path of event.payload.paths ?? []) await openDropped(path);
      })
      .then((unlisten) => (cancelled ? unlisten() : (off = unlisten)))
      .catch(() => {});
    return () => {
      cancelled = true;
      off?.();
    };
  }, [openDropped]);

  return (
    <div className="app-shell">
      <TabBar
        tabs={state.tabs}
        active={state.active}
        onActivate={(id) => dispatch({ type: "activate", id })}
        onClose={(id) => void closeTab(id)}
      />
      {error && (
        <div className="app-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label={t("common.dismiss")}>
            ×
          </button>
        </div>
      )}
      {/* Les onglets Audio, Image et Vidéo n'ont pas ces actions : le menu Fichier doit tout de même
          pouvoir créer, ouvrir un projet ou rouvrir un récent. */}
      {activeIsTool && <ToolTabMenuActions dispatch={dispatch} onError={setError} />}
      <div className="tab-panels">
        <TabPanel active={state.active === HOME}>
          <Home
            startNewProject={state.startNewProject}
            onNewProjectHandled={() => dispatch({ type: "clearNewProject" })}
            onOpenProject={(dir) => dispatch({ type: "openProject", dir })}
            onOpenTool={(tool) => {
              if (tool === "audio") dispatch({ type: "openAudio", path: null });
              if (tool === "image") dispatch({ type: "openImage", path: null });
              if (tool === "video") dispatch({ type: "openVideo", path: null });
            }}
          />
        </TabPanel>
        {state.tabs.map((tab) => (
          <TabPanel key={tab.id} active={state.active === tab.id}>
            {tab.kind === "project" ? (
              // `key` : un projet par onglet, avec sa propre histoire d'annulation.
              <Editor
                projectDir={tab.dir}
                initialNotice={tab.notice}
                registerCloseGuard={(guard) => {
                  closeGuards.current.set(tab.id, guard);
                  return () => void closeGuards.current.delete(tab.id);
                }}
                onBack={(intent) => dispatch({ type: "close", id: tab.id, intent })}
                onOpenProject={(dir, notice) => dispatch({ type: "openProject", dir, notice })}
                onNewProject={() => dispatch({ type: "newProject" })}
                onEditMedia={(kind, origin) => void editMedia(kind, origin)}
              />
            ) : tab.kind === "video" ? (
              <VideoTool
                path={tab.path}
                origin={tab.origin}
                onOpenFile={() => void openFile()}
                onOpenPath={(path) => dispatch({ type: "setTabPath", id: tab.id, path })}
                onOpenAudio={(path) => dispatch({ type: "openAudio", path })}
                onClose={() => dispatch({ type: "close", id: tab.id })}
                registerCloseGuard={(guard) => {
                  closeGuards.current.set(tab.id, guard);
                  return () => void closeGuards.current.delete(tab.id);
                }}
              />
            ) : tab.kind === "image" ? (
              <ImageTool
                path={tab.path}
                origin={tab.origin}
                onOpenFile={() => void openFile()}
                onOpenPath={(path) => dispatch({ type: "setTabPath", id: tab.id, path })}
                onClose={() => dispatch({ type: "close", id: tab.id })}
                registerCloseGuard={(guard) => {
                  closeGuards.current.set(tab.id, guard);
                  return () => void closeGuards.current.delete(tab.id);
                }}
              />
            ) : (
              <AudioTool
                path={tab.path}
                origin={tab.origin}
                onOpen={(path) => dispatch({ type: "setTabPath", id: tab.id, path })}
                onClose={() => dispatch({ type: "close", id: tab.id })}
                registerCloseGuard={(guard) => {
                  closeGuards.current.set(tab.id, guard);
                  return () => void closeGuards.current.delete(tab.id);
                }}
              />
            )}
          </TabPanel>
        ))}
      </div>
    </div>
  );
}

export default App;
