import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { listRecentProjects } from "../lib/commands";
import type { MediaOrigin } from "../lib/tabs";
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
  origin,
  toOrigin = false,
  onToOrigin,
}: {
  selected: string[];
  onChange: (projects: string[]) => void;
  toComputer: boolean;
  onToComputer: (on: boolean) => void;
  /** Le média de projet que cet onglet édite : l'export peut en devenir une nouvelle version. */
  origin?: MediaOrigin;
  toOrigin?: boolean;
  onToOrigin?: (on: boolean) => void;
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
      {origin && onToOrigin && (
        <label className="subs-check" title={origin.projectDir}>
          <input type="checkbox" checked={toOrigin} onChange={(e) => onToOrigin(e.target.checked)} />
          {t("addToProjects.origin", { project: nameOf(origin.projectDir).replace(/\.lvproj$/, "") })}
        </label>
      )}
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
      {noDestination(toComputer, selected, toOrigin) && (
        <span className="add-to-projects-hint" role="status">
          {t("addToProjects.none")}
        </span>
      )}
    </div>
  );
}
