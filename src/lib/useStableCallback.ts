import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Renvoie une fonction d'identité stable qui appelle toujours la dernière version de `fn`.
 * Permet de passer des gestionnaires à des composants `memo` sans les re-rendre à chaque
 * mutation du projet (drag, frappe).
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
