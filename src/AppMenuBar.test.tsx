import { render, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import AppMenuBar from "./AppMenuBar";
import { inertBridge } from "./lib/menuBridge";
import { entry, lastMenu } from "./suite/menuTestHelpers";
import { listRecentProjects, removeRecentProject } from "./lib/commands";

vi.mock("./lib/commands", () => ({
  listRecentProjects: vi.fn(),
  removeRecentProject: vi.fn(() => Promise.resolve()),
}));

const mockList = vi.mocked(listRecentProjects);
const mockRemove = vi.mocked(removeRecentProject);

const recent = (path: string, name: string) => ({ path, name, width: 1920, height: 1080, duration: 10 });

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([recent("/p/a.lvproj", "Spot A"), recent("/p/b.lvproj", "Spot B")]);
});

async function mount() {
  render(<AppMenuBar />);
  await waitFor(() => expect(entry("File", "Open recent").items?.length).toBeGreaterThan(1));
}

describe("AppMenuBar", () => {
  it("has File, Edit, View and Help, always", async () => {
    await mount();
    expect(lastMenu().map((m) => m.text)).toEqual(["File", "Edit", "View", "Help"]);
  });

  it("lists the recent projects in File > Open recent, then Clear recent", async () => {
    await mount();

    const recents = entry("File", "Open recent");
    expect(recents.items?.map((i) => i.text ?? i.item)).toEqual(["Spot A", "Spot B", "Separator", "Clear recent"]);
  });

  it("opens the chosen recent project through the screen in front", async () => {
    await mount();
    const openRecent = vi.fn();
    inertBridge.actions.current.openRecent = openRecent;

    entry("File", "Open recent").items?.[1].action?.();

    expect(openRecent).toHaveBeenCalledWith("/p/b.lvproj");
    delete inertBridge.actions.current.openRecent;
  });

  it("clears the list", async () => {
    await mount();
    mockList.mockResolvedValue([]);

    await act(async () => entry("File", "Open recent").items?.[3].action?.());

    expect(mockRemove).toHaveBeenCalledWith("/p/a.lvproj");
    expect(mockRemove).toHaveBeenCalledWith("/p/b.lvproj");
  });

  it("disables Open recent when there is none", async () => {
    mockList.mockResolvedValue([]);
    render(<AppMenuBar />);
    await waitFor(() => expect(lastMenu().length).toBeGreaterThan(0));

    expect((entry("File", "Open recent") as { enabled?: boolean }).enabled).toBe(false);
  });

  it("has Undo, Redo, Delete and Duplicate in Edit, without accelerators the editor already handles", async () => {
    await mount();

    const edit = lastMenu().find((m) => m.text === "Edit")!;
    expect(edit.items.map((i) => i.text ?? i.item)).toEqual([
      "Undo",
      "Redo",
      "Separator",
      "Delete",
      "Duplicate",
      "Separator",
      "Grid size",
    ]);
    expect(edit.items.every((i) => !("accelerator" in i) || i.accelerator === undefined)).toBe(true);
  });

  it("puts the keyboard shortcuts in Help", async () => {
    await mount();
    expect(entry("Help", "Keyboard shortcuts…")).toBeTruthy();
  });

  it("Open file… (Ctrl+O) asks the screen in front to open a media file; Open project folder… has its own shortcut", async () => {
    await mount();
    const openFile = vi.fn();
    const openProject = vi.fn();
    inertBridge.actions.current.openFile = openFile;
    inertBridge.actions.current.openProject = openProject;

    const file = entry("File", "Open file…");
    const folder = entry("File", "Open project folder…");
    file.action?.();
    folder.action?.();

    expect(file.accelerator).toBe("CmdOrCtrl+O");
    expect(folder.accelerator).toBe("CmdOrCtrl+Shift+O");
    expect(openFile).toHaveBeenCalledTimes(1);
    expect(openProject).toHaveBeenCalledTimes(1);
    delete inertBridge.actions.current.openFile;
    delete inertBridge.actions.current.openProject;
  });

  it("disables Export and Close tab on the home screen", async () => {
    await mount();

    expect((entry("File", "Export…") as { enabled?: boolean }).enabled).toBe(false);
    expect((entry("File", "Close tab") as { enabled?: boolean }).enabled).toBe(false);
  });

  it("enables Export and Close tab when an audio tab is shown, but not Save", async () => {
    inertBridge.flags = { ...inertBridge.flags, inAudio: true };
    try {
      await mount();

      expect((entry("File", "Export…") as { enabled?: boolean }).enabled).toBe(true);
      expect((entry("File", "Close tab") as { enabled?: boolean }).enabled).toBe(true);
      expect((entry("File", "Save") as { enabled?: boolean }).enabled).toBe(false);
    } finally {
      inertBridge.flags = { ...inertBridge.flags, inAudio: false };
    }
  });

  it("Close tab (Ctrl+W) closes the tab in front", async () => {
    await mount();
    const close = vi.fn();
    inertBridge.actions.current.closeProject = close;

    const item = entry("File", "Close tab");
    item.action?.();

    expect(item.accelerator).toBe("CmdOrCtrl+W");
    expect(close).toHaveBeenCalled();
    delete inertBridge.actions.current.closeProject;
  });
});
