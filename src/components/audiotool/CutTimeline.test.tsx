import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CutTimeline from "./CutTimeline";
import { createPlaybackClock } from "../../lib/playbackClock";
import type { Cut } from "../../lib/audiotool/cuts";

const DURATION = 100;
/** La piste fait 1000 px de large : 10 px par seconde. */
const RECT = { left: 0, top: 0, right: 1000, bottom: 100, width: 1000, height: 100, x: 0, y: 0 } as DOMRect;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  Element.prototype.getBoundingClientRect = () => RECT;
});

const cut = (id: string, start: number, end: number): Cut => ({ id, start, end });

function setup(cuts: Cut[] = [], selectedId: string | null = null) {
  const handlers = {
    onCutsChange: vi.fn(),
    onSelect: vi.fn(),
    onSeekReal: vi.fn(),
    onMark: vi.fn(),
    onSeekBy: vi.fn(),
  };
  const view = render(
    <CutTimeline
      duration={DURATION}
      waveform={[0.2, 0.8, 0.5]}
      cuts={cuts}
      kept={[{ start: 0, end: DURATION }]}
      selectedId={selectedId}
      clock={createPlaybackClock(0)}
      {...handlers}
    />,
  );
  const track = screen.getByTestId("cut-track");
  return { ...handlers, ...view, track };
}

/** Un glissé du pointeur sur la piste, de `from` à `to` pixels. */
function drag(track: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(track, { clientX: from, button: 0 });
  fireEvent.pointerMove(track, { clientX: to });
  fireEvent.pointerUp(track, { clientX: to });
}

describe("CutTimeline — marquer des coupes", () => {
  it("un glissé sur la piste crée une coupe, qui devient la sélection", () => {
    const { track, onCutsChange } = setup();

    drag(track, 100, 300);

    expect(onCutsChange).toHaveBeenCalledTimes(1);
    const [cuts, selected] = onCutsChange.mock.calls[0];
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ start: 10, end: 30 });
    expect(selected).toBe(cuts[0].id);
  });

  it("marche aussi de droite à gauche", () => {
    const { track, onCutsChange } = setup();

    drag(track, 300, 100);

    expect(onCutsChange.mock.calls[0][0][0]).toMatchObject({ start: 10, end: 30 });
  });

  it("montre la coupe en cours de tracé sans encore la valider", () => {
    const { track, onCutsChange, container } = setup();

    fireEvent.pointerDown(track, { clientX: 100, button: 0 });
    fireEvent.pointerMove(track, { clientX: 300 });

    expect(container.querySelector(".at-cut.draft")).not.toBeNull();
    expect(onCutsChange).not.toHaveBeenCalled();
  });

  it("un simple clic déplace la tête de lecture au lieu de créer une coupe", () => {
    const { track, onCutsChange, onSeekReal } = setup();

    drag(track, 250, 250);

    expect(onSeekReal).toHaveBeenCalledWith(25);
    expect(onCutsChange).not.toHaveBeenCalled();
  });

  it("fusionne une nouvelle coupe avec celle qu'elle touche", () => {
    const { track, onCutsChange } = setup([cut("a", 10, 30)]);

    // Part de 35 s (hors de la coupe) vers 25 s : la nouvelle coupe 25–35 chevauche 10–30.
    drag(track, 350, 250);

    const [cuts, selected] = onCutsChange.mock.calls[0];
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ id: "a", start: 10, end: 35 });
    expect(selected).toBe("a");
  });

  it("ignore un clic droit", () => {
    const { track, onCutsChange } = setup();

    fireEvent.pointerDown(track, { clientX: 100, button: 2 });
    fireEvent.pointerUp(track, { clientX: 300 });

    expect(onCutsChange).not.toHaveBeenCalled();
  });

  it("une interruption du pointeur n'ajoute rien", () => {
    const { track, onCutsChange, onSeekReal } = setup();

    fireEvent.pointerDown(track, { clientX: 100, button: 0 });
    fireEvent.pointerMove(track, { clientX: 300 });
    fireEvent.pointerCancel(track);

    expect(onCutsChange).not.toHaveBeenCalled();
    expect(onSeekReal).not.toHaveBeenCalled();
  });
});

