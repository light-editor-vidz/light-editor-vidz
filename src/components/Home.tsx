import { describeError } from "../lib/errors";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, FolderOpen } from "lucide-react";
import { listRecentProjects, removeRecentProject, type RecentProject } from "../lib/commands";
import NewProjectModal from "./NewProjectModal";
import { useRegisterMenuActions } from "../lib/menuBridge";
import "./Home.css";

interface Props {
  onOpenProject: (projectDir: string) => void;
  /** Ouvre directement la fenêtre de création de projet. */
  startNewProject?: boolean;
}

function aspectRatioLabel(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height) || 1;
  return `${width / d}:${height / d}`;
}

export default function Home({ onOpenProject, startNewProject = false }: Props) {
  const { t } = useTranslation();
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [showNewProject, setShowNewProject] = useState(startNewProject);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRecentProjects()
      .then(setRecents)
      .catch((e) => setError(describeError(e)));
  }, []);

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
