import { beforeEach, describe, expect, it, vi } from "vitest";

const created = vi.hoisted(() => ({ menus: 0, closed: 0, enabledCalls: [] as [string, boolean][] }));

vi.mock("@tauri-apps/api/menu", () => {
  const item = (opts: { text?: string }) => ({
    text: opts.text,
    setEnabled: async (v: boolean) => void created.enabledCalls.push([opts.text ?? "", v]),
  });
  return {
    MenuItem: { new: async (o: { text: string }) => item(o) },
    CheckMenuItem: { new: async (o: { text: string }) => item(o) },
    PredefinedMenuItem: { new: async () => ({}) },
    Submenu: { new: async (o: { text: string }) => item(o) },
    Menu: {
      new: async () => {
        created.menus += 1;
        return { setAsAppMenu: async () => {}, close: async () => void (created.closed += 1) };
      },
    },
  };
});

import { installMenu, resetInstalledMenu, type TopMenu } from "./menu";

const menus = (canUndo: boolean, label = "Undo"): TopMenu[] => [
  {
    text: "Edit",
    items: [
      { kind: "item", text: label, enabled: canUndo, action: () => {} },
      { kind: "item", text: "Redo", enabled: false, action: () => {} },
    ],
  },
];

beforeEach(() => {
  resetInstalledMenu();
  created.menus = 0;
  created.closed = 0;
  created.enabledCalls = [];
});

describe("installMenu", () => {
  it("updates an entry in place when only its enabled state changes", async () => {
    await installMenu(menus(false), () => {});
    await installMenu(menus(true), () => {});
    await installMenu(menus(true), () => {});

    expect(created.menus).toBe(1);
    expect(created.enabledCalls).toEqual([["Undo", true]]);
  });

  it("rebuilds, and frees the old menu, when the entries themselves change", async () => {
    await installMenu(menus(false), () => {});
    await installMenu(menus(false, "Annuler"), () => {});

    expect(created.menus).toBe(2);
    expect(created.closed).toBe(1);
  });
});
