import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useMenuBridge, useRegisterMenuActions, useTabActive } from "../../lib/menuBridge";
import { registerBeforeExit } from "../../lib/lifecycle";
import DropZone from "./components/DropZone";
import VideoPlayer from "./components/VideoPlayer";
import Timeline from "./components/Timeline";
import Toolbar from "./components/Toolbar";
import CompositionGrid from "./components/CompositionGrid";
import CropFrame from "./components/CropFrame";
import VideoControls from "./components/VideoControls";
import Toast from "./components/Toast";
import { UndoIcon, RedoIcon } from "./components/icons";
import SubtitleOverlay from "./components/SubtitleOverlay";
import FilterDefs from "./components/FilterDefs";
import VignetteOverlay from "./components/VignetteOverlay";
import { useEditorHistory } from "./hooks/useHistory";
import { formatTime, getKeptSegments, getVirtualDuration, realToVirtual, virtualToReal } from "./utils/time";
import { getApi } from "./api";
import type { RecentEntry } from "./api";
import type { SubtitleCue } from "./utils/srt";
import { DEFAULT_SUBTITLE_STYLE } from "./types";
import type { CropRect, EditorState, SubtitleAnimation, SubtitleStyle, TrimSegment } from "./types";
import type { StabilizeLevel } from "./hooks/useHistory";
import { useT } from "./i18n";
import { useTranslation } from "react-i18next";
import { History as HistoryIcon } from "lucide-react";
import HistoryPanel from "../HistoryPanel";
import { stepLabels, videoStepLabel, type Translate } from "../../lib/historyLabels";
import GenerateSubtitlesDialog from "../subtitles/GenerateSubtitlesDialog";
import { cuesToSrt, remapCues } from "../../lib/subs/linked";
import i18n from "i18next";
import { parseSrt } from "./utils/srt";
import "./videotool.css";

export type { CropRect, EditorState, SubtitleAnimation, SubtitleStyle, TrimSegment };
export { DEFAULT_SUBTITLE_STYLE };
void ({} as StabilizeLevel);

const ExportModal = lazy(() => import("./components/ExportModal"));
const Filters = lazy(() => import("./components/Filters"));
const GeometrySettings = lazy(() => import("./components/GeometrySettings"));
const CropOverlay = lazy(() => import("./components/CropOverlay"));
const SubtitlesPanel = lazy(() => import("./components/SubtitlesPanel"));
import type { GeneratedSubtitles } from "./components/SubtitlesPanel";

type ActivePanel = "crop" | "filters" | "geometry" | "subtitles" | null;

// How far short of a requested time the player may land (about one frame).
const SEEK_LANDING_MARGIN = 0.05;

const isMac = navigator.platform.includes("Mac");

interface Props {
  /** Vidéo à ouvrir ; `null` = vue vide (zone de dépôt et fichiers récents). */
  path: string | null;
  /** « Ouvrir une vidéo » : le choix du fichier se fait au niveau de la fenêtre. */
  onOpenFile: () => void;
  /** Ouvre ce chemin (un fichier récent) : dans cet onglet s'il est vide. */
  onOpenPath: (path: string) => void;
  onClose: () => void;
  /** Enregistre ce qui doit être demandé avant de fermer l'onglet (modifications non exportées). */
  registerCloseGuard: (guard: () => Promise<boolean>) => () => void;
}

