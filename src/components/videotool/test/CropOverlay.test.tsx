import "./setup";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import CropOverlay from "../components/CropOverlay";
import { LangProvider } from "../i18n";
import type { CropRect } from "../types";

function makeVideo(width = 1920, height = 1080, displayWidth = 960) {
  const video = document.createElement("video") as HTMLVideoElement;
  Object.defineProperty(video, "videoWidth", { value: width, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: height, configurable: true });
  // Layout metrics, not getBoundingClientRect: the latter is the bounding box of
  // the transformed element and is wrong as soon as a rotation is applied.
  const displayHeight = displayWidth * (height / width);
  for (const [key, value] of Object.entries({
    offsetLeft: 0,
    offsetTop: 0,
    offsetWidth: displayWidth,
    offsetHeight: displayHeight,
  })) {
    Object.defineProperty(video, key, { value, configurable: true });
  }
  return video;
}

function Harness({
  crop,
  onChange,
  onChangeLive,
  onCommit,
  onApply,
}: {
  crop?: CropRect | null;
  onChange?: (c: CropRect) => void;
  onChangeLive?: (c: CropRect) => void;
  onCommit?: () => void;
  onApply?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(makeVideo());
  return (
    <CropOverlay
      videoRef={videoRef}
      crop={crop ?? null}
      onChange={onChange ?? vi.fn()}
      onChangeLive={onChangeLive ?? vi.fn()}
      onCommit={onCommit ?? vi.fn()}
      onApply={onApply ?? vi.fn()}
    />
  );
}

describe("CropOverlay", () => {
  it("renders the apply button", () => {
    const { container } = render(
      <LangProvider>
        <Harness />
      </LangProvider>,
    );
    expect(container.querySelector(".crop-apply-btn")).toBeTruthy();
  });

  it("renders four corner handles", () => {
    const { container } = render(
      <LangProvider>
        <Harness />
      </LangProvider>,
    );
    expect(container.querySelectorAll(".crop-handle")).toHaveLength(4);
  });

  it("renders the crop-box and grid", () => {
    const { container } = render(
      <LangProvider>
        <Harness />
      </LangProvider>,
    );
    expect(container.querySelector(".crop-box")).toBeTruthy();
    expect(container.querySelector(".crop-grid")).toBeTruthy();
  });

  it("shows current dimensions", () => {
    const { container } = render(
      <LangProvider>
        <Harness crop={{ x: 0, y: 0, w: 400, h: 200 }} />
      </LangProvider>,
    );
    expect(container.textContent).toMatch(/400.*200/);
  });

  it("calls onApply when the apply button is clicked", () => {
    const onApply = vi.fn();
    const { container } = render(
      <LangProvider>
        <Harness onApply={onApply} />
      </LangProvider>,
    );
    fireEvent.click(container.querySelector(".crop-apply-btn")!);
    expect(onApply).toHaveBeenCalled();
  });

  it("calls onApply when Enter is pressed", () => {
    const onApply = vi.fn();
    render(
      <LangProvider>
        <Harness onApply={onApply} />
      </LangProvider>,
    );
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onApply).toHaveBeenCalled();
  });

  it("ignores other keys", () => {
    const onApply = vi.fn();
    render(
      <LangProvider>
        <Harness onApply={onApply} />
      </LangProvider>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onApply).not.toHaveBeenCalled();
  });

  it("removes the keydown listener on unmount", () => {
    const onApply = vi.fn();
    const { unmount } = render(
      <LangProvider>
        <Harness onApply={onApply} />
      </LangProvider>,
    );
    unmount();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onApply).not.toHaveBeenCalled();
  });
});

// ─── Drag gestures ───────────────────────────────────────────────────────────

