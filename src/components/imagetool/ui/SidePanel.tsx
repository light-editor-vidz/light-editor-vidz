import type { ReactNode } from "react";
import { useT } from "../lib/langContext";
import { ResetIcon } from "./PanelParts";

interface Props {
  title: string;
  /** Revient à l'image d'origine ; le bouton n'apparaît que si cette action est fournie. */
  onReset?: () => void;
  canReset?: boolean;
  children: ReactNode;
}

/**
 * Un panneau à droite de la barre d'outils : ce que chaque bouton de la barre ouvre, que ce
 * soit une barre de réglages, une boîte de saisie ou un panneau de liste. Un seul à la fois.
 */
export function SidePanel({ title, onReset, canReset = false, children }: Props) {
  const t = useT();
  return (
    <aside className="side-panel" role="region" aria-label={title}>
      <div className="side-panel-head">
        <span className="side-panel-title">{title}</span>
        {onReset && (
          <button
            className="side-panel-reset"
            onClick={onReset}
            disabled={!canReset}
            title={t("adj.reset")}
            aria-label={t("adj.reset")}
          >
            <ResetIcon />
          </button>
        )}
      </div>
      <div className="side-panel-body">{children}</div>
    </aside>
  );
}
