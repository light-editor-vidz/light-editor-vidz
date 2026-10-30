import { describeError } from "./errors";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "../bindings/Project";
import { saveProject } from "./commands";

/** Délai entre la dernière modification et la sauvegarde automatique. */
export const AUTOSAVE_DELAY_MS = 2500;
/** Délai avant une nouvelle tentative après un échec d'écriture. */
export const AUTOSAVE_RETRY_MS = 10_000;

interface Options {
  project: Project | null;
  /** Dernière version écrite (comparaison par référence). */
  saved: Project | null;
  projectDir: string;
  /** Pas de sauvegarde tant qu'il est faux (ex : chargement en erreur). */
  enabled: boolean;
  onSaved: (project: Project) => void;
}

/**
 * Sauvegarde automatique du projet : 2,5 s après la dernière modification (chaque mutation
 * repousse l'échéance), nouvelle tentative après un échec — l'éditeur reste utilisable, l'erreur
 * est exposée pour un bandeau. `flush` écrit immédiatement ce qui est en attente (retour à
 * l'accueil, fermeture, mise à jour) et retourne `false` si l'écriture a échoué ; `force`
 * écrit même sans modification (Ctrl+S).
 */
export function useAutosave({ project, saved, projectDir, enabled, onSaved }: Options) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const latest = useRef({ project, saved });
  const onSavedRef = useRef(onSaved);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));

  useEffect(() => {
    latest.current = { project, saved };
    onSavedRef.current = onSaved;
  });

  const flush = useCallback(
    (force = false): Promise<boolean> => {
      // Les écritures sont sérialisées : une sauvegarde manuelle pendant l'autosave attend son tour.
      const run = async (): Promise<boolean> => {
        const { project: current, saved: lastSaved } = latest.current;
        if (!current || (!force && current === lastSaved)) return true;
        setSaving(true);
        try {
          await saveProject(projectDir, current);
          // Mis à jour tout de suite : un `flush` enchaîné ne réécrit pas la même version.
          latest.current = { project: latest.current.project, saved: current };
          onSavedRef.current(current);
          setSaveError(null);
          return true;
        } catch (e) {
          setSaveError(describeError(e));
          return false;
        } finally {
          setSaving(false);
        }
      };
      queue.current = queue.current.then(run, run);
      return queue.current;
    },
    [projectDir],
  );

  const dirty = project !== null && project !== saved;
  useEffect(() => {
    if (!enabled || !dirty) return;
    const timer = setTimeout(() => void flush(), saveError ? AUTOSAVE_RETRY_MS : AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, dirty, project, saveError, flush]);

  return { saving, saveError, flush };
}
