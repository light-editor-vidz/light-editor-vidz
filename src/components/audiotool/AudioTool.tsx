import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Pause, Play, Redo2, Undo2 } from "lucide-react";
import { useRegisterMenuActions, useMenuBridge, useTabActive } from "../../lib/menuBridge";
import { createPlaybackClock, useClockValue } from "../../lib/playbackClock";
import { keptDuration, keptSegments, realToVirtual, virtualToReal, MIN_CUT, type Cut } from "../../lib/audiotool/cuts";
import {
  audioAllowAsset,
  audioCancel,
  audioLoad,
  audioPickFile,
  audioPickOutput,
  audioProcess,
  fetchAudioData,
  type AudioInfo,
} from "../../lib/audiotool/commands";
import {
  baseName,
  buildProcessOptions,
  defaultOutputPath,
  describeEngineError,
  fmtTime,
  validateSettings,
  type EngineError,
  type ExportFormat,
  type WavDepth,
} from "../../lib/audiotool/helpers";
import { PreviewEngine, type PreviewParams } from "../../lib/audiotool/previewEngine";
import {
  DEFAULT_SETTINGS,
  canRedo,
  canUndo,
  current,
  newHistory,
  record,
  redo,
  speedOf,
  undo,
  type AudioSettings,
} from "../../lib/audiotool/settings";
import Controls from "./Controls";
import CutTimeline from "./CutTimeline";
import DropZone from "./DropZone";
import ExportDialog from "./ExportDialog";
import GenerateSubtitlesDialog from "../subtitles/GenerateSubtitlesDialog";
import AddToProjects from "../AddToProjects";
import { noDestination } from "../../lib/exportDestination";
import { addOutputToProjects, listMediaSubs, saveMediaSub, stagedExportPath } from "../../lib/subs/commands";
import { cuesToSrt, remapCues } from "../../lib/subs/linked";
import { parseSrt } from "../videotool/utils/srt";
import Spectrum from "./Spectrum";
import "./audiotool.css";

/** Nombre de tranches de la forme d'onde demandées au moteur. */
const WAVEFORM_POINTS = 900;

interface Props {
  /** Fichier à ouvrir ; `null` = onglet vide (zone de dépôt et fichiers récents). */
  path: string | null;
  /** Un fichier est choisi dans cet onglet. */
  onOpen: (path: string) => void;
  onClose: () => void;
}

interface Loaded {
  path: string;
  info: AudioInfo;
}

interface Toast {
  text: string;
  kind: "info" | "success" | "warning" | "error";
}

const toParams = (s: AudioSettings): PreviewParams => ({
  fadeIn: s.fadeIn,
  fadeOut: s.fadeOut,
  curve: s.fadeCurve,
  speed: speedOf(s),
  normalize: s.normalize,
  filter: { type: s.filterType, freq: s.filterFreq, slope: s.filterSlope, q: s.filterQ, bandwidth: s.filterBandwidth },
});

/** L'espace tape dans les champs de texte et les nombres et agit sur les cases et listes ; ailleurs
 * — boutons compris — il lance et met en pause. */
function spaceBelongsTo(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  if (node.isContentEditable || node.tagName === "TEXTAREA" || node.tagName === "SELECT") return true;
  return node.tagName === "INPUT" && (node as HTMLInputElement).type !== "range";
}

