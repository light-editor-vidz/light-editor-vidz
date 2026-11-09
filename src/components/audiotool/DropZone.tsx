import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { audioPickFile, audioRecentForget, audioRecentList, type RecentAudio } from "../../lib/audiotool/commands";
import { describeEngineError } from "../../lib/audiotool/helpers";
import { useTabActive } from "../../lib/menuBridge";

interface Props {
  onOpen: (path: string) => void;
  onError: (message: string) => void;
}

/** L'onglet audio sans fichier : un cadre pour déposer ou parcourir, et les fichiers récents. */
export default function DropZone({ onOpen, onError }: Props) {
  const { t } = useTranslation();
  const tabActive = useTabActive();
  const [recents, setRecents] = useState<RecentAudio[]>([]);

  const refresh = useCallback(() => {
    audioRecentList()
      .then((list) => setRecents(Array.isArray(list) ? list.slice(0, 5) : []))
      .catch(() => setRecents([]));
  }, []);
  useEffect(() => {
    if (tabActive) refresh();
  }, [tabActive, refresh]);

  async function browse() {
    try {
      const path = await audioPickFile();
      if (path) onOpen(path);
    } catch (e) {
      onError(describeEngineError(e, (key, vars) => String(t(key, vars))));
    }
  }

  async function forget(path: string | null) {
    await audioRecentForget(path).catch(() => {});
    refresh();
  }

  return (
    <section className="at-drop">
      <div className="at-drop-frame">
        <img src="/tools/soundz.png" alt="" className="at-drop-icon" />
        <h2 className="at-drop-name">{t("audioTool.drop.name")}</h2>
        <p className="at-drop-subtitle">{t("audioTool.drop.title")}</p>
        <button type="button" className="at-btn primary" onClick={() => void browse()}>
          {t("audioTool.drop.open")}
        </button>
      </div>
      <p className="at-drop-formats">MP3 · WAV · FLAC · OGG · AAC · M4A · AIFF</p>
      {recents.length > 0 && (
        <div className="at-recent">
          <div className="at-recent-head">
            <h3>{t("audioTool.recent.title")}</h3>
            <button type="button" className="at-link" onClick={() => void forget(null)}>
              {t("audioTool.recent.clear")}
            </button>
          </div>
          <ul>
            {recents.map(({ path, name, dir }) => (
              <li className="at-recent-item" key={path}>
                <button type="button" className="at-recent-open" title={path} onClick={() => onOpen(path)}>
                  <span className="at-recent-kind">{(name.split(".").pop() ?? "").toUpperCase()}</span>
                  <span className="at-recent-name">{name}</span>
                  <span className="at-recent-dir">{dir}</span>
                </button>
                <button
                  type="button"
                  className="at-recent-remove"
                  title={t("audioTool.recent.remove")}
                  aria-label={t("audioTool.recent.remove")}
                  onClick={() => void forget(path)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
