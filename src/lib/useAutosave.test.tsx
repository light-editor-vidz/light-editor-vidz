import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../bindings/Project";
import { saveProject } from "./commands";
import { AUTOSAVE_DELAY_MS, AUTOSAVE_RETRY_MS, useAutosave } from "./useAutosave";

vi.mock("./commands", () => ({ saveProject: vi.fn() }));
const mockSave = vi.mocked(saveProject);

const project = (name: string) => ({ name }) as unknown as Project;

beforeEach(() => {
  vi.useFakeTimers();
  mockSave.mockReset();
  mockSave.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

function setup(initial: { project: Project | null; saved: Project | null; enabled?: boolean }) {
  const onSaved = vi.fn();
  const hook = renderHook((props) => useAutosave({ projectDir: "/p", onSaved, enabled: true, ...props }), {
    initialProps: initial,
  });
  return { ...hook, onSaved };
}

describe("useAutosave", () => {
  it("n'écrit rien tant que le projet est identique à la version enregistrée", async () => {
    const p = project("a");
    setup({ project: p, saved: p });
    await act(async () => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 4));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("écrit 2,5 s après une modification", async () => {
    const saved = project("a");
    const { onSaved } = setup({ project: project("b"), saved });
    await act(async () => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1));
    expect(mockSave).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(2));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalled();
  });

  it("repousse l'échéance à chaque modification", async () => {
    const saved = project("a");
    const { rerender } = setup({ project: project("b"), saved });
    await act(async () => void vi.advanceTimersByTime(2000));
    rerender({ project: project("c"), saved });
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(mockSave).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(600));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][1]).toMatchObject({ name: "c" });
  });

  it("expose l'erreur et réessaie plus tard sans rien perdre", async () => {
    mockSave.mockRejectedValueOnce(new Error("disque plein"));
    const { result } = setup({ project: project("b"), saved: project("a") });
    await act(async () => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    expect(result.current.saveError).toContain("disque plein");

    await act(async () => void vi.advanceTimersByTime(AUTOSAVE_RETRY_MS));
    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(result.current.saveError).toBeNull();
  });

  it("flush écrit tout de suite et retourne true", async () => {
    const { result } = setup({ project: project("b"), saved: project("a") });
    let ok = false;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(true);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it("flush retourne false quand l'écriture échoue", async () => {
    mockSave.mockRejectedValue(new Error("refusé"));
    const { result } = setup({ project: project("b"), saved: project("a") });
    let ok = true;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(false);
  });

  it("flush ne réécrit pas une version déjà enregistrée, sauf avec force", async () => {
    const p = project("a");
    const { result } = setup({ project: p, saved: p });
    await act(async () => void (await result.current.flush()));
    expect(mockSave).not.toHaveBeenCalled();
    await act(async () => void (await result.current.flush(true)));
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it("deux flush simultanés n'écrivent la même version qu'une fois", async () => {
    const { result } = setup({ project: project("b"), saved: project("a") });
    await act(async () => {
      await Promise.all([result.current.flush(), result.current.flush()]);
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it("n'écrit rien quand il est désactivé (chargement en erreur)", async () => {
    setup({ project: project("b"), saved: project("a"), enabled: false });
    await act(async () => void vi.advanceTimersByTime(AUTOSAVE_RETRY_MS * 2));
    expect(mockSave).not.toHaveBeenCalled();
  });
});