const isTyping = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  return !!node && (["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName) || node.isContentEditable);
};

/** La vue Audio (ex-LightCutSoundz) : couper, fondre, normaliser, changer la vitesse, filtrer, puis
 * exporter un fichier audio — aux couleurs de l'éditeur. */
export default function AudioTool({ path, onOpen, onClose }: Props) {
  const { t } = useTranslation();
  const tabActive = useTabActive();
  const { setFlags } = useMenuBridge();
  const [engine] = useState(() => new PreviewEngine());
  const [clock] = useState(() => createPlaybackClock(0));

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [hasPreview, setHasPreview] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [playing, setPlaying] = useState(false);

  // Les réglages en direct, et leur historique (un pas par geste terminé).
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef<AudioSettings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState(newHistory());
  const [selectedCut, setSelectedCut] = useState<string | null>(null);
  const pendingCutStart = useRef<number | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [subsOpen, setSubsOpen] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [toComputer, setToComputer] = useState(true);
  const [format, setFormat] = useState<ExportFormat>("wav");
  const [wavDepth, setWavDepth] = useState<WavDepth>("float32");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const describe = useCallback((e: unknown) => describeEngineError(e, (key, vars) => String(t(key, vars))), [t]);
  const say = useCallback((text: string, kind: Toast["kind"] = "info") => setToast({ text, kind }), []);
  // Les messages de réussite ou d'avertissement s'effacent seuls ; une erreur reste affichée.
  useEffect(() => {
    if (!toast || toast.kind === "error" || toast.kind === "info") return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const info = loaded?.info ?? null;
  const duration = info?.duration ?? 0;
  const kept = useMemo(() => keptSegments(settings.cuts, duration), [settings.cuts, duration]);
  const virtualDuration = keptDuration(kept);

  // ─── Chargement ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    // Le message de chargement est posé hors de l'effet : pas de rendu en cascade.
    void Promise.resolve().then(() => {
      if (!cancelled) say(t("audioTool.msg.loading"));
    });
    // L'aperçu est lu par le protocole `asset:`, qui ne sert que les fichiers que le moteur connaît ;
    // il se décode pendant que le moteur décode de son côté.
    const preview = audioAllowAsset(path)
      .then(() => fetchAudioData(path))
      .then((data) => engine.decode(data))
      .then(
        (buffer) => ({ buffer, error: null as unknown }),
        (error: unknown) => ({ buffer: null, error }),
      );
    audioLoad(path, WAVEFORM_POINTS)
      .then(async (result) => {
        const { buffer, error } = await preview;
        if (cancelled) return;
        // Tout est rassemblé d'abord, puis appliqué : un échec — ou un chargement plus récent —
        // laisse l'éditeur tel qu'il était.
        engine.pause();
        engine.load(buffer, result.duration, result.waveform);
        engine.setParams(toParams(DEFAULT_SETTINGS));
        settingsRef.current = DEFAULT_SETTINGS;
        setSettings(DEFAULT_SETTINGS);
        setHistory(newHistory());
        setSelectedCut(null);
        pendingCutStart.current = null;
        clock.set(0);
        setPlaying(false);
        setHasPreview(buffer !== null);
        setLoaded({ path, info: result });
        if (error) say(t("audioTool.msg.previewUnavailable"), "warning");
        else setToast(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) say(t("audioTool.msg.error", { error: describe(e) }), "error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, engine, clock]);

  // Ce qui joue suit les coupes et les réglages.
  useEffect(() => {
    if (loaded) engine.setKept(kept);
  }, [engine, loaded, kept]);
  useEffect(() => {
    engine.setParams(toParams(settings));
  }, [engine, settings]);

  // Le moteur n'a plus rien à jouer : retour au début.
  useEffect(() => {
    engine.setOnEnded(() => {
      setPlaying(false);
      clock.set(0);
    });
  }, [engine, clock]);

  // La tête de lecture ne fait que se dessiner : ce qui joue, et quand ça s'arrête, est sur l'horloge audio.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const frame = () => {
      clock.set(engine.currentTime());
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, engine, clock]);

  // Un onglet laissé en arrière-plan ne joue plus rien ; fermer l'onglet libère le contexte audio.
  useEffect(() => {
    if (!tabActive) engine.pause();
  }, [tabActive, engine]);
  if (!tabActive && playing) setPlaying(false);
  useEffect(() => () => engine.dispose(), [engine]);

  // ─── Lecture ──────────────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    if (!engine.hasPreview) return;
    if (engine.playing) {
      engine.pause();
      setPlaying(false);
    } else {
      engine.play();
      setPlaying(true);
    }
    clock.set(engine.currentTime());
  }, [engine, clock]);

  const seek = useCallback(
    (time: number) => {
      engine.seek(time);
      clock.set(engine.currentTime());
    },
    [engine, clock],
  );

  const stopPlayback = useCallback(() => {
    if (!engine.playing) return;
    engine.pause();
    setPlaying(false);
  }, [engine]);

  // ─── Réglages et historique ───────────────────────────────────────────────

  const change = useCallback((patch: Partial<AudioSettings>, commit: boolean) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    if (commit) setHistory((h) => record(h, next));
  }, []);
  const commit = useCallback(() => setHistory((h) => record(h, settingsRef.current)), []);

  const restore = useCallback((next: AudioSettings) => {
    settingsRef.current = next;
    setSettings(next);
    setSelectedCut(null);
  }, []);
  const handleUndo = useCallback(() => {
    if (!canUndo(history)) return;
    const h = undo(history);
    setHistory(h);
    restore(current(h));
  }, [history, restore]);
  const handleRedo = useCallback(() => {
    if (!canRedo(history)) return;
    const h = redo(history);
    setHistory(h);
    restore(current(h));
  }, [history, restore]);

  const setCuts = useCallback(
    (cuts: Cut[], selected: string | null) => {
      setSelectedCut(selected);
      change({ cuts }, true);
    },
    [change],
  );

  const markCut = useCallback(
    (which: "start" | "end") => {
      if (!info) return;
      const time = virtualToReal(engine.currentTime(), kept);
      if (which === "start") {
        pendingCutStart.current = time;
        return;
      }
      const start = pendingCutStart.current;
      if (start === null || time - start < MIN_CUT) return;
      pendingCutStart.current = null;
      const id = `cut-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      const merged = [...settingsRef.current.cuts, { id, start, end: time }].sort((a, b) => a.start - b.start);
      setCuts(mergeAfterMark(merged), id);
    },
    [engine, info, kept, setCuts],
  );

  // ─── Validité de l'export ─────────────────────────────────────────────────

  const problem = useMemo(
    () =>
      info
        ? validateSettings({
            duration: info.duration,
            sampleRate: info.sample_rate,
            cuts: settings.cuts,
            fadeIn: settings.fadeIn,
            fadeOut: settings.fadeOut,
            filterType: settings.filterType,
            filterFreq: settings.filterFreq,
            filterBandwidth: settings.filterBandwidth,
            filterSlope: settings.filterSlope,
            filterQ: settings.filterQ,
          })
        : null,
    [info, settings],
  );
  const problemText = problem ? describe(problem) : "";

  // ─── Export ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!processing) return;
    const unlisten = listen<number>("audio-export-progress", (e) => setProgress(e.payload));
    return () => {
      void unlisten.then((off) => off());
    };
  }, [processing]);

  async function runExport() {
    if (!loaded || processing || problem || noDestination(toComputer, projects)) return;
    let output: string | null;
    try {
      // Le moteur ajoute l'extension du format choisi si elle a été omise : le conteneur est décidé
      // par le format, le nom doit donc s'y accorder. Vers les seuls projets : pas de dialogue.
      const suggested = defaultOutputPath(loaded.path, format);
      output = toComputer ? await audioPickOutput(suggested, format) : await stagedExportPath(baseName(suggested));
    } catch (e) {
      say(t("audioTool.msg.error", { error: describe(e) }), "error");
      return;
    }
    if (!output) return;
    stopPlayback();
    setProcessing(true);
    setProgress(0);
    try {
      await audioProcess(
        buildProcessOptions(
          {
            filePath: loaded.path,
            format,
            duration: loaded.info.duration,
            cuts: settings.cuts,
            fadeIn: settings.fadeIn,
            fadeOut: settings.fadeOut,
            fadeCurve: settings.fadeCurve,
            normalize: settings.normalize,
            speed: speedOf(settings),
            filterType: settings.filterType,
            filterFreq: settings.filterFreq,
            filterBandwidth: settings.filterBandwidth,
            filterSlope: settings.filterSlope,
            filterQ: settings.filterQ,
            wavDepth,
          },
          output,
        ),
      );
      setExportOpen(false);
      if (toComputer) say(t("audioTool.export.done", { name: baseName(output) }), "success");
      if (projects.length > 0) await addToProjects(output);
    } catch (e) {
      if ((e as EngineError | null)?.code === "cancelled") say(t("audioTool.export.cancelled"), "warning");
      else say(t("audioTool.msg.error", { error: describe(e) }), "error");
    } finally {
      setProcessing(false);
    }
  }

  /** Le fichier exporté rejoint les projets cochés, avec son sous-titre recalé sur le montage. */
  async function addToProjects(output: string) {
    if (!loaded) return;
    const entries = await listMediaSubs(loaded.path);
    const last = entries[entries.length - 1];
    const cues = last
      ? remapCues(parseSrt(last.srt), keptSegments(settings.cuts, loaded.info.duration), speedOf(settings))
      : [];
    const report = await addOutputToProjects(output, projects, cues.length > 0 ? cuesToSrt(cues) : null);
    if (report.errors.length > 0) say(t("subs.addToProjectFailed", { error: report.errors[0] }), "error");
    else say(t("subs.addedToProjects", { count: report.added }), "success");
  }

  async function openAnother() {
    try {
      const picked = await audioPickFile();
      if (picked) onOpen(picked);
    } catch (e) {
      say(t("audioTool.msg.error", { error: describe(e) }), "error");
    }
  }

  const openExport = useCallback(() => {
    if (!loaded) return;
    stopPlayback();
    setExportOpen(true);
  }, [loaded, stopPlayback]);

  // ─── Menu et clavier ──────────────────────────────────────────────────────

  useRegisterMenuActions({
    closeProject: onClose,
    openExport,
    undo: handleUndo,
    redo: handleRedo,
  });
  const undoable = canUndo(history);
  const redoable = canRedo(history);
  useEffect(() => {
    if (!tabActive) return;
    setFlags({ inAudio: true, canUndo: undoable, canRedo: redoable });
    return () => setFlags({ inAudio: false, canUndo: false, canRedo: false });
  }, [setFlags, tabActive, undoable, redoable]);

  useEffect(() => {
    if (!tabActive || !loaded) return;
    const onKey = (e: KeyboardEvent) => {
      if (exportOpen || subsOpen) return;
      if (e.code === "Space" && !spaceBelongsTo(e.target)) {
        e.preventDefault();
        if (!e.repeat) togglePlay();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedCut && !isTyping(e.target)) {
        e.preventDefault();
        setCuts(
          settingsRef.current.cuts.filter((c) => c.id !== selectedCut),
          null,
        );
      } else if ((e.ctrlKey || e.metaKey) && !isTyping(e.target)) {
        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if ((key === "z" && e.shiftKey) || key === "y") {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabActive, loaded, exportOpen, subsOpen, selectedCut, togglePlay, setCuts, handleUndo, handleRedo]);

  // ─── Rendu ────────────────────────────────────────────────────────────────

  if (!path || !loaded || !info) {
    return (
      <div className="at-root">
        <DropZone onOpen={onOpen} onError={(text) => say(text, "error")} />
        {toast && <ToastView toast={toast} />}
      </div>
    );
  }

  return (
    <div className="at-root">
      <header className="at-header">
        <div className="at-badge">
          <span className="at-badge-name" title={loaded.path}>
            {baseName(loaded.path)}
          </span>
          <span className="at-badge-meta">
            {t("audioTool.badge.meta", {
              channels: info.channels,
              rate: info.sample_rate,
              duration: fmtTime(info.duration),
            })}
          </span>
        </div>
        <div className="at-actions">
          <button
            type="button"
            className="at-btn icon"
            disabled={!undoable}
            onClick={handleUndo}
            title={t("audioTool.header.undo")}
            aria-label={t("audioTool.header.undo")}
          >
            <Undo2 size={14} />
          </button>
          <button
            type="button"
            className="at-btn icon"
            disabled={!redoable}
            onClick={handleRedo}
            title={t("audioTool.header.redo")}
            aria-label={t("audioTool.header.redo")}
          >
            <Redo2 size={14} />
          </button>
          <button
            type="button"
            className="at-btn"
            title={t("audioTool.header.openOther")}
            onClick={() => void openAnother()}
          >
            {t("audioTool.header.open")}
          </button>
          <button type="button" className="at-btn" onClick={() => setSubsOpen(true)}>
            {t("subs.menu")}
          </button>
          <button type="button" className="at-btn primary" onClick={openExport}>
            {t("audioTool.export.run")}
          </button>
        </div>
      </header>

      <section className="at-editor">
        <div className="at-main">
          <div className="at-viz">
            <Spectrum analyser={engine.analyserNode} playing={playing} />
          </div>
          <Controls
            settings={settings}
            sampleRate={info.sample_rate}
            invalidField={problem?.field ?? null}
            onChange={change}
            onCommit={commit}
          />
        </div>

        <Player
          clock={clock}
          total={virtualDuration}
          playing={playing}
          canPlay={hasPreview}
          onToggle={togglePlay}
          onSeek={seek}
        />

        <CutTimeline
          duration={info.duration}
          waveform={info.waveform}
          cuts={settings.cuts}
          kept={kept}
          selectedId={selectedCut}
          clock={clock}
          onCutsChange={setCuts}
          onSelect={setSelectedCut}
          onSeekReal={(time) => seek(realToVirtual(time, kept))}
          onMark={markCut}
          onSeekBy={(delta) => seek(engine.currentTime() + delta)}
        />
      </section>

      {exportOpen && (
        <ExportDialog
          format={format}
          wavDepth={wavDepth}
          onFormat={setFormat}
          onWavDepth={setWavDepth}
          problem={problemText}
          processing={processing}
          progress={progress}
          onExport={() => void runExport()}
          onCancel={() => void audioCancel()}
          noDestination={noDestination(toComputer, projects)}
          addToProjects={
            <AddToProjects
              selected={projects}
              onChange={setProjects}
              toComputer={toComputer}
              onToComputer={setToComputer}
            />
          }
          onClose={() => setExportOpen(false)}
        />
      )}
      {subsOpen && (
        <GenerateSubtitlesDialog
          source={{ kind: "file", path: loaded.path }}
          label={loaded.path}
          onClose={() => setSubsOpen(false)}
          onAssociate={(srt, id) => void saveMediaSub(loaded.path, { id, label: "#1", srt })}
        />
      )}
      {toast && <ToastView toast={toast} />}
    </div>
  );
}

/** Les coupes d'un repère I/O, triées et fusionnées comme le fait `mergeCuts`. */
function mergeAfterMark(cuts: Cut[]): Cut[] {
  const out: Cut[] = [];
  for (const cut of cuts) {
    const last = out[out.length - 1];
    if (last && cut.start <= last.end) last.end = Math.max(last.end, cut.end);
    else out.push({ ...cut });
  }
  return out;
}

function ToastView({ toast }: { toast: Toast }) {
  return (
    <div className={`at-toast ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
      {toast.text}
    </div>
  );
}

/** Barre de lecture et bouton lecture/pause. */
function Player({
  clock,
  total,
  playing,
  canPlay,
  onToggle,
  onSeek,
}: {
  clock: ReturnType<typeof createPlaybackClock>;
  total: number;
  playing: boolean;
  canPlay: boolean;
  onToggle: () => void;
  onSeek: (time: number) => void;
}) {
  const { t } = useTranslation();
  const time = useClockValue(clock, (value) => value);
  const trackRef = useRef<HTMLDivElement>(null);
  const seeking = useRef(false);
  const percent = total > 0 ? Math.min(100, (time / total) * 100) : 0;

  const timeAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return 0;
    return Math.max(0, Math.min(total, ((clientX - rect.left) / rect.width) * total));
  };

  return (
    <div className="at-player">
      <div
        className="at-seek"
        role="slider"
        tabIndex={0}
        aria-label={t("audioTool.player.seek")}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(time)}
        onPointerDown={(e) => {
          if (!canPlay || e.button > 0) return;
          seeking.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          onSeek(timeAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (seeking.current) onSeek(timeAt(e.clientX));
        }}
        onPointerUp={() => (seeking.current = false)}
        onPointerCancel={() => (seeking.current = false)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          onSeek(time + (e.shiftKey ? 5 : 1) * (e.key === "ArrowLeft" ? -1 : 1));
        }}
      >
        <div className="at-seek-track" ref={trackRef}>
          <div className="at-seek-fill" style={{ width: `${percent}%` }} />
          <div className="at-seek-thumb" style={{ left: `${percent}%` }} />
        </div>
      </div>
      <div className="at-controls">
        <button
          type="button"
          className="at-play"
          disabled={!canPlay}
          onClick={onToggle}
          title={t("audioTool.player.playPause")}
          aria-label={t("audioTool.player.playPause")}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="at-time">
          {fmtTime(time)} / {fmtTime(total)}
        </span>
      </div>
    </div>
  );
}
