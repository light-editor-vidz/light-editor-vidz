import { describeError } from "../lib/errors";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import type { Project } from "../bindings/Project";
import type { ShapeType } from "../bindings/ShapeType";
import type { AudioTrack } from "../bindings/AudioTrack";
import { loadProject, newProject, pickTextFile, saveProject, takeProjectRecovery } from "../lib/commands";
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
import HistoryPanel from "./HistoryPanel";
import { projectStepLabel, stepLabels, type Translate } from "../lib/historyLabels";
import { createPlaybackClock, useClockValue } from "../lib/playbackClock";
import { useAutosave } from "../lib/useAutosave";
import { registerBeforeExit } from "../lib/lifecycle";
import { confirmInterrupt } from "../lib/busyWork";
import type { TransitionType } from "../bindings/TransitionType";
import { useStableCallback } from "../lib/useStableCallback";
import { dropIdleMedia } from "../lib/mediaCache";
import { clampPosition } from "../lib/geometry";
import TopBar from "./editor/TopBar";
import { useMenuBridge, useRegisterMenuActions, useTabActive } from "../lib/menuBridge";
import SettingsModal from "./editor/SettingsModal";
import CategoryRail from "./editor/CategoryRail";
import type { MediaOrigin } from "../lib/tabs";
import { samePath } from "../lib/tabs";
import { listen } from "@tauri-apps/api/event";
import { audioClipSettings, videoClipSettings } from "../lib/clipSettings";
import { clipsUsing, swapMediaSrc, type SwapScope } from "../lib/mediaSwap";
import MediaVersionDialog from "./editor/MediaVersionDialog";
import LibraryPanel from "./editor/LibraryPanel";
import CanvasStage from "./editor/CanvasStage";
import PropertiesPanel from "./editor/PropertiesPanel";
import Timeline from "./editor/Timeline";
import AudioPlayer from "./editor/AudioPlayer";
import { useEditorShortcuts } from "./editor/useEditorShortcuts";
import StatusBanner, { type Notice } from "./editor/StatusBanner";
import type { LeftTab } from "./editor/types";
import GenerateSubtitlesDialog, { type SubsSource } from "./subtitles/GenerateSubtitlesDialog";
import { addCuesToProject, type TimedCue } from "../lib/subs/place";
import { attachLinked, cuesToSrt, expandLinkedSubtitles, srtToLinked, syncLinkedCues } from "../lib/subs/linked";
import { projectMediaSubtitle, setProjectMediaSubtitle } from "../lib/subs/commands";
import type { LinkedCue } from "../bindings/LinkedCue";
import "./editor/editor.css";

interface Props {
  projectDir: string;
  /** `intent: "new"` : retour à l'accueil avec la fenêtre de création de projet ouverte. */
  onBack: (intent?: "new") => void;
  onOpenProject: (dir: string, notice?: string) => void;
  /** « Nouveau projet » : va à l'accueil sans fermer cet onglet (à défaut, `onBack("new")`). */
  onNewProject?: () => void;
  /** Message affiché à l'ouverture (ex : médias à ré-importer après un import legacy). */
  initialNotice?: string | null;
  /** Ce que l'onglet demande avant de se fermer : enregistrer, et confirmer si un export tourne. */
  registerCloseGuard?: (guard: () => Promise<boolean>) => () => void;
  /** Ouvre un média du projet dans l'onglet d'édition de son type. */
  onEditMedia?: (kind: "audio" | "image" | "video", origin: MediaOrigin) => void;
}

/** Les réglages à choix (gras, alignement, mode de fusion…) sont des actions ponctuelles : deux
 * bascules rapprochées restent deux entrées d'annulation, au lieu de fusionner en une. */
const DISCRETE_KEYS = new Set([
  "alignment",
  "vertical_alignment",
  "font_weight",
  "font_style",
  "blend_mode",
  "shape_type",
  "fit_mode",
  "loop_video",
  "muted",
  "underline",
  "strikethrough",
]);
function isDiscretePatch(patch: ElementPatch): boolean {
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((k) => DISCRETE_KEYS.has(k));
}

