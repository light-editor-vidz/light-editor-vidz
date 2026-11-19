import type { Project } from "../bindings/Project";
import { neutralizeBaked } from "./clipSettings";

export type SwapScope = "clip" | "all";

/** Les clips (éléments image/vidéo et pistes audio) qui utilisent ce média. */
export function clipsUsing(project: Project, src: string): string[] {
  const ids = project.audio_tracks.filter((t) => t.src === src).map((t) => t.id);
  for (const comp of project.compositions) {
    for (const el of comp.elements) if ((el.type === "image" || el.type === "video") && el.src === src) ids.push(el.id);
  }
  return ids;
}

/** Fait pointer les clips vers une nouvelle version du média : un seul (`clip`) ou tous ceux qui
 * utilisent l'ancienne. Le clip d'où l'édition a été demandée (`elementId`) avait ses réglages
 * repris dans l'onglet : la nouvelle version les contient, il repart de zéro (`neutralizeBaked`).
 * Pure ; renvoie le même objet si rien ne change. */
export function swapMediaSrc(
  project: Project,
  oldSrc: string,
  newSrc: string,
  scope: SwapScope,
  elementId?: string,
): Project {
  const hit = (id: string, src: string) => src === oldSrc && (scope === "all" || id === elementId);
  let changed = false;
  const audio_tracks = project.audio_tracks.map((track) => {
    if (!hit(track.id, track.src)) return track;
    changed = true;
    return { ...(track.id === elementId ? neutralizeBaked(track) : track), src: newSrc };
  });
  const compositions = project.compositions.map((comp) => {
    let compChanged = false;
    const elements = comp.elements.map((el) => {
      if ((el.type !== "image" && el.type !== "video") || !hit(el.id, el.src)) return el;
      compChanged = true;
      return { ...(el.id === elementId ? neutralizeBaked(el) : el), src: newSrc };
    });
    if (!compChanged) return comp;
    changed = true;
    return { ...comp, elements };
  });
  return changed ? { ...project, audio_tracks, compositions } : project;
}
