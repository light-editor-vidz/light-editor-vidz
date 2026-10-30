import { AlertTriangle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface Notice {
  kind: "error" | "warning" | "info";
  message: string;
  /** Action proposée (ex : réessayer, afficher le fichier). */
  action?: { label: string; onClick: () => void };
  details?: string[];
}

/** Bandeau non bloquant en haut de l'éditeur : l'état de l'éditeur est conservé. */
export default function StatusBanner({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={`status-banner status-banner-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
      <AlertTriangle size={14} />
      <div className="status-banner-text">
        <span>{notice.message}</span>
        {notice.details && notice.details.length > 0 && (
          <ul className="status-banner-details">
            {notice.details.slice(0, 5).map((d) => (
              <li key={d}>{d}</li>
            ))}
            {notice.details.length > 5 && <li>…</li>}
          </ul>
        )}
      </div>
      {notice.action && (
        <button type="button" className="btn-secondary status-banner-action" onClick={notice.action.onClick}>
          {notice.action.label}
        </button>
      )}
      {onDismiss && (
        <button type="button" className="icon-btn icon-btn-sm" onClick={onDismiss} title={t("common.dismiss")}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}
