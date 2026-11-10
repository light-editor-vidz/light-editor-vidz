import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import type { CropApi } from "./hooks/useCrop";
import type { CropRect } from "./types";
import { CropControls } from "./CropControls";

/** Rectangle courant, partagé hors de l'état React pour ne pas re-rendre toute l'application à chaque pointeur. */
export interface CropStore {
  rect: CropRect;
  listener: ((rect: CropRect) => void) | null;
}

interface Props {
  store: MutableRefObject<CropStore>;
  apiRef: MutableRefObject<CropApi | null>;
  isLoading: boolean;
  onApply: (rect: CropRect) => void;
  onCancel: () => void;
}

/**
 * Barre de recadrage. Seule elle suit le rectangle pendant le glissement : le reste de
 * l'application n'est pas re-rendu à chaque mouvement du pointeur.
 */
export function CropBar({ store, apiRef, isLoading, onApply, onCancel }: Props) {
  const [rect, setRect] = useState(store.current.rect);

  useEffect(() => {
    const s = store.current;
    s.listener = setRect;
    setRect(s.rect);
    return () => {
      s.listener = null;
    };
  }, [store]);

  return (
    <CropControls
      cropRect={rect}
      isLoading={isLoading}
      apiRef={apiRef}
      onApply={() => onApply(store.current.rect)}
      onCancel={onCancel}
    />
  );
}
