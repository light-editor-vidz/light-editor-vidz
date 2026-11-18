import { describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import { startHorizontalDrag } from "./pointerDrag";

const press = (clientX: number) =>
  ({ clientX, stopPropagation: vi.fn(), preventDefault: vi.fn() }) as unknown as ReactPointerEvent;

const move = (clientX: number, buttons: number) =>
  window.dispatchEvent(new PointerEvent("pointermove", { clientX, buttons }));

describe("startHorizontalDrag", () => {
  it("reports the distance from the press while the button is held", () => {
    const onMove = vi.fn();
    startHorizontalDrag(press(100), onMove);
    move(130, 1);
    expect(onMove).toHaveBeenCalledWith(30);
    window.dispatchEvent(new PointerEvent("pointerup"));
  });

  it("ends the gesture when the button was released outside the window", () => {
    const onMove = vi.fn();
    startHorizontalDrag(press(100), onMove);
    move(130, 1);
    move(200, 0); // plus de bouton enfoncé, aucun pointerup reçu
    move(250, 1);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("ends the gesture when the browser cancels it", () => {
    const onMove = vi.fn();
    startHorizontalDrag(press(100), onMove);
    window.dispatchEvent(new Event("pointercancel"));
    move(150, 1);
    expect(onMove).not.toHaveBeenCalled();
  });
});
