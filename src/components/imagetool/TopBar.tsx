import { useT } from "./lib/langContext";

interface Props {
  /** Nom du fichier de l'onglet actif. */
  name: string;
  /** Dimensions et format, sous le nom. */
  meta: string;
  canUndo: boolean;
  canRedo: boolean;
  isLoading: boolean;
  undoTitle: string;
  redoTitle: string;
  onUndo: () => void;
  onRedo: () => void;
  onOpen: () => void;
  onExport: () => void;
}

/**
 * La barre du haut, comme dans LightCutVidz : le nom du fichier avec ses informations à
 * gauche ; Annuler, Rétablir, Ouvrir et Exporter à droite.
 */
export function TopBar({
  name,
  meta,
  canUndo,
  canRedo,
  isLoading,
  undoTitle,
  redoTitle,
  onUndo,
  onRedo,
  onOpen,
  onExport,
}: Props) {
  const t = useT();

  return (
    <div className="top-bar">
      <div className="file-badge" title={name}>
        <span className="file-badge-name">{name}</span>
        <span className="file-badge-meta">{meta}</span>
      </div>
      <div className="top-bar-actions">
        <button
          className="btn-ghost btn-icon"
          onClick={onUndo}
          disabled={!canUndo || isLoading}
          title={undoTitle}
          aria-label={t("a11y.undo")}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
          </svg>
        </button>
        <button
          className="btn-ghost btn-icon"
          onClick={onRedo}
          disabled={!canRedo || isLoading}
          title={redoTitle}
          aria-label={t("a11y.redo")}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 14 20 9 15 4" />
            <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
          </svg>
        </button>
        <button className="btn-ghost" onClick={onOpen} disabled={isLoading} aria-label={t("a11y.open-image")}>
          {t("topbar.open")}
        </button>
        <button className="btn-primary" onClick={onExport} disabled={isLoading} aria-label={t("tooltip.export")}>
          {t("topbar.export")}
        </button>
      </div>
    </div>
  );
}
