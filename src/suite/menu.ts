import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

/** A menu entry, described as data so it can be rebuilt (language, theme, recent files). */
export type MenuSpec =
  | { kind: "item"; text: string; accelerator?: string; enabled?: boolean; action: () => void }
  | { kind: "check"; text: string; checked: boolean; action: () => void }
  | { kind: "separator" }
  | {
      kind: "predefined";
      item: "Quit" | "Undo" | "Redo" | "Cut" | "Copy" | "Paste" | "SelectAll" | "Hide" | "HideOthers" | "ShowAll";
      text?: string;
    }
  | { kind: "submenu"; text: string; enabled?: boolean; items: MenuSpec[] };

export interface TopMenu {
  text: string;
  items: MenuSpec[];
}

type Run = (path: string) => void;

/** Entries whose enabled state can change later, by position ("0.2"). */
type Toggleable = Map<string, MenuItem | Submenu>;

type Built = MenuItem | CheckMenuItem | PredefinedMenuItem | Submenu;

async function build(spec: MenuSpec, path: string, run: Run, toggleable: Toggleable): Promise<Built> {
  switch (spec.kind) {
    case "separator":
      return PredefinedMenuItem.new({ item: "Separator" });
    case "predefined":
      return PredefinedMenuItem.new({ item: spec.item, text: spec.text });
    case "item": {
      const item = await MenuItem.new({
        text: spec.text,
        accelerator: spec.accelerator,
        enabled: spec.enabled,
        action: () => run(path),
      });
      toggleable.set(path, item);
      return item;
    }
    case "check":
      return CheckMenuItem.new({ text: spec.text, checked: spec.checked, action: () => run(path) });
    case "submenu": {
      const submenu = await Submenu.new({
        text: spec.text,
        enabled: spec.enabled,
        items: await Promise.all(spec.items.map((s, i) => build(s, `${path}.${i}`, run, toggleable))),
      });
      toggleable.set(path, submenu);
      return submenu;
    }
  }
}

/** What is installed now: the menu, its shape (everything but the enabled flags) and each entry's
 * enabled state, so a change of enabled state alone does not rebuild ~60 native objects. */
let installed: { menu: Menu; shape: string; toggleable: Toggleable; enabled: Map<string, boolean> } | null = null;

const shapeOf = (menus: TopMenu[]) => JSON.stringify(menus, (key, value) => (key === "enabled" ? undefined : value));

function enabledStates(menus: TopMenu[]): Map<string, boolean> {
  const states = new Map<string, boolean>();
  const visit = (items: MenuSpec[], prefix: string) =>
    items.forEach((spec, i) => {
      const path = `${prefix}.${i}`;
      if (spec.kind === "item" || spec.kind === "submenu") states.set(path, spec.enabled ?? true);
      if (spec.kind === "submenu") visit(spec.items, path);
    });
  menus.forEach((m, i) => visit(m.items, String(i)));
  return states;
}

/** Installs `menus` as the application menu. An entry calls `run` with its position
 * ("0.2" is the third entry of the first menu), so the caller always runs its latest code.
 * Installed again with the same entries and only other enabled states (undo becoming available),
 * the existing entries are updated in place. */
export async function installMenu(menus: TopMenu[], run: Run): Promise<void> {
  const shape = shapeOf(menus);
  const states = enabledStates(menus);
  if (installed && installed.shape === shape) {
    const current = installed;
    for (const [path, enabled] of states) {
      if (current.enabled.get(path) === enabled) continue;
      await current.toggleable.get(path)?.setEnabled(enabled);
      current.enabled.set(path, enabled);
    }
    return;
  }
  const toggleable: Toggleable = new Map();
  const top = await Promise.all(
    menus.map(async (m, i) =>
      Submenu.new({
        text: m.text,
        items: await Promise.all(m.items.map((s, j) => build(s, `${i}.${j}`, run, toggleable))),
      }),
    ),
  );
  const menu = await Menu.new({ items: top });
  await menu.setAsAppMenu();
  const previous = installed;
  installed = { menu, shape, toggleable, enabled: states };
  // The replaced menu and its entries are native resources: freed, not left behind.
  await previous?.menu.close().catch(() => {});
}

/** Forgets the installed menu (tests: each starts from nothing). */
export function resetInstalledMenu(): void {
  installed = null;
}

/** The entry at a position written by `installMenu`. */
export function findSpec(menus: TopMenu[], path: string): MenuSpec | undefined {
  const [first, ...rest] = path.split(".").map(Number);
  let items: MenuSpec[] | undefined = menus[first]?.items;
  let spec: MenuSpec | undefined;
  for (const index of rest) {
    spec = items?.[index];
    items = spec?.kind === "submenu" ? spec.items : undefined;
  }
  return spec;
}
