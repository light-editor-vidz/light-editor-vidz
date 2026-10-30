import type { Project } from "../bindings/Project";
import type { Composition } from "../bindings/Composition";
import type { Element } from "../bindings/Element";
import type { TransitionType } from "../bindings/TransitionType";
import i18n from "i18next";

const DEFAULT_COMPOSITION_DURATION = 5;

/**
 * Port TS de `scene-core::timeline::recompute_start_times` (Rust) — duplication assumée, voir
 * la doc de `crates/scene-core/src/animate.rs`. Validé contre la même implémentation Rust par
 * `timelineGolden.test.ts` (fixture partagée `fixtures/animation-golden.json`).
 */
export function recomputeStartTimes(project: Project): Project {
  let cursor = 0;
  const compositions = project.compositions.map((comp) => {
    const start_time = cursor;
    const overlap = Math.max(0, comp.overlap_next);
    cursor += Math.max(0, comp.duration - overlap);
    return { ...comp, start_time };
  });
  const lastOverlap = compositions.length > 0 ? Math.max(0, compositions[compositions.length - 1].overlap_next) : 0;
  return { ...project, compositions, duration: cursor + lastOverlap };
}

const MIN_OVERLAP_GAP = 0.1;

/** Ramène chaque chevauchement dans ses bornes : jamais plus long que l'une des deux scènes
 * concernées (moins un écart minimal), et nul pour la dernière scène (son `overlap_next` serait
 * ajouté à la durée du projet). À appliquer après toute modification de durée ou d'ordre. */
export function normalizeOverlaps(project: Project): Project {
  let changed = false;
  const compositions = project.compositions.map((comp, i) => {
    const next = project.compositions[i + 1];
    const max = next ? Math.max(0, Math.min(comp.duration, next.duration) - MIN_OVERLAP_GAP) : 0;
    const overlap = Math.max(0, Math.min(max, comp.overlap_next));
    if (overlap === comp.overlap_next) return comp;
    changed = true;
    return { ...comp, overlap_next: overlap };
  });
  return changed ? { ...project, compositions } : project;
}

/** Recalcule les débuts de scène et la durée du projet après normalisation des chevauchements. */
function recomputeTimeline(project: Project): Project {
  return recomputeStartTimes(normalizeOverlaps(project));
}

export function addComposition(project: Project): Project {
  const comp: Composition = {
    id: crypto.randomUUID(),
    name: i18n.t("defaults.scene", { n: project.compositions.length + 1 }),
    start_time: 0,
    duration: DEFAULT_COMPOSITION_DURATION,
    elements: [],
    transition_in: null,
    transition_out: null,
    overlap_next: 0,
  };
  return recomputeTimeline({ ...project, compositions: [...project.compositions, comp] });
}

export function updateCompositionDuration(project: Project, compId: string, duration: number): Project {
  const clamped = Math.max(0.5, duration);
  return recomputeTimeline({
    ...project,
    compositions: project.compositions.map((c) => (c.id === compId ? { ...c, duration: clamped } : c)),
  });
}

export function setCompositionTransitionIn(
  project: Project,
  compId: string,
  transitionType: TransitionType | null,
): Project {
  return {
    ...project,
    compositions: project.compositions.map((c) =>
      c.id === compId
        ? {
            ...c,
            transition_in: transitionType
              ? { transition_type: transitionType, duration: 0.6, easing: "power2-in-out" }
              : null,
          }
        : c,
    ),
  };
}

export function setCompositionTransitionOut(
  project: Project,
  compId: string,
  transitionType: TransitionType | null,
): Project {
  return {
    ...project,
    compositions: project.compositions.map((c) =>
      c.id === compId
        ? {
            ...c,
            transition_out: transitionType
              ? { transition_type: transitionType, duration: 0.6, easing: "power2-in-out" }
              : null,
          }
        : c,
    ),
  };
}

/** Chevauchement (secondes) avec la composition suivante, pour un fondu-enchaîné entre scènes. */
export function setCompositionOverlap(project: Project, compId: string, overlap: number): Project {
  const idx = project.compositions.findIndex((c) => c.id === compId);
  if (idx === -1) return project;
  const comp = project.compositions[idx];
  const next = project.compositions[idx + 1];
  const maxOverlap = next ? Math.max(0, Math.min(comp.duration, next.duration) - MIN_OVERLAP_GAP) : 0;
  const clamped = Math.max(0, Math.min(maxOverlap, overlap));
  return recomputeStartTimes({
    ...project,
    compositions: project.compositions.map((c) => (c.id === compId ? { ...c, overlap_next: clamped } : c)),
  });
}

