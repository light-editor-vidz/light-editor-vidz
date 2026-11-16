import type { DragEndEvent } from "@dnd-kit/core";

/** Le dernier `onDragEnd` donné au DndContext : jsdom n'a pas de géométrie, on simule le dépôt à la main. */
export const dnd: { onDragEnd?: (e: DragEndEvent) => void } = {};

/** Simule le dépôt de la carte `activeId` sur la carte `overId`. */
export function drop(activeId: number, overId: number) {
  dnd.onDragEnd?.({ active: { id: activeId }, over: { id: overId } } as unknown as DragEndEvent);
}
