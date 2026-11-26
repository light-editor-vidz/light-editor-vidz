import { useEffect, useRef, useState } from "react";
import type { Project } from "../bindings/Project";
import { projectVoiceRanges } from "./commands";
import { voiceSignature, type VoiceRange } from "./ducking";

/** Délai après le dernier changement avant de relancer l'analyse (un glissé en produit beaucoup). */
const SETTLE_MS = 600;
const NONE: VoiceRange[] = [];

/** Les passages où la voix se fait entendre ; vide tant qu'aucune piste ne doit baisser. Pendant
 * une nouvelle analyse, la précédente reste appliquée. */
export function useVoiceRanges(project: Project, projectDir: string): VoiceRange[] {
  const signature = voiceSignature(project);
  const [ranges, setRanges] = useState(NONE);
  const latest = useRef(project);
  useEffect(() => {
    latest.current = project;
  }, [project]);

  useEffect(() => {
    if (signature === null) return;
    let stale = false;
    const timer = setTimeout(() => {
      projectVoiceRanges(projectDir, latest.current)
        .then((found) => !stale && setRanges(found))
        // Sans analyse, l'aperçu joue la musique à plein volume ; l'export, lui, la baisse.
        .catch(() => !stale && setRanges(NONE));
    }, SETTLE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [signature, projectDir]);

  return signature === null ? NONE : ranges;
}
