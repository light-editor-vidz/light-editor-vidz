import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import Home from "./components/Home";
import Editor from "./components/Editor";
import AudioTool from "./components/audiotool/AudioTool";
import ImageTool from "./components/imagetool/ImageTool";
import VideoTool from "./components/videotool/VideoTool";
import TabBar from "./components/TabBar";
import { installCloseGuard } from "./lib/closeGuard";
import { describeError } from "./lib/errors";
import { TabActiveProvider, useRegisterMenuActions } from "./lib/menuBridge";
import { mediaKind, pickMediaFile, takePendingFiles, type PickedFile } from "./lib/openMedia";
import { HOME, initialTabs, tabsReducer } from "./lib/tabs";

function TabPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className="tab-panel" hidden={!active}>
      <TabActiveProvider value={active}>{children}</TabActiveProvider>
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(tabsReducer, initialTabs);
  const [error, setError] = useState<string | null>(null);

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
        for (const path of event.payload.paths ?? []) {
          await openPicked({ path, kind: await mediaKind(path) });
        }
      })
      .then((unlisten) => (cancelled ? unlisten() : (off = unlisten)))
      .catch(() => {});
    return () => {
      cancelled = true;
      off?.();
    };
  }, [openPicked]);

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
                onBack={(intent) => dispatch({ type: "close", id: tab.id, intent })}
                onOpenProject={(dir, notice) => dispatch({ type: "openProject", dir, notice })}
              />
            ) : tab.kind === "video" ? (
              <VideoTool
                path={tab.path}
                onOpenFile={() => void openFile()}
                onOpenPath={(path) => dispatch({ type: "setTabPath", id: tab.id, path })}
                onClose={() => dispatch({ type: "close", id: tab.id })}
                registerCloseGuard={(guard) => {
                  closeGuards.current.set(tab.id, guard);
                  return () => void closeGuards.current.delete(tab.id);
                }}
              />
            ) : tab.kind === "image" ? (
              <ImageTool
                path={tab.path}
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
                onOpen={(path) => dispatch({ type: "setTabPath", id: tab.id, path })}
                onClose={() => dispatch({ type: "close", id: tab.id })}
              />
            )}
          </TabPanel>
        ))}
      </div>
    </div>
  );
}

export default App;
