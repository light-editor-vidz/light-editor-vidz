import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./commands", () => ({
  readMediaFile: vi.fn(),
}));

import { readMediaFile } from "./commands";
import {
  acquireMediaObjectUrl,
  cacheSizeForTests,
  dropIdleMedia,
  IDLE_BUDGET_BYTES,
  idleCountForTests,
  preloadMedia,
} from "./mediaCache";

const readMediaFileMock = vi.mocked(readMediaFile);
let urlCounter = 0;

beforeEach(() => {
  urlCounter = 0;
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:mock-${++urlCounter}`),
    revokeObjectURL: vi.fn(),
  });
  readMediaFileMock.mockReset();
  readMediaFileMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  dropIdleMedia();
  vi.unstubAllGlobals();
});

describe("acquireMediaObjectUrl", () => {
  it("ne lit le fichier qu'une fois pour deux consommateurs de la même source", async () => {
    const a = acquireMediaObjectUrl("/p", "assets/videos/v.mp4");
    const b = acquireMediaObjectUrl("/p", "assets/videos/v.mp4");
    const [urlA, urlB] = await Promise.all([a.promise, b.promise]);
    expect(urlA).toBe(urlB);
    expect(readMediaFileMock).toHaveBeenCalledTimes(1);
    a.release();
    b.release();
  });

  it("garde le blob quand le dernier consommateur le relâche (pas de relecture au retour)", async () => {
    const a = acquireMediaObjectUrl("/p", "assets/videos/v.mp4");
    const url = await a.promise;
    a.release();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(idleCountForTests()).toBe(1);

    const again = acquireMediaObjectUrl("/p", "assets/videos/v.mp4");
    expect(await again.promise).toBe(url);
    expect(readMediaFileMock).toHaveBeenCalledTimes(1);
    expect(idleCountForTests()).toBe(0);
    again.release();
    // Un release répété ne doit rien décrémenter de plus.
    again.release();
    expect(idleCountForTests()).toBe(1);
  });

  it("révoque les blobs inactifs les plus anciens au-delà du budget mémoire", async () => {
    readMediaFileMock.mockImplementation(async () => new ArrayBuffer(IDLE_BUDGET_BYTES / 2 + 1));
    const urls: string[] = [];
    for (const name of ["a", "b", "c"]) {
      const handle = acquireMediaObjectUrl("/p", `assets/videos/${name}.mp4`);
      urls.push(await handle.promise);
      handle.release();
    }
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(urls[0]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(urls[1]);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(urls[2]);
    expect(idleCountForTests()).toBe(1);
  });

  it("dropIdleMedia révoque tous les blobs inactifs", async () => {
    const a = acquireMediaObjectUrl("/p", "assets/videos/v.mp4");
    const url = await a.promise;
    a.release();
    dropIdleMedia();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(cacheSizeForTests()).toBe(0);
  });

  it("preloadMedia charge à l'avance sans retenir la source", async () => {
    preloadMedia("/p", "assets/videos/next.mp4");
    await vi.waitFor(() => expect(idleCountForTests()).toBe(1));
    const handle = acquireMediaObjectUrl("/p", "assets/videos/next.mp4");
    await handle.promise;
    expect(readMediaFileMock).toHaveBeenCalledTimes(1);
    handle.release();
  });

  it("preloadMedia ignore les erreurs de lecture", async () => {
    readMediaFileMock.mockRejectedValueOnce(new Error("missing"));
    expect(() => preloadMedia("/p", "assets/videos/gone.mp4")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(cacheSizeForTests()).toBe(0);
  });

  it("révoque l'URL si tous les consommateurs sont partis avant la fin du chargement", async () => {
    let resolveRead: (b: ArrayBuffer) => void = () => {};
    readMediaFileMock.mockImplementation(() => new Promise((res) => (resolveRead = res)));
    const a = acquireMediaObjectUrl("/p", "assets/videos/v.mp4");
    a.release();
    resolveRead(new ArrayBuffer(8));
    await a.promise;
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("ne met pas en cache un échec de lecture (nouvelle tentative possible)", async () => {
    readMediaFileMock.mockRejectedValueOnce(new Error("missing"));
    const a = acquireMediaObjectUrl("/p", "assets/videos/v.mp4");
    await expect(a.promise).rejects.toThrow("missing");
    // Laisse le .catch interne purger l'entrée.
    await Promise.resolve();
    const b = acquireMediaObjectUrl("/p", "assets/videos/v.mp4");
    await expect(b.promise).resolves.toMatch(/^blob:mock-/);
    expect(readMediaFileMock).toHaveBeenCalledTimes(2);
    a.release();
    b.release();
  });

  it("des sources différentes ont des entrées distinctes", async () => {
    const a = acquireMediaObjectUrl("/p", "assets/videos/a.mp4");
    const b = acquireMediaObjectUrl("/p", "assets/videos/b.mp4");
    const [urlA, urlB] = await Promise.all([a.promise, b.promise]);
    expect(urlA).not.toBe(urlB);
    a.release();
    b.release();
  });
});
