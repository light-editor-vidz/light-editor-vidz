import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { History, Redo2, Undo2 } from "lucide-react";
import type { Project } from "../../bindings/Project";
import { describeError, isExportCancelled } from "../../lib/errors";
import {
  AUDIO_FORMAT_EXTENSION,
  cancelExport,
  exportProject,
  exportProjectAudio,
  type AudioExportFormat,
  type ExportOptions,
  type ExportResult,
} from "../../lib/commands";
import type { Notice } from "./StatusBanner";
import { expandLinkedSubtitles } from "../../lib/subs/linked";
import ExportModal from "./ExportModal";
import { useRegisterMenuActions } from "../../lib/menuBridge";
import { markBusy } from "../../lib/busyWork";

interface Props {
  project: Project;
  projectDir: string;
  /** Affiche (ou retire, avec `null`) un message non bloquant au-dessus de l'éditeur. */
  onNotice: (notice: Notice | null) => void;
  saving: boolean;
  /** Modifications non enregistrées (la sauvegarde automatique est en attente). */
  dirty: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Generates the subtitles of the whole project. */
  onGenerateSubtitles?: () => void;
  /** Le panneau Historique est affiché. */
  historyOpen?: boolean;
  onToggleHistory?: () => void;
}

export default function TopBar({
  project,
  projectDir,
  onNotice,
  saving,
  dirty,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onGenerateSubtitles,
  historyOpen = false,
  onToggleHistory,
}: Props) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  // Quitter pendant l'export demande confirmation.
  useEffect(() => (exporting ? markBusy("quit.projectExport") : undefined), [exporting]);
  const [exportProgress, setExportProgress] = useState(0);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportStartedAt, setExportStartedAt] = useState(0);

  useEffect(() => {
    const unlisten = listen<number>("export-progress", (e) => setExportProgress(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // The File menu's Export… opens the same window.
  useRegisterMenuActions({ openExport: () => setShowExportModal(true) });

  async function handleExport(options: ExportOptions) {
    onNotice(null);
    const outputPath = await save({
      defaultPath: `${project.name.trim() || "video"}.mp4`,
      filters: [{ name: t("topbar.mp4Filter"), extensions: ["mp4"] }],
    });
    if (!outputPath) return;
    await runExport(outputPath, () => exportProject(projectDir, expandLinkedSubtitles(project), outputPath, options));
  }

  async function handleExportAudio(format: AudioExportFormat) {
    onNotice(null);
    const extension = AUDIO_FORMAT_EXTENSION[format];
    const outputPath = await save({
      defaultPath: `${project.name.trim() || "audio"}.${extension}`,
      filters: [{ name: t("topbar.audioFilter", { ext: extension.toUpperCase() }), extensions: [extension] }],
    });
    if (!outputPath) return;
    await runExport(outputPath, () => exportProjectAudio(projectDir, project, outputPath, format));
  }

  /** Suivi commun aux deux exports : progression, notification de fin, annulation, erreurs. */
  async function runExport(outputPath: string, run: () => Promise<ExportResult>) {
    setExporting(true);
    setExportProgress(0);
    setExportStartedAt(performance.now());
    try {
      const result = await run();
      setShowExportModal(false);
      const missing = result.missing_media;
      onNotice({
        kind: missing.length > 0 ? "warning" : "info",
        message:
          missing.length > 0 ? t("topbar.exportMissingMedia", { count: missing.length }) : t("topbar.exportDone"),
        details: missing,
        action: {
          label: t("topbar.showInFolder"),
          onClick: () => {
            void revealItemInDir(outputPath).catch(() => {});
          },
        },
      });
    } catch (e) {
      setShowExportModal(false);
      const message = describeError(e);
      // Annulation voulue par l'utilisateur : simple confirmation, pas une erreur.
      if (isExportCancelled(e)) {
        onNotice({ kind: "info", message: t("topbar.exportCancelled") });
      } else {
        onNotice({ kind: "error", message: t("topbar.exportFailedDetail", { error: message }) });
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <header className="editor-topbar">
      <div className="file-badge" title={project.name}>
        <span className="file-badge-name">
          {project.name}
          {dirty && !saving && <span className="topbar-dirty-dot" aria-label={t("topbar.unsavedChanges")} />}
        </span>
        <span className="file-badge-meta">
          {project.width} × {project.height} · {project.fps}fps
          {saving ? ` · ${t("topbar.saving")}` : ""}
        </span>
      </div>

      <div className="top-bar-actions">
        <button
          type="button"
          className="sb-ghost icon-square"
          onClick={onUndo}
          disabled={!canUndo}
          title={t("topbar.undo")}
          aria-label={t("topbar.undo")}
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          className="sb-ghost icon-square"
          onClick={onRedo}
          disabled={!canRedo}
          title={t("topbar.redo")}
          aria-label={t("topbar.redo")}
        >
          <Redo2 size={15} />
        </button>
        {onToggleHistory && (
          <button
            type="button"
            className={`sb-ghost icon-square${historyOpen ? " active" : ""}`}
            onClick={onToggleHistory}
            aria-pressed={historyOpen}
            title={t("history.toggle")}
            aria-label={t("history.toggle")}
          >
            <History size={15} />
          </button>
        )}
        {onGenerateSubtitles && (
          <button type="button" className="sb-ghost" onClick={onGenerateSubtitles} disabled={exporting}>
            {t("subs.menu")}
          </button>
        )}
        {exporting && (
          <button type="button" className="sb-ghost" onClick={() => void cancelExport()}>
            {t("topbar.cancelExport")}
          </button>
        )}
        <button type="button" className="sb-primary" onClick={() => setShowExportModal(true)} disabled={exporting}>
          {exporting
            ? `${t("topbar.exporting")} ${Math.round(exportProgress * 100)}%${formatEta(exportStartedAt, exportProgress)}`
            : t("topbar.export")}
        </button>
      </div>
      {exporting && (
        <div className="export-progress-bar">
          <div className="export-progress-fill" style={{ width: `${exportProgress * 100}%` }} />
        </div>
      )}
      {showExportModal && (
        <ExportModal
          projectWidth={project.width}
          projectHeight={project.height}
          projectFps={project.fps}
          onExport={handleExport}
          onExportAudio={handleExportAudio}
          onClose={() => setShowExportModal(false)}
          exporting={exporting}
        />
      )}
    </header>
  );
}

/** " · ~2:41" : temps restant estimé par extrapolation linéaire de la progression. Vide tant
 * que la progression est trop faible pour donner une estimation stable. */
function formatEta(startedAt: number, progress: number): string {
  if (progress < 0.03) return "";
  const elapsed = (performance.now() - startedAt) / 1000;
  const remaining = Math.max(0, (elapsed * (1 - progress)) / progress);
  const m = Math.floor(remaining / 60);
  const s = Math.round(remaining % 60);
  return ` · ~${m}:${s.toString().padStart(2, "0")}`;
}
