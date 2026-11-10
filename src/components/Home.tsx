import { describeError } from "../lib/errors";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, FolderOpen } from "lucide-react";
import { listRecentProjects, removeRecentProject, type RecentProject } from "../lib/commands";
import NewProjectModal from "./NewProjectModal";
import { useRegisterMenuActions, useTabActive } from "../lib/menuBridge";
import "./Home.css";

export type HomeTool = "audio" | "video" | "image" | "subtitles";

/** Les outils proposés sur l'accueil : l'ancienne application dont ils reprennent l'écran. Seuls
 * ceux qui ont leur vue sont actifs ; les autres arrivent avec les prochaines étapes. */
const TOOLS: { id: HomeTool; icon: string; enabled: boolean }[] = [
  { id: "audio", icon: "/tools/soundz.png", enabled: true },
  { id: "video", icon: "/tools/vidz.png", enabled: false },
  { id: "image", icon: "/tools/imgz.png", enabled: true },
  { id: "subtitles", icon: "/tools/subz.png", enabled: false },
];

interface Props {
  onOpenProject: (projectDir: string) => void;
  /** Ouvre la vue d'un outil (dans un nouvel onglet). */
  onOpenTool?: (tool: HomeTool) => void;
  /** Ouvre directement la fenêtre de création de projet. */
  startNewProject?: boolean;
  /** La demande ci-dessus a été prise en compte. */
  onNewProjectHandled?: () => void;
}

function aspectRatioLabel(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height) || 1;
  return `${width / d}:${height / d}`;
}

export default function Home({ onOpenProject, onOpenTool, startNewProject = false, onNewProjectHandled }: Props) {
  const { t } = useTranslation();
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [showNewProject, setShowNewProject] = useState(startNewProject);
  const [error, setError] = useState<string | null>(null);

  // La liste est relue chaque fois que l'accueil revient au premier plan (un projet a pu être
  // ouvert ou créé entre-temps).
  const tabActive = useTabActive();
  useEffect(() => {
    if (!tabActive) return;
    listRecentProjects()
      .then(setRecents)
      .catch((e) => setError(describeError(e)));
  }, [tabActive]);

  // Fermer un projet par « Nouveau projet » ramène ici avec la fenêtre de création ouverte : la
  // demande est lue une fois, puis acquittée pour qu'une suivante soit de nouveau vue.
  const [seenNewRequest, setSeenNewRequest] = useState(startNewProject);
  if (startNewProject !== seenNewRequest) {
    setSeenNewRequest(startNewProject);
    if (startNewProject) setShowNewProject(true);
  }
  useEffect(() => {
    if (startNewProject) onNewProjectHandled?.();
  }, [startNewProject, onNewProjectHandled]);

  async function handleOpen() {
    setError(null);
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    onOpenProject(dir);
  }

  async function handleClear() {
    try {
      await Promise.all(recents.map((p) => removeRecentProject(p.path)));
      setRecents([]);
    } catch (e) {
      setError(describeError(e));
    }
  }

  // The File menu's New project and Open project act on this screen.
  useRegisterMenuActions({
    newProject: () => setShowNewProject(true),
    openProject: () => void handleOpen(),
    openRecent: (dir: string) => onOpenProject(dir),
  });

  async function handleRemove(path: string) {
    try {
      await removeRecentProject(path);
      setRecents((list) => list.filter((p) => p.path !== path));
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <div className="home">
      <main className="home-content">
        <div className="home-brand">
          <img src="/logo.png" alt="" className="home-logo" />
          <div className="home-wordmark">
            LightEditor<span className="accent-text">Vidz</span>
          </div>
        </div>

        <p className="home-tagline">{t("home.tagline")}</p>

        <div className="home-actions">
          <button type="button" className="btn-primary" onClick={() => setShowNewProject(true)}>
            <Plus size={17} />
            {t("home.newProject")}
          </button>
          <button type="button" className="btn-secondary" onClick={handleOpen}>
            <FolderOpen size={16} />
            {t("home.openProject")}
          </button>
        </div>

        <section className="home-tools" aria-label={t("home.tools")}>
          {TOOLS.map(({ id, icon, enabled }) => (
            <button
              type="button"
              key={id}
              className="home-tool"
              disabled={!enabled}
              onClick={() => onOpenTool?.(id)}
              title={enabled ? t(`home.tool.${id}.hint`) : t("home.comingSoon")}
            >
              <img src={icon} alt="" className="home-tool-icon" />
              <span className="home-tool-name">{t(`home.tool.${id}.name`)}</span>
              <span className="home-tool-hint">{enabled ? t(`home.tool.${id}.hint`) : t("home.comingSoon")}</span>
            </button>
          ))}
        </section>

        {error && <p className="home-error">{error}</p>}

        {recents.length > 0 && (
          <section className="home-recents" aria-label={t("home.recentProjects")}>
            <div className="home-recents-header">
              <h2>{t("home.recentProjects")}</h2>
              <button type="button" className="home-recents-clear" onClick={() => void handleClear()}>
                {t("home.clearRecent")}
              </button>
            </div>
            <ul className="home-recents-list">
              {recents.map((p) => (
                <li className="recent-item" key={p.path}>
                  <button type="button" className="recent-open" onClick={() => onOpenProject(p.path)} title={p.path}>
                    <span className="recent-kind mono">{aspectRatioLabel(p.width, p.height)}</span>
                    <span className="recent-title">{p.name}</span>
                    <span className="recent-meta mono">
                      {p.width}×{p.height}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="recent-remove"
                    onClick={() => void handleRemove(p.path)}
                    title={t("home.removeRecent")}
                    aria-label={t("home.removeRecent")}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={(projectDir) => {
            setShowNewProject(false);
            onOpenProject(projectDir);
          }}
        />
      )}
    </div>
  );
}
