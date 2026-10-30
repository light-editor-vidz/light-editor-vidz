import { describe, expect, it, vi } from "vitest";
import { registerBeforeExit, runBeforeExit } from "./lifecycle";

describe("lifecycle", () => {
  it("attend tous les travaux enregistrés", async () => {
    const order: string[] = [];
    const off1 = registerBeforeExit(async () => {
      await Promise.resolve();
      order.push("a");
    });
    const off2 = registerBeforeExit(async () => order.push("b"));
    expect(await runBeforeExit()).toBe(true);
    expect(order.sort()).toEqual(["a", "b"]);
    off1();
    off2();
  });

  it("signale l'échec d'un travail (retour false ou exception)", async () => {
    const off1 = registerBeforeExit(async () => false);
    expect(await runBeforeExit()).toBe(false);
    off1();
    const off2 = registerBeforeExit(async () => {
      throw new Error("disque plein");
    });
    expect(await runBeforeExit()).toBe(false);
    off2();
  });

  it("un travail retiré n'est plus exécuté", async () => {
    const task = vi.fn(async () => true);
    registerBeforeExit(task)();
    await runBeforeExit();
    expect(task).not.toHaveBeenCalled();
  });

  it("sans travail enregistré, on peut s'arrêter", async () => {
    expect(await runBeforeExit()).toBe(true);
  });
});
