import "./setup";
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditorHistory, defaultEditable } from "../hooks/useHistory";

describe("useEditorHistory", () => {
  it("initialises with default state", () => {
    const { result } = renderHook(() => useEditorHistory());
    expect(result.current.editable).toEqual(defaultEditable);
  });

  it("applies a change", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.set((p) => ({ ...p, speed: 2 }));
    });
    expect(result.current.editable.speed).toBe(2);
  });

  it("undoes a change", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.set((p) => ({ ...p, speed: 2 }));
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.editable.speed).toBe(1);
  });

  it("redoes after undo", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.set((p) => ({ ...p, speed: 2 }));
    });
    act(() => {
      result.current.undo();
    });
    act(() => {
      result.current.redo();
    });
    expect(result.current.editable.speed).toBe(2);
  });

  it("clears redo stack after a new change", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.set((p) => ({ ...p, speed: 2 }));
    });
    act(() => {
      result.current.undo();
    });
    act(() => {
      result.current.set((p) => ({ ...p, speed: 3 }));
    });
    act(() => {
      result.current.undo();
    });
    // redo should bring us back to 3, not 2
    act(() => {
      result.current.redo();
    });
    expect(result.current.editable.speed).toBe(3);
  });

  it("stacks multiple undos", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.set((p) => ({ ...p, speed: 2 }));
    });
    act(() => {
      result.current.set((p) => ({ ...p, muted: true }));
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.editable.muted).toBe(false);
    expect(result.current.editable.speed).toBe(2);
    act(() => {
      result.current.undo();
    });
    expect(result.current.editable.speed).toBe(1);
  });

  it("does nothing on undo when history is empty", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.undo();
    });
    expect(result.current.editable).toEqual(defaultEditable);
  });

  it("does nothing on redo when future is empty", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.redo();
    });
    expect(result.current.editable).toEqual(defaultEditable);
  });

  it("reset clears history", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.set((p) => ({ ...p, speed: 2 }));
    });
    act(() => {
      result.current.reset();
    });
    act(() => {
      result.current.undo();
    });
    // undo after reset should have no effect
    expect(result.current.editable).toEqual(defaultEditable);
  });

  it("tracks cutSegments changes", () => {
    const { result } = renderHook(() => useEditorHistory());
    const seg = { id: "seg1", start: 1, end: 3 };
    act(() => {
      result.current.set((p) => ({ ...p, cutSegments: [seg] }));
    });
    expect(result.current.editable.cutSegments).toHaveLength(1);
    act(() => {
      result.current.undo();
    });
    expect(result.current.editable.cutSegments).toHaveLength(0);
  });
});

// ─── Gesture coalescing ──────────────────────────────────────────────────────
// A pointer drag or slider scrub fires a change per event. Without setLive,
// one drag produced one undo step per pixel moved.

