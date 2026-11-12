import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { listRecentProjects } from "../lib/commands";
import { noDestination } from "../lib/exportDestination";
import "./subtitles/subtitles.css";

const nameOf = (path: string) =>
  path
    .replace(/[/\\]$/, "")
    .split(/[/\\]/)
    .pop() ?? path;

/**
 * Où va un export : sur l'ordinateur (« Enregistrer sous »), dans des projets (projets récents à
 * cocher, ou un autre dossier), ou les deux.
 */
export default function AddToProjects({
  selected,
  onChange,
  toComputer,
  onToComputer,
}: {
  selected: string[];
  onChange: (projects: string[]) => void;
  toComputer: boolean;
  onToComputer: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [known, setKnown] = useState<{ path: string; name: string }[]>([]);

  function toggleEnabled(on: boolean) {
    setEnabled(on);
    if (!on) {
      onChange([]);
      return;
    }
    listRecentProjects()
      .then((recents) => setKnown(recents.map(({ path, name }) => ({ path, name }))))
      .catch(() => setKnown([]));
  }

  const toggle = (path: string, on: boolean) => onChange(on ? [...selected, path] : selected.filter((p) => p !== path));

  async function browse() {
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    setKnown((list) => (list.some((p) => p.path === dir) ? list : [...list, { path: dir, name: nameOf(dir) }]));
    if (!selected.includes(dir)) onChange([...selected, dir]);
  }

  return (
    <div className="add-to-projects">
      <label className="subs-check">
        <input type="checkbox" checked={toComputer} onChange={(e) => onToComputer(e.target.checked)} />
        {t("addToProjects.computer")}
      </label>
      <label className="subs-check">
        <input type="checkbox" checked={enabled} onChange={(e) => toggleEnabled(e.target.checked)} />
        {t("addToProjects.label")}
      </label>
      {enabled && (
        <>
          <div className="add-to-projects-list">
            {known.map((p) => (
              <label className="subs-check" key={p.path} title={p.path}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.path)}
                  onChange={(e) => toggle(p.path, e.target.checked)}
                />
                {p.name}
              </label>
            ))}
          </div>
          <button type="button" className="subs-forget" onClick={() => void browse()}>
            {t("addToProjects.browse")}
          </button>
        </>
      )}
      {noDestination(toComputer, selected) && (
        <span className="add-to-projects-hint" role="status">
          {t("addToProjects.none")}
        </span>
      )}
    </div>
  );
}
