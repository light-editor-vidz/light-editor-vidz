// Le nom d'une étape d'historique, déduit de ce qui a changé entre deux états : les vues gardent
// des instantanés, pas des actions nommées.

import type { Project } from "../bindings/Project";
import type { Element } from "../bindings/Element";
import type { AudioTrack } from "../bindings/AudioTrack";
import type { AudioSettings } from "./audiotool/settings";
import type { EditableState } from "../components/videotool/hooks/useHistory";

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Le premier changement nommé, suivi du nombre des autres. */
function summarize(changes: string[], t: Translate): string {
  if (changes.length === 0) return t("history.edit");
  if (changes.length === 1) return changes[0];
  return t("history.more", { first: changes[0], count: changes.length - 1 });
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function audioStepLabel(prev: AudioSettings, next: AudioSettings, t: Translate): string {
  const changes: string[] = [];
  if (!same(prev.cuts, next.cuts)) {
    const key =
      next.cuts.length > prev.cuts.length
        ? "history.audio.cutAdded"
        : next.cuts.length < prev.cuts.length
          ? "history.audio.cutRemoved"
          : "history.audio.cutChanged";
    changes.push(t(key));
  }
  if (prev.fadeIn !== next.fadeIn) changes.push(t("history.audio.fadeIn"));
  if (prev.fadeOut !== next.fadeOut) changes.push(t("history.audio.fadeOut"));
  if (prev.fadeCurve !== next.fadeCurve) changes.push(t("history.audio.fadeCurve"));
  if (prev.normalize !== next.normalize) changes.push(t("history.audio.normalize"));
  if (prev.speedStep !== next.speedStep) changes.push(t("history.audio.speed"));
  if (
    prev.filterType !== next.filterType ||
    prev.filterFreq !== next.filterFreq ||
    prev.filterSlope !== next.filterSlope ||
    prev.filterQ !== next.filterQ ||
    prev.filterBandwidth !== next.filterBandwidth
  ) {
    changes.push(t("history.audio.filter"));
  }
  return summarize(changes, t);
}

export function videoStepLabel(prev: EditableState, next: EditableState, t: Translate): string {
  const changes: string[] = [];
  if (!same(prev.cutSegments, next.cutSegments)) changes.push(t("history.video.cuts"));
  if (!same(prev.crop, next.crop)) changes.push(t("history.video.crop"));
  if (prev.speed !== next.speed) changes.push(t("history.video.speed"));
  if (prev.muted !== next.muted) changes.push(t(next.muted ? "history.video.muted" : "history.video.unmuted"));
  if (prev.filter !== next.filter) changes.push(t("history.video.filter"));
  if (prev.rotation !== next.rotation) changes.push(t("history.video.rotation"));
  if (prev.straighten !== next.straighten) changes.push(t("history.video.straighten"));
  if (
    prev.perspectiveHorizontal !== next.perspectiveHorizontal ||
    prev.perspectiveVertical !== next.perspectiveVertical
  )
    changes.push(t("history.video.perspective"));
  if (!same(prev.subtitles, next.subtitles)) changes.push(t("history.video.subtitles"));
  if (prev.stabilize !== next.stabilize) changes.push(t("history.video.stabilize"));
  return summarize(changes, t);
}

/** Ce qui a changé sur un élément : déplacé, redimensionné, son timing, ou autre chose. */
function elementChange(a: Element, b: Element, t: Translate): string {
  const name = b.name;
  const moved = a.x !== b.x || a.y !== b.y;
  const resized = a.width !== b.width || a.height !== b.height;
  const timed = a.start_time !== b.start_time || a.duration !== b.duration;
  const rest = (e: Element) => ({ ...e, x: 0, y: 0, width: 0, height: 0, start_time: 0, duration: 0 });
  if (!same(rest(a), rest(b))) return t("history.project.elementChanged", { name });
  if (resized) return t("history.project.elementResized", { name });
  if (moved) return t("history.project.elementMoved", { name });
  if (timed) return t("history.project.elementTimed", { name });
  return t("history.project.elementChanged", { name });
}

function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((item) => [item.id, item]));
}

function trackChanges(prev: AudioTrack[], next: AudioTrack[], t: Translate): string[] {
  const changes: string[] = [];
  const before = byId(prev);
  const after = byId(next);
  for (const track of next) {
    const old = before.get(track.id);
    if (!old) changes.push(t("history.project.trackAdded", { name: track.name }));
    else if (!same(old, track)) changes.push(t("history.project.trackChanged", { name: track.name }));
  }
  for (const track of prev) {
    if (!after.has(track.id)) changes.push(t("history.project.trackRemoved", { name: track.name }));
  }
  return changes;
}

export function projectStepLabel(prev: Project, next: Project, t: Translate): string {
  const changes: string[] = [];
  if (prev.name !== next.name || prev.width !== next.width || prev.height !== next.height || prev.fps !== next.fps) {
    changes.push(t("history.project.settings"));
  }
  const before = byId(prev.compositions);
  const after = byId(next.compositions);
  for (const scene of next.compositions) {
    const old = before.get(scene.id);
    if (!old) {
      changes.push(t("history.project.sceneAdded", { name: scene.name }));
      continue;
    }
    if (old === scene) continue;
    const found = changes.length;
    const oldElements = byId(old.elements);
    const newElements = byId(scene.elements);
    for (const element of scene.elements) {
      const was = oldElements.get(element.id);
      if (!was) changes.push(t("history.project.elementAdded", { name: element.name }));
      else if (!same(was, element)) changes.push(elementChange(was, element, t));
    }
    for (const element of old.elements) {
      if (!newElements.has(element.id)) changes.push(t("history.project.elementRemoved", { name: element.name }));
    }
    // `start_time` est recalculé d'après les scènes précédentes : ce n'est pas une modification de celle-ci.
    const sceneOnly = (s: typeof scene) => ({ ...s, elements: [], start_time: 0 });
    if (!same(sceneOnly(old), sceneOnly(scene))) changes.push(t("history.project.sceneChanged", { name: scene.name }));
    else if (
      changes.length === found &&
      !same(
        old.elements.map((e) => e.id),
        scene.elements.map((e) => e.id),
      )
    )
      changes.push(t("history.project.elementsReordered", { name: scene.name }));
  }
  for (const scene of prev.compositions) {
    if (!after.has(scene.id)) changes.push(t("history.project.sceneRemoved", { name: scene.name }));
  }
  if (
    changes.length === 0 &&
    !same(
      prev.compositions.map((s) => s.id),
      next.compositions.map((s) => s.id),
    )
  ) {
    changes.push(t("history.project.scenesReordered"));
  }
  changes.push(...trackChanges(prev.audio_tracks, next.audio_tracks, t));
  return summarize(changes, t);
}

/** Les noms de toutes les étapes d'un historique : « Ouverture », puis un par changement. */
export function stepLabels<S>(states: S[], label: (prev: S, next: S) => string, t: Translate): string[] {
  return states.map((state, i) => (i === 0 ? t("history.initial") : label(states[i - 1], state)));
}
