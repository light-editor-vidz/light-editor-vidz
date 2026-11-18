import "./setup";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCommitSession } from "../hooks/useCommitSession";

describe("useCommitSession — one-off actions", () => {
  it("resets the sliders of the section whose adjustment a preset freezes", async () => {
    // Des fonctions stables : le hook se réinitialise quand `onPreview` change.
    const onApply = vi.fn().mockResolvedValue(1);
    const onPreview = vi.fn();
    const { result } = renderHook(() => useCommitSession({ tabId: "t1", historyIndex: 0, onApply, onPreview }));
    await act(async () => {
      await result.current.commit({ type: "exposure", exposure: 1 }, "exposure");
    });
    const before = result.current.keyFor("exposure");

    // Un préréglage : l'exposition est figée dans l'image, son curseur doit repartir de zéro.
    act(() => result.current.endSession());

    expect(result.current.keyFor("exposure")).not.toBe(before);
  });
});