describe("CutTimeline — modifier une coupe", () => {
  it("déplace une coupe en la glissant par son milieu", () => {
    const { track, onCutsChange, onSelect } = setup([cut("a", 20, 40)]);

    drag(track, 300, 400);

    expect(onSelect).toHaveBeenCalledWith("a");
    expect(onCutsChange.mock.calls[0][0][0]).toMatchObject({ id: "a", start: 30, end: 50 });
  });

  it("garde la coupe dans le fichier quand on la pousse au-delà de la fin", () => {
    const { track, onCutsChange } = setup([cut("a", 80, 90)]);

    drag(track, 850, 990);

    expect(onCutsChange.mock.calls[0][0][0]).toMatchObject({ start: 90, end: 100 });
  });

  it("redimensionne par le bord gauche", () => {
    const { track, onCutsChange } = setup([cut("a", 20, 40)]);

    drag(track, 202, 100);

    expect(onCutsChange.mock.calls[0][0][0]).toMatchObject({ start: 10, end: 40 });
  });

  it("redimensionne par le bord droit, sans passer sous la longueur minimale", () => {
    const { track, onCutsChange } = setup([cut("a", 20, 40)]);

    drag(track, 398, 0);

    const [updated] = onCutsChange.mock.calls[0][0];
    expect(updated.start).toBe(20);
    expect(updated.end).toBeCloseTo(20.05);
  });

  it("fusionne deux coupes quand on pousse l'une sur l'autre", () => {
    const { track, onCutsChange } = setup([cut("a", 10, 20), cut("b", 40, 50)]);

    // « a » (10–20) saisie à 15 s et poussée jusqu'à 40 s devient 35–45 : elle mord sur 40–50.
    drag(track, 150, 400);

    const [cuts] = onCutsChange.mock.calls[0];
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ id: "a", start: 35, end: 50 });
  });

  it("la croix d'une coupe la supprime sans déclencher de glissé", () => {
    const { onCutsChange, onSeekReal } = setup([cut("a", 20, 40), cut("b", 60, 70)]);

    const first = document.querySelector('[data-id="a"]') as HTMLElement;
    fireEvent.click(within(first).getByRole("button", { name: "Delete cut" }));

    expect(onCutsChange).toHaveBeenCalledWith([cut("b", 60, 70)], null);
    expect(onSeekReal).not.toHaveBeenCalled();
  });

  it("Tout effacer vide les coupes", () => {
    const { onCutsChange } = setup([cut("a", 20, 40)]);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(onCutsChange).toHaveBeenCalledWith([], null);
  });
});

describe("CutTimeline — affichage", () => {
  it("compte les coupes, au singulier et au pluriel", () => {
    const { rerender } = setup([cut("a", 1, 2)]);
    expect(screen.getByText("1 cut")).toBeInTheDocument();
    rerender(
      <CutTimeline
        duration={DURATION}
        waveform={[0.5]}
        cuts={[cut("a", 1, 2), cut("b", 5, 6)]}
        kept={[]}
        selectedId={null}
        clock={createPlaybackClock(0)}
        onCutsChange={vi.fn()}
        onSelect={vi.fn()}
        onSeekReal={vi.fn()}
        onMark={vi.fn()}
        onSeekBy={vi.fn()}
      />,
    );
    expect(screen.getByText("2 cuts")).toBeInTheDocument();
  });

  it("place la coupe selon ses temps, en pourcentage de la durée", () => {
    setup([cut("a", 25, 75)]);

    const node = document.querySelector('[data-id="a"]') as HTMLElement;
    expect(node.style.left).toBe("25%");
    expect(node.style.width).toBe("50%");
  });

  it("marque la coupe sélectionnée et affiche sa durée", () => {
    setup([cut("a", 0, 65)], "a");

    const node = document.querySelector('[data-id="a"]') as HTMLElement;
    expect(node).toHaveClass("selected");
    expect(within(node).getByText("1:05")).toBeInTheDocument();
  });

  it("gradue la règle sur des nombres ronds", () => {
    const { container } = setup();

    const labels = [...container.querySelectorAll(".at-tick span")].map((n) => n.textContent);
    // 100 s : un repère toutes les 10 s.
    expect(labels.slice(0, 3)).toEqual(["0:00", "0:10", "0:20"]);
    expect(labels).toHaveLength(11);
  });
});