describe("CropOverlay drag gestures", () => {
  function setup(props: Parameters<typeof Harness>[0] = {}) {
    const { container } = render(
      <LangProvider>
        <Harness {...props} />
      </LangProvider>,
    );
    const box = container.querySelector(".crop-box") as HTMLElement;
    box.setPointerCapture = () => {};
    box.releasePointerCapture = () => {};
    return { container, box, overlay: container.querySelector(".crop-overlay") as HTMLElement };
  }

  // A crop drag used to push one undo entry per pointer event.
  it("reports moves as live changes, not discrete history entries", () => {
    const onChange = vi.fn();
    const onChangeLive = vi.fn();
    const { box, overlay } = setup({ crop: { x: 0, y: 0, w: 800, h: 600 }, onChange, onChangeLive });

    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, pointerId: 1 });
    onChange.mockClear();
    fireEvent.pointerMove(overlay, { clientX: 120, clientY: 110, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientX: 140, clientY: 120, pointerId: 1 });

    expect(onChangeLive).toHaveBeenCalledTimes(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes the gesture on pointer up", () => {
    const onCommit = vi.fn();
    const { box, overlay } = setup({ crop: { x: 0, y: 0, w: 800, h: 600 }, onCommit });

    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientX: 140, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(overlay, { pointerId: 1 });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("does not close a gesture that never started", () => {
    const onCommit = vi.fn();
    const { overlay } = setup({ crop: { x: 0, y: 0, w: 800, h: 600 }, onCommit });
    fireEvent.pointerUp(overlay, { pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("ignores moves once the gesture is over", () => {
    const onChangeLive = vi.fn();
    const { box, overlay } = setup({ crop: { x: 0, y: 0, w: 800, h: 600 }, onChangeLive });

    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(overlay, { pointerId: 1 });
    onChangeLive.mockClear();
    fireEvent.pointerMove(overlay, { clientX: 300, clientY: 300, pointerId: 1 });

    expect(onChangeLive).not.toHaveBeenCalled();
  });
});

describe("CropOverlay — poignées de coin", () => {
  /** Rend l'overlay avec un recadrage donné et renvoie de quoi piloter un glisser. */
  function setup(crop: CropRect, onChangeLive = vi.fn()) {
    const { container } = render(
      <LangProvider>
        <Harness crop={crop} onChangeLive={onChangeLive} />
      </LangProvider>,
    );
    const overlay = container.querySelector(".crop-overlay") as HTMLElement;
    const handle = (h: string) => {
      const el = container.querySelector(`.crop-handle-${h}`) as HTMLElement;
      el.setPointerCapture = () => {};
      return el;
    };
    return { container, overlay, handle, onChangeLive };
  }

  /** Vidéo 1920×1080 affichée sur 960 px : 1 px écran = 2 px source. */
  const SCALE = 2;
  const base: CropRect = { x: 200, y: 200, w: 800, h: 600 };

  function drag(h: string, dx: number, dy: number, crop = base) {
    const { overlay, handle, onChangeLive } = setup(crop);
    fireEvent.pointerDown(handle(h), { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientX: dx, clientY: dy, pointerId: 1 });
    return onChangeLive.mock.calls[onChangeLive.mock.calls.length - 1]?.[0] as CropRect;
  }

  it("la poignée haut-gauche déplace les deux bords", () => {
    const r = drag("tl", 50, 25);

    expect(r).toEqual({ x: 200 + 50 * SCALE, y: 200 + 25 * SCALE, w: 800 - 50 * SCALE, h: 600 - 25 * SCALE });
  });

  it("la poignée bas-droite étire la largeur et la hauteur", () => {
    const r = drag("br", 50, 25);

    expect(r).toEqual({ x: 200, y: 200, w: 800 + 50 * SCALE, h: 600 + 25 * SCALE });
  });

  it("la poignée haut-droite étire à droite et remonte le haut", () => {
    const r = drag("tr", 50, 25);

    expect(r).toMatchObject({ x: 200, y: 200 + 25 * SCALE, w: 800 + 50 * SCALE });
  });

  it("la poignée bas-gauche déplace le bord gauche et étire vers le bas", () => {
    const r = drag("bl", 50, 25);

    expect(r).toMatchObject({ x: 200 + 50 * SCALE, w: 800 - 50 * SCALE, h: 600 + 25 * SCALE });
  });

  it("garde une sélection d’au moins 20 px", () => {
    // On tire la poignée gauche bien au-delà du bord droit.
    const r = drag("tl", 1000, 1000);

    expect(r.w).toBeGreaterThanOrEqual(20);
    expect(r.h).toBeGreaterThanOrEqual(20);
  });

  it("ne laisse pas la sélection sortir par le haut ni par la gauche", () => {
    const r = drag("tl", -1000, -1000);

    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it("ne laisse pas la sélection dépasser la taille de la source", () => {
    const r = drag("br", 1000, 1000);

    expect(r.x + r.w).toBeLessThanOrEqual(1920);
    expect(r.y + r.h).toBeLessThanOrEqual(1080);
  });

  /** Glisse la sélection entière (poignée « move ») de (dx, dy) pixels écran. */
  function dragBox(dx: number, dy: number) {
    const onChangeLive = vi.fn();
    const { container } = render(
      <LangProvider>
        <Harness crop={base} onChangeLive={onChangeLive} />
      </LangProvider>,
    );
    const box = container.querySelector(".crop-box") as HTMLElement;
    box.setPointerCapture = () => {};
    const overlay = container.querySelector(".crop-overlay") as HTMLElement;

    fireEvent.pointerDown(box, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientX: dx, clientY: dy, pointerId: 1 });
    return onChangeLive.mock.calls[onChangeLive.mock.calls.length - 1]?.[0] as CropRect;
  }

  it("déplace la sélection sans changer sa taille", () => {
    expect(dragBox(50, 25)).toEqual({ x: 200 + 50 * SCALE, y: 200 + 25 * SCALE, w: 800, h: 600 });
  });

  it("bloque le déplacement contre les bords de la source", () => {
    // La sélection garde sa taille et vient se coller en bas à droite.
    expect(dragBox(5000, 5000)).toEqual({ x: 1920 - 800, y: 1080 - 600, w: 800, h: 600 });
    expect(dragBox(-5000, -5000)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });
});

describe("CropOverlay — cadrage initial", () => {
  // Opening the panel must not record a crop: it would be exported (and trip a
  // rotation) even if the user never touched it.
  it("montre toute l’image sans enregistrer de recadrage", () => {
    const onChange = vi.fn();
    const onChangeLive = vi.fn();

    const { container } = render(
      <LangProvider>
        <Harness onChange={onChange} onChangeLive={onChangeLive} />
      </LangProvider>,
    );

    expect(container.querySelector(".crop-dimensions")?.textContent).toBe("1920 × 1080");
    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeLive).not.toHaveBeenCalled();
  });

  it("respecte un recadrage déjà posé", () => {
    const onChange = vi.fn();
    const crop = { x: 10, y: 20, w: 100, h: 200 };

    const { container } = render(
      <LangProvider>
        <Harness crop={crop} onChange={onChange} />
      </LangProvider>,
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector(".crop-dimensions")?.textContent).toBe("100 × 200");
  });

  it("se recalcule quand la fenêtre est redimensionnée", () => {
    const { container } = render(
      <LangProvider>
        <Harness crop={{ x: 0, y: 0, w: 960, h: 540 }} />
      </LangProvider>,
    );
    const before = (container.querySelector(".crop-box") as HTMLElement).style.width;

    fireEvent(window, new Event("resize"));

    expect((container.querySelector(".crop-box") as HTMLElement).style.width).toBe(before);
  });
});
describe("CropOverlay — formats réseaux sociaux", () => {
  function setup(crop: CropRect | null = null) {
    const onChangeLive = vi.fn();
    const onCommit = vi.fn();
    const { container, getByRole } = render(
      <LangProvider>
        <Harness crop={crop} onChangeLive={onChangeLive} onCommit={onCommit} />
      </LangProvider>,
    );
    const chip = (name: string) =>
      Array.from(container.querySelectorAll(".crop-aspect")).find((b) => b.textContent === name) as HTMLElement;
    return { container, onChangeLive, onCommit, chip, getByRole };
  }

  it("offers free-form and the four ratios", () => {
    const { container } = setup();
    expect(Array.from(container.querySelectorAll(".crop-aspect")).map((b) => b.textContent)).toEqual([
      "Free",
      "9:16",
      "4:5",
      "1:1",
      "16:9",
    ]);
  });

  it("picking 9:16 puts the largest centred 9:16 box on a 1920×1080 frame, as one undo step", () => {
    const { chip, onChangeLive, onCommit } = setup();
    fireEvent.click(chip("9:16"));
    expect(onChangeLive).toHaveBeenCalledWith({ x: 656, y: 0, w: 608, h: 1080 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('marks the chosen ratio as pressed, and "Free" does not touch the box', () => {
    const { chip, onChangeLive } = setup();
    fireEvent.click(chip("1:1"));
    expect(chip("1:1").getAttribute("aria-pressed")).toBe("true");
    onChangeLive.mockClear();
    fireEvent.click(chip("Free"));
    expect(chip("Free").getAttribute("aria-pressed")).toBe("true");
    expect(onChangeLive).not.toHaveBeenCalled();
  });

  it("keeps the ratio while a corner is dragged once one is picked", () => {
    const { container, chip, onChangeLive } = setup({ x: 200, y: 200, w: 400, h: 400 });
    fireEvent.click(chip("1:1"));
    onChangeLive.mockClear();
    const overlay = container.querySelector(".crop-overlay") as HTMLElement;
    const handle = container.querySelector(".crop-handle-br") as HTMLElement;
    handle.setPointerCapture = () => {};
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientX: 50, clientY: 10, pointerId: 1 });
    const r = onChangeLive.mock.calls[onChangeLive.mock.calls.length - 1][0] as CropRect;
    expect(r.w).toBe(r.h);
    expect(r.w).toBeGreaterThan(400);
  });
});
