import { useRef, useState } from "react";
import type { Command } from "../types";

/** Ce qu'un panneau met à la disposition de ses sections. */
export interface PanelCtx {
  /** Aperçu en direct (`null` pour l'effacer). */
  preview: (cmd: Command | null) => void;
  /** Valide un réglage ; `key` regroupe les validations successives d'une même section. */
  commit: (cmd: Command, key: string | null) => void;
}

/**
 * Paramètres d'un réglage : état affiché, copie synchrone pour les gestionnaires, aperçu
 * à chaque modification (effacé quand on revient aux valeurs de départ) et validation.
 */
export function useCommandParams<T extends object>(
  initial: T,
  toCommand: (v: T) => Command,
  ctx: PanelCtx,
  key: string,
  /** Valeurs sans effet : y revenir efface l'aperçu. `null` si aucune valeur n'est neutre. */
  identity: T | null = initial,
) {
  const [values, setValues] = useState(initial);
  const ref = useRef(initial);
  const identityJson = useRef(identity && JSON.stringify(identity));

  const set = (patch: Partial<T> | ((current: T) => Partial<T>)) => {
    const next = { ...ref.current, ...(typeof patch === "function" ? patch(ref.current) : patch) };
    ref.current = next;
    setValues(next);
    ctx.preview(JSON.stringify(next) === identityJson.current ? null : toCommand(next));
  };
  const commit = () => ctx.commit(toCommand(ref.current), key);
  const settle = () => ctx.preview(null);

  return { values, set, commit, settle };
}
