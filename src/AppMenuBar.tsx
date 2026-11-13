import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSuiteMenu } from "./suite/useSuiteMenu";
import type { MenuSpec } from "./suite/menu";
import type { SuiteLang } from "./suite/messages";
import { suiteMessages } from "./suite/messages";
import { useMenuBridge } from "./lib/menuBridge";
import { listRecentProjects, removeRecentProject, type RecentProject } from "./lib/commands";
import ShortcutsModal from "./components/ShortcutsModal";
import { GRID_SIZES } from "./components/imagetool/lib/prefs";

/** The menu bar (File, Edit, View, Help), always there, on the home screen and in the editor. The
 * screen in front registers what its entries do (`useRegisterMenuActions`). */
export default function AppMenuBar() {
  const { t, i18n } = useTranslation();
  const { actions, flags } = useMenuBridge();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const lang: SuiteLang = i18n.resolvedLanguage === "fr" ? "fr" : "en";

  const suiteT = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const own = (suiteMessages[lang] as Record<string, string>)[key];
      if (own === undefined) return t(key, vars ?? {});
      return vars ? Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), own) : own;
    },
    [lang, t],
  );

  // The recent projects, read again when a project is opened or closed (the screen changes) and
  // when the window gets the focus back.
  const refreshRecents = useCallback(() => {
    listRecentProjects()
      .then(setRecents)
      .catch(() => setRecents([]));
  }, []);
  useEffect(() => {
    refreshRecents();
    window.addEventListener("focus", refreshRecents);
    return () => window.removeEventListener("focus", refreshRecents);
  }, [refreshRecents, flags.inEditor]);

  // Calls go through `actions`: the screen's latest functions, whenever it is clicked.
  const call = (name: Exclude<keyof typeof actions.current, "openRecent" | "setImageGrid">) => () =>
    actions.current[name]?.();
  const { inEditor, inAudio, inImage, inVideo, canUndo, canRedo, hasSelection } = flags;
  /** Un projet ou un fichier audio est affiché : l'export et la fermeture de l'onglet ont un sens. */
  const inTab = inEditor || inAudio || inImage || inVideo;

  const file = useMemo<MenuSpec[]>(
    () => [
      { kind: "item", text: t("topbar.newProject"), accelerator: "CmdOrCtrl+N", action: call("newProject") },
      { kind: "item", text: t("topbar.openFile"), accelerator: "CmdOrCtrl+O", action: call("openFile") },
      {
        kind: "item",
        text: t("topbar.openProjectFolder"),
        accelerator: "CmdOrCtrl+Shift+O",
        action: call("openProject"),
      },
      {
        kind: "submenu",
        text: t("topbar.openRecent"),
        enabled: recents.length > 0,
        items: [
          ...recents.map((project): MenuSpec => ({
            kind: "item",
            text: project.name,
            action: () => actions.current.openRecent?.(project.path),
          })),
          { kind: "separator" },
          {
            kind: "item",
            text: t("topbar.clearRecent"),
            action: () => {
              void Promise.all(recents.map((p) => removeRecentProject(p.path).catch(() => {}))).then(refreshRecents);
            },
          },
        ],
      },
      { kind: "item", text: t("topbar.importLegacy"), enabled: inEditor, action: call("importLegacy") },
      { kind: "separator" },
      { kind: "item", text: t("topbar.save"), enabled: inEditor, action: call("save") },
      {
        kind: "item",
        text: t("topbar.exportEllipsis"),
        accelerator: "CmdOrCtrl+E",
        enabled: inTab,
        action: call("openExport"),
      },
      { kind: "item", text: t("subs.menu"), enabled: inEditor, action: call("generateSubtitles") },
      {
        kind: "item",
        text: t("topbar.closeTab"),
        accelerator: "CmdOrCtrl+W",
        enabled: inTab,
        action: call("closeProject"),
      },
      { kind: "separator" },
      {
        kind: "item",
        text: t("topbar.settings"),
        accelerator: "CmdOrCtrl+,",
        enabled: inEditor || inImage,
        action: call("openSettings"),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, inEditor, inImage, inTab, recents, refreshRecents],
  );

  // Undo, redo, delete and duplicate are already keys of the editor (Ctrl+Z…): no accelerator here,
  // or one press would act twice.
  const edit = useMemo<MenuSpec[]>(
    () => [
      { kind: "item", text: t("topbar.undo"), enabled: canUndo, action: call("undo") },
      { kind: "item", text: t("topbar.redo"), enabled: canRedo, action: call("redo") },
      {
        kind: "item",
        text: t("history.toggle"),
        accelerator: "CmdOrCtrl+Shift+H",
        enabled: inTab,
        action: call("toggleHistory"),
      },
      { kind: "separator" },
      { kind: "item", text: t("topbar.delete"), enabled: hasSelection, action: call("deleteSelected") },
      { kind: "item", text: t("topbar.duplicate"), enabled: hasSelection, action: call("duplicateSelected") },
      { kind: "separator" },
      {
        kind: "submenu",
        text: t("topbar.gridSize"),
        enabled: inImage,
        items: GRID_SIZES.map((size): MenuSpec => ({
          kind: "item",
          text: `${size} px`,
          action: () => actions.current.setImageGrid?.(size),
        })),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, canUndo, canRedo, hasSelection, inImage, inTab],
  );

  const helpExtra = useMemo<MenuSpec[]>(
    () => [{ kind: "item", text: t("topbar.shortcutsMenu"), action: () => setShowShortcuts(true) }],
    [t],
  );

  const onLanguage = useCallback((next: SuiteLang) => void i18n.changeLanguage(next), [i18n]);

  useSuiteMenu({ t: suiteT, lang, appName: "LightEditorVidz", onLanguage, file, edit, helpExtra });

  return showShortcuts ? <ShortcutsModal onClose={() => setShowShortcuts(false)} /> : null;
}
