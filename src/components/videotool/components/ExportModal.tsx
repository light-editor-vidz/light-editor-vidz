import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { getApi } from "../api";
import type { EditorState } from "../types";
import { formatTime, getKeptSegments } from "../utils/time";
import { getFilterById } from "../utils/filters";
import { useT } from "../i18n";
import { engineErrorText } from "../engineError";
import { useVideoOwner } from "../owner";
import {
  ASPECTS,
  SOCIAL_PRESETS,
  PRESET_SETTINGS,
  type Aspect,
  type ReframeMode,
  type PresetId,
} from "../utils/presets";
import AddToProjects from "../../AddToProjects";
import { noDestination } from "../../../lib/exportDestination";
import { stagedExportPath, type MediaOrigin } from "../../../lib/subs/commands";
import { LOUDNESS_TARGETS, parseLoudness } from "../../../lib/loudness";
import VoiceCleanupFields from "../../VoiceCleanupFields";
import { NO_VOICE_CLEANUP, parseVoice, type VoiceCleanup } from "../../../lib/voice";
import DeliveryCheck, { CheckList, DestinationSelect } from "../../DeliveryCheck";
import { checkDelivery, parsePlatform, platformOf, type PlatformId } from "../../../lib/platforms";
import { queuedDestinations } from "../../../lib/deliveryCheck";
import { EXPORT_PREFS_KEY as PREFS_KEY } from "../utils/exportPrefs";
import "./ExportModal.css";

interface Props {
  state: EditorState;
  onClose: () => void;
  /** Called after the export was added to the queue (the dialog then closes). */
  onQueued?: () => void;
  /** Un export vers des projets est lancé : cet onglet attend le compte rendu de l'ajout. */
  onProjectsExport?: () => void;
  /** Le sous-titre qui accompagnera la vidéo dans les projets choisis. */
  associatedSrt?: () => string | null;
  /** Le média de projet que cet onglet édite : l'export peut en devenir une nouvelle version. */
  origin?: MediaOrigin;
}

type Format = "mp4" | "mov" | "webm" | "avi" | "gif";
type Quality = "high" | "balanced" | "small";

const QUALITIES: Quality[] = ["high", "balanced", "small"];
const RESOLUTIONS = [2160, 1440, 1080, 720, 480, 360];
const GIF_WIDTHS = [240, 320, 480, 640, 800];
const GIF_FPS = [8, 10, 12, 15, 20, 25];
const HARDWARE_FORMATS: Format[] = ["mp4", "mov", "avi"];

interface Prefs {
  format: Format;
  quality: Quality;
  resolution: number | null;
  gifWidth: number;
  gifFps: number;
  hardware: boolean;
  /** Volume ressenti visé (LUFS), ou null pour laisser le son tel quel. */
  loudness: number | null;
  voice: VoiceCleanup;
  /** Destination choisie : son préréglage a été appliqué, et le fichier sera contrôlé. */
  platform: PlatformId | null;
  /** Social format to fit the picture to, or null to keep its own proportions. */
  aspect: Aspect | null;
  reframeMode: ReframeMode;
}
const DEFAULT_PREFS: Prefs = {
  format: "mp4",
  quality: "balanced",
  resolution: null,
  gifWidth: 480,
  gifFps: 15,
  hardware: true,
  loudness: null,
  voice: NO_VOICE_CLEANUP,
  platform: null,
  aspect: null,
  reframeMode: "blur",
};