describe("setLive / endGesture", () => {
  it("records a single history entry for a whole gesture", () => {
    const { result } = renderHook(() => useEditorHistory());

    act(() => {
      result.current.setLive((p) => ({ ...p, speed: 1.25 }));
    });
    act(() => {
      result.current.setLive((p) => ({ ...p, speed: 1.5 }));
    });
    act(() => {
      result.current.setLive((p) => ({ ...p, speed: 2 }));
    });
    act(() => {
      result.current.endGesture();
    });

    expect(result.current.editable.speed).toBe(2);
    act(() => {
      result.current.undo();
    });
    expect(result.current.editable.speed).toBe(1);
    expect(result.current.canUndo).toBe(false);
  });

  it("starts a new history entry for each gesture", () => {
    const { result } = renderHook(() => useEditorHistory());

    act(() => {
      result.current.setLive((p) => ({ ...p, speed: 2 }));
    });
    act(() => {
      result.current.endGesture();
    });
    act(() => {
      result.current.setLive((p) => ({ ...p, speed: 4 }));
    });
    act(() => {
      result.current.endGesture();
    });

    act(() => {
      result.current.undo();
    });
    expect(result.current.editable.speed).toBe(2);
    act(() => {
      result.current.undo();
    });
    expect(result.current.editable.speed).toBe(1);
  });

  it("exposes canUndo from the first live move, before the gesture closes", () => {
    const { result } = renderHook(() => useEditorHistory());
    expect(result.current.canUndo).toBe(false);
    act(() => {
      result.current.setLive((p) => ({ ...p, speed: 2 }));
    });
    expect(result.current.canUndo).toBe(true);
  });

  it("clears the redo stack when a gesture starts", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.set((p) => ({ ...p, speed: 2 }));
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.setLive((p) => ({ ...p, speed: 3 }));
    });
    expect(result.current.canRedo).toBe(false);
  });

  it("closes an open gesture when a discrete edit lands", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.setLive((p) => ({ ...p, straighten: 10 }));
    });
    act(() => {
      result.current.set((p) => ({ ...p, muted: true }));
    });

    act(() => {
      result.current.undo();
    });
    expect(result.current.editable.muted).toBe(false);
    expect(result.current.editable.straighten).toBe(10);
  });

  it("closes an open gesture on undo", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.setLive((p) => ({ ...p, speed: 2 }));
    });
    act(() => {
      result.current.undo();
    });
    act(() => {
      result.current.setLive((p) => ({ ...p, speed: 3 }));
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.editable.speed).toBe(1);
  });

  it("closes an open gesture on reset", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.setLive((p) => ({ ...p, speed: 2 }));
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.canUndo).toBe(false);

    act(() => {
      result.current.setLive((p) => ({ ...p, speed: 3 }));
    });
    expect(result.current.canUndo).toBe(true);
  });

  it("endGesture on its own changes nothing", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => {
      result.current.endGesture();
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.editable).toEqual(defaultEditable);
  });
});

describe("useEditorHistory — no-op edits and bounded memory", () => {
  it("does not record a step when a value is set to what it already is", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => result.current.set((p) => ({ ...p, speed: 1 })));
    act(() => result.current.set((p) => p));
    expect(result.current.canUndo).toBe(false);
  });

  it("still records a real change", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => result.current.set((p) => ({ ...p, speed: 2 })));
    expect(result.current.canUndo).toBe(true);
  });

  it("keeps at most 200 undo steps", () => {
    const { result } = renderHook(() => useEditorHistory());
    for (let i = 0; i < 250; i++) act(() => result.current.set((p) => ({ ...p, rotation: i + 1 })));
    let undone = 0;
    while (result.current.canUndo) {
      act(() => result.current.undo());
      undone++;
    }
    expect(undone).toBe(200);
  });
});

describe("useEditorHistory — stabilisation", () => {
  it("is undoable like any other edit", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => result.current.set((p) => ({ ...p, stabilize: "strong" })));
    expect(result.current.editable.stabilize).toBe("strong");
    act(() => result.current.undo());
    expect(result.current.editable.stabilize).toBe("off");
  });

  it("lists every step in order and jumps to any of them", () => {
    const { result } = renderHook(() => useEditorHistory());
    act(() => result.current.set((p) => ({ ...p, speed: 2 })));
    act(() => result.current.set((p) => ({ ...p, muted: true })));
    expect(result.current.steps).toHaveLength(3);
    expect(result.current.index).toBe(2);
    act(() => result.current.goto(0));
    expect(result.current.editable).toEqual(defaultEditable);
    expect(result.current.index).toBe(0);
    expect(result.current.steps.map((s) => s.speed)).toEqual([1, 2, 2]);
    act(() => result.current.goto(2));
    expect(result.current.editable.muted).toBe(true);
    act(() => result.current.redo());
    expect(result.current.index).toBe(2);
    act(() => result.current.undo());
    expect(result.current.editable.speed).toBe(2);
    expect(result.current.editable.muted).toBe(false);
  });
});
