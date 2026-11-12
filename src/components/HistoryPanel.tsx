import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { History, X } from "lucide-react";
import "./HistoryPanel.css";

/**
 * L'historique d'une vue (Audio, Vidéo, projet) : chaque étape, la courante en évidence, celles
 * qu'on a annulées en retrait ; un clic ramène à l'étape choisie.
 */
export default function HistoryPanel({
  labels,
  current,
  onGoto,
  onClose,
}: {
  labels: string[];
  current: number;
  onGoto: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const active = useRef<HTMLButtonElement>(null);

  // L'étape courante reste visible quand la liste défile.
  useEffect(() => {
    active.current?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  return (
    <aside className="history-panel" aria-label={t("history.title")}>
      <div className="history-panel-header">
        <History size={14} aria-hidden="true" />
        <span>{t("history.title")}</span>
        <button
          type="button"
          className="history-panel-close"
          onClick={onClose}
          title={t("history.close")}
          aria-label={t("history.close")}
        >
          <X size={14} />
        </button>
      </div>
      <ol className="history-panel-list">
        {labels.map((label, i) => (
          <li key={i}>
            <button
              type="button"
              ref={i === current ? active : undefined}
              className={`history-step${i === current ? " current" : ""}${i > current ? " undone" : ""}`}
              aria-current={i === current ? "step" : undefined}
              disabled={i === current}
              onClick={() => onGoto(i)}
              title={label}
            >
              {label}
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
