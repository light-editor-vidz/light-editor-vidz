import { describe, expect, it } from "vitest";
import type { Project } from "../bindings/Project";
import type { Composition } from "../bindings/Composition";
import { audioStepLabel, projectStepLabel, stepLabels, videoStepLabel, type Translate } from "./historyLabels";
import { DEFAULT_SETTINGS } from "./audiotool/settings";
import { defaultEditable } from "../components/videotool/hooks/useHistory";
import { createImageElement, createTitleElement } from "./elements";
import { createAudioTrack } from "./audio";

/** La clé, suivie des valeurs : assez pour vérifier ce qui a été choisi. */
const t: Translate = (key, vars) => (vars ? `${key}:${Object.values(vars).join(",")}` : key);

function scene(id: string, elements: Composition["elements"] = []): Composition {
  return {
    id,
    name: `Scene ${id}`,
    start_time: 0,
    duration: 5,
    elements,
    transition_in: null,
    transition_out: null,
    overlap_next: 0,
  };
}

function project(compositions: Composition[], audio_tracks: Project["audio_tracks"] = []): Project {
  return { name: "p", width: 1920, height: 1080, fps: 30, duration: 5, compositions, audio_tracks };
}

describe("audioStepLabel", () => {
  it("names a cut added, removed or changed", () => {
    const one = { ...DEFAULT_SETTINGS, cuts: [{ id: "c1", start: 1, end: 2 }] };
    const moved = { ...DEFAULT_SETTINGS, cuts: [{ id: "c1", start: 1, end: 3 }] };
    expect(audioStepLabel(DEFAULT_SETTINGS, one, t)).toBe("history.audio.cutAdded");
    expect(audioStepLabel(one, DEFAULT_SETTINGS, t)).toBe("history.audio.cutRemoved");
    expect(audioStepLabel(one, moved, t)).toBe("history.audio.cutChanged");
  });

  it("names a setting, and counts the others when several changed at once", () => {
    expect(audioStepLabel(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, fadeIn: 2 }, t)).toBe("history.audio.fadeIn");
    expect(audioStepLabel(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, filterFreq: 200 }, t)).toBe("history.audio.filter");
    expect(audioStepLabel(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, normalize: true, speedStep: 5 }, t)).toBe(
      "history.more:history.audio.normalize,1",
    );
  });
});

describe("videoStepLabel", () => {
  it("names what changed on the video", () => {
    expect(videoStepLabel(defaultEditable, { ...defaultEditable, crop: { x: 0, y: 0, w: 10, h: 10 } }, t)).toBe(
      "history.video.crop",
    );
    expect(videoStepLabel(defaultEditable, { ...defaultEditable, muted: true }, t)).toBe("history.video.muted");
    expect(videoStepLabel({ ...defaultEditable, muted: true }, defaultEditable, t)).toBe("history.video.unmuted");
    expect(videoStepLabel(defaultEditable, { ...defaultEditable, perspectiveVertical: 4 }, t)).toBe(
      "history.video.perspective",
    );
  });
});

describe("projectStepLabel", () => {
  it("names an element added, moved, resized or removed", () => {
    const title = { ...createTitleElement(), name: "Title" };
    const before = project([scene("a")]);
    const added = project([scene("a", [title])]);
    expect(projectStepLabel(before, added, t)).toBe("history.project.elementAdded:Title");
    const moved = project([scene("a", [{ ...title, x: title.x + 5 }])]);
    expect(projectStepLabel(added, moved, t)).toBe("history.project.elementMoved:Title");
    const resized = project([scene("a", [{ ...title, width: title.width + 5, x: title.x + 1 }])]);
    expect(projectStepLabel(added, resized, t)).toBe("history.project.elementResized:Title");
    expect(projectStepLabel(added, before, t)).toBe("history.project.elementRemoved:Title");
  });

  it("names another change of an element, and a layer reorder", () => {
    const a = { ...createTitleElement(), name: "A" };
    const b = { ...createImageElement("assets/images/x.png", "B") };
    const p = project([scene("s", [a, b])]);
    expect(projectStepLabel(p, project([scene("s", [{ ...a, rotation: 30 }, b])]), t)).toBe(
      "history.project.elementChanged:A",
    );
    expect(projectStepLabel(p, project([scene("s", [b, a])]), t)).toBe("history.project.elementsReordered:Scene s");
  });

  it("names scenes added, removed and reordered, but not a recomputed start time", () => {
    const one = project([scene("a"), scene("b")]);
    expect(projectStepLabel(one, project([scene("a"), scene("b"), scene("c")]), t)).toBe(
      "history.project.sceneAdded:Scene c",
    );
    expect(projectStepLabel(one, project([scene("a")]), t)).toBe("history.project.sceneRemoved:Scene b");
    expect(projectStepLabel(one, project([scene("b"), scene("a")]), t)).toBe("history.project.scenesReordered");
    const shifted = project([scene("a"), { ...scene("b"), start_time: 7, duration: 9 }]);
    expect(projectStepLabel(one, shifted, t)).toBe("history.project.sceneChanged:Scene b");
  });

  it("names audio tracks and the project settings", () => {
    const track = createAudioTrack("assets/audio/a.mp3", "Music");
    const p = project([scene("a")]);
    const withTrack = project([scene("a")], [track]);
    expect(projectStepLabel(p, withTrack, t)).toBe("history.project.trackAdded:Music");
    expect(projectStepLabel(withTrack, project([scene("a")], [{ ...track, volume: 0.2 }]), t)).toBe(
      "history.project.trackChanged:Music",
    );
    expect(projectStepLabel(withTrack, p, t)).toBe("history.project.trackRemoved:Music");
    expect(projectStepLabel(p, { ...p, fps: 60 }, t)).toBe("history.project.settings");
  });
});

describe("stepLabels", () => {
  it("starts with the opened state, then one label per change", () => {
    const states = [DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, fadeOut: 1 }];
    expect(stepLabels(states, (a, b) => audioStepLabel(a, b, t), t)).toEqual([
      "history.initial",
      "history.audio.fadeOut",
    ]);
  });
});
