import { describe, expect, it } from "vitest";
import { HOME, initialTabs, tabsReducer, type TabsAction, type TabsState } from "./tabs";

const run = (actions: TabsAction[], from: TabsState = initialTabs) => actions.reduce(tabsReducer, from);

describe("tabsReducer", () => {
  it("starts on the home tab with nothing open", () => {
    expect(initialTabs).toEqual({ tabs: [], active: HOME, startNewProject: false });
  });

  it("opens a project in a new tab and shows it", () => {
    const s = run([{ type: "openProject", dir: "/p/a", notice: "hi" }]);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({ kind: "project", dir: "/p/a", notice: "hi" });
    expect(s.active).toBe(s.tabs[0].id);
  });

  it("brings an already open project forward instead of opening it twice", () => {
    const s = run([
      { type: "openProject", dir: "/p/a" },
      { type: "openProject", dir: "/p/b" },
      { type: "openProject", dir: "/p/a" },
    ]);
    expect(s.tabs).toHaveLength(2);
    expect(s.active).toBe(s.tabs[0].id);
  });

  it("opens audio files in tabs of their own, and brings an open file forward", () => {
    const s = run([
      { type: "openAudio", path: "/m/a.mp3" },
      { type: "openAudio", path: "/m/b.mp3" },
      { type: "openAudio", path: "/m/a.mp3" },
    ]);
    expect(s.tabs.map((t) => t.kind === "audio" && t.path)).toEqual(["/m/a.mp3", "/m/b.mp3"]);
    expect(s.active).toBe(s.tabs[0].id);
  });

  it("keeps a single empty audio view", () => {
    const s = run([
      { type: "openAudio", path: null },
      { type: "activate", id: HOME },
      { type: "openAudio", path: null },
    ]);
    expect(s.tabs).toHaveLength(1);
    expect(s.active).toBe(s.tabs[0].id);
  });

  it("an empty audio view takes the file chosen in it", () => {
    let s = run([{ type: "openAudio", path: null }]);
    const id = s.tabs[0].id;
    s = tabsReducer(s, { type: "setAudioPath", id, path: "/m/a.mp3" });
    expect(s.tabs[0]).toMatchObject({ kind: "audio", path: "/m/a.mp3" });
  });

  it("activates the home tab or an open tab, and ignores an unknown one", () => {
    const s = run([{ type: "openAudio", path: "/m/a.mp3" }]);
    const id = s.tabs[0].id;
    expect(tabsReducer(s, { type: "activate", id: HOME }).active).toBe(HOME);
    expect(tabsReducer(s, { type: "activate", id: "ghost" })).toBe(s);
    expect(tabsReducer(s, { type: "activate", id }).active).toBe(id);
  });

  it("closing the shown tab goes to its right neighbour, else its left one, else home", () => {
    let s = run([
      { type: "openAudio", path: "/a" },
      { type: "openAudio", path: "/b" },
      { type: "openAudio", path: "/c" },
    ]);
    const [a, b, c] = s.tabs.map((t) => t.id);
    s = tabsReducer(s, { type: "activate", id: b });
    s = tabsReducer(s, { type: "close", id: b });
    expect(s.active).toBe(c);
    s = tabsReducer(s, { type: "close", id: c });
    expect(s.active).toBe(a);
    s = tabsReducer(s, { type: "close", id: a });
    expect(s.active).toBe(HOME);
    expect(s.tabs).toEqual([]);
  });

  it("closing another tab leaves the shown one alone", () => {
    let s = run([
      { type: "openAudio", path: "/a" },
      { type: "openAudio", path: "/b" },
    ]);
    const [a, b] = s.tabs.map((t) => t.id);
    s = tabsReducer(s, { type: "close", id: a });
    expect(s.active).toBe(b);
  });

  it("closing with the new-project intent returns home with the creation window requested", () => {
    let s = run([{ type: "openProject", dir: "/p/a" }]);
    s = tabsReducer(s, { type: "close", id: s.tabs[0].id, intent: "new" });
    expect(s).toMatchObject({ tabs: [], active: HOME, startNewProject: true });
    expect(tabsReducer(s, { type: "clearNewProject" }).startNewProject).toBe(false);
  });

  it("closing a tab that does not exist changes nothing", () => {
    const s = run([{ type: "openAudio", path: "/a" }]);
    expect(tabsReducer(s, { type: "close", id: "ghost" })).toBe(s);
  });

  it("opening a project cancels a pending new-project request", () => {
    const s = run([
      { type: "openProject", dir: "/p/a" },
      { type: "close", id: "project-x", intent: "new" },
    ]);
    expect(s.startNewProject).toBe(false);
    const closed = tabsReducer(s, { type: "close", id: s.tabs[0].id, intent: "new" });
    expect(tabsReducer(closed, { type: "openProject", dir: "/p/b" }).startNewProject).toBe(false);
  });
});
