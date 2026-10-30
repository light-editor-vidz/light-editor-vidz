import { describeError } from "../lib/errors";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import type { Project } from "../bindings/Project";
import type { ShapeType } from "../bindings/ShapeType";
import type { AudioTrack } from "../bindings/AudioTrack";
import { loadProject, newProject, pickTextFile, saveProject } from "../lib/commands";
import { parseLegacyProject } from "../lib/legacyImport";
import type { Element } from "../bindings/Element";
import {
  addElementToComposition,
  alignElements,
  type AlignEdge,
  createImageElement,
  createShapeElement,
  createStyledTextElement,
  createSubtitleElement,
  createTitleElement,
  createVideoElement,
  type TextStylePreset,
  deleteElementsFromProject,
  distributeElements,
  duplicateElementsInProject,
  findElement,
  groupElements,
  groupMembers,
  moveElementToIndex,
  remapGroupIds,
  reorderElementInProject,
  splitElementInProject,
  ungroupElements,
  updateElementInProject,
  updateElementTiming,
  type ElementPatch,
} from "../lib/elements";
import {
  addAudioTrackToProject,
  createAudioTrack,
  duplicateAudioTrackInProject,
  findAudioTrack,
  removeAudioTrackFromProject,
  updateAudioTrackInProject,
} from "../lib/audio";
import {
  addComposition,
  duplicateComposition,
  removeComposition,
  renameComposition,
  reorderComposition,
  resolveActiveComposition,
  setCompositionOverlap,
  setCompositionTransitionIn,
  setCompositionTransitionOut,
  updateCompositionDuration,
} from "../lib/timeline";
import { historyReducer, initialHistory } from "../lib/history";
import { createPlaybackClock, useClockValue } from "../lib/playbackClock";
import { useAutosave } from "../lib/useAutosave";
import { registerBeforeExit } from "../lib/lifecycle";
import { preloadMedia, dropIdleMedia } from "../lib/mediaCache";
import { clampPosition } from "../lib/geometry";
import TopBar from "./editor/TopBar";
import { useMenuBridge, useRegisterMenuActions } from "../lib/menuBridge";
import SettingsModal from "./editor/SettingsModal";
import CategoryRail from "./editor/CategoryRail";
import LibraryPanel from "./editor/LibraryPanel";
import CanvasStage from "./editor/CanvasStage";
import PropertiesPanel from "./editor/PropertiesPanel";
import Timeline from "./editor/Timeline";
import AudioPlayer from "./editor/AudioPlayer";
import { useEditorShortcuts } from "./editor/useEditorShortcuts";
import StatusBanner, { type Notice } from "./editor/StatusBanner";
import type { LeftTab } from "./editor/types";
import "./editor/editor.css";

interface Props {
  projectDir: string;
  /** `intent: "new"` : retour à l'accueil avec la fenêtre de création de projet ouverte. */
  onBack: (intent?: "new") => void;
  onOpenProject: (dir: string, notice?: string) => void;
  /** Message affiché à l'ouverture (ex : médias à ré-importer après un import legacy). */
  initialNotice?: string | null;
}