/** Copie profonde d'une scène (nouveaux ids pour la scène, ses éléments et groupes — les
 * pistes audio, globales au projet, ne sont pas concernées), insérée juste après l'originale. */
export function duplicateComposition(project: Project, compId: string): { project: Project; newId: string | null } {
  const idx = project.compositions.findIndex((c) => c.id === compId);
  if (idx === -1) return { project, newId: null };
  const src = project.compositions[idx];
  const groupRemap = new Map<string, string>();
  const copy: Composition = {
    ...src,
    id: crypto.randomUUID(),
    name: i18n.t("defaults.copyOf", { name: src.name }),
    elements: src.elements.map((el) => {
      let group_id = el.group_id;
      if (group_id) {
        if (!groupRemap.has(group_id)) groupRemap.set(group_id, crypto.randomUUID());
        group_id = groupRemap.get(group_id)!;
      }
      return { ...el, id: crypto.randomUUID(), group_id, animations: el.animations.map((a) => ({ ...a })) } as Element;
    }),
    transition_in: src.transition_in ? { ...src.transition_in } : null,
    transition_out: src.transition_out ? { ...src.transition_out } : null,
  };
  const compositions = [...project.compositions];
  compositions.splice(idx + 1, 0, copy);
  return { project: recomputeTimeline({ ...project, compositions }), newId: copy.id };
}

export function removeComposition(project: Project, compId: string): Project {
  if (project.compositions.length <= 1) return project;
  return recomputeTimeline({
    ...project,
    compositions: project.compositions.filter((c) => c.id !== compId),
  });
}

export function renameComposition(project: Project, compId: string, name: string): Project {
  return {
    ...project,
    compositions: project.compositions.map((c) => (c.id === compId ? { ...c, name } : c)),
  };
}

/** Échange la composition `compId` avec sa voisine directe (-1 = précédente, 1 = suivante). */
export function reorderComposition(project: Project, compId: string, direction: -1 | 1): Project {
  const idx = project.compositions.findIndex((c) => c.id === compId);
  const targetIdx = idx + direction;
  if (idx === -1 || targetIdx < 0 || targetIdx >= project.compositions.length) return project;
  const compositions = [...project.compositions];
  [compositions[idx], compositions[targetIdx]] = [compositions[targetIdx], compositions[idx]];
  return recomputeTimeline({ ...project, compositions });
}

/** Composition active à l'instant global `t`, avec le temps local (relatif à son début). */
export function resolveActiveComposition(
  project: Project,
  t: number,
): { composition: Composition; localTime: number } | null {
  for (const comp of project.compositions) {
    if (t >= comp.start_time && t < comp.start_time + comp.duration) {
      return { composition: comp, localTime: t - comp.start_time };
    }
  }
  const last = project.compositions[project.compositions.length - 1];
  if (last && t >= last.start_time + last.duration) {
    return { composition: last, localTime: last.duration };
  }
  return project.compositions[0] ? { composition: project.compositions[0], localTime: 0 } : null;
}

/**
 * Toutes les compositions actives à l'instant `t`, dans l'ordre de la timeline : plusieurs
 * pendant un chevauchement (fondu-enchaîné entre scènes). Même repli que
 * `resolveActiveComposition` hors de toute composition. Miroir de
 * `resolve_active_compositions` (Rust).
 */
export function resolveActiveCompositions(
  project: Project,
  t: number,
): { composition: Composition; localTime: number }[] {
  const active = project.compositions
    .filter((comp) => t >= comp.start_time && t < comp.start_time + comp.duration)
    .map((composition) => ({ composition, localTime: t - composition.start_time }));
  if (active.length > 0) return active;
  const fallback = resolveActiveComposition(project, t);
  return fallback ? [fallback] : [];
}

export function isElementActive(el: Element, localTime: number): boolean {
  if (localTime < el.start_time) return false;
  if (el.duration === null) return true;
  return localTime < el.start_time + el.duration;
}
