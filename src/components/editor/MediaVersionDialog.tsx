import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { SwapScope } from "../../lib/mediaSwap";
import "../NewProjectModal.css";

/** Une nouvelle version d'un média vient d'être enregistrée : à quels clips s'applique-t-elle ?
 * L'ancienne version reste dans la médiathèque. */
export default function MediaVersionDialog({
  count,
  canChooseClip,
  onChoose,
  onClose,
}: {
  /** Nombre de clips qui utilisent l'ancienne version. */
  count: number;
  /** Le clip d'où vient la demande est connu : on peut ne remplacer que lui. */
  canChooseClip: boolean;
  onChoose: (scope: SwapScope) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{t("mediaVersion.title")}</h2>
            <p className="modal-subtitle">{t("mediaVersion.intro", { count })}</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t("mediaVersion.keep")}
          </button>
          {canChooseClip && (
            <button type="button" className="btn-secondary" onClick={() => onChoose("clip")}>
              {t("mediaVersion.thisClip")}
            </button>
          )}
          <button type="button" className="btn-primary" onClick={() => onChoose("all")} autoFocus>
            {t("mediaVersion.all", { count })}
          </button>
        </div>
      </div>
    </div>
  );
}
