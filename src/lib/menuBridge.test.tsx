import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { inertBridge, TabActiveProvider, useRegisterMenuActions, useTabActive } from "./menuBridge";

function Screen({ onSave }: { onSave: () => void }) {
  useRegisterMenuActions({ save: onSave });
  return null;
}

function Probe({ seen }: { seen: (active: boolean) => void }) {
  seen(useTabActive());
  return null;
}

describe("useRegisterMenuActions", () => {
  it("enregistre les actions de l'écran affiché, et les retire à son démontage", () => {
    const save = vi.fn();
    const { unmount } = render(<Screen onSave={save} />);

    inertBridge.actions.current.save?.();
    expect(save).toHaveBeenCalledTimes(1);

    unmount();
    expect(inertBridge.actions.current.save).toBeUndefined();
  });

  it("appelle toujours la dernière fonction, sans réenregistrer", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Screen onSave={first} />);

    rerender(<Screen onSave={second} />);
    inertBridge.actions.current.save?.();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("un onglet resté en arrière-plan n'enregistre rien", () => {
    const hidden = vi.fn();
    render(
      <TabActiveProvider value={false}>
        <Screen onSave={hidden} />
      </TabActiveProvider>,
    );

    expect(inertBridge.actions.current.save).toBeUndefined();
  });

  it("les actions passent d'un onglet à l'autre quand l'onglet affiché change", () => {
    const a = vi.fn();
    const b = vi.fn();
    const tree = (activeA: boolean) => (
      <>
        <TabActiveProvider value={activeA}>
          <Screen onSave={a} />
        </TabActiveProvider>
        <TabActiveProvider value={!activeA}>
          <Screen onSave={b} />
        </TabActiveProvider>
      </>
    );
    const { rerender } = render(tree(true));

    inertBridge.actions.current.save?.();
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 0]);

    rerender(tree(false));
    inertBridge.actions.current.save?.();
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
  });
});

describe("useTabActive", () => {
  it("vaut vrai hors des onglets (rendu isolé, test)", () => {
    const seen = vi.fn();
    render(<Probe seen={seen} />);
    expect(seen).toHaveBeenCalledWith(true);
  });

  it("suit la valeur de l'onglet qui l'entoure", () => {
    const seen = vi.fn();
    render(
      <TabActiveProvider value={false}>
        <Probe seen={seen} />
      </TabActiveProvider>,
    );
    expect(seen).toHaveBeenLastCalledWith(false);
  });
});
