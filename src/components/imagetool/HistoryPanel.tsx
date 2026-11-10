import type { HistoryEntry } from "./types";
import { useT } from "./lib/langContext";
import { MOD } from "./lib/platform";

interface HistoryPanelProps {
  history: HistoryEntry[];
  currentIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Clic sur une étape : y revenir (ou l'avancer) directement. */
  onJump?: (index: number) => void;
  isLoading: boolean;
}

export function HistoryPanel({
  history,
  currentIndex,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onJump,
  isLoading,
}: HistoryPanelProps) {
  const t = useT();
  return (
    <aside className="flex flex-col w-44 bg-slate-900 border-l border-slate-700 shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("hist.header")}</span>
        <div className="flex gap-1">
          <button
            onClick={onUndo}
            disabled={!canUndo || isLoading}
            className="toolbar-btn p-1"
            title={t("hist.undo", { mod: MOD })}
            aria-label={t("a11y.undo")}
          >
            <UndoIcon />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo || isLoading}
            className="toolbar-btn p-1"
            title={t("hist.redo", { mod: MOD })}
            aria-label={t("a11y.redo")}
          >
            <RedoIcon />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {history.length === 0 ? (
          <p className="text-xs text-slate-600 px-3 py-2 italic">{t("hist.empty")}</p>
        ) : (
          <ul>
            {history.map((entry, i) => {
              const isActive = i === currentIndex;
              const isFuture = i > currentIndex;
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onJump?.(i)}
                    disabled={isLoading || !onJump || isActive}
                    aria-current={isActive ? "step" : undefined}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left select-none ${
                      isActive
                        ? "bg-indigo-900/60 text-indigo-200 font-medium"
                        : isFuture
                          ? "text-slate-600 hover:bg-slate-800"
                          : "text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    <ActionIcon kind={entry.key} />
                    <span className="truncate">{t(entry.key, entry.params)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function ActionIcon({ kind }: { kind: string }) {
  const base = {
    width: 11,
    height: 11,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    className: "shrink-0 opacity-60",
  };
  if (kind === "hist.open") {
    return (
      <svg {...base}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    );
  }
  if (kind === "hist.crop") {
    return (
      <svg {...base}>
        <polyline points="6 2 6 6 2 6" />
        <polyline points="18 22 18 18 22 18" />
        <path d="M2 12h14v10" />
        <path d="M12 2v14H2" />
      </svg>
    );
  }
  return (
    <svg {...base}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
