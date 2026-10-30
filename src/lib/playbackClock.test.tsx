import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createPlaybackClock, useClockValue } from "./playbackClock";

describe("createPlaybackClock", () => {
  it("garde la dernière valeur et notifie les abonnés", () => {
    const clock = createPlaybackClock(1);
    const listener = vi.fn();
    clock.subscribe(listener);
    clock.set(2.5);
    expect(clock.get()).toBe(2.5);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ne notifie pas quand la valeur ne change pas", () => {
    const clock = createPlaybackClock(3);
    const listener = vi.fn();
    clock.subscribe(listener);
    clock.set(3);
    expect(listener).not.toHaveBeenCalled();
  });

  it("le désabonnement arrête les notifications", () => {
    const clock = createPlaybackClock();
    const listener = vi.fn();
    const unsubscribe = clock.subscribe(listener);
    unsubscribe();
    clock.set(1);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("useClockValue", () => {
  it("ne re-rend le composant que lorsque la valeur sélectionnée change", () => {
    const clock = createPlaybackClock(0);
    let renders = 0;
    function Scene() {
      const scene = useClockValue(clock, (t) => (t < 5 ? "A" : "B"));
      renders += 1;
      return <span data-testid="scene">{scene}</span>;
    }
    const { getByTestId } = render(<Scene />);
    const initial = renders;
    act(() => clock.set(1));
    act(() => clock.set(2));
    expect(renders).toBe(initial);
    act(() => clock.set(6));
    expect(getByTestId("scene").textContent).toBe("B");
    expect(renders).toBe(initial + 1);
  });
});
