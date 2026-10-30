import { beforeEach, describe, expect, it, vi } from "vitest";

const destroy = vi.fn(() => Promise.resolve());
let handler: ((e: { preventDefault: () => void }) => Promise<void>) | null = null;
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    destroy,
    onCloseRequested: async (h: typeof handler) => {
      handler = h;
      return () => {};
    },
  }),
}));

import { installCloseGuard } from "./closeGuard";
import { registerBeforeExit } from "./lifecycle";

beforeEach(() => {
  destroy.mockClear();
  handler = null;
});

async function requestClose() {
  const preventDefault = vi.fn();
  await handler!({ preventDefault });
  return preventDefault;
}

describe("installCloseGuard", () => {
  it("laisse la fenêtre se fermer quand rien n'est en attente", async () => {
    await installCloseGuard();
    const preventDefault = await requestClose();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("termine le travail en attente avant de fermer", async () => {
    await installCloseGuard();
    const task = vi.fn(async () => true);
    const off = registerBeforeExit(task);
    const preventDefault = await requestClose();
    off();
    expect(preventDefault).toHaveBeenCalled();
    expect(task).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });

  it("garde la fenêtre ouverte si l'enregistrement échoue", async () => {
    await installCloseGuard();
    const off = registerBeforeExit(async () => false);
    await requestClose();
    off();
    expect(destroy).not.toHaveBeenCalled();
  });
});
