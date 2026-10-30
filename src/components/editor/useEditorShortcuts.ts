import { useEffect, useRef } from "react";

export interface ShortcutActions {
  save: () => void;
  togglePlay: () => void;
  nudge: (dx: number, dy: number) => void;
  seekBy: (deltaSeconds: number) => void;
  /** Va au temps donné ; sans argument, à la fin du projet. */
  seekTo: (time?: number) => void;
  fps: () => number;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copy: () => void;
  paste: () => void;
  selectAll: () => void;
  group: () => void;
  ungroup: () => void;
  deselect: () => void;
  undo: () => void;
  redo: () => void;
}

interface Options {
  hasActiveComposition: boolean;
  selectedIds: string[];
  selectedElementIds: string[];
  actions: ShortcutActions;
}

/**
 * Raccourcis clavier de l'éditeur : un seul abonnement `keydown` pour toute la vie du composant ;
 * le gestionnaire lu à chaque frappe est le dernier défini (ref), il voit donc toujours l'état
 * courant sans se réabonner à chaque rendu.
 */
export function useEditorShortcuts({ hasActiveComposition, selectedIds, selectedElementIds, actions }: Options) {
  const handler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    handler.current = (e: KeyboardEvent) => {
      // Ctrl+S avant le filtre sur les champs de saisie : la sauvegarde doit marcher aussi
      // pendant l'édition d'un texte (comportement standard, affiché dans le menu Fichier).
      if (e.key.toLowerCase() === "s" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        actions.save();
        return;
      }
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === " ") {
        e.preventDefault();
        if (!e.repeat) actions.togglePlay();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const sign = e.key === "ArrowRight" ? 1 : -1;
        if (selectedElementIds.length > 0) {
          // Sélection active : les flèches déplacent les éléments (1 % du canvas, 5 % avec Maj).
          actions.nudge(sign * (e.shiftKey ? 5 : 1), 0);
        } else {
          // Sinon : navigation image par image (1 s avec Maj).
          const fps = actions.fps();
          actions.seekBy(sign * (e.shiftKey ? 1 : 1 / fps));
        }
      } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && selectedElementIds.length > 0) {
        e.preventDefault();
        actions.nudge(0, (e.key === "ArrowDown" ? 1 : -1) * (e.shiftKey ? 5 : 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        actions.seekTo(0);
      } else if (e.key === "End") {
        e.preventDefault();
        actions.seekTo(undefined);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length > 0) {
        e.preventDefault();
        actions.deleteSelected();
      } else if (e.key.toLowerCase() === "d" && (e.metaKey || e.ctrlKey) && selectedIds.length > 0) {
        e.preventDefault();
        actions.duplicateSelected();
      } else if (e.key.toLowerCase() === "c" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        actions.copy();
      } else if (e.key.toLowerCase() === "v" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        actions.paste();
      } else if (e.key.toLowerCase() === "a" && (e.metaKey || e.ctrlKey) && hasActiveComposition) {
        e.preventDefault();
        actions.selectAll();
      } else if (e.key.toLowerCase() === "g" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        actions.ungroup();
      } else if (e.key.toLowerCase() === "g" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        actions.group();
      } else if (e.key === "Escape") {
        actions.deselect();
      } else if (e.key.toLowerCase() === "z" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        actions.redo();
      } else if (e.key.toLowerCase() === "z" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        actions.undo();
      } else if (e.key.toLowerCase() === "y" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        actions.redo();
      }
    };
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => handler.current(e);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
