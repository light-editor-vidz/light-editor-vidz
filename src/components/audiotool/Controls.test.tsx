import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Controls from "./Controls";
import { DEFAULT_SETTINGS, type AudioSettings } from "../../lib/audiotool/settings";

function setup(over: Partial<AudioSettings> = {}, invalidField: string | null = null) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <Controls
      settings={{ ...DEFAULT_SETTINGS, ...over }}
      sampleRate={44100}
      invalidField={invalidField}
      onChange={onChange}
      onCommit={onCommit}
    />,
  );
  return { onChange, onCommit };
}

describe("Controls — fondus", () => {
  it("un curseur de fondu change en direct, et le geste se valide au relâchement", () => {
    const { onChange, onCommit } = setup();

    const fadeIn = screen.getByLabelText("Fade in");
    fireEvent.change(fadeIn, { target: { value: "2.5" } });
    expect(onChange).toHaveBeenCalledWith({ fadeIn: 2.5 }, false);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(fadeIn);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("le clavier valide aussi un geste de curseur", () => {
    const { onCommit } = setup();

    fireEvent.keyUp(screen.getByLabelText("Fade out"), { key: "ArrowRight" });

    expect(onCommit).toHaveBeenCalled();
  });

  it("affiche la durée des fondus", () => {
    setup({ fadeIn: 1.5, fadeOut: 0 });
    expect(screen.getByText("1.5s")).toBeInTheDocument();
    expect(screen.getByText("0.0s")).toBeInTheDocument();
  });

  it("choisit la courbe, et l'enregistre tout de suite", () => {
    const { onChange } = setup();

    expect(screen.getByRole("button", { name: "Linear" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Equal power" }));

    expect(onChange).toHaveBeenCalledWith({ fadeCurve: "equal-power" }, true);
  });

  it("signale le fondu que l'export refuserait", () => {
    setup({}, "fadeout");
    expect(screen.getByLabelText("Fade out")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Fade in")).not.toHaveAttribute("aria-invalid");
  });
});

describe("Controls — volume et vitesse", () => {
  it("la normalisation s'enregistre tout de suite", () => {
    const { onChange } = setup();

    fireEvent.click(screen.getByLabelText("Normalise (peak −1 dBFS)"));

    expect(onChange).toHaveBeenCalledWith({ normalize: true }, true);
  });

  it("affiche la vitesse courante et ses préréglages", () => {
    setup({ speedStep: 6 });

    expect(screen.getByText("2x", { selector: ".at-speed-display" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2x" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1x" })).toHaveAttribute("aria-pressed", "false");
  });

  it("un préréglage de vitesse s'enregistre tout de suite", () => {
    const { onChange } = setup();

    fireEvent.click(screen.getByRole("button", { name: "0.5x" }));

    expect(onChange).toHaveBeenCalledWith({ speedStep: 1 }, true);
  });

  it("le curseur de vitesse change par pas et se valide au relâchement", () => {
    const { onChange, onCommit } = setup();

    const slider = screen.getByLabelText("Speed");
    fireEvent.change(slider, { target: { value: "8" } });
    fireEvent.pointerUp(slider);

    expect(onChange).toHaveBeenCalledWith({ speedStep: 8 }, false);
    expect(onCommit).toHaveBeenCalled();
  });
});

describe("Controls — filtre", () => {
  it("n'affiche aucun réglage tant qu'aucun filtre n'est choisi", () => {
    setup();

    expect(screen.getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Slope")).not.toBeInTheDocument();
  });

  it.each([
    ["Low-pass", "lowpass"],
    ["High-pass", "highpass"],
    ["Band-pass", "bandpass"],
  ])("choisir %s enregistre le filtre", (label, type) => {
    const { onChange } = setup();

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(onChange).toHaveBeenCalledWith({ filterType: type }, true);
  });

  it("un passe-bas montre la coupure, la pente et Q", () => {
    setup({ filterType: "lowpass", filterFreq: 2000 });

    expect(screen.getByLabelText("Cutoff")).toHaveValue(2000);
    expect(screen.getByLabelText("Slope")).toBeInTheDocument();
    expect(screen.getByLabelText("Q")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bandwidth")).not.toBeInTheDocument();
  });

  it("un passe-bande montre le centre et la largeur, sans pente ni Q", () => {
    setup({ filterType: "bandpass" });

    expect(screen.getByLabelText("Centre")).toBeInTheDocument();
    expect(screen.getByLabelText("Bandwidth")).toBeInTheDocument();
    expect(screen.queryByLabelText("Slope")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Q")).not.toBeInTheDocument();
  });

  it("change la fréquence en direct et valide à la perte du focus", () => {
    const { onChange, onCommit } = setup({ filterType: "lowpass" });

    const freq = screen.getByLabelText("Cutoff");
    fireEvent.change(freq, { target: { value: "3000" } });
    expect(onChange).toHaveBeenCalledWith({ filterFreq: 3000 }, false);

    fireEvent.blur(freq);
    expect(onCommit).toHaveBeenCalled();
  });

  it("borne la fréquence au Nyquist du fichier", () => {
    const { onChange } = setup({ filterType: "lowpass" });

    fireEvent.change(screen.getByLabelText("Cutoff"), { target: { value: "99999" } });

    expect(onChange).toHaveBeenCalledWith({ filterFreq: 22049 }, false);
  });

  it("change la pente, et grise Q dès qu'elle dépasse 12 dB/octave", () => {
    const { onChange } = setup({ filterType: "lowpass" });
    expect(screen.getByLabelText("Q")).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Slope"), { target: { value: "36" } });

    expect(onChange).toHaveBeenCalledWith({ filterSlope: 36 }, true);
  });

  it("Q est grisé sur un filtre plus raide", () => {
    setup({ filterType: "highpass", filterSlope: 24 });
    expect(screen.getByLabelText("Q")).toBeDisabled();
  });

  it("change la largeur d'un passe-bande", () => {
    const { onChange } = setup({ filterType: "bandpass" });

    fireEvent.change(screen.getByLabelText("Bandwidth"), { target: { value: "200" } });

    expect(onChange).toHaveBeenCalledWith({ filterBandwidth: 200 }, false);
  });

  it("signale le champ de filtre que l'export refuserait", () => {
    setup({ filterType: "lowpass" }, "filter-freq");
    expect(screen.getByLabelText("Cutoff").closest(".at-unit")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("Controls — coupes", () => {
  it("rappelle comment couper, et compte les coupes", () => {
    setup({ cuts: [{ id: "a", start: 1, end: 2 }] });

    expect(screen.getByText(/drag to select the parts to remove/i)).toBeInTheDocument();
    expect(screen.getByText("1 cut", { selector: ".at-count" })).toBeInTheDocument();
  });
});
