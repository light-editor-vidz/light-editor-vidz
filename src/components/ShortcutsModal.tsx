import { useEffect } from "react";
import { useTranslation } from "react-i18next";

/** Keyboard shortcuts handled by `useEditorShortcuts` / `Editor.tsx` — informative only. */
const SHORTCUTS: [string, string][] = [
  ["topbar.shortcutPlayPause", "topbar.keySpace"],
  ["topbar.shortcutStepFrame", "←/→"],
  ["topbar.shortcutStepSecond", "Shift+←/→"],
  ["topbar.shortcutNudge", "←↑↓→"],
  ["topbar.shortcutHomeEnd", "topbar.keyHomeEnd"],
  ["topbar.shortcutSave", "Ctrl+S"],
  ["topbar.shortcutDelete", "topbar.keyDelete"],
  ["topbar.shortcutDuplicate", "Ctrl+D"],
  ["topbar.shortcutCopy", "Ctrl+C"],
  ["topbar.shortcutPaste", "Ctrl+V"],
  ["topbar.shortcutSelectAll", "Ctrl+A"],
  ["topbar.shortcutGroup", "Ctrl+G"],
  ["topbar.shortcutUngroup", "Ctrl+Shift+G"],
  ["topbar.shortcutDeselect", "topbar.keyEscape"],
  ["topbar.shortcutUndo", "Ctrl+Z"],
  ["topbar.shortcutRedo", "Ctrl+Shift+Z"],
];

/** The shortcuts window of the Help menu. */
export default function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="cl-backdrop">
      <div className="cl-scrim" aria-hidden="true" onClick={onClose} />
      <div className="cl-card shortcuts-card" role="dialog" aria-modal="true" aria-label={t("topbar.shortcutsTitle")}>
        <div className="cl-header">
          <div className="cl-title">{t("topbar.shortcutsTitle")}</div>
          <button type="button" className="cl-close" onClick={onClose} aria-label={t("common.close")}>
            ×
          </button>
        </div>
        <div className="shortcuts-list">
          {SHORTCUTS.map(([labelKey, keys]) => (
            <div className="shortcuts-row" key={labelKey}>
              <span>{t(labelKey)}</span>
              <kbd>{keys.startsWith("topbar.") ? t(keys) : keys}</kbd>
            </div>
          ))}
        </div>
        <div className="cl-actions">
          <button type="button" className="sb-primary" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
