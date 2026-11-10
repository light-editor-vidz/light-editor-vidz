import "./setup";
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as tauri from "../lib/tauri";
import { usePreview, PREVIEW_SIDE } from "../hooks/usePreview";
import type { Command } from "../types";

vi.mock("../lib/tauri");

const exposure = (v: number): Command => ({ type: "exposure", exposure: v });

/** Réponse que le test résoudra à la main, pour maîtriser l'ordre d'arrivée. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tauri.previewCommand).mockImplementation(async (_id, cmd) => `url:${JSON.stringify(cmd)}`);
});

describe("usePreview", () => {
  it("asks the backend for a preview at the standard size and exposes it", async () => {
    const { result } = renderHook(() => usePreview("t1"));

    await act(async () => result.current.requestPreview(exposure(1)));

    expect(tauri.previewCommand).toHaveBeenCalledWith("t1", exposure(1), PREVIEW_SIDE);
    expect(result.current.previewSrc).toBe(`url:${JSON.stringify(exposure(1))}`);
  });

  it("clears the preview on request", async () => {
    const { result } = renderHook(() => usePreview("t1"));
    await act(async () => result.current.requestPreview(exposure(1)));

    await act(async () => result.current.requestPreview(null));

    expect(result.current.previewSrc).toBeNull();
  });

  it("keeps one request in flight and sends only the latest of a burst", async () => {
    const first = deferred<string>();
    vi.mocked(tauri.previewCommand).mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => usePreview("t1"));

    act(() => {
      result.current.requestPreview(exposure(1));
      result.current.requestPreview(exposure(2));
      result.current.requestPreview(exposure(3));
    });
    expect(tauri.previewCommand).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve("first"));

    expect(tauri.previewCommand).toHaveBeenCalledTimes(2);
    expect(tauri.previewCommand).toHaveBeenLastCalledWith("t1", exposure(3), PREVIEW_SIDE);
    expect(result.current.previewSrc).toBe(`url:${JSON.stringify(exposure(3))}`);
  });

  it("ignores an answer that arrives after the preview was cleared", async () => {
    const slow = deferred<string>();
    vi.mocked(tauri.previewCommand).mockReturnValueOnce(slow.promise);
    const { result } = renderHook(() => usePreview("t1"));

    act(() => result.current.requestPreview(exposure(1)));
    act(() => result.current.requestPreview(null));
    await act(async () => slow.resolve("too late"));

    expect(result.current.previewSrc).toBeNull();
  });

  it("drops the preview when the tab changes", async () => {
    const { result, rerender } = renderHook(({ id }) => usePreview(id), {
      initialProps: { id: "t1" as string | null },
    });
    await act(async () => result.current.requestPreview(exposure(1)));
    expect(result.current.previewSrc).not.toBeNull();

    rerender({ id: "t2" });

    expect(result.current.previewSrc).toBeNull();
  });

  it("does nothing without a tab", () => {
    const { result } = renderHook(() => usePreview(null));

    act(() => result.current.requestPreview(exposure(1)));

    expect(tauri.previewCommand).not.toHaveBeenCalled();
  });

  it("survives a failed preview and can try again", async () => {
    vi.mocked(tauri.previewCommand).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => usePreview("t1"));

    await act(async () => result.current.requestPreview(exposure(1)));
    expect(result.current.previewSrc).toBeNull();

    await act(async () => result.current.requestPreview(exposure(2)));
    expect(result.current.previewSrc).toBe(`url:${JSON.stringify(exposure(2))}`);
  });
});
