import { useEffect, useRef } from "react";
import { useTabActive } from "../../lib/menuBridge";

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

/** Types d'`<input>` dans lesquels on saisit du texte : les autres (curseur, case à cocher, bouton,
 * couleur…) laissent passer Espace, Suppr et Ctrl+Z. */
const TEXT_INPUT_TYPES = new Set(["text", "number", "search", "email", "url", "tel", "password", "date", "time"]);

/** Une fenêtre modale visible est-elle ouverte ? (celles d'un onglet masqué ne comptent pas) */
export function isModalOpen(): boolean {
  return Array.from(document.querySelectorAll('[aria-modal="true"], [role="dialog"], .modal-backdrop')).some(
    (el) => !el.closest("[hidden]"),
  );
}

/** La touche est-elle destinée au champ qui a le focus ? */
export function isTyping(el: Element | null, key: string): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select" || (el as HTMLElement).isContentEditable) return true;
  if (tag !== "input") return false;
  const type = ((el as HTMLInputElement).type || "text").toLowerCase();
  if (TEXT_INPUT_TYPES.has(type)) return true;
  // Un curseur utilise les flèches, Début et Fin pour lui-même.
  return type === "range" && /^(Arrow|Home$|End$|Page)/.test(key);
}

/**
 * Raccourcis clavier de l'éditeur : un seul abonnement `keydown` pour toute la vie du composant ;
 * le gestionnaire lu à chaque frappe est le dernier défini (ref), il voit donc toujours l'état
 * courant sans se réabonner à chaque rendu.
 */
export function useEditorShortcuts({ hasActiveComposition, selectedIds, selectedElementIds, actions }: Options) {
  const handler = useRef<(e: KeyboardEvent) => void>(() => {});
  const tabActive = useTabActive();
  useEffect(() => {
    handler.current = (e: KeyboardEvent) => {
      // Un éditeur resté monté dans un onglet masqué ne réagit pas au clavier.
      if (!tabActive) return;
      // Ctrl+S avant le filtre sur les champs de saisie : la sauvegarde doit marcher aussi
      // pendant l'édition d'un texte (comportement standard, affiché dans le menu Fichier).
      if (e.key.toLowerCase() === "s" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        actions.save();
        return;
      }
      if (isTyping(document.activeElement, e.key)) return;
      // Une fenêtre modale est ouverte : Suppr, Espace, Ctrl+A… ne doivent pas agir sur l'éditeur
      // qui est derrière elle.
      if (isModalOpen()) return;
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
