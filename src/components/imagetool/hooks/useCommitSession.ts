import { useCallback, useEffect, useRef, useState } from "react";
import type { Command } from "../types";

interface Options {
  tabId: string | null;
  historyIndex: number;
  onApply: (cmd: Command, opts?: { replace: true }) => Promise<number | void>;
  onPreview: (cmd: Command | null) => void;
}

/**
 * Réglage non destructif d'un panneau.
 *
 * Un curseur exprime une valeur **absolue** par rapport à l'image de départ. Tant qu'on
 * reste dans la même section et que l'historique n'a pas bougé ailleurs, chaque nouvelle
 * validation **remplace** la dernière étape (le backend repart de l'image précédente) :
 * 20 puis 25 donne 25 et non 45. Changer de section, annuler, ouvrir un autre onglet ou
 * toute autre retouche termine la session : les curseurs concernés repartent de zéro.
 */
export function useCommitSession({ tabId, historyIndex, onApply, onPreview }: Options) {
  const session = useRef<{ key: string; index: number } | null>(null);
  const histRef = useRef(historyIndex);
  const inFlight = useRef(false);
  const pending = useRef<{ cmd: Command; key: string | null } | null>(null);
  const committing = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  // Un numéro par section (et un global) : le changer remonte le contenu, donc remet ses
  // curseurs à leur valeur initiale.
  const [resets, setResets] = useState<Record<string, number>>({});
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    histRef.current = historyIndex;
  }, [historyIndex]);

  const resetAll = useCallback(() => {
    session.current = null;
    setEpoch((e) => e + 1);
    onPreview(null);
  }, [onPreview]);

  // Historique modifié ailleurs (annuler, autre retouche…) : la session est terminée.
  useEffect(() => {
    if (committing.current) return;
    if (session.current && session.current.index !== historyIndex) resetAll();
  }, [historyIndex, resetAll]);

  // Autre onglet : tout repart de zéro.
  useEffect(() => {
    resetAll();
  }, [tabId, resetAll]);

  const show = (visible: boolean) => {
    if (overlayRef.current) overlayRef.current.style.display = visible ? "block" : "none";
  };

  const commit = useCallback(
    async (cmd: Command, key: string | null) => {
      if (inFlight.current) {
        pending.current = { cmd, key };
        return;
      }
      inFlight.current = true;
      committing.current = true;
      show(true);
      try {
        let next: { cmd: Command; key: string | null } | null = { cmd, key };
        while (next) {
          const previous = session.current;
          const replace = !!next.key && previous?.key === next.key && previous.index === histRef.current;
          // Les effets du réglage précédent sont figés dans l'image : ses curseurs repartent de zéro.
          if (previous && previous.key !== next.key) {
            const old = previous.key;
            setResets((r) => ({ ...r, [old]: (r[old] ?? 0) + 1 }));
          }
          const position = await (replace ? onApply(next.cmd, { replace: true }) : onApply(next.cmd));
          if (typeof position === "number") {
            histRef.current = position;
            session.current = next.key ? { key: next.key, index: position } : null;
          } else {
            session.current = null;
          }
          next = pending.current;
          pending.current = null;
        }
      } finally {
        inFlight.current = false;
        committing.current = false;
        show(false);
        onPreview(null);
      }
    },
    [onApply, onPreview],
  );

  /** Termine la session : appelé par les actions ponctuelles (préréglage, bouton). */
  const endSession = useCallback(() => {
    session.current = null;
  }, []);

  const keyFor = (section: string) => `${epoch}:${section}:${resets[section] ?? 0}`;

  return { commit, endSession, overlayRef, keyFor, resetAll };
}