export default function VideoTool({ path, onOpenFile, onOpenPath, onClose, registerCloseGuard }: Props) {
  const { t } = useT();
  const tabActive = useTabActive();
  const { setFlags } = useMenuBridge();

  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [generated, setGenerated] = useState<GeneratedSubtitles[]>([]);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [filterFrameUrl, setFilterFrameUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<{ msg: string; progress: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const { editable, set, setLive, endGesture, undo, redo, reset, goto, steps, index, canUndo, canRedo } =
    useEditorHistory();
  const { t: tr } = useTranslation();
  const [showHistory, setShowHistory] = useState(false);
  const ht = useCallback<Translate>((key, vars) => tr(key, vars ?? {}), [tr]);
  const historyLabels = useMemo(
    () => (showHistory ? stepLabels(steps, (a, b) => videoStepLabel(a, b, ht), ht) : []),
    // `steps` is rebuilt on every render: its length and the current state say when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showHistory, steps.length, editable, ht],
  );

  const showCrop = activePanel === "crop";
  const showFilters = activePanel === "filters";
  const showGeometry = activePanel === "geometry";
  const showSubtitles = activePanel === "subtitles";

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    // The grid shows 20 thumbnails of this frame: a full-resolution 4K data URL
    // (several MB, encoded synchronously) buys nothing there.
    const scale = Math.min(1, 320 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setFilterFrameUrl(canvas.toDataURL("image/jpeg", 0.8));
    } catch (err) {
      // A tainted canvas must not take the panel down: the cards fall back to
      // their placeholder preview.
      console.error("Could not capture a frame for the filter previews:", err);
      setFilterFrameUrl(null);
    }
  }, []);

  // Stable, undoable setters — each one snapshots the previous state onto the history stack
  const setSpeed = useCallback((speed: number) => set((p) => ({ ...p, speed })), [set]);
  const toggleMuted = useCallback(() => set((p) => ({ ...p, muted: !p.muted })), [set]);
  const setCrop = useCallback((crop: CropRect | null) => set((p) => ({ ...p, crop })), [set]);
  const setCutSegments = useCallback((cutSegments: TrimSegment[]) => set((p) => ({ ...p, cutSegments })), [set]);
  const setStabilize = useCallback((stabilize: StabilizeLevel) => set((p) => ({ ...p, stabilize })), [set]);
  const setFilter = useCallback((filter: string) => set((p) => ({ ...p, filter })), [set]);
  const setRotation = useCallback((rotation: number) => set((p) => ({ ...p, rotation })), [set]);

  // Gesture-driven setters — a whole drag or slider scrub collapses into one
  // undo step, closed by onCommit (pointerup / keyup) below.
  const setSpeedLive = useCallback((speed: number) => setLive((p) => ({ ...p, speed })), [setLive]);
  const setCropLive = useCallback((crop: CropRect | null) => setLive((p) => ({ ...p, crop })), [setLive]);
  const setCutSegmentsLive = useCallback(
    (cutSegments: TrimSegment[]) => setLive((p) => ({ ...p, cutSegments })),
    [setLive],
  );
  const setStraighten = useCallback((val: number) => setLive((p) => ({ ...p, straighten: val })), [setLive]);
  const setPerspectiveH = useCallback(
    (val: number) => setLive((p) => ({ ...p, perspectiveHorizontal: val })),
    [setLive],
  );
  const setPerspectiveV = useCallback((val: number) => setLive((p) => ({ ...p, perspectiveVertical: val })), [setLive]);
  const resetGeometry = useCallback(
    () =>
      set((p) => ({
        ...p,
        rotation: 0,
        straighten: 0,
        perspectiveHorizontal: 0,
        perspectiveVertical: 0,
      })),
    [set],
  );
  const setSubtitlesStyle = useCallback(
    (style: SubtitleStyle) => set((p) => (p.subtitles ? { ...p, subtitles: { ...p.subtitles, style } } : p)),
    [set],
  );
  const setSubtitlesStyleLive = useCallback(
    (style: SubtitleStyle) => setLive((p) => (p.subtitles ? { ...p, subtitles: { ...p.subtitles, style } } : p)),
    [setLive],
  );
  const setSubtitlesAnimation = useCallback(
    (animation: SubtitleAnimation) =>
      set((p) => (p.subtitles ? { ...p, subtitles: { ...p.subtitles, animation } } : p)),
    [set],
  );
  const setSubtitles = useCallback(
    (fileName: string, cues: SubtitleCue[]) =>
      set((p) => ({
        ...p,
        subtitles: { fileName, cues, style: DEFAULT_SUBTITLE_STYLE, animation: "word-pop" },
      })),
    [set],
  );
  const editSubtitleTexts = useCallback(
    (texts: string[]) =>
      set((p) => {
        if (!p.subtitles) return p;
        const cues = p.subtitles.cues.map((c, i) => ({ ...c, text: texts[i] })).filter((c) => c.text.trim());
        return { ...p, subtitles: cues.length > 0 ? { ...p.subtitles, cues } : null };
      }),
    [set],
  );
  const removeSubtitles = useCallback(() => set((p) => ({ ...p, subtitles: null })), [set]);

  // Panel toggles — switching panels is a single state update
  const onCropToggle = useCallback(() => setActivePanel((p) => (p === "crop" ? null : "crop")), []);
  const onCropReset = useCallback(() => {
    setCrop(null);
    setActivePanel((p) => (p === "crop" ? null : p));
  }, [setCrop]);
  const onFilterToggle = useCallback(() => {
    // Capturing is a side effect: it stays out of the state updater, which React
    // may run twice.
    if (activePanel !== "filters") captureFrame();
    setActivePanel((p) => (p === "filters" ? null : "filters"));
  }, [activePanel, captureFrame]);
  const onGeometryToggle = useCallback(() => setActivePanel((p) => (p === "geometry" ? null : "geometry")), []);
  const onSubtitlesToggle = useCallback(() => setActivePanel((p) => (p === "subtitles" ? null : "subtitles")), []);

  // ─── Load video ────────────────────────────────────────────────────────────
  // Each load gets an id; only the latest may touch state, so two overlapping
  // loads (menu "Open" while one transcodes) cannot leave the player on one file
  // and the export on another.
  const loadId = useRef(0);
  // The file whose preview was already transcoded: a second playback error is final.
  const forcedPath = useRef<string | null>(null);
  const hasEdits = useRef(false);
  useEffect(() => {
    hasEdits.current = canUndo;
  }, [canUndo]);

  const loadVideo = useCallback(
    async (filePath: string, force = false) => {
      const id = ++loadId.current;
      forcedPath.current = force ? filePath : null;
      setLoading({ msg: t.loading_preparing, progress: 0 });

      // Registered outside the try so the failure path unregisters it too.
      const off = getApi().onPreviewProgress((p) => {
        if (id === loadId.current) setLoading({ msg: t.loading_preparing, progress: p });
      });
      let url: string | null = null;
      try {
        url = await getApi().previewVideo(filePath, force);
      } catch (err) {
        if (id === loadId.current) {
          console.error("Preview transcode failed:", err);
          // Fall back to the source: it may still play natively.
          try {
            url = await getApi().toFileUrl(filePath);
          } catch {
            url = null;
          }
        }
      }
      off();
      if (id !== loadId.current) return; // superseded or cancelled

      if (!url) {
        setLoading(null);
        setToast(t.error_video_unreadable);
        return;
      }
      setIsPlaying(false);
      setActivePanel(null);
      reset();
      setVideoPath(filePath);
      setGenerated([]);
      getApi()
        .listSubs(filePath)
        .then((entries) => {
          if (id === loadId.current) {
            setGenerated(entries.map((e) => ({ id: e.id, label: e.label, cues: parseSrt(e.srt) })));
          }
        })
        .catch(() => {});
      setVideoUrl(url);
      setDuration(0);
      setVideoSize(null);
      setCurrentTime(0);
      setLoading(null);
    },
    [t, reset],
  );

  const cancelLoad = useCallback(() => {
    loadId.current++;
    void getApi().cancelFfmpeg();
    setLoading(null);
  }, []);

  // With a text field focused, Cmd/Ctrl+Z belongs to the field, not to the
  // timeline's history (the menu accelerator would otherwise swallow it).
  const inTextField = () => {
    const el = document.activeElement as HTMLElement | null;
    return (
      !!el &&
      (el.tagName === "TEXTAREA" ||
        (el.tagName === "INPUT" &&
          !["range", "color", "checkbox", "radio", "button"].includes((el as HTMLInputElement).type)))
    );
  };
  const undoOrTextUndo = useCallback(() => {
    if (inTextField()) document.execCommand("undo");
    else undo();
  }, [undo]);
  const redoOrTextRedo = useCallback(() => {
    if (inTextField()) document.execCommand("redo");
    else redo();
  }, [redo]);

  // Ouvre la vidéo de l'onglet, une fois, quand il reçoit son chemin.
  const openedPath = useRef<string | null>(null);
  useEffect(() => {
    if (!path || openedPath.current === path) return;
    openedPath.current = path;
    void loadVideo(path);
  }, [path, loadVideo]);

  // Kept segments = inverse of cuts.
  const keptSegments = useMemo(() => getKeptSegments(editable.cutSegments, duration), [editable.cutSegments, duration]);
  const virtualDuration = useMemo(() => getVirtualDuration(keptSegments), [keptSegments]);
  const virtualCurrentTime = useMemo(() => realToVirtual(currentTime, keptSegments), [currentTime, keptSegments]);

  // Real-time space — used by Timeline & CutEditor.
  const seek = useCallback((time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
  }, []);

  // Virtual-time space — used by VideoControls seekbar.
  const seekVirtual = useCallback(
    (virtualTime: number) => {
      if (!videoRef.current) return;
      videoRef.current.currentTime = virtualToReal(virtualTime, keptSegments);
    },
    [keptSegments],
  );

  // Skip cut zones during playback; stop at the end of the last kept segment.
  const skipCuts = useCallback(
    (realTime: number) => {
      const cuts = editable.cutSegments;
      const video = videoRef.current;
      // A seek is already on its way: asking again restarts it.
      if (!cuts.length || !video || video.paused || video.seeking) return;
      for (const cut of cuts) {
        // Seeking to `cut.end` lands on the nearest frame, which can be a few
        // milliseconds *before* it. Without a margin that still counts as inside the
        // cut, so the player seeks again, lands short again, and freezes there.
        if (realTime >= cut.start && realTime < cut.end - SEEK_LANDING_MARGIN) {
          video.currentTime = cut.end;
          return;
        }
      }
      const lastKept = keptSegments[keptSegments.length - 1];
      if (lastKept && realTime >= lastKept.end) {
        video.pause();
        video.currentTime = lastKept.end;
      }
    },
    [editable.cutSegments, keptSegments],
  );

  const handleTimeUpdate = useCallback(
    (realTime: number) => {
      setCurrentTime(realTime);
      skipCuts(realTime);
    },
    [skipCuts],
  );

  // `timeupdate` fires about every 250 ms: the player would run up to a quarter
  // second into a removed zone before skipping it. Check every frame instead.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && !video.paused) skipCuts(video.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, skipCuts]);

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
    } else {
      // Playback stops at the end of the last kept part, which may be short of
      // the file's end (so `ended` is false): restart from the top then too,
      // instead of needing a second click.
      const first = keptSegments[0]?.start ?? 0;
      const lastEnd = keptSegments[keptSegments.length - 1]?.end;
      if (video.ended || (lastEnd !== undefined && video.currentTime >= lastEnd - 0.05)) video.currentTime = first;
      void video.play();
    }
  }, [isPlaying, keptSegments]);

  // Keyboard transport. Space (or K) toggles playback, as the README promises —
  // without this it activated whichever toolbar button last had focus. The
  // others: ←/→ seek 1 s (Shift: 5 s), J/L seek 5 s, ,/. step one frame.
  const transportRef = useRef({ time: 0, duration: 0 });
  useEffect(() => {
    transportRef.current = { time: virtualCurrentTime, duration: virtualDuration };
  }, [virtualCurrentTime, virtualDuration]);
  const FRAME = 1 / 30; // the real frame rate is not known to the renderer

  useEffect(() => {
    if (!videoPath || showExport || showGenerate || !tabActive) return;
    const isTextual = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      if (node.tagName === "TEXTAREA" || node.tagName === "SELECT" || node.isContentEditable) return true;
      return (
        node.tagName === "INPUT" &&
        (node as HTMLInputElement).type !== "range" &&
        (node as HTMLInputElement).type !== "color"
      );
    };
    const jump = (delta: number) => {
      const { time, duration: total } = transportRef.current;
      seekVirtual(Math.max(0, Math.min(total, time + delta)));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat && e.code === "Space") return;
      // Ctrl+Z n'est pas un raccourci du menu de la suite : chaque écran le gère lui-même.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !isTextual(e.target)) {
        const key = e.key.toLowerCase();
        if (key === "z" || key === "y") {
          e.preventDefault();
          if (key === "z" && !e.shiftKey) undoOrTextUndo();
          else redoOrTextRedo();
          return;
        }
      }
      if (isTextual(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const onRange = (e.target as HTMLElement | null)?.tagName === "INPUT"; // arrows belong to a focused slider
      switch (e.code) {
        case "Space":
        case "KeyK":
          e.preventDefault();
          handlePlayPause();
          break;
        case "ArrowLeft":
          if (onRange) return;
          e.preventDefault();
          jump(e.shiftKey ? -5 : -1);
          break;
        case "ArrowRight":
          if (onRange) return;
          e.preventDefault();
          jump(e.shiftKey ? 5 : 1);
          break;
        case "KeyJ":
          e.preventDefault();
          jump(-5);
          break;
        case "KeyL":
          e.preventDefault();
          jump(5);
          break;
        case "Comma":
          e.preventDefault();
          videoRef.current?.pause();
          jump(-FRAME);
          break;
        case "Period":
          e.preventDefault();
          videoRef.current?.pause();
          jump(FRAME);
          break;
        default:
          break;
      }
    };
    // A focused button clicks on Space *release*: swallow that as well.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTextual(e.target)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    videoPath,
    showExport,
    showGenerate,
    tabActive,
    handlePlayPause,
    seekVirtual,
    FRAME,
    undoOrTextUndo,
    redoOrTextRedo,
  ]);

  const openExport = useCallback(() => setShowExport(true), []);

  // Fermer l'onglet (ou la fenêtre) avec des modifications non exportées demande confirmation.
  const confirmClose = useCallback(async () => {
    if (!hasEdits.current) return true;
    try {
      return await ask(t.confirm_close_tab, { kind: "warning" });
    } catch {
      return true;
    }
  }, [t]);
  useEffect(() => registerCloseGuard(confirmClose), [registerCloseGuard, confirmClose]);
  useEffect(() => registerBeforeExit(confirmClose), [confirmClose]);
  useRegisterMenuActions({
    undo: undoOrTextUndo,
    redo: redoOrTextRedo,
    openExport: () => {
      if (videoPath) setShowExport(true);
    },
    closeProject: () => void confirmClose().then((ok) => ok && onClose()),
    toggleHistory: () => {
      if (videoPath) setShowHistory((s) => !s);
    },
  });
  useEffect(() => {
    if (!tabActive) return;
    setFlags({ inVideo: !!videoPath, canUndo, canRedo });
    return () => setFlags({ inVideo: false, canUndo: false, canRedo: false });
  }, [setFlags, tabActive, videoPath, canUndo, canRedo]);
  // Un onglet laissé en arrière-plan ne joue plus rien.
  useEffect(() => {
    if (!tabActive) videoRef.current?.pause();
  }, [tabActive]);
  const closeExport = useCallback(() => setShowExport(false), []);
  const onApplyCrop = useCallback(() => setActivePanel(null), []);
  const onToastDone = useCallback(() => setToast(null), []);
  const onExportQueued = useCallback(() => setToast(t.export_queued), [t]);
  const refreshRecent = useCallback(() => {
    getApi()
      .listRecent()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);
  // The home screen lists what was opened lately; refresh it whenever it is shown.
  useEffect(() => {
    if (!videoPath && !loading) refreshRecent();
  }, [videoPath, loading, refreshRecent]);
  // Quand le lecteur refuse la vidéo, on essaie dans l'ordre : la même par HTTP local (le WebView
  // de Linux refuse les protocoles internes dans `<video>`), puis un aperçu transcodé, servi de
  // même (le WebView peut aussi ne pas avoir le codec d'un fichier qui semblait lisible).
  const streamedUrl = useRef<string | null>(null);
  const onVideoError = useCallback(async () => {
    if (!videoPath) return;
    if (videoUrl && videoUrl !== streamedUrl.current) {
      const id = loadId.current;
      try {
        const url = await getApi().toStreamUrl(videoUrl);
        if (id === loadId.current) {
          streamedUrl.current = url;
          setVideoUrl(url);
        }
        return;
      } catch (err) {
        console.error("Streaming the video failed:", err);
      }
    }
    if (forcedPath.current !== videoPath) void loadVideo(videoPath, true);
    else setToast(t.error_video_unreadable);
  }, [t, videoPath, videoUrl, loadVideo]);
  /** Un sous-titre généré est associé tout de suite à la vidéo, et le reste d'une session à l'autre. */
  const associateSubtitles = (srt: string, id: string) => {
    const cues = parseSrt(srt);
    if (!videoPath || cues.length === 0) return;
    const label = generated.find((g) => g.id === id)?.label ?? `#${generated.length + 1}`;
    setGenerated((list) =>
      list.some((g) => g.id === id)
        ? list.map((g) => (g.id === id ? { ...g, cues } : g))
        : [...list, { id, label, cues }],
    );
    setActivePanel("subtitles");
    void getApi().saveSub(videoPath, { id, label, srt });
  };
  /** Le sous-titre à emporter dans un projet : s'il n'est pas incrusté, recalé sur le montage. */
  const associatedSrt = () => {
    const last = generated[generated.length - 1];
    if (editable.subtitles || !last) return null;
    const cues = remapCues(last.cues, keptSegments, editable.speed);
    return cues.length > 0 ? cuesToSrt(cues) : null;
  };
  useEffect(() => {
    if (!tabActive) return;
    return getApi().onAddedToProjects((report) =>
      setToast(
        report.errors.length > 0
          ? i18n.t("subs.addToProjectFailed", { error: report.errors[0] })
          : i18n.t("subs.addedToProjects", { count: report.added }),
      ),
    );
  }, [tabActive]);
  const onSubtitlesError = useCallback(
    (reason: "empty" | "read") => setToast(reason === "empty" ? t.subtitles_empty : t.subtitles_error),
    [t],
  );

  const editorState = useMemo<EditorState>(
    () => ({
      videoPath,
      videoUrl,
      duration,
      speed: editable.speed,
      muted: editable.muted,
      cutSegments: editable.cutSegments,
      crop: editable.crop,
      filter: editable.filter,
      rotation: editable.rotation,
      straighten: editable.straighten,
      perspectiveHorizontal: editable.perspectiveHorizontal,
      perspectiveVertical: editable.perspectiveVertical,
      subtitles: editable.subtitles,
      stabilize: editable.stabilize,
    }),
    [videoPath, videoUrl, duration, editable],
  );

  if (loading) {
    return (
      <div className="vt-root">
        <div className="loading-screen">
          <div className="loading-inner">
            <div className="loading-spinner" />
            <p className="loading-msg">{loading.msg}</p>
            {loading.progress > 0 && (
              <div className="loading-bar">
                <div className="loading-fill" style={{ width: `${loading.progress}%` }} />
              </div>
            )}
            <button className="btn-ghost" onClick={cancelLoad}>
              {t.loading_cancel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!videoPath) {
    return (
      <div className="vt-root">
        <DropZone
          onDrop={loadVideo}
          onOpen={onOpenFile}
          onReject={() => setToast(t.error_not_video)}
          recent={recent}
          onOpenRecent={onOpenPath}
          onRemoveRecent={(p) => {
            void getApi().removeRecent(p).then(refreshRecent);
          }}
          onClearRecent={() => {
            void getApi().clearRecent().then(refreshRecent);
          }}
        />
        {toast && <Toast key={toast} message={toast} onDone={onToastDone} />}
      </div>
    );
  }

  return (
    <div className="vt-root">
      <div className="app-layout">
        <div className="top-bar">
          <div className="file-badge" title={videoPath ?? undefined}>
            <span className="file-badge-name">{videoPath?.split(/[\\/]/).pop()}</span>
            <span className="file-badge-meta">
              {[videoSize && `${videoSize.w}×${videoSize.h}`, formatTime(duration)].filter(Boolean).join(" · ")}
            </span>
          </div>
          <div className="top-bar-actions">
            <button
              className="btn-ghost btn-icon"
              onClick={undo}
              disabled={!canUndo}
              title={`${t.app_undo} (${isMac ? "Cmd+Z" : "Ctrl+Z"})`}
            >
              <UndoIcon />
            </button>
            <button
              className="btn-ghost btn-icon"
              onClick={redo}
              disabled={!canRedo}
              title={`${t.app_redo} (${isMac ? "Cmd+Shift+Z" : "Ctrl+Y"})`}
            >
              <RedoIcon />
            </button>
            <button
              className={`btn-ghost btn-icon${showHistory ? " active" : ""}`}
              onClick={() => setShowHistory((s) => !s)}
              aria-pressed={showHistory}
              title={tr("history.toggle")}
              aria-label={tr("history.toggle")}
            >
              <HistoryIcon size={16} />
            </button>
            <button className="btn-ghost" onClick={onOpenFile}>
              {t.app_open_video}
            </button>
            <button className="btn-ghost" onClick={() => setShowGenerate(true)}>
              {t.subtitles_generate}
            </button>
            <button className="btn-primary" onClick={openExport}>
              {t.app_export}
            </button>
          </div>
        </div>

        <div className="main-area">
          <div className="video-wrapper">
            <VideoPlayer
              videoRef={videoRef}
              src={videoUrl!}
              speed={editable.speed}
              muted={editable.muted}
              filterId={editable.filter}
              rotation={editable.rotation}
              straighten={editable.straighten}
              perspectiveH={editable.perspectiveHorizontal}
              perspectiveV={editable.perspectiveVertical}
              neutral={showCrop}
              onError={onVideoError}
              onTimeUpdate={handleTimeUpdate}
              onDurationLoaded={(d) => {
                setDuration(d);
                const v = videoRef.current;
                if (v?.videoWidth) setVideoSize({ w: v.videoWidth, h: v.videoHeight });
              }}
              onPlayPause={setIsPlaying}
            />
            <FilterDefs />
            <VignetteOverlay videoRef={videoRef} visible={editable.filter === "vignette"} />
            <SubtitleOverlay
              videoRef={videoRef}
              subtitles={editable.subtitles}
              currentTime={currentTime}
              crop={editable.crop}
            />
            <CompositionGrid visible={showCrop || showGeometry} videoRef={videoRef} />
            {showCrop && (
              <Suspense fallback={null}>
                <CropOverlay
                  videoRef={videoRef}
                  crop={editable.crop}
                  onChangeLive={setCropLive}
                  onCommit={endGesture}
                  onApply={onApplyCrop}
                />
              </Suspense>
            )}
            {!showCrop && editable.crop && (
              <CropFrame
                videoRef={videoRef}
                crop={editable.crop}
                geometry={{
                  rotation: editable.rotation,
                  straighten: editable.straighten,
                  perspectiveH: editable.perspectiveHorizontal,
                  perspectiveV: editable.perspectiveVertical,
                  filterId: editable.filter,
                }}
              />
            )}
          </div>

          <Toolbar
            state={editorState}
            showCrop={showCrop}
            showFilters={showFilters}
            showGeometry={showGeometry}
            showSubtitles={showSubtitles}
            onSpeedChange={setSpeed}
            onSpeedChangeLive={setSpeedLive}
            onCommit={endGesture}
            onStabilizeChange={setStabilize}
            onMuteToggle={toggleMuted}
            onCropToggle={onCropToggle}
            onCropReset={onCropReset}
            onFilterToggle={onFilterToggle}
            onGeometryToggle={onGeometryToggle}
            onSubtitlesToggle={onSubtitlesToggle}
          />

          {showFilters && (
            <Suspense fallback={null}>
              <Filters
                activeFilterId={editable.filter}
                onSelect={setFilter}
                frameDataUrl={filterFrameUrl ?? undefined}
              />
            </Suspense>
          )}

          {showGeometry && (
            <Suspense fallback={null}>
              <GeometrySettings
                rotation={editable.rotation}
                straighten={editable.straighten}
                perspectiveH={editable.perspectiveHorizontal}
                perspectiveV={editable.perspectiveVertical}
                onRotationChange={setRotation}
                onStraightenChange={setStraighten}
                onPerspectiveHChange={setPerspectiveH}
                onPerspectiveVChange={setPerspectiveV}
                onCommit={endGesture}
                onReset={resetGeometry}
              />
            </Suspense>
          )}

          {showSubtitles && (
            <Suspense fallback={null}>
              <SubtitlesPanel
                subtitles={editable.subtitles}
                onImport={setSubtitles}
                onStyleChange={setSubtitlesStyle}
                onStyleChangeLive={setSubtitlesStyleLive}
                onCommit={endGesture}
                onError={onSubtitlesError}
                onAnimationChange={setSubtitlesAnimation}
                onRemove={removeSubtitles}
                onEditTexts={editSubtitleTexts}
                generated={generated}
                onUseGenerated={(g) => setSubtitles(g.label, g.cues)}
                onDiscardGenerated={(id) => {
                  setGenerated((list) => list.filter((x) => x.id !== id));
                  if (videoPath) void getApi().removeSub(videoPath, id);
                }}
              />
            </Suspense>
          )}
        </div>

        <VideoControls
          currentTime={virtualCurrentTime}
          duration={virtualDuration}
          isPlaying={isPlaying}
          onPlayPause={handlePlayPause}
          onSeek={seekVirtual}
        />

        <div className="timeline-section">
          <Timeline
            duration={duration}
            currentTime={currentTime}
            cutSegments={editable.cutSegments}
            videoUrl={videoUrl!}
            onSeek={seek}
            onCutSegmentsChange={setCutSegments}
            onCutSegmentsChangeLive={setCutSegmentsLive}
            onCommit={endGesture}
          />
        </div>

        {showHistory && (
          <HistoryPanel labels={historyLabels} current={index} onGoto={goto} onClose={() => setShowHistory(false)} />
        )}

        {showExport && (
          <Suspense fallback={null}>
            <ExportModal
              state={editorState}
              associatedSrt={associatedSrt}
              onClose={closeExport}
              onQueued={onExportQueued}
            />
          </Suspense>
        )}

        {showGenerate && videoPath && (
          <GenerateSubtitlesDialog
            source={{ kind: "file", path: videoPath }}
            label={videoPath}
            onClose={() => setShowGenerate(false)}
            onAssociate={associateSubtitles}
          />
        )}

        {toast && <Toast key={toast} message={toast} onDone={onToastDone} />}
      </div>
    </div>
  );
}
