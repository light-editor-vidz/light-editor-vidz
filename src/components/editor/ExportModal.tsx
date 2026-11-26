import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, ArrowRight } from "lucide-react";
import type { AudioExportFormat, ExportOptions } from "../../lib/commands";
import { exportDimensions } from "../../lib/exportSize";
import { LOUDNESS_TARGETS } from "../../lib/loudness";
import { CheckList, DestinationSelect } from "../DeliveryCheck";
import { checkDelivery, parsePlatform, platformOf, type PlatformId } from "../../lib/platforms";
import "../NewProjectModal.css";

interface Props {
  projectWidth: number;
  projectHeight: number;
  projectFps: number;
  projectDuration: number;
  /** `platform` : la destination choisie, contrôlée une fois le fichier écrit. */
  onExport: (options: ExportOptions, platform?: PlatformId) => void;
  /** Export du son seul (mix des pistes audio et de l'audio des vidéos). */
  onExportAudio: (format: AudioExportFormat, loudness: number | null) => void;
  onClose: () => void;
  exporting: boolean;
}

type ResolutionChoice = "original" | 1080 | 720 | 480;
type QualityChoice = "high" | "medium" | "low";
type ModeChoice = "video" | "audio";

// Noms de formats : identiques dans toutes les langues, sauf « float » (`labelKey`).
const AUDIO_FORMAT_ROWS: { value: AudioExportFormat; label: string; labelKey?: string }[][] = [
  [
    { value: "wav16", label: "WAV 16-bit" },
    { value: "wav24", label: "WAV 24-bit" },
    { value: "wav32f", label: "WAV 32-bit float", labelKey: "exportModal.wav32f" },
  ],
  [
    { value: "mp3", label: "MP3" },
    { value: "flac", label: "FLAC" },
    { value: "ogg", label: "OGG Vorbis" },
    { value: "m4a", label: "M4A (AAC)" },
  ],
];

const QUALITY_CRF: Record<QualityChoice, number> = { high: 18, medium: 23, low: 28 };

