import { useState, useCallback, useRef } from "react";
import type { TrimSegment, CropRect, SubtitlesState } from "../types";

export type StabilizeLevel = "off" | "light" | "normal" | "strong";

export interface EditableState {
  speed: number;
  muted: boolean;
  crop: CropRect | null;
  cutSegments: TrimSegment[];
  filter: string;
  rotation: number;
  straighten: number;
  perspectiveHorizontal: number;
  perspectiveVertical: number;
  subtitles: SubtitlesState | null;
  /** Applied at export (two passes), not in the live preview. */
  stabilize: StabilizeLevel;
}

export const defaultEditable: EditableState = {
  speed: 1,
  muted: false,
  crop: null,
  cutSegments: [],
  filter: "none",
  rotation: 0,
  straighten: 0,
  perspectiveHorizontal: 0,
  perspectiveVertical: 0,
  subtitles: null,
  stabilize: "off",
};

// Bounds memory on very long sessions; older steps fall off the undo stack.
const MAX_HISTORY = 200;

const pushPast = (past: EditableState[], entry: EditableState) => [...past, entry].slice(-MAX_HISTORY);

interface History {
  past: EditableState[];
  current: EditableState;
  future: EditableState[];
}

function shallowEqual(a: EditableState, b: EditableState): boolean {
  const keys = Object.keys(a) as (keyof EditableState)[];
  return keys.every((k) => a[k] === b[k]);
}

export function useEditorHistory(initial: EditableState = defaultEditable) {
  // Past/present/future live in one state object so every updater below stays
  // pure — no refs mutated and no setState called from inside another updater.
  const [hist, setHist] = useState<History>({ past: [], current: initial, future: [] });

  // True while a continuous gesture (pointer drag, slider scrub) is in flight.
  // The gesture pushes a single history entry on its first move, not one per event.
  const inGesture = useRef(false);

  const set = useCallback((updater: (prev: EditableState) => EditableState) => {
    inGesture.current = false;
    setHist((h) => {
      const next = updater(h.current);
      // Setting a value to itself (same speed, filter, reset of an empty crop…)
      // is not an edit and must not cost an undo step.
      if (next === h.current || shallowEqual(next, h.current)) return h;
      return { past: pushPast(h.past, h.current), current: next, future: [] };
    });
  }, []);

  /**
   * Live update during a gesture. Snapshots history once, on the first call,
   * then edits in place until `endGesture()` closes the gesture — so dragging a
   * cut or a crop handle costs one undo step instead of one per pointer event.
   */
  const setLive = useCallback((updater: (prev: EditableState) => EditableState) => {
    // Decided out here, not inside the updater: React may run the updater
    // lazily (or twice under StrictMode), by which time the ref has moved on.
    const isFirstMove = !inGesture.current;
    inGesture.current = true;
    setHist((h) =>
      isFirstMove
        ? { past: pushPast(h.past, h.current), current: updater(h.current), future: [] }
        : { ...h, current: updater(h.current) },
    );
  }, []);

  const endGesture = useCallback(() => {
    inGesture.current = false;
  }, []);

  const undo = useCallback(() => {
    inGesture.current = false;
    setHist((h) =>
      h.past.length === 0
        ? h
        : {
            past: h.past.slice(0, -1),
            current: h.past[h.past.length - 1],
            future: [...h.future, h.current],
          },
    );
  }, []);

  const redo = useCallback(() => {
    inGesture.current = false;
    setHist((h) =>
      h.future.length === 0
        ? h
        : {
            past: pushPast(h.past, h.current),
            current: h.future[h.future.length - 1],
            future: h.future.slice(0, -1),
          },
    );
  }, []);

  const reset = useCallback((val: EditableState = defaultEditable) => {
    inGesture.current = false;
    setHist({ past: [], current: val, future: [] });
  }, []);

  return {
    editable: hist.current,
    set,
    setLive,
    endGesture,
    undo,
    redo,
    reset,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
  };
}
