import { useCallback, useEffect, useRef, useState } from "react";
import { previewCommand } from "../lib/tauri";
import type { Command } from "../types";

/** Côté maximal (px) des aperçus calculés par le backend. */
export const PREVIEW_SIDE = 1024;

/**
 * Aperçu en direct d'un réglage, calculé par le **même code** que le rendu final sur une
 * version réduite de l'image. Les demandes rapprochées (glissement d'un curseur) sont
 * fusionnées : une seule est en vol, la plus récente passe ensuite, et une réponse
 * périmée (ou arrivée après l'annulation) est ignorée.
 */
export function usePreview(tabId: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  const seq = useRef(0);
  const busy = useRef(false);
  const pending = useRef<Command | null>(null);
  const tabRef = useRef(tabId);

  const clear = useCallback(() => {
    seq.current++;
    pending.current = null;
    setSrc(null);
  }, []);

  useEffect(() => {
    tabRef.current = tabId;
    clear();
  }, [tabId, clear]);

  const request = useCallback(
    (cmd: Command | null) => {
      if (!cmd) return clear();
      if (!tabRef.current) return;
      pending.current = cmd;
      if (busy.current) return;
      busy.current = true;
      void (async () => {
        while (pending.current) {
          const next = pending.current;
          pending.current = null;
          const mine = ++seq.current;
          try {
            const url = await previewCommand(tabRef.current as string, next, PREVIEW_SIDE);
            if (mine === seq.current) setSrc(url);
          } catch {
            // Un aperçu raté n'est pas une erreur : le rendu final reste disponible.
          }
        }
        busy.current = false;
      })();
    },
    [clear],
  );

  return { previewSrc: src, requestPreview: request };
}