/** Last used choices, validated: a stale or hand-edited value falls back to its default. */
function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return {
      format: ["mp4", "mov", "webm", "avi", "gif"].includes(raw.format) ? raw.format : DEFAULT_PREFS.format,
      quality: QUALITIES.includes(raw.quality) ? raw.quality : DEFAULT_PREFS.quality,
      resolution: RESOLUTIONS.includes(raw.resolution) ? raw.resolution : null,
      gifWidth: GIF_WIDTHS.includes(raw.gifWidth) ? raw.gifWidth : DEFAULT_PREFS.gifWidth,
      gifFps: GIF_FPS.includes(raw.gifFps) ? raw.gifFps : DEFAULT_PREFS.gifFps,
      hardware: raw.hardware !== false,
      loudness: parseLoudness(raw.loudness),
      voice: parseVoice(raw.voice),
      platform: parsePlatform(raw.platform),
      aspect: ASPECTS.includes(raw.aspect) ? raw.aspect : null,
      reframeMode: raw.reframeMode === "crop" ? "crop" : "blur",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export default function ExportModal({ state, onClose, onQueued, onProjectsExport, associatedSrt, origin }: Props) {
  const owner = useVideoOwner();
  const { t, lang } = useT();
  const { t: tr } = useTranslation();
  const [projects, setProjects] = useState<string[]>([]);
  const [toComputer, setToComputer] = useState(!origin);
  const [toOrigin, setToOrigin] = useState(!!origin);
  const originSent = toOrigin && origin ? origin : null;
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const { format, quality, resolution, gifWidth, gifFps } = prefs;
  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* not remembered */
      }
      return next;
    });
  const setFormat = (f: Format) => update({ format: f });

  // The preset is not stored: it is whichever one the current choices spell out.
  const activePreset: PresetId | "custom" =
    SOCIAL_PRESETS.find(
      (p) =>
        prefs.aspect === p.aspect &&
        prefs.format === PRESET_SETTINGS.format &&
        prefs.reframeMode === PRESET_SETTINGS.mode &&
        prefs.resolution === PRESET_SETTINGS.resolution,
    )?.id ?? "custom";
  const applyPreset = (id: string) => {
    const preset = SOCIAL_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    update({
      aspect: preset.aspect,
      format: PRESET_SETTINGS.format,
      reframeMode: PRESET_SETTINGS.mode,
      resolution: PRESET_SETTINGS.resolution,
      quality: PRESET_SETTINGS.quality,
    });
  };

  const destination = platformOf(prefs.platform);
  const applyDestination = (id: string) => {
    const platform = parsePlatform(id);
    const spec = platformOf(platform);
    update(
      spec
        ? {
            platform,
            aspect: spec.preset.aspect,
            resolution: spec.preset.resolution,
            format: PRESET_SETTINGS.format,
            reframeMode: PRESET_SETTINGS.mode,
            quality: PRESET_SETTINGS.quality,
            loudness: spec.loudness,
          }
        : { platform: null },
    );
  };

  // What this machine's ffmpeg can do: hardware encoders (probed) and stabilisation.
  const [caps, setCaps] = useState<{ hardware: string[]; stabilization: boolean }>({
    hardware: [],
    stabilization: true,
  });
  useEffect(() => {
    let cancelled = false;
    getApi()
      .getCapabilities()
      .then((c) => {
        if (!cancelled) setCaps(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const hardwareId = caps.hardware[0] ?? null;
  const hardwareApplies = !!hardwareId && HARDWARE_FORMATS.includes(format);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loudnessSkipped, setLoudnessSkipped] = useState(false);
  // Position dans la file : l'export attend derrière les travaux actifs plus anciens (worker unique).
  const [queuedId, setQueuedId] = useState<number | null>(null);
  const [ahead, setAhead] = useState(0);
  const [outputPath, setOutputPath] = useState<string | null>(null);

  const FORMATS: { id: Format; label: string; desc: string }[] = [
    { id: "mp4", label: "MP4", desc: t.format_mp4_desc },
    { id: "mov", label: "MOV", desc: t.format_mov_desc },
    { id: "webm", label: "WebM", desc: t.format_webm_desc },
    { id: "avi", label: "AVI", desc: t.format_avi_desc },
    { id: "gif", label: "GIF", desc: t.format_gif_desc },
  ];

  const keptSegments = getKeptSegments(state.cutSegments, state.duration);

  // The exported clip plays the kept parts at `speed`, so it is shorter (or
  // longer) than the sum of the kept parts.
  const keptDuration = keptSegments.reduce((acc, s) => acc + (s.end - s.start), 0) / state.speed;
  const exporting = progress !== null && !done;
  const nothingToExport = keptSegments.length === 0;
  const destinationMissing = noDestination(toComputer, projects, toOrigin);

  useEffect(() => {
    if (queuedId === null) return;
    const count = (jobs: { id: number; status: string }[]) => {
      const mine = jobs.find((j) => j.id === queuedId);
      setAhead(
        mine?.status === "queued"
          ? jobs.filter((j) => j.id < queuedId && (j.status === "queued" || j.status === "running")).length
          : 0,
      );
    };
    const off = getApi().onQueueUpdate(count);
    getApi()
      .queueList()
      .then(count)
      .catch(() => {});
    return off;
  }, [queuedId]);

  useEffect(() => {
    const off = getApi(owner).onProgress((p: number) => setProgress(p));
    return off;
  }, [owner]);

  // Closing mid-export would leave it running with no way to see or stop it.
  // Ce qu'on sait avant d'exporter ; le reste est contrôlé sur le fichier produit.
  const [ratioW, ratioH] = (prefs.aspect ?? "").split(":").map(Number);
  const foreseen = destination
    ? checkDelivery(destination, { duration: keptDuration, ratio: ratioH ? ratioW / ratioH : undefined }).filter(
        (item) => !item.ok,
      )
    : [];

  const requestClose = () => {
    if (!exporting) onClose();
  };

  const soundApplies = !state.muted && format !== "gif";

  const buildOptions = (savePath: string) => ({
    inputPath: state.videoPath as string,
    outputPath: savePath,
    segments: keptSegments,
    speed: state.speed,
    crop: state.crop,
    filter: state.filter,
    rotation: state.rotation,
    straighten: state.straighten,
    perspectiveH: state.perspectiveHorizontal,
    perspectiveV: state.perspectiveVertical,
    muted: state.muted,
    loudness: soundApplies ? prefs.loudness : null,
    voice: soundApplies ? prefs.voice : null,
    format,
    quality,
    resolution: format === "gif" ? null : resolution,
    reframe: prefs.aspect ? { aspect: prefs.aspect, mode: prefs.reframeMode } : null,
    gifWidth,
    gifFps,
    stabilize: state.stabilize,
    hardware: hardwareApplies && prefs.hardware ? hardwareId : null,
    subtitles: state.subtitles
      ? { cues: state.subtitles.cues, style: state.subtitles.style, animation: state.subtitles.animation }
      : null,
  });

  /** L'export n'aura pas lieu : le fichier ne doit plus être ajouté aux projets annoncés. */
  const forgetAfterExport = async (savePath: string) => {
    if (projects.length > 0 || originSent)
      await getApi(owner)
        .addAfterExport(savePath, [], null)
        .catch(() => {});
  };

  const handleExport = async (mode: "now" | "queue" = "now") => {
    setError(null);
    setDone(false);
    setLoudnessSkipped(false);
    // Progress still reads 100 after a finished export: without this, cancelling the save dialog
    // of "Export again" would leave the window "exporting" with every button disabled.
    setProgress(null);

    if (!state.videoPath || nothingToExport || destinationMissing) return;

    const baseName =
      state.videoPath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.[^.]+$/, "") || "output";

    // Vers les seuls projets : un fichier temporaire, sans boîte d'enregistrement.
    let savePath: string | null;
    try {
      savePath = toComputer
        ? await getApi().saveVideo(`${baseName}_edit.${format}`, format)
        : await stagedExportPath(`${baseName}_edit.${format}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!savePath) return;

    if (projects.length > 0 || originSent) {
      try {
        onProjectsExport?.();
        await getApi().addAfterExport(savePath, projects, associatedSrt?.() ?? null, originSent);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    if (mode === "queue") {
      if (prefs.platform && toComputer) queuedDestinations.set(savePath, prefs.platform);
      else queuedDestinations.delete(savePath);
      try {
        await getApi().queueAdd(buildOptions(savePath));
        onQueued?.();
        onClose();
      } catch (err: unknown) {
        setError(engineErrorText(err instanceof Error ? err.message : String(err), t));
        await forgetAfterExport(savePath);
      }
      return;
    }

    setProgress(0);
    setQueuedId(null);
    setAhead(0);

    try {
      const result = await getApi(owner).exportVideo(buildOptions(savePath), setQueuedId);
      setDone(true);
      setLoudnessSkipped(result.notice === "loudness-skipped");
      setOutputPath(result.outputPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // The user pressed "Stop export": not a failure worth an error banner.
      setError(/cancelled/i.test(message) ? t.export_cancelled : engineErrorText(message, t));
      setProgress(null);
      await forgetAfterExport(savePath);
    }
  };

  const activeFilter = getFilterById(state.filter);
  const filterName = lang === "fr" ? activeFilter.nameFr : activeFilter.nameEn;

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t.export_title}</h2>
          <button className="modal-close" onClick={requestClose} disabled={exporting}>
            ×
          </button>
        </div>

        {/* Summary */}
        <div className="export-summary">
          <div className="summary-row">
            <span className="summary-label">{t.export_duration}</span>
            <span className="summary-value">{formatTime(keptDuration)}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t.tool_filters}</span>
            <span className="summary-value">{filterName}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t.export_speed}</span>
            <span className="summary-value">{state.speed}x</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t.export_audio}</span>
            <span className="summary-value">{state.muted ? t.export_audio_muted : t.export_audio_on}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t.export_crop}</span>
            <span className="summary-value">{state.crop ? `${state.crop.w}×${state.crop.h}` : t.export_crop_none}</span>
          </div>
          {prefs.aspect && (
            <div className="summary-row">
              <span className="summary-label">{t.export_reframe}</span>
              <span className="summary-value">
                {prefs.aspect} · {prefs.reframeMode === "blur" ? t.reframe_blur : t.reframe_crop}
              </span>
            </div>
          )}
          <div className="summary-row">
            <span className="summary-label">{t.tool_geometry}</span>
            <span className="summary-value">
              {t.geometry_summary_short(
                state.rotation + state.straighten,
                state.perspectiveHorizontal,
                state.perspectiveVertical,
              )}
            </span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t.export_cuts}</span>
            <span className="summary-value">
              {state.cutSegments.length > 0 ? t.export_cuts_removed(state.cutSegments.length) : t.export_cuts_none}
            </span>
          </div>
          {state.stabilize !== "off" && (
            <div className="summary-row">
              <span className="summary-label">{t.export_stabilization}</span>
              <span className="summary-value">{t[`stabilize_${state.stabilize}`]}</span>
            </div>
          )}
          <div className="summary-row">
            <span className="summary-label">{t.export_subtitles}</span>
            <span className="summary-value">
              {state.subtitles ? state.subtitles.fileName : t.export_subtitles_none}
            </span>
          </div>
        </div>

        {/* Social network presets */}
        <div className="export-options">
          <div className="opt-row">
            <span className="opt-label">{tr("delivery.destination")}</span>
            <DestinationSelect
              className="opt-select"
              value={prefs.platform}
              onChange={applyDestination}
              disabled={exporting}
            />
          </div>
          <div className="opt-row">
            <label className="opt-label" htmlFor="opt-preset">
              {t.export_preset}
            </label>
            <select
              id="opt-preset"
              className="opt-select"
              value={activePreset}
              disabled={exporting}
              onChange={(e) => applyPreset(e.target.value)}
            >
              <option value="custom" disabled>
                {t.preset_custom}
              </option>
              {SOCIAL_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t[`preset_${p.id}`]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Format picker */}
        <div className="format-grid">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              className={`format-card ${format === f.id ? "selected" : ""}`}
              onClick={() => setFormat(f.id)}
              disabled={exporting}
            >
              <div className="format-name">{f.label}</div>
              <div className="format-desc">{f.desc}</div>
            </button>
          ))}
        </div>

        {/* Quality, size and speed */}
        <div className="export-options">
          <div className="opt-row">
            <span className="opt-label">{t.export_quality}</span>
            <div className="seg" role="group" aria-label={t.export_quality}>
              {QUALITIES.map((q) => (
                <button
                  key={q}
                  className={`seg-btn ${quality === q ? "active" : ""}`}
                  aria-pressed={quality === q}
                  disabled={exporting}
                  onClick={() => update({ quality: q })}
                >
                  {t[`quality_${q}`]}
                </button>
              ))}
            </div>
          </div>

          <div className="opt-row">
            <label className="opt-label" htmlFor="opt-aspect">
              {t.export_reframe}
            </label>
            <select
              id="opt-aspect"
              className="opt-select"
              value={prefs.aspect ?? ""}
              disabled={exporting}
              onChange={(e) => update({ aspect: e.target.value === "" ? null : (e.target.value as Aspect) })}
            >
              <option value="">{t.reframe_original}</option>
              {ASPECTS.map((a) => (
                <option key={a} value={a}>
                  {t[`aspect_${a.replace(":", "_")}` as "aspect_9_16"]}
                </option>
              ))}
            </select>
          </div>
          {prefs.aspect && (
            <div className="opt-row">
              <span className="opt-label">{t.export_reframe_mode}</span>
              <div className="seg" role="group" aria-label={t.export_reframe_mode}>
                {(["blur", "crop"] as ReframeMode[]).map((m) => (
                  <button
                    key={m}
                    className={`seg-btn ${prefs.reframeMode === m ? "active" : ""}`}
                    aria-pressed={prefs.reframeMode === m}
                    title={t[`reframe_${m}_hint`]}
                    disabled={exporting}
                    onClick={() => update({ reframeMode: m })}
                  >
                    {t[`reframe_${m}`]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {format !== "gif" ? (
            <div className="opt-row">
              <label className="opt-label" htmlFor="opt-resolution">
                {t.export_resolution}
              </label>
              <select
                id="opt-resolution"
                className="opt-select"
                value={resolution ?? ""}
                disabled={exporting}
                title={prefs.aspect ? t.resolution_short_hint : undefined}
                onChange={(e) => update({ resolution: e.target.value === "" ? null : Number(e.target.value) })}
              >
                <option value="">{t.resolution_original}</option>
                {RESOLUTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}p
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="opt-row">
                <label className="opt-label" htmlFor="opt-gif-width">
                  {t.export_gif_width}
                </label>
                <select
                  id="opt-gif-width"
                  className="opt-select"
                  value={gifWidth}
                  disabled={exporting}
                  onChange={(e) => update({ gifWidth: Number(e.target.value) })}
                >
                  {GIF_WIDTHS.map((w) => (
                    <option key={w} value={w}>
                      {w}px
                    </option>
                  ))}
                </select>
              </div>
              <div className="opt-row">
                <label className="opt-label" htmlFor="opt-gif-fps">
                  {t.export_gif_fps}
                </label>
                <select
                  id="opt-gif-fps"
                  className="opt-select"
                  value={gifFps}
                  disabled={exporting}
                  onChange={(e) => update({ gifFps: Number(e.target.value) })}
                >
                  {GIF_FPS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {hardwareApplies && (
            <div className="opt-row">
              <label className="opt-label" htmlFor="opt-hardware">
                {t.export_hardware}
              </label>
              <label className="opt-check" title={t.export_hardware_hint}>
                <input
                  id="opt-hardware"
                  type="checkbox"
                  checked={prefs.hardware}
                  disabled={exporting}
                  onChange={(e) => update({ hardware: e.target.checked })}
                />
                <span>{t[`hw_${hardwareId as "videotoolbox" | "nvenc" | "qsv" | "vaapi"}`] ?? hardwareId}</span>
              </label>
            </div>
          )}

          {soundApplies && (
            <VoiceCleanupFields
              value={prefs.voice}
              onChange={(voice) => update({ voice })}
              disabled={exporting}
              classes={{ row: "opt-row", label: "opt-label", select: "opt-select", check: "opt-check" }}
              texts={{
                label: t.voice_label,
                levels: { off: t.voice_off, light: t.voice_light, medium: t.voice_medium, strong: t.voice_strong },
                denoise: t.voice_denoise,
                gate: t.voice_gate,
                hint: t.voice_hint,
              }}
            />
          )}

          {soundApplies && (
            <div className="opt-row">
              <label className="opt-label" htmlFor="opt-loudness">
                {t.export_loudness}
              </label>
              <select
                id="opt-loudness"
                className="opt-select"
                value={prefs.loudness ?? ""}
                disabled={exporting}
                title={t.export_loudness_hint}
                onChange={(e) => update({ loudness: parseLoudness(e.target.value || null) })}
              >
                <option value="">{t.export_loudness_off}</option>
                {LOUDNESS_TARGETS.map((target) => (
                  <option key={target} value={target}>
                    {target} LUFS
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Progress */}
        {progress !== null && (
          <div className="export-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-label">
              {done ? t.export_done : ahead > 0 ? t.export_waiting(ahead) : `${progress}%`}
            </div>
          </div>
        )}

        {done && outputPath && toComputer && (
          <div className="export-done">
            {t.export_saved} <strong>{outputPath}</strong>
          </div>
        )}

        {!done && destination && foreseen.length > 0 && <CheckList platform={prefs.platform!} items={foreseen} />}

        {done && outputPath && toComputer && prefs.platform && (
          <DeliveryCheck platform={prefs.platform} path={outputPath} />
        )}

        {done && loudnessSkipped && <div className="export-error">{t.export_loudness_skipped}</div>}

        <AddToProjects
          selected={projects}
          onChange={setProjects}
          toComputer={toComputer}
          onToComputer={setToComputer}
          origin={origin}
          toOrigin={toOrigin}
          onToOrigin={setToOrigin}
        />

        {nothingToExport && <div className="export-error">{t.export_nothing}</div>}

        {error && (
          <div className="export-error">
            {t.export_error}: {error}
          </div>
        )}

        {/* Actions */}
        <div className="modal-actions">
          {exporting ? (
            <button
              className="btn-ghost"
              onClick={() => {
                void getApi(owner).cancelFfmpeg();
              }}
            >
              {t.export_stop}
            </button>
          ) : (
            <button className="btn-ghost" onClick={onClose}>
              {t.export_cancel}
            </button>
          )}
          <button
            className="btn-ghost"
            onClick={() => {
              void handleExport("queue");
            }}
            disabled={exporting || nothingToExport || destinationMissing}
          >
            {t.export_queue_add}
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              void handleExport("now");
            }}
            disabled={exporting || nothingToExport || destinationMissing}
          >
            {done ? t.export_again : t.export_btn}
          </button>
        </div>
      </div>
    </div>
  );
}
