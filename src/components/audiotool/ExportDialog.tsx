import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { ExportFormat, WavDepth } from "../../lib/audiotool/helpers";
import "../NewProjectModal.css";

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "wav", label: "WAV" },
  { value: "mp3", label: "MP3" },
  { value: "flac", label: "FLAC" },
  { value: "ogg", label: "OGG" },
  { value: "m4a", label: "M4A" },
];

const DEPTHS: { value: WavDepth; key: string }[] = [
  { value: "float32", key: "audioTool.depth.float32" },
  { value: "pcm24", key: "audioTool.depth.pcm24" },
  { value: "pcm16", key: "audioTool.depth.pcm16" },
];

interface Props {
  format: ExportFormat;
  wavDepth: WavDepth;
  onFormat: (format: ExportFormat) => void;
  onWavDepth: (depth: WavDepth) => void;
  /** Ce qui ferait refuser l'export, déjà traduit ; vide si rien. */
  problem: string;
  processing: boolean;
  /** Avancement, de 0 à 100. */
  progress: number;
  onExport: () => void;
  onCancel: () => void;
  onClose: () => void;
  /** « Ajouter à un projet ». */
  addToProjects?: ReactNode;
}

/** Les options d'export : le format, et le format des échantillons pour un WAV. */
export default function ExportDialog({
  format,
  wavDepth,
  onFormat,
  onWavDepth,
  problem,
  processing,
  progress,
  onExport,
  onCancel,
  onClose,
  addToProjects,
}: Props) {
  const { t } = useTranslation();

  // Un export en cours s'arrête avec son propre bouton, pas en masquant la fenêtre.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !processing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [processing, onClose]);

  return (
    <div className="modal-backdrop" onClick={processing ? undefined : onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("audioTool.export.title")}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={processing}
            title={t("audioTool.export.close")}
            aria-label={t("audioTool.export.close")}
          >
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="at-formats">
            {FORMATS.map(({ value, label }) => (
              <button
                type="button"
                key={value}
                className={`fps-option${format === value ? " selected" : ""}`}
                aria-pressed={format === value}
                disabled={processing}
                onClick={() => onFormat(value)}
              >
                <span className="fps-value mono">{label}</span>
              </button>
            ))}
          </div>
          {format === "wav" && (
            <div className="at-opt-row">
              <label htmlFor="at-wav-depth">{t("audioTool.export.depth")}</label>
              <select
                id="at-wav-depth"
                className="at-select"
                value={wavDepth}
                disabled={processing}
                onChange={(e) => onWavDepth(e.target.value as WavDepth)}
              >
                {DEPTHS.map(({ value, key }) => (
                  <option key={value} value={value}>
                    {t(key)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {processing && (
            <div
              className="at-progress"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="at-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
          {addToProjects}
          <span className="at-export-hint" role="status">
            {problem}
          </span>
        </div>
        <div className="modal-footer">
          {processing ? (
            <button type="button" className="btn-secondary" onClick={onCancel}>
              {t("audioTool.export.cancel")}
            </button>
          ) : (
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t("audioTool.export.cancel")}
            </button>
          )}
          <button type="button" className="btn-primary" onClick={onExport} disabled={processing || problem !== ""}>
            {processing ? t("audioTool.export.progress", { percent: progress }) : t("audioTool.export.run")}
          </button>
        </div>
      </div>
    </div>
  );
}