export default function Editor({
  projectDir,
  onBack,
  onOpenProject,
  onNewProject,
  initialNotice = null,
  registerCloseGuard,
  onEditMedia,
}: Props) {
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
  const [subs, setSubs] = useState<{
    source: SubsSource;
    label: string;
    /** Le média d'origine (absent pour le projet entier). */
    owner?: { id: string; src: string };
  } | null>(null);

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;

  const hiddenByResize = useRef(0);
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
        // Rouvert depuis la sauvegarde (le fichier principal était illisible) : à signaler.
        return takeProjectRecovery(projectDir)
          .then((recovered) => {
            if (recovered) setNotice({ kind: "warning", message: t("editor.recoveredFromBackup") });
          })
          .catch(() => {});
      })
      .catch((e) => setLoadError(describeError(e)));
    // `t` n'est pas une dépendance : un changement de langue ne doit pas recharger le projet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const exportingRef = useRef(false);
  const onExportingChange = useCallback((exporting: boolean) => {
    exportingRef.current = exporting;
  }, []);
  // La croix de l'onglet passe par le même chemin que Ctrl+W : si l'écriture échoue (clé USB
  // retirée…), l'onglet reste ouvert avec son bandeau d'erreur au lieu de perdre le travail.
  useEffect(
    () =>
      registerCloseGuard?.(async () => {
        if (exportingRef.current && !(await confirmInterrupt(["quit.projectExport"]))) return false;
        return flushRef.current();
      }),
    [registerCloseGuard],
  );
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

  /** Lecture / pause. Lancée à la fin du projet, la lecture repart du début (sinon le premier
   * pas d'horloge dépassait la durée et s'arrêtait aussitôt, sans rien jouer). */
  const togglePlay = useCallback(() => {
    setPlaying((was) => {
      if (!was) {
        const duration = projectRef.current?.duration ?? 0;
        if (duration > 0 && clock.get() >= duration - 0.001) clock.set(0);
      }
      return !was;
    });
  }, [clock]);

  /** Applique une mutation au projet en poussant l'état précédent dans l'historique d'annulation.
   * `coalesceKey` : les mutations rapprochées portant la même clé (drag, slider, frappe continue)
   * fusionnent en une seule entrée d'historique — voir `src/lib/history.ts`. */
  // Un drag émet une mutation par `pointermove` (plusieurs centaines par seconde) : chacune
  // refaisait le rendu de tout l'éditeur et relançait l'autosave. Les mutations qui portent une
  // clé de fusion sont regroupées : au plus une par image d'écran, composées dans l'ordre.
  const pendingMutations = useRef<{ fns: ((p: Project) => Project)[]; key: string; frame: number } | null>(null);
  const flushMutations = useCallback(() => {
    const pending = pendingMutations.current;
    if (!pending) return;
    pendingMutations.current = null;
    cancelAnimationFrame(pending.frame);
    const fn = (p: Project) => pending.fns.reduce((acc, step) => step(acc), p);
    dispatch({ type: "mutate", fn, key: pending.key, now: performance.now() });
  }, []);
  // Seuls les gestes à la souris sont regroupés : une frappe ou un clic isolé s'applique tout de suite.
  const pointerHeld = useRef(false);
  useEffect(() => {
    const down = () => {
      pointerHeld.current = true;
    };
    const up = () => {
      pointerHeld.current = false;
      flushMutations();
    };
    // Le clavier et la saisie dans un champ ne sont jamais un geste à la souris en cours.
    const typed = () => {
      pointerHeld.current = false;
    };
    window.addEventListener("keydown", typed, true);
    window.addEventListener("input", typed, true);
    window.addEventListener("change", typed, true);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("keydown", typed, true);
      window.removeEventListener("input", typed, true);
      window.removeEventListener("change", typed, true);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, [flushMutations]);
  const mutate = useCallback(
    (fn: (p: Project) => Project, coalesceKey?: string) => {
      if (!coalesceKey || !pointerHeld.current) {
        // Une action ponctuelle (ou au clavier) passe après celles déjà en attente.
        flushMutations();
        dispatch({ type: "mutate", fn, key: coalesceKey, now: performance.now() });
        return;
      }
      if (pendingMutations.current && pendingMutations.current.key !== coalesceKey) flushMutations();
      if (pendingMutations.current) pendingMutations.current.fns.push(fn);
      else pendingMutations.current = { fns: [fn], key: coalesceKey, frame: requestAnimationFrame(flushMutations) };
    },
    [flushMutations],
  );
  useEffect(() => flushMutations, [flushMutations]);

  // Une nouvelle version d'un média du projet vient d'être enregistrée depuis son onglet : les clips
  // qui utilisaient l'ancienne peuvent la reprendre (un seul pas d'annulation).
  const [newVersion, setNewVersion] = useState<{
    oldSrc: string;
    newSrc: string;
    elementId?: string;
    count: number;
  } | null>(null);
  useEffect(() => {
    const un = listen<{ projectDir: string; oldSrc: string; newSrc: string; elementId: string | null }>(
      "project-media-saved",
      ({ payload }) => {
        const current = projectRef.current;
        if (!current || !samePath(payload.projectDir, projectDir)) return;
        const users = clipsUsing(current, payload.oldSrc);
        const elementId = payload.elementId ?? undefined;
        if (users.length === 0) {
          setNotice({ kind: "info", message: t("mediaVersion.used") });
        } else if (elementId && users.length === 1 && users[0] === elementId) {
          mutate((p) => swapMediaSrc(p, payload.oldSrc, payload.newSrc, "clip", elementId));
          setNotice({ kind: "info", message: t("mediaVersion.applied") });
        } else {
          setNewVersion({ oldSrc: payload.oldSrc, newSrc: payload.newSrc, elementId, count: users.length });
        }
      },
    ).catch(() => undefined);
    return () => {
      void un.then((off) => off?.());
    };
  }, [projectDir, mutate, t]);
  const applyNewVersion = (scope: SwapScope) => {
    if (!newVersion) return;
    const { oldSrc, newSrc, elementId } = newVersion;
    mutate((p) => swapMediaSrc(p, oldSrc, newSrc, scope, elementId));
    setNewVersion(null);
    setNotice({ kind: "info", message: t("mediaVersion.applied") });
  };

  const historyProjects = useMemo(() => [...past, ...future], [past, future]);
  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
  const handleUndo = useCallback(() => {
    flushMutations();
    dispatch({ type: "undo" });
  }, [flushMutations]);
  const handleRedo = useCallback(() => {
    flushMutations();
    dispatch({ type: "redo" });
  }, [flushMutations]);
  const handleGoto = useCallback(
    (index: number) => {
      flushMutations();
      dispatch({ type: "goto", index });
    },
    [flushMutations],
  );
  const [showHistory, setShowHistory] = useState(false);
  const ht = useCallback<Translate>((key, vars) => t(key, vars ?? {}), [t]);
  const historyLabels = useMemo(
    () =>
      showHistory && project ? stepLabels([...past, project, ...future], (a, b) => projectStepLabel(a, b, ht), ht) : [],
    [showHistory, past, project, future, ht],
  );

  /** Subtitles of the whole project: its mix is already on the project timeline. */
  function openSubsForProject() {
    if (!project) return;
    setSubs({ source: { kind: "project", projectDir, project }, label: project.name });
  }

  /** Subtitles of the selected video element or audio track. */
  function openSubsForSelection() {
    if (!project || !selectedId) return;
    const media = findAudioTrack(project, selectedId) ?? findElement(project, selectedId);
    if (!media || !("src" in media) || ("type" in media && media.type !== "video")) return;
    setSubs({
      source: { kind: "media", projectDir, src: media.src },
      label: media.name,
      owner: { id: media.id, src: media.src },
    });
  }

  function placeSubs(cues: TimedCue[]) {
    if (!project) return;
    const { added } = addCuesToProject(project, cues);
    mutate((p) => addCuesToProject(p, cues).project);
    setNotice({ kind: "info", message: t("subs.added", { count: added }) });
  }

  /** Le sous-titre généré suit le média : à côté du fichier, et actif sur l'élément d'origine. */
  function associateSubs(srt: string) {
    const owner = subs?.owner;
    const linked = srtToLinked(srt, true);
    if (!owner || !linked) return;
    mutate((p) => attachLinked(p, owner.id, owner.src, linked));
    setProjectMediaSubtitle(projectDir, owner.src, srt).catch((e) =>
      setNotice({ kind: "error", message: describeError(e) }),
    );
  }

  /** Les textes corrigés valent pour toutes les utilisations de ce média. */
  function editLinkedCues(src: string, cues: LinkedCue[]) {
    mutate((p) => syncLinkedCues(p, src, cues));
    setProjectMediaSubtitle(projectDir, src, cuesToSrt(cues)).catch((e) =>
      setNotice({ kind: "error", message: describeError(e) }),
    );
  }

  /** Un média qui a un sous-titre l'apporte avec lui, activé ou non selon la médiathèque. */
  async function linkedFor(src: string, enabled: boolean) {
    const srt = await projectMediaSubtitle(projectDir, src).catch(() => null);
    return srt ? srtToLinked(srt, enabled) : null;
  }

  async function addVideo(src: string, name: string, subtitlesOn?: boolean) {
    const element = createVideoElement(src, name);
    const subtitles = subtitlesOn === undefined ? null : await linkedFor(src, subtitlesOn);
    addAndSelect(subtitles && element.type === "video" ? { ...element, subtitles } : element);
  }

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
  /** Ouvre le média d'un clip (ou, sans clip, d'un fichier de la médiathèque) dans son onglet. */
  const editClipMedia = onEditMedia
    ? (id: string) => {
        if (!project) return;
        const track = findAudioTrack(project, id);
        if (track) {
          return onEditMedia("audio", { projectDir, src: track.src, elementId: id, clip: audioClipSettings(track) });
        }
        const el = findElement(project, id);
        if (el && (el.type === "image" || el.type === "video")) {
          const comp = project.compositions.find((c) => c.elements.some((e) => e.id === id));
          const duration = el.duration ?? (comp ? comp.duration - el.start_time : 1);
          const clip = el.type === "video" ? videoClipSettings(el, duration) : undefined;
          onEditMedia(el.type, { projectDir, src: el.src, elementId: id, clip });
        }
      }
    : undefined;
  const editLibraryMedia = onEditMedia
    ? (kind: "audio" | "image" | "video", src: string) => onEditMedia(kind, { projectDir, src })
    : undefined;

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

  function addAndSelect(element: ReturnType<typeof createTitleElement>) {
    const active = getActive();
    if (!project || !active) return;
    mutate((p) => addElementToComposition(p, active.composition.id, element));
    setSelectedIds([element.id]);
  }

  async function addAndSelectAudio(relativeSrc: string, name: string, subtitlesOn?: boolean) {
    const subtitles = subtitlesOn === undefined ? null : await linkedFor(relativeSrc, subtitlesOn);
    // Piste globale au projet (non rattachée à une scène), posée au début de la timeline et
    // jouant jusqu'à la fin du projet par défaut.
    const track = { ...createAudioTrack(relativeSrc, name), subtitles };
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
      isDiscretePatch(patch) ? undefined : `el:${elementId}:${Object.keys(patch).sort().join(",")}`,
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
      togglePlay,
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

  // Gestionnaires d'identité stable : les panneaux (`memo`) ne se re-rendent pas à chaque mutation
  // du projet (un drag en émet une par image) quand leurs données n'ont pas changé.
  const sAddTitle = useStableCallback(() => addAndSelect(createTitleElement()));
  const sAddSubtitle = useStableCallback(() => addAndSelect(createSubtitleElement()));
  const sAddStyledText = useStableCallback((preset: TextStylePreset) => addAndSelect(createStyledTextElement(preset)));
  const sAddImage = useStableCallback((src: string, name: string) => addAndSelect(createImageElement(src, name)));
  const sAddVideo = useStableCallback((src: string, name: string, subtitlesOn?: boolean) => {
    void addVideo(src, name, subtitlesOn);
  });
  const sAddAudio = useStableCallback((src: string, name: string, subtitlesOn?: boolean) => {
    void addAndSelectAudio(src, name, subtitlesOn);
  });
  const sAddShape = useStableCallback((shapeType: ShapeType) => addAndSelect(createShapeElement(shapeType)));
  const sOpenSettings = useStableCallback(() => setShowSettings(true));
  const sSeekToStart = useStableCallback(() => {
    if (activeComposition) clock.set(activeComposition.start_time);
  });
  const sSeekToNext = useStableCallback(() => {
    const p = projectRef.current;
    if (!p || !activeComposition) return;
    const idx = p.compositions.findIndex((c) => c.id === activeComposition.id);
    const next = p.compositions[idx + 1];
    clock.set(next ? next.start_time : p.duration);
  });
  const sSetTransitionIn = useStableCallback((transitionType: TransitionType | null) => {
    if (activeComposition) mutate((p) => setCompositionTransitionIn(p, activeComposition.id, transitionType));
  });
  const sSetTransitionOut = useStableCallback((transitionType: TransitionType | null) => {
    if (activeComposition) mutate((p) => setCompositionTransitionOut(p, activeComposition.id, transitionType));
  });
  const sSelectElement = useStableCallback(handleSelectElement);
  const sMarqueeSelect = useStableCallback(handleMarqueeSelect);
  const sUpdateElement = useStableCallback(handleUpdateElement);
  const sUpdateSelected = useStableCallback((patch: ElementPatch) => {
    if (selectedId) handleUpdateElement(selectedId, patch);
  });
  const sUpdateAudio = useStableCallback(handleUpdateAudio);
  const sReorder = useStableCallback(handleReorder);
  const sSelectLayer = useStableCallback((id: string, additive: boolean) => handleSelectElement(id, additive));
  const sReorderLayer = useStableCallback(handleReorderLayer);
  const sDeleteLayer = useStableCallback((id: string) => {
    mutate((p) => deleteElementsFromProject(p, [id]));
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  });
  const sAlign = useStableCallback(handleAlign);
  const sDistribute = useStableCallback(handleDistribute);
  const sGroup = useStableCallback(handleGroup);
  const sUngroup = useStableCallback(handleUngroup);
  const sSubsForSelection = useStableCallback(openSubsForSelection);
  const sEditLinkedCues = useStableCallback(editLinkedCues);
  const sSelectComposition = useStableCallback((id: string) => {
    const comp = projectRef.current?.compositions.find((c) => c.id === id);
    if (comp) clock.set(comp.start_time);
  });
  const sTimelineSelect = useStableCallback((id: string) => handleSelectElement(id, false));
  const sAddComposition = useStableCallback(() => mutate(addComposition));
  const sSeek = useStableCallback((time: number) => clock.set(time));
  const sResizeComposition = useStableCallback((compId: string, duration: number) => {
    mutate((p) => updateCompositionDuration(p, compId, duration), `comp:${compId}:duration`);
    // Un élément qui commence après la fin de la scène n'est plus visible : on le dit (une
    // seule fois par changement du nombre d'éléments masqués, pas à chaque pixel du drag).
    const comp = projectRef.current?.compositions.find((c) => c.id === compId);
    const hidden = comp ? comp.elements.filter((el) => el.start_time >= duration).length : 0;
    if (hidden !== hiddenByResize.current) {
      hiddenByResize.current = hidden;
      if (hidden > 0) setNotice({ kind: "warning", message: t("editor.sceneHidesElements", { count: hidden }) });
    }
  });
  const sUpdateOverlap = useStableCallback((compId: string, overlap: number) =>
    mutate((p) => setCompositionOverlap(p, compId, overlap), `comp:${compId}:overlap`),
  );
  const sRenameComposition = useStableCallback((compId: string, name: string) =>
    mutate((p) => renameComposition(p, compId, name)),
  );
  const sReorderComposition = useStableCallback((compId: string, direction: 1 | -1) =>
    mutate((p) => reorderComposition(p, compId, direction)),
  );
  const sDeleteComposition = useStableCallback((compId: string) => mutate((p) => removeComposition(p, compId)));
  const sDuplicateComposition = useStableCallback((compId: string) => {
    const current = projectRef.current;
    if (!current) return;
    const { project: next, newId } = duplicateComposition(current, compId);
    mutate(() => next);
    const copy = next.compositions.find((c) => c.id === newId);
    if (copy) clock.set(copy.start_time);
  });
  const sUpdateElementTiming = useStableCallback((elementId: string, startTime: number, duration: number | null) =>
    mutate((p) => updateElementTiming(p, elementId, startTime, duration), `timing:${elementId}`),
  );
  const sUpdateAudioTiming = useStableCallback((trackId: string, startTime: number, duration: number | null) =>
    mutate((p) => updateAudioTrackInProject(p, trackId, { start_time: startTime, duration }), `timing:${trackId}`),
  );
  const sSplit = useStableCallback(handleSplitSelected);
  const sDelete = useStableCallback(handleDeleteSelected);
  const sDuplicate = useStableCallback(handleDuplicateSelected);

  const dirty = project !== null && project !== savedProject;
  // Ce que le canvas affiche : le projet, plus les sous-titres activés de ses médias.
  const shownProject = useMemo(() => (project ? expandLinkedSubtitles(project) : null), [project]);

  // The menu bar acts on this editor while it is open.
  useRegisterMenuActions({
    newProject: () => void afterSave(() => (onNewProject ? onNewProject() : onBack("new"))),
    openProject: () => void handleOpenProjectDialog(),
    openRecent: (dir: string) => void afterSave(() => onOpenProject(dir)),
    importLegacy: () => void handleImportLegacy(),
    closeProject: () => void afterSave(() => onBack()),
    save: handleSave,
    openSettings: () => setShowSettings(true),
    generateSubtitles: openSubsForProject,
    undo: handleUndo,
    redo: handleRedo,
    deleteSelected: handleDeleteSelected,
    duplicateSelected: handleDuplicateSelected,
    toggleHistory: () => setShowHistory((s) => !s),
  });
  const { setFlags } = useMenuBridge();
  const tabActive = useTabActive();
  const hasSelection = selectedIds.length > 0;
  useEffect(() => {
    if (!tabActive) return;
    setFlags({ inEditor: true, canUndo, canRedo, hasSelection });
    return () => setFlags({ inEditor: false, canUndo: false, canRedo: false, hasSelection: false });
  }, [setFlags, tabActive, canUndo, canRedo, hasSelection]);
  // Un onglet laissé en arrière-plan ne joue plus rien.
  if (!tabActive && playing) setPlaying(false);

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
        onGenerateSubtitles={openSubsForProject}
        historyOpen={showHistory}
        onToggleHistory={() => setShowHistory((s) => !s)}
        onExportingChange={onExportingChange}
      />
      {showHistory && (
        <HistoryPanel
          labels={historyLabels}
          current={past.length}
          onGoto={handleGoto}
          onClose={() => setShowHistory(false)}
        />
      )}
      {banner && <StatusBanner notice={banner} onDismiss={saveError ? undefined : () => setNotice(null)} />}
      {newVersion && (
        <MediaVersionDialog
          count={newVersion.count}
          canChooseClip={!!newVersion.elementId}
          onChoose={applyNewVersion}
          onClose={() => {
            setNewVersion(null);
            setNotice({ kind: "info", message: t("mediaVersion.used") });
          }}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {subs && (
        <GenerateSubtitlesDialog
          source={subs.source}
          label={subs.label}
          onClose={() => setSubs(null)}
          onPlace={subs.owner ? undefined : placeSubs}
          onAssociate={subs.owner ? associateSubs : undefined}
        />
      )}
      <div className="editor-middle">
        <CategoryRail active={leftTab} onChange={setLeftTab} />
        <LibraryPanel
          active={leftTab}
          projectDir={projectDir}
          project={project}
          historyProjects={historyProjects}
          onAddTitle={sAddTitle}
          onAddSubtitle={sAddSubtitle}
          onAddStyledText={sAddStyledText}
          onAddImage={sAddImage}
          onAddVideo={sAddVideo}
          onAddAudio={sAddAudio}
          onAddShape={sAddShape}
          onEditMedia={editLibraryMedia}
          onOpenSettings={sOpenSettings}
        />
        <CanvasStage
          project={shownProject ?? project}
          projectDir={projectDir}
          composition={shownProject?.compositions.find((c) => c.id === activeComposition.id) ?? activeComposition}
          clock={clock}
          playing={playing}
          onTogglePlay={togglePlay}
          onSeekToStart={sSeekToStart}
          selectedIds={selectedIds}
          onSelectElement={sSelectElement}
          onMarqueeSelect={sMarqueeSelect}
          onUpdateElement={sUpdateElement}
          onSetTransitionIn={sSetTransitionIn}
          onSetTransitionOut={sSetTransitionOut}
          onSeekToNext={sSeekToNext}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          onEditElement={editClipMedia}
        />
        <PropertiesPanel
          element={findElement(project, selectedId)}
          audioTrack={findAudioTrack(project, selectedId)}
          onUpdate={sUpdateSelected}
          onUpdateAudio={sUpdateAudio}
          onReorder={sReorder}
          activeCompositionDuration={activeComposition.duration}
          elements={activeComposition.elements}
          selectedIds={selectedIds}
          onSelectLayer={sSelectLayer}
          onReorderLayer={sReorderLayer}
          onDeleteLayer={sDeleteLayer}
          onAlign={sAlign}
          onDistribute={sDistribute}
          onGroup={sGroup}
          onUngroup={sUngroup}
          onGenerateSubtitles={sSubsForSelection}
          onEditLinkedCues={sEditLinkedCues}
          onEditMedia={editClipMedia}
        />
      </div>
      <Timeline
        project={project}
        activeCompositionId={activeComposition.id}
        selectedElementIds={selectedIds}
        clock={clock}
        canSplit={selectedIds.length === 1 && !isAudioSelected}
        onSelectComposition={sSelectComposition}
        onSelectElement={sTimelineSelect}
        onAddComposition={sAddComposition}
        onSeek={sSeek}
        onResizeComposition={sResizeComposition}
        onUpdateOverlap={sUpdateOverlap}
        onRenameComposition={sRenameComposition}
        onReorderComposition={sReorderComposition}
        onDeleteComposition={sDeleteComposition}
        onDuplicateComposition={sDuplicateComposition}
        onUpdateElementTiming={sUpdateElementTiming}
        onUpdateAudioTiming={sUpdateAudioTiming}
        onSplit={sSplit}
        onDelete={sDelete}
        onDuplicate={sDuplicate}
        searchQuery={timelineSearch}
        onSearchChange={setTimelineSearch}
        onEditElement={editClipMedia}
        projectDir={projectDir}
      />
    </div>
  );
}