export default function Editor({ projectDir, onBack, onOpenProject, initialNotice = null }: Props) {
  const { t } = useTranslation();
  const [history, dispatch] = useReducer(historyReducer, initialHistory);
  const { present: project, saved: savedProject, past, future } = history;
  /** Erreur de chargement : seule situation où l'éditeur est remplacé par un écran d'erreur. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(
    initialNotice ? { kind: "warning", message: initialNotice } : null,
  );
  const [leftTab, setLeftTab] = useState<LeftTab>("text");
  const [playing, setPlaying] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Horloge hors de l'état React : voir `playbackClock.ts`.
  const [clock] = useState(() => createPlaybackClock());
  const [clipboard, setClipboard] = useState<Element[]>([]);
  const [timelineSearch, setTimelineSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;

  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    loadProject(projectDir)
      // Un projet sans aucune composition (fichier legacy/corrompu — le flux normal de
      // l'app ne peut jamais y mener : `new_project` en crée toujours une et l'UI refuse
      // de supprimer la dernière) laisserait `resolveActiveComposition` renvoyer `null`
      // indéfiniment, bloquant l'éditeur sur "Chargement…" sans jamais rien afficher.
      // On répare silencieusement en ajoutant une scène vide plutôt que de bloquer.
      .then((p) => {
        const repaired = p.compositions.length > 0 ? p : addComposition(p);
        // Si le projet a dû être réparé, il diffère du disque : rester "non enregistré"
        // pour que la sauvegarde automatique persiste la réparation.
        dispatch({ type: "load", project: repaired, saved: repaired === p ? p : null });
      })
      .catch((e) => setLoadError(describeError(e)));
  }, [projectDir]);

  const { saving, saveError, flush } = useAutosave({
    project,
    saved: savedProject,
    projectDir,
    // Pas de sauvegarde si le chargement a échoué : on écrirait dans un dossier qui n'est pas
    // (ou plus) un projet.
    enabled: loadError === null,
    onSaved: useCallback((p: Project) => dispatch({ type: "saved", project: p }), []),
  });

  // Les modifications en attente sont écrites avant l'arrêt de l'application (fermeture de la
  // fenêtre, relance après une mise à jour) et quand l'éditeur se démonte.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => {
    const unregister = registerBeforeExit(() => flushRef.current());
    return () => {
      unregister();
      void flushRef.current();
      dropIdleMedia();
    };
  }, []);

  /** Exécute `action` une fois les modifications enregistrées ; si l'écriture échoue, on reste
   * dans l'éditeur (le bandeau d'erreur reste affiché) plutôt que de perdre le travail. */
  const afterSave = useCallback(async (action: () => void) => {
    if (await flushRef.current()) action();
  }, []);

  // Horloge de lecture : rAF avec delta-time réel.
  useEffect(() => {
    if (!playing) return;
    let raf: number;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const duration = projectRef.current?.duration ?? 0;
      const next = clock.get() + dt;
      if (next >= duration) {
        clock.set(duration);
        setPlaying(false);
        return;
      }
      clock.set(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, clock]);

  /** Applique une mutation au projet en poussant l'état précédent dans l'historique d'annulation.
   * `coalesceKey` : les mutations rapprochées portant la même clé (drag, slider, frappe continue)
   * fusionnent en une seule entrée d'historique — voir `src/lib/history.ts`. */
  const mutate = useCallback((fn: (p: Project) => Project, coalesceKey?: string) => {
    dispatch({ type: "mutate", fn, key: coalesceKey, now: performance.now() });
  }, []);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
  const handleUndo = useCallback(() => dispatch({ type: "undo" }), []);
  const handleRedo = useCallback(() => dispatch({ type: "redo" }), []);

  function handleSave() {
    void flush(true);
  }

  async function handleOpenProjectDialog() {
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    await afterSave(() => onOpenProject(dir));
  }

  async function handleImportLegacy() {
    const picked = await pickTextFile(t("editor.legacyPickTitle"), "JSON", ["json"]);
    if (!picked) return;
    const parentDir = await open({ directory: true, multiple: false });
    if (!parentDir || Array.isArray(parentDir)) return;

    try {
      const { project: legacyProject, unresolvedMedia } = parseLegacyProject(JSON.parse(picked.content));
      const newDir = await newProject({
        parent_dir: parentDir,
        name: legacyProject.name,
        width: legacyProject.width,
        height: legacyProject.height,
        fps: legacyProject.fps,
      });
      await saveProject(newDir, legacyProject);
      const mediaNotice =
        unresolvedMedia.length > 0 ? t("editor.legacyMissingMedia", { count: unresolvedMedia.length }) : undefined;
      await afterSave(() => onOpenProject(newDir, mediaNotice));
    } catch (e) {
      // Erreur passagère : on reste dans l'éditeur, rien n'est perdu.
      setNotice({ kind: "error", message: t("editor.legacyImportFailed", { error: describeError(e) }) });
    }
  }

  /** Scène active à l'instant de l'horloge (lue à l'appel : l'horloge n'est pas un état React). */
  const getActive = () => (projectRef.current ? resolveActiveComposition(projectRef.current, clock.get()) : null);
  const activeId = useClockValue(clock, (time) =>
    project ? (resolveActiveComposition(project, time)?.composition.id ?? null) : null,
  );
  const activeComposition = project?.compositions.find((c) => c.id === activeId) ?? null;
  const isAudioSelected = !!project && findAudioTrack(project, selectedId) !== null;
  const selectedAudioIds = project ? selectedIds.filter((id) => findAudioTrack(project, id) !== null) : [];
  const selectedElementIds = selectedIds.filter((id) => !selectedAudioIds.includes(id));

  // Une sélection ne survit pas à un changement de scène : le panneau Propriétés et les flèches du
  // clavier agiraient sinon sur un élément qui n'est plus affiché. Les pistes audio (globales au
  // projet) restent sélectionnables d'une scène à l'autre.
  useEffect(() => {
    if (!activeComposition) return;
    const visible = new Set(activeComposition.elements.map((el) => el.id));
    setSelectedIds((prev) => {
      const kept = prev.filter(
        (id) => visible.has(id) || projectRef.current?.audio_tracks.some((track) => track.id === id),
      );
      return kept.length === prev.length ? prev : kept;
    });
  }, [activeComposition]);

  // Les vidéos de la scène active et de la suivante sont chargées à l'avance : elles ne sont pas
  // relues depuis le disque au moment où la tête de lecture les atteint.
  useEffect(() => {
    if (!project || !activeId) return;
    const index = project.compositions.findIndex((c) => c.id === activeId);
    for (const comp of project.compositions.slice(index, index + 2)) {
      for (const el of comp.elements) {
        if (el.type === "video") preloadMedia(projectDir, el.src);
      }
    }
  }, [project, activeId, projectDir]);

  function addAndSelect(element: ReturnType<typeof createTitleElement>) {
    const active = getActive();
    if (!project || !active) return;
    mutate((p) => addElementToComposition(p, active.composition.id, element));
    setSelectedIds([element.id]);
  }

  function addAndSelectAudio(relativeSrc: string, name: string) {
    // Piste globale au projet (non rattachée à une scène), posée au début de la timeline et
    // jouant jusqu'à la fin du projet par défaut.
    const track = createAudioTrack(relativeSrc, name);
    mutate((p) => addAudioTrackToProject(p, track));
    setSelectedIds([track.id]);
  }

  function handleUpdateElement(elementId: string, patch: ElementPatch) {
    const active = getActive();
    mutate(
      (p) => {
        const next = updateElementInProject(p, elementId, patch);
        // Déplacement groupé : si x/y a changé, le même delta s'applique aux membres du groupe de
        // l'élément et, s'il fait partie de la sélection, à toute la sélection.
        if (!active || (patch.x === undefined && patch.y === undefined)) return next;
        const before = findElement(p, elementId);
        const after = findElement(next, elementId);
        if (!before || !after) return next;
        const dx = after.x - before.x;
        const dy = after.y - before.y;
        if (dx === 0 && dy === 0) return next;
        const movers = new Set(groupMembers(p, active.composition.id, elementId));
        if (selectedElementIds.includes(elementId)) {
          for (const id of selectedElementIds) groupMembers(p, active.composition.id, id).forEach((m) => movers.add(m));
        }
        movers.delete(elementId);
        return Array.from(movers).reduce((acc, id) => {
          const el = findElement(acc, id);
          return el ? updateElementInProject(acc, id, { x: el.x + dx, y: el.y + dy }) : acc;
        }, next);
      },
      // Un drag (x,y en rafale), un slider (volume…) ou la frappe (content) fusionnent en une
      // seule entrée d'annulation ; la clé inclut les champs touchés pour que deux réglages
      // différents restent deux entrées distinctes.
      `el:${elementId}:${Object.keys(patch).sort().join(",")}`,
    );
  }

  function handleUpdateAudio(patch: Partial<AudioTrack>) {
    if (!selectedId) return;
    mutate(
      (p) => updateAudioTrackInProject(p, selectedId, patch),
      `audio:${selectedId}:${Object.keys(patch).sort().join(",")}`,
    );
  }

  /** Déplace tous les éléments sélectionnés de (dx, dy) % du canvas (flèches du clavier). */
  function handleNudge(dx: number, dy: number) {
    if (selectedElementIds.length === 0 || !project) return;
    mutate(
      (p) =>
        selectedElementIds.reduce((acc, id) => {
          const el = findElement(acc, id);
          if (!el) return acc;
          return updateElementInProject(acc, id, {
            x: clampPosition(el.x + dx, el.width),
            y: clampPosition(el.y + dy, el.height),
          });
        }, p),
      `nudge:${selectedElementIds.join(",")}`,
    );
  }

  /** Avance/recule le playhead de `deltaSeconds`, borné à la durée du projet. */
  function handleSeekBy(deltaSeconds: number) {
    const duration = projectRef.current?.duration ?? 0;
    clock.set(Math.min(duration, Math.max(0, clock.get() + deltaSeconds)));
  }

  function handleReorder(direction: 1 | -1) {
    if (!selectedId) return;
    mutate((p) => reorderElementInProject(p, selectedId, direction));
  }

  function handleReorderLayer(elementId: string, toIndex: number) {
    mutate((p) => moveElementToIndex(p, elementId, toIndex));
  }

  function handleSelectElement(id: string | null, additive: boolean) {
    if (id === null) {
      if (!additive) setSelectedIds([]);
      return;
    }
    const active = getActive();
    setSelectedIds((prev) => {
      if (additive) return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (project && active) return groupMembers(project, active.composition.id, id);
      return [id];
    });
  }

  function handleGroup() {
    const active = getActive();
    if (!active || selectedElementIds.length < 2) return;
    mutate((p) => groupElements(p, active.composition.id, selectedElementIds));
  }

  function handleUngroup() {
    const active = getActive();
    if (!active || selectedElementIds.length === 0) return;
    mutate((p) => ungroupElements(p, active.composition.id, selectedElementIds));
  }

  function handleMarqueeSelect(ids: string[], additive: boolean) {
    if (ids.length === 0) {
      if (!additive) setSelectedIds([]);
      return;
    }
    setSelectedIds((prev) => (additive ? Array.from(new Set([...prev, ...ids])) : ids));
  }

  function handleDeleteSelected() {
    if (selectedIds.length === 0) return;
    mutate((p) => {
      let next = p;
      if (selectedAudioIds.length > 0) {
        next = selectedAudioIds.reduce((acc, id) => removeAudioTrackFromProject(acc, id), next);
      }
      if (selectedElementIds.length > 0) {
        next = deleteElementsFromProject(next, selectedElementIds);
      }
      return next;
    });
    setSelectedIds([]);
  }

  function handleDuplicateSelected() {
    if (!project || selectedIds.length === 0) return;
    let next = project;
    const newIds: string[] = [];
    for (const id of selectedAudioIds) {
      const result = duplicateAudioTrackInProject(next, id);
      next = result.project;
      if (result.newId) newIds.push(result.newId);
    }
    if (selectedElementIds.length > 0) {
      const result = duplicateElementsInProject(next, selectedElementIds);
      next = result.project;
      newIds.push(...result.newIds);
    }
    mutate(() => next);
    setSelectedIds(newIds);
  }

  function handleSplitSelected() {
    const active = getActive();
    if (!selectedId || !active || isAudioSelected) return;
    mutate((p) => splitElementInProject(p, active.composition.id, selectedId, active.localTime));
  }

  function handleAlign(edge: AlignEdge) {
    const active = getActive();
    if (!active || selectedElementIds.length === 0) return;
    mutate((p) => alignElements(p, active.composition.id, selectedElementIds, edge));
  }

  function handleDistribute(axis: "horizontal" | "vertical") {
    const active = getActive();
    if (!active || selectedElementIds.length < 3) return;
    mutate((p) => distributeElements(p, active.composition.id, selectedElementIds, axis));
  }

  function handleCopy() {
    if (!project || selectedElementIds.length === 0) return;
    const elements = selectedElementIds
      .map((id) => findElement(project, id))
      .filter((el): el is Element => el !== null);
    setClipboard(elements);
  }

  function handlePaste() {
    const active = getActive();
    if (!project || !active || clipboard.length === 0) return;
    let next = project;
    const newIds: string[] = [];
    for (const el of clipboard) {
      const copy = {
        ...el,
        id: crypto.randomUUID(),
        x: Math.min(95, el.x + 3),
        y: Math.min(95, el.y + 3),
      } as Element;
      next = addElementToComposition(next, active.composition.id, copy);
      newIds.push(copy.id);
    }
    // Comme pour la duplication : les éléments collés ne doivent pas rejoindre le groupe
    // des originaux.
    mutate(() => remapGroupIds(next, newIds));
    setSelectedIds(newIds);
  }

  useEditorShortcuts({
    hasActiveComposition: activeComposition !== null,
    selectedIds,
    selectedElementIds,
    actions: {
      save: handleSave,
      togglePlay: () => setPlaying((p) => !p),
      nudge: handleNudge,
      seekBy: handleSeekBy,
      seekTo: (time) => clock.set(time ?? projectRef.current?.duration ?? 0),
      fps: () => projectRef.current?.fps || 30,
      deleteSelected: handleDeleteSelected,
      duplicateSelected: handleDuplicateSelected,
      copy: handleCopy,
      paste: handlePaste,
      selectAll: () => setSelectedIds(activeComposition?.elements.map((el) => el.id) ?? []),
      group: handleGroup,
      ungroup: handleUngroup,
      deselect: () => setSelectedIds([]),
      undo: handleUndo,
      redo: handleRedo,
    },
  });

  const dirty = project !== null && project !== savedProject;

  // The menu bar acts on this editor while it is open.
  useRegisterMenuActions({
    newProject: () => void afterSave(() => onBack("new")),
    openProject: () => void handleOpenProjectDialog(),
    openRecent: (dir: string) => void afterSave(() => onOpenProject(dir)),
    importLegacy: () => void handleImportLegacy(),
    closeProject: () => void afterSave(() => onBack()),
    save: handleSave,
    openSettings: () => setShowSettings(true),
    undo: handleUndo,
    redo: handleRedo,
    deleteSelected: handleDeleteSelected,
    duplicateSelected: handleDuplicateSelected,
  });
  const { setFlags } = useMenuBridge();
  const hasSelection = selectedIds.length > 0;
  useEffect(() => {
    setFlags({ inEditor: true, canUndo, canRedo, hasSelection });
    return () => setFlags({ inEditor: false, canUndo: false, canRedo: false, hasSelection: false });
  }, [setFlags, canUndo, canRedo, hasSelection]);

  if (loadError) {
    return (
      <main className="editor-root" style={{ alignItems: "center", justifyContent: "center" }}>
        <p className="home-error">{loadError}</p>
        <button type="button" className="btn-secondary" onClick={() => onBack()}>
          {t("common.back")}
        </button>
      </main>
    );
  }

  if (!project || !activeComposition) {
    return (
      <main
        className="editor-root"
        style={{ alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}
      >
        {t("common.loading")}
      </main>
    );
  }

  // Un échec d'enregistrement est affiché en priorité, sans retirer l'éditeur : les modifications
  // non enregistrées restent en mémoire et l'écriture est retentée.
  const banner: Notice | null = saveError
    ? {
        kind: "error",
        message: t("editor.saveFailed", { error: saveError }),
        action: { label: t("editor.retry"), onClick: () => void flush() },
      }
    : notice;

  return (
    <div className="editor-root">
      <AudioPlayer project={project} projectDir={projectDir} clock={clock} playing={playing} />
      <TopBar
        project={project}
        projectDir={projectDir}
        onNotice={setNotice}
        saving={saving}
        dirty={dirty}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
      />
      {banner && <StatusBanner notice={banner} onDismiss={saveError ? undefined : () => setNotice(null)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <div className="editor-middle">
        <CategoryRail active={leftTab} onChange={setLeftTab} />
        <LibraryPanel
          active={leftTab}
          projectDir={projectDir}
          project={project}
          onAddTitle={() => addAndSelect(createTitleElement())}
          onAddSubtitle={() => addAndSelect(createSubtitleElement())}
          onAddStyledText={(preset: TextStylePreset) => addAndSelect(createStyledTextElement(preset))}
          onAddImage={(src, name) => addAndSelect(createImageElement(src, name))}
          onAddVideo={(src, name) => addAndSelect(createVideoElement(src, name))}
          onAddAudio={addAndSelectAudio}
          onAddShape={(shapeType: ShapeType) => addAndSelect(createShapeElement(shapeType))}
          onOpenSettings={() => setShowSettings(true)}
        />
        <CanvasStage
          project={project}
          projectDir={projectDir}
          composition={activeComposition}
          clock={clock}
          playing={playing}
          onTogglePlay={() => setPlaying((p) => !p)}
          onSeekToStart={() => clock.set(activeComposition.start_time)}
          selectedIds={selectedIds}
          onSelectElement={handleSelectElement}
          onMarqueeSelect={handleMarqueeSelect}
          onUpdateElement={handleUpdateElement}
          onSetTransitionIn={(transitionType) =>
            mutate((p) => setCompositionTransitionIn(p, activeComposition.id, transitionType))
          }
          onSetTransitionOut={(transitionType) =>
            mutate((p) => setCompositionTransitionOut(p, activeComposition.id, transitionType))
          }
          onSeekToNext={() => {
            const idx = project.compositions.findIndex((c) => c.id === activeComposition.id);
            const next = project.compositions[idx + 1];
            clock.set(next ? next.start_time : project.duration);
          }}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={canUndo}
          canRedo={canRedo}
        />
        <PropertiesPanel
          element={findElement(project, selectedId)}
          audioTrack={findAudioTrack(project, selectedId)}
          onUpdate={(patch) => selectedId && handleUpdateElement(selectedId, patch)}
          onUpdateAudio={handleUpdateAudio}
          onReorder={handleReorder}
          activeCompositionDuration={activeComposition.duration}
          elements={activeComposition.elements}
          selectedIds={selectedIds}
          onSelectLayer={(id, additive) => handleSelectElement(id, additive)}
          onReorderLayer={handleReorderLayer}
          onDeleteLayer={(id) => {
            mutate((p) => deleteElementsFromProject(p, [id]));
            setSelectedIds((prev) => prev.filter((x) => x !== id));
          }}
          onAlign={handleAlign}
          onDistribute={handleDistribute}
          onGroup={handleGroup}
          onUngroup={handleUngroup}
        />
      </div>
      <Timeline
        project={project}
        activeCompositionId={activeComposition.id}
        selectedElementIds={selectedIds}
        clock={clock}
        canSplit={selectedIds.length === 1 && !isAudioSelected}
        onSelectComposition={(id) => {
          const comp = project.compositions.find((c) => c.id === id);
          if (comp) clock.set(comp.start_time);
        }}
        onSelectElement={(id) => handleSelectElement(id, false)}
        onAddComposition={() => mutate(addComposition)}
        onSeek={(time) => clock.set(time)}
        onResizeComposition={(compId, duration) =>
          mutate((p) => updateCompositionDuration(p, compId, duration), `comp:${compId}:duration`)
        }
        onUpdateOverlap={(compId, overlap) =>
          mutate((p) => setCompositionOverlap(p, compId, overlap), `comp:${compId}:overlap`)
        }
        onRenameComposition={(compId, name) => mutate((p) => renameComposition(p, compId, name))}
        onReorderComposition={(compId, direction) => mutate((p) => reorderComposition(p, compId, direction))}
        onDeleteComposition={(compId) => mutate((p) => removeComposition(p, compId))}
        onDuplicateComposition={(compId) => {
          const { project: next, newId } = duplicateComposition(project, compId);
          mutate(() => next);
          const copy = next.compositions.find((c) => c.id === newId);
          if (copy) clock.set(copy.start_time);
        }}
        onUpdateElementTiming={(elementId, startTime, duration) =>
          mutate((p) => updateElementTiming(p, elementId, startTime, duration), `timing:${elementId}`)
        }
        onUpdateAudioTiming={(trackId, startTime, duration) =>
          mutate((p) => updateAudioTrackInProject(p, trackId, { start_time: startTime, duration }), `timing:${trackId}`)
        }
        onSplit={handleSplitSelected}
        onDelete={handleDeleteSelected}
        onDuplicate={handleDuplicateSelected}
        searchQuery={timelineSearch}
        onSearchChange={setTimelineSearch}
      />
    </div>
  );
}