export default function ExportModal({
  projectWidth,
  projectHeight,
  projectFps,
  projectDuration,
  onExport,
  onExportAudio,
  onClose,
  exporting,
}: Props) {
  const { t } = useTranslation();
  const [resolution, setResolution] = useState<ResolutionChoice>("original");
  const [fps, setFps] = useState<number | "original">("original");
  const [quality, setQuality] = useState<QualityChoice>("medium");
  const [mode, setMode] = useState<ModeChoice>("video");
  const [audioFormat, setAudioFormat] = useState<AudioExportFormat>("mp3");
  const [loudness, setLoudness] = useState<number | null>(null);
  const [platform, setPlatform] = useState<PlatformId | null>(null);

  const RESOLUTION_OPTIONS: { value: ResolutionChoice; label: string }[] = [
    { value: "original", label: t("exportModal.resolutionOriginal") },
    { value: 1080, label: "1080p" },
    { value: 720, label: "720p" },
    { value: 480, label: "480p" },
  ];
  const FPS_OPTIONS: { value: number | "original"; label: string }[] = [
    { value: "original", label: t("exportModal.fpsOriginal") },
    { value: 24, label: "24" },
    { value: 30, label: "30" },
    { value: 60, label: "60" },
  ];
  const QUALITY_OPTIONS: { value: QualityChoice; label: string }[] = [
    { value: "high", label: t("exportModal.qualityHigh") },
    { value: "medium", label: t("exportModal.qualityMedium") },
    { value: "low", label: t("exportModal.qualityLow") },
  ];

  const dimensions = exportDimensions(projectWidth, projectHeight, resolution);

  // Le préréglage règle la sortie ; le format du projet, lui, ne change pas.
  function applyDestination(id: string) {
    const next = parsePlatform(id);
    setPlatform(next);
    const spec = platformOf(next);
    if (!spec) return;
    setResolution(spec.preset.resolution);
    setFps(spec.preset.fps ?? "original");
    setQuality("medium");
    setLoudness(spec.loudness);
  }
  const destination = platformOf(platform);
  const foreseen = destination
    ? checkDelivery(destination, {
        duration: projectDuration,
        ratio: projectWidth / projectHeight,
        height: dimensions.effective.height,
        fps: fps === "original" ? projectFps : fps,
      }).filter((item) => !item.ok)
    : [];

  function handleExport() {
    if (mode === "audio") {
      onExportAudio(audioFormat, loudness);
      return;
    }
    const options: ExportOptions = {
      width: dimensions.width,
      height: dimensions.height,
      fps: fps === "original" ? null : fps,
      crf: QUALITY_CRF[quality],
      loudness,
    };
    if (platform) onExport(options, platform);
    else onExport(options);
  }

  return (
    <div className="modal-backdrop" onClick={exporting ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{t(mode === "audio" ? "exportModal.titleAudio" : "exportModal.title")}</h2>
            <p className="modal-subtitle">
              {t("exportModal.subtitle", { width: projectWidth, height: projectHeight, fps: projectFps })}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} disabled={exporting}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-group">
            <div className="fps-row">
              {(["video", "audio"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={`fps-option${mode === value ? " selected" : ""}`}
                  onClick={() => setMode(value)}
                >
                  <span className="fps-value mono">
                    {t(value === "video" ? "exportModal.modeVideo" : "exportModal.modeAudio")}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {mode === "audio" ? (
            <div className="field-group">
              <span className="field-label">{t("exportModal.audioFormat")}</span>
              {AUDIO_FORMAT_ROWS.map((row, i) => (
                <div className="fps-row" key={i}>
                  {row.map((opt) => (
                    <button
                      type="button"
                      key={opt.value}
                      className={`fps-option${audioFormat === opt.value ? " selected" : ""}`}
                      onClick={() => setAudioFormat(opt.value)}
                    >
                      <span className="fps-value mono">{opt.labelKey ? t(opt.labelKey) : opt.label}</span>
                    </button>
                  ))}
                </div>
              ))}
              <span className="modal-hint">{t("exportModal.audioHint")}</span>
            </div>
          ) : (
            <>
              <div className="field-group">
                <span className="field-label">{t("delivery.destination")}</span>
                <DestinationSelect className="properties-input" value={platform} onChange={applyDestination} />
                {destination && foreseen.length > 0 && <CheckList platform={platform!} items={foreseen} />}
              </div>

              <div className="field-group">
                <span className="field-label">{t("exportModal.resolution")}</span>
                <div className="fps-row">
                  {RESOLUTION_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={String(opt.value)}
                      className={`fps-option${resolution === opt.value ? " selected" : ""}`}
                      onClick={() => setResolution(opt.value)}
                    >
                      <span className="fps-value mono">{opt.label}</span>
                    </button>
                  ))}
                </div>
                <span className="modal-hint mono">{t("exportModal.outputSize", dimensions.effective)}</span>
              </div>

              <div className="field-group">
                <span className="field-label">{t("exportModal.fps")}</span>
                <div className="fps-row">
                  {FPS_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={String(opt.value)}
                      className={`fps-option${fps === opt.value ? " selected" : ""}`}
                      onClick={() => setFps(opt.value)}
                    >
                      <span className="fps-value mono">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-group">
                <span className="field-label">{t("exportModal.quality")}</span>
                <div className="fps-row">
                  {QUALITY_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={opt.value}
                      className={`fps-option${quality === opt.value ? " selected" : ""}`}
                      onClick={() => setQuality(opt.value)}
                    >
                      <span className="fps-value mono">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="field-group">
            <span className="field-label">{t("loudness.label")}</span>
            <div className="fps-row" role="group" aria-label={t("loudness.label")}>
              {[null, ...LOUDNESS_TARGETS].map((value) => (
                <button
                  type="button"
                  key={String(value)}
                  className={`fps-option${loudness === value ? " selected" : ""}`}
                  aria-pressed={loudness === value}
                  onClick={() => setLoudness(value)}
                >
                  <span className="fps-value mono">{value === null ? t("loudness.off") : `${value} LUFS`}</span>
                </button>
              ))}
            </div>
            <span className="modal-hint">{t("loudness.hint")}</span>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={exporting}>
            {t("modal.cancel")}
          </button>
          <button type="button" className="btn-primary" onClick={handleExport} disabled={exporting}>
            {exporting ? t("topbar.exporting") : t("exportModal.confirm")}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