describe("CutTimeline — coupe sélectionnée", () => {
  it("invite à en sélectionner une quand il n'y en a pas", () => {
    setup();
    expect(screen.getByText("Click a cut to edit its times")).toBeInTheDocument();
  });

  it("affiche les temps de la coupe sélectionnée en m:ss.t", () => {
    setup([cut("a", 61.5, 70)], "a");

    expect(screen.getByDisplayValue("1:01.5")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1:10.0")).toBeInTheDocument();
    expect(screen.getByText("(0:08.5)")).toBeInTheDocument();
  });

  it("applique un temps tapé à la perte du focus", () => {
    const { onCutsChange } = setup([cut("a", 10, 20)], "a");

    const start = screen.getByDisplayValue("0:10.0");
    fireEvent.focus(start);
    fireEvent.change(start, { target: { value: "0:05" } });
    fireEvent.blur(start);

    expect(onCutsChange).toHaveBeenCalledWith([cut("a", 5, 20)], "a");
  });

  it("ignore un champ laissé intact ou un texte invalide", () => {
    const { onCutsChange } = setup([cut("a", 10, 20)], "a");

    const end = screen.getByDisplayValue("0:20.0");
    fireEvent.focus(end);
    fireEvent.blur(end);
    fireEvent.focus(end);
    fireEvent.change(end, { target: { value: "n'importe quoi" } });
    fireEvent.blur(end);

    expect(onCutsChange).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("0:20.0")).toBeInTheDocument();
  });

  it("borne la fin au fichier et garde la longueur minimale", () => {
    const { onCutsChange } = setup([cut("a", 10, 20)], "a");

    const end = screen.getByDisplayValue("0:20.0");
    fireEvent.focus(end);
    fireEvent.change(end, { target: { value: "9:00" } });
    fireEvent.blur(end);

    expect(onCutsChange.mock.calls[0][0][0]).toMatchObject({ start: 10, end: 100 });
  });

  it("Entrée valide le champ", () => {
    const { onCutsChange } = setup([cut("a", 10, 20)], "a");

    const start = screen.getByDisplayValue("0:10.0");
    start.focus();
    fireEvent.change(start, { target: { value: "0:02" } });
    fireEvent.keyDown(start, { key: "Enter" });

    expect(onCutsChange).toHaveBeenCalledWith([cut("a", 2, 20)], "a");
  });

  it("le bouton de la ligne supprime la coupe sélectionnée", () => {
    const { onCutsChange } = setup([cut("a", 10, 20)], "a");

    const buttons = screen.getAllByRole("button", { name: "Delete cut" });
    fireEvent.click(buttons[buttons.length - 1]);

    expect(onCutsChange).toHaveBeenCalledWith([], null);
  });
});

describe("CutTimeline — clavier", () => {
  const waveform = () => screen.getByRole("img");

  it("I puis O marquent le début et la fin d'une coupe à la tête de lecture", () => {
    const { onMark } = setup();

    fireEvent.keyDown(waveform(), { key: "i" });
    fireEvent.keyDown(waveform(), { key: "o" });

    expect(onMark.mock.calls).toEqual([["start"], ["end"]]);
  });

  it("les flèches déplacent la tête de 1 s, de 5 s avec Maj", () => {
    const { onSeekBy } = setup();

    fireEvent.keyDown(waveform(), { key: "ArrowRight" });
    fireEvent.keyDown(waveform(), { key: "ArrowLeft", shiftKey: true });

    expect(onSeekBy.mock.calls).toEqual([[1], [-5]]);
  });

  it("laisse passer les autres touches", () => {
    const { onMark, onSeekBy } = setup();

    fireEvent.keyDown(waveform(), { key: "x" });

    expect(onMark).not.toHaveBeenCalled();
    expect(onSeekBy).not.toHaveBeenCalled();
  });
});
