import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Démarre un drag horizontal au clic (utilisé par la timeline pour déplacer/redimensionner
 * scènes, clips d'éléments et pistes audio). Factorise le boilerplate d'écouteurs
 * pointermove/pointerup sur `window`, dupliqué 3× avant cette extraction.
 */
/** Déplacement (px) en dessous duquel un appui reste un clic : aucun changement n'est émis. */
export const DRAG_THRESHOLD_PX = 3;

export function startHorizontalDrag(e: ReactPointerEvent, onMove: (deltaPx: number) => void) {
  e.stopPropagation();
  e.preventDefault();
  const startX = e.clientX;
  let moved = false;

  function move(ev: PointerEvent) {
    // Bouton relâché hors de la fenêtre : aucun `pointerup` n'arrive, le geste est terminé.
    if (ev.buttons === 0) {
      up();
      return;
    }
    const delta = ev.clientX - startX;
    // Un clic avec micro-mouvement ne doit pas modifier le projet (entrée d'annulation inutile).
    if (!moved && Math.abs(delta) <= DRAG_THRESHOLD_PX) return;
    moved = true;
    onMove(delta);
  }
  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}
